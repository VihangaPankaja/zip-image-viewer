import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import WebTorrent, { type Torrent } from "webtorrent";
import { path7za } from "7zip-bin";
import { runCommand } from "../../server/infrastructure/process/commandRunner.js";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { expect, it } from "vitest";
import { serverContract } from "../../shared/contracts.js";

async function startServer(directory: string) {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  if (!address || typeof address === "string")
    throw new Error("Missing server port");
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
      `process.on("message", (message) => { if (message === "shutdown") process.emit("SIGTERM"); }); await import(${JSON.stringify(pathToFileURL(path.resolve("server/index.ts")).href)});`,
    ],
    {
      cwd: directory,
      env: { ...process.env, PORT: String(address.port), NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const client: ContractRouterClient<typeof serverContract> = createORPCClient(
    new RPCLink({ url: `${origin}/rpc` }),
  );
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (child.exitCode !== null) throw new Error(output);
    if (
      await fetch(`${origin}/health`)
        .then(
          async (response) =>
            response.ok &&
            ((await response.json()) as { ready?: unknown }).ready === true,
        )
        .catch(() => false)
    )
      return { child, client, origin };
    await delay(50);
  }
  child.kill("SIGKILL");
  throw new Error(`Server startup timed out: ${output}`);
}

async function stopServer(child: ChildProcess, force = false) {
  if (child.exitCode !== null) return;
  const exited = once(child, "exit");
  if (force) child.kill("SIGKILL");
  else child.send("shutdown");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const code: unknown = (await exited)[0];
    if (!force) expect(code).toBe(0);
  } finally {
    clearTimeout(timeout);
  }
}

