import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function spawnFixtureServer(directory: string, port: number, script: string) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href,
      "--input-type",
      "module",
      "--eval",
      script,
    ],
    {
      cwd: directory,
      env: { ...process.env, PORT: String(port), NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream?.on("data", (data: Buffer) => {
      output += data.toString();
    });
  return { child, logs: () => output };
}
