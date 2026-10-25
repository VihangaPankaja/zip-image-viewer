import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { serverContract } from "../../shared/contracts.js";

export async function startHttpRestartServer(directory: string, slowStage = "") {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("Missing TCP port");
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const origin = `http://127.0.0.1:${address.port}`;
  const child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href,
      "--input-type",
      "module",
      "--eval",
      `
      import dns from "node:dns";
      import fs from "node:fs";
      import { syncBuiltinESMExports } from "node:module";
      const lookup = dns.lookup;
      dns.lookup = function(host, options, callback) {
        if (host !== "download.example") return lookup.apply(this, arguments);
        if (typeof options === "function") { callback = options; options = {}; }
        queueMicrotask(() => options?.all ? callback(null, [{address:"127.0.0.1", family:4}]) : callback(null, "127.0.0.1", 4));
      };
      const create = fs.createWriteStream;
      fs.createWriteStream = function(filename, ...args) {
        const output = create.call(this, filename, ...args);
        const stage = ${JSON.stringify(slowStage)};
        if ((stage === "assembly" && String(filename).endsWith(".assembling")) ||
            (stage === "extraction" && String(filename).includes("extracted"))) {
          const write = output._write;
          output._write = function(chunk, encoding, callback) { setTimeout(() => write.call(this, chunk, encoding, callback), 25); };
        }
        return output;
      };
      syncBuiltinESMExports();
      process.on("message", message => { if (message === "shutdown") process.emit("SIGTERM"); });
      await import(${JSON.stringify(pathToFileURL(path.resolve("server/index.ts")).href)});
    `,
    ],
    {
      cwd: directory,
      env: { ...process.env, PORT: String(address.port), NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let output = "";
  child.stdout?.on("data", (data: Buffer) => {
    output += data.toString();
  });
  child.stderr?.on("data", (data: Buffer) => {
    output += data.toString();
  });
  const client: ContractRouterClient<typeof serverContract> = createORPCClient(
    new RPCLink({ url: `${origin}/rpc` }),
  );
  for (let attempt = 0; attempt < 600; attempt++) {
    if (child.exitCode !== null) throw new Error(output);
    if (
      await fetch(`${origin}/health`)
        .then(
          async (response) => response.ok && ((await response.json()) as { ready?: boolean }).ready,
        )
        .catch(() => false)
    )
      return { child, client, origin, logs: () => output };
    await delay(50);
  }
  child.kill("SIGKILL");
  throw new Error(`HTTP server startup timed out: ${output}`);
}

export async function stopHttpRestartServer(child: ChildProcess, force = false) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  if (force) child.kill("SIGKILL");
  else child.send("shutdown");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const code: unknown = (await exited)[0];
    if (!force && code !== 0) throw new Error(`HTTP server shutdown failed: ${String(code)}`);
  } finally {
    clearTimeout(timeout);
  }
}