it("retains and reverifies selective downloads across graceful and forced restarts, then fetches skipped files with piece reuse", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "retained-server-"));
  const seedDirectory = path.join(directory, "fixture");
  await mkdir(seedDirectory);
  const contents = [32_771, 32_775, 1_000_009].map((size, file) =>
    Buffer.from(
      Array.from(
        { length: size },
        (_, index) => (index * 17 + (index >> 7) + file * 39) % 256,
      ),
    ),
  );
  for (let file = 0; file < contents.length; file += 1)
    await writeFile(path.join(seedDirectory, `${file}.bin`), contents[file]);
  let seed = new WebTorrent({
    dht: false,
    tracker: false,
    lsd: false,
    utp: false,
    natUpnp: false,
    natPmp: false,
  });
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  const currentClient = () => {
    if (!server) throw new Error("Server is not running");
    return server.client;
  };
  try {
    const options = { announce: [], private: true, pieceLength: 16_384 };
    const torrent = await new Promise<Torrent>((resolve) =>
      seed.seed(seedDirectory, options, resolve),
    );
    const requests: number[] = [];
    torrent.on("wire", (wire) =>
      wire.on("request", (piece) => requests.push(piece)),
    );
    const source = `${torrent.magnetURI}&x.pe=127.0.0.1:${seed.torrentPort}`;
    server = await startServer(directory);
    const { items } = await server.client.jobs.enqueue({
      items: [{ url: source }],
    });
    const id = items[0].id;
    await expect
      .poll(async () => (await currentClient().jobs.list()).items[0].status, {
        timeout: 20_000,
      })
      .toBe("awaiting_selection");
    expect(requests).toEqual([]);
    await server.client.jobs.selectFiles({ id, fileIds: ["0"] });
    await expect
      .poll(async () => (await currentClient().jobs.list()).items[0].status, {
        timeout: 20_000,
      })
      .toBe("ready");
    let job = (await server.client.jobs.list()).items[0];
    const sessionId = job.sessionId;
    const downloadDir = path.join(
      directory,
      "sessions",
      id,
      "torrent",
      "fixture",
    );
    expect(await readFile(path.join(downloadDir, "0.bin"))).toEqual(
      contents[0],
    );
    expect(new Set(requests)).toEqual(new Set([0, 1, 2]));
    const firstRequests = requests.length;
    const eventStream = await fetch(
      `${server.origin}/api/session-jobs/${id}/events`,
    );
    expect(eventStream.status).toBe(200);
    await stopServer(server.child);
    await eventStream.body?.cancel();
    const seedPort = seed.torrentPort;
    await new Promise<void>((resolve) => seed.destroy(() => resolve()));
    server = await startServer(directory);
    job = (await server.client.jobs.list()).items[0];
    expect(job).toMatchObject({ id, status: "ready", sessionId });
    expect(requests.length).toBe(firstRequests);
    expect(
      await fetch(`${server.origin}/api/sessions/${sessionId}`, {
        method: "DELETE",
      }).then((response) => response.status),
    ).toBe(204);
    expect(
      await fetch(`${server.origin}/api/session-jobs/${id}?release=true`, {
        method: "DELETE",
      }).then((response) => response.status),
    ).toBe(204);
    expect((await server.client.jobs.list()).items[0].status).toBe("ready");
    expect(await readFile(path.join(downloadDir, "0.bin"))).toEqual(
      contents[0],
    );
    seed = new WebTorrent({
      torrentPort: seedPort,
      dht: false,
      tracker: false,
      lsd: false,
      utp: false,
      natUpnp: false,
      natPmp: false,
    });
    const reseeded = await new Promise<Torrent>((resolve) =>
      seed.seed(seedDirectory, options, resolve),
    );
    reseeded.on("wire", (wire) =>
      wire.on("request", (piece) => requests.push(piece)),
    );
    await server.client.jobs.selectFiles({ id, fileIds: ["1"] });
    await expect
      .poll(async () => (await currentClient().jobs.list()).items[0].status, {
        timeout: 20_000,
      })
      .toBe("ready");
    job = (await server.client.jobs.list()).items[0];
    expect(job.torrentFiles.map((file) => file.selected)).toEqual([
      true,
      true,
      false,
    ]);
    expect(job.sessionId).toBe(sessionId);
    expect(
      requests.slice(firstRequests).every((piece) => piece > 2 && piece <= 4),
    ).toBe(true);
    expect(await readFile(path.join(downloadDir, "0.bin"))).toEqual(
      contents[0],
    );
    expect(await readFile(path.join(downloadDir, "1.bin"))).toEqual(
      contents[1],
    );
    const tree: unknown = await fetch(
      `${server.origin}/api/sessions/${sessionId}/tree`,
    ).then((response) => response.json());
    expect(JSON.stringify(tree)).toContain("0.bin");
    expect(JSON.stringify(tree)).toContain("1.bin");
    await stopServer(server.child, true);
    // Same-size corruption and a missing file must not inherit saved completion.
    await writeFile(
      path.join(downloadDir, "0.bin"),
      Buffer.alloc(contents[0].length, 0),
    );
    await rm(path.join(downloadDir, "1.bin"));
    server = await startServer(directory);
    job = (await server.client.jobs.list()).items[0];
    expect(job.status).toBe("paused");
    expect(job.torrentFiles.slice(0, 2).map((file) => file.complete)).toEqual([
      false,
      false,
    ]);
    expect((await server.client.sessions.list()).items).toEqual([]);
    await server.client.jobs.resume({ id });
    await expect
      .poll(async () => (await currentClient().jobs.list()).items[0].status, {
        timeout: 20_000,
      })
      .toBe("ready");
    expect(await readFile(path.join(downloadDir, "0.bin"))).toEqual(
      contents[0],
    );
    expect(await readFile(path.join(downloadDir, "1.bin"))).toEqual(
      contents[1],
    );
    seed.throttleUpload(16_384);
    await server.client.jobs.selectFiles({ id, fileIds: ["2"] });
    await expect
      .poll(
        async () =>
          (await currentClient().jobs.list()).items[0].downloadedBytes,
        { timeout: 20_000 },
      )
      .toBeGreaterThan(contents[0].length + contents[1].length);
    const port = seed.torrentPort;
    expect(
      await fetch(`${server.origin}/api/session-jobs/${id}`, {
        method: "DELETE",
      }).then((response) => response.status),
    ).toBe(409);
    if (!seed.destroyed)
      await new Promise<void>((resolve) => seed.destroy(() => resolve()));
    await expect
      .poll(
        async () => (await currentClient().jobs.list()).items[0].peerCount,
        { timeout: 20_000 },
      )
      .toBe(0);
    job = (await server.client.jobs.list()).items[0];
    expect(job.torrentFiles[2].complete).toBe(false);
    expect(
      await fetch(
        `${server.origin}/api/sessions/${sessionId}/file?path=fixture%2F2.bin`,
      ).then((response) => response.status),
    ).toBe(404);
    await server.client.jobs.pause({ id });
    await expect
      .poll(async () => (await currentClient().jobs.list()).items[0].phase)
      .toBe("paused");
    await stopServer(server.child);
    server = await startServer(directory);
    expect((await server.client.jobs.list()).items[0].status).toBe("paused");
    const restoredTree: unknown = await fetch(
      `${server.origin}/api/sessions/${sessionId}/tree`,
    ).then((response) => response.json());
    expect(JSON.stringify(restoredTree)).toContain("0.bin");
    expect(JSON.stringify(restoredTree)).toContain("1.bin");
    expect(JSON.stringify(restoredTree)).not.toContain("2.bin");
    seed = new WebTorrent({
      torrentPort: port,
      dht: false,
      tracker: false,
      lsd: false,
      utp: false,
      natUpnp: false,
      natPmp: false,
    });
    await new Promise<Torrent>((resolve) =>
      seed.seed(seedDirectory, options, resolve),
    );
    await server.client.jobs.resume({ id });
    await expect
      .poll(async () => (await currentClient().jobs.list()).items[0].status, {
        timeout: 20_000,
      })
      .toBe("ready");
    expect(await readFile(path.join(downloadDir, "2.bin"))).toEqual(
      contents[2],
    );
    expect(
      await fetch(`${server.origin}/api/session-jobs/${id}`, {
        method: "DELETE",
      }).then((response) => response.status),
    ).toBe(204);
    expect((await server.client.jobs.list()).items).toEqual([]);
    await expect(
      readFile(path.join(downloadDir, "0.bin")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await stopServer(server.child);
    server = await startServer(directory);
    expect((await server.client.jobs.list()).items).toEqual([]);
  } finally {
    if (server) await stopServer(server.child, true);
    if (!seed.destroyed)
      await new Promise<void>((resolve) => seed.destroy(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);

it("preserves extracted archive paths when adding siblings and restoring offline", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "retained-archive-"));
  const sourceDir = path.join(directory, "source");
  await mkdir(sourceDir);
  await writeFile(path.join(sourceDir, "notes.txt"), "retained archive notes");
  await mkdir(path.join(sourceDir, "torrent files"));
  await writeFile(
    path.join(sourceDir, "torrent files", "collision.txt"),
    "archive owns this folder",
  );
  const bundle = path.join(directory, "bundle");
  await mkdir(bundle);
  const archive = path.join(bundle, "notes.zip");
  await runCommand(
    path7za,
    ["a", "-tzip", archive, "notes.txt", "torrent files"],
    {
      cwd: sourceDir,
    },
  );
  await writeFile(path.join(bundle, "sibling.txt"), "added sibling");
  await runCommand(
    path7za,
    ["a", "-tzip", path.join(bundle, "earlier.zip"), "notes.txt"],
    { cwd: sourceDir },
  );
  const original = await readFile(archive);
  const seed = new WebTorrent({
    dht: false,
    tracker: false,
    lsd: false,
    utp: false,
    natUpnp: false,
    natPmp: false,
  });
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    const torrent = await new Promise<Torrent>((resolve) =>
      seed.seed(bundle, { announce: [], private: true }, resolve),
    );
    server = await startServer(directory);
    const { items } = await server.client.jobs.enqueue({
      items: [
        { url: `${torrent.magnetURI}&x.pe=127.0.0.1:${seed.torrentPort}` },
      ],
    });
    const client = server.client;
    await expect
      .poll(async () => (await client.jobs.list()).items[0].status, {
        timeout: 20_000,
      })
      .toBe("awaiting_selection");
    const files = (await client.jobs.list()).items[0].torrentFiles;
    const archiveFile = files.find((file) => file.path.endsWith("/notes.zip"));
    if (!archiveFile) throw new Error("Missing archive fixture");
    await client.jobs.selectFiles({
      id: items[0].id,
      fileIds: [archiveFile.id],
    });
    await expect
      .poll(async () => (await client.jobs.list()).items[0].status, {
        timeout: 20_000,
      })
      .toBe("ready");
    const job = (await client.jobs.list()).items[0];
    const fileUrl = (relativePath: string) =>
      `${server?.origin}/api/sessions/${job.sessionId}/file?path=${encodeURIComponent(relativePath)}`;
    expect(
      await fetch(fileUrl("notes.txt")).then((response) => response.text()),
    ).toBe("retained archive notes");
    await client.jobs.selectFiles({
      id: job.id,
      fileIds: files
        .filter((file) => file.id !== archiveFile.id)
        .map((file) => file.id),
    });
    await expect
      .poll(async () => (await client.jobs.list()).items[0].status, {
        timeout: 20_000,
      })
      .toBe("ready");
    expect((await client.jobs.list()).items[0].sessionId).toBe(job.sessionId);
    expect(
      await fetch(fileUrl("notes.txt")).then((response) => response.text()),
    ).toBe("retained archive notes");
    expect(
      await fetch(fileUrl("Torrent files-/bundle/sibling.txt")).then(
        (response) => response.text(),
      ),
    ).toBe("added sibling");
    expect(
      await fetch(fileUrl("torrent files/collision.txt")).then((response) =>
        response.text(),
      ),
    ).toBe("archive owns this folder");
    await stopServer(server.child);
    await new Promise<void>((resolve) => seed.destroy(() => resolve()));
    server = await startServer(directory);
    expect((await server.client.jobs.list()).items[0]).toMatchObject({
      id: job.id,
      status: "ready",
      phase: "ready",
      sessionId: job.sessionId,
    });
    const tree: unknown = await fetch(
      `${server.origin}/api/sessions/${job.sessionId}/tree`,
    ).then((response) => response.json());
    expect(JSON.stringify(tree)).toContain("notes.txt");
    expect(
      await fetch(fileUrl("notes.txt")).then((response) => response.text()),
    ).toBe("retained archive notes");
    expect(
      await fetch(fileUrl("Torrent files-/bundle/sibling.txt")).then(
        (response) => response.text(),
      ),
    ).toBe("added sibling");
    expect(JSON.stringify(tree)).toContain("earlier.zip");
    expect(
      await readFile(
        path.join(
          directory,
          "sessions",
          job.id,
          "torrent",
          "bundle",
          "notes.zip",
        ),
      ),
    ).toEqual(original);
  } finally {
    if (server) await stopServer(server.child, true);
    if (!seed.destroyed)
      await new Promise<void>((resolve) => seed.destroy(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
