import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import ffmpegPath from "ffmpeg-static";
import WebTorrent, { type Torrent } from "webtorrent";
import { runCommand } from "../../server/infrastructure/process/commandRunner.js";
import { serverContract } from "../../shared/contracts.js";

export async function waitForPlayback<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeout = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  let value = await read();
  while (!accept(value)) {
    if (Date.now() >= deadline)
      throw new Error(`Torrent fixture condition timed out: ${JSON.stringify(value)}`);
    await delay(50);
    value = await read();
  }
  return value;
}

async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.send("shutdown");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
  try {
    await exited;
  } finally {
    clearTimeout(timeout);
  }
}

/** A real private swarm: no public discovery, synthetic progress, or HTTP media mocks. */
export async function startTorrentPlaybackFixture({
  serveApp = false,
  frontendOrigin,
}: { serveApp?: boolean; frontendOrigin?: string } = {}) {
  if (!ffmpegPath) throw new Error("ffmpeg-static is required for torrent playback tests");
  const directory = await mkdtemp(path.join(tmpdir(), "torrent-playback-"));
  const source = path.join(directory, "source");
  await mkdir(source);
  let child: ChildProcess | undefined;
  let proxy: Server | undefined;
  let seed: WebTorrent | undefined;
  let seedPort = 0;
  let uploadLimit = 256 * 1024;
  let magnetURI = "";
  let infoHash = "";
  const requests: number[] = [];
  const names = ["0-faststart.mp4", "1-tail-index.mp4", "2-unsupported.mkv"];
  const close = async () => {
    if (proxy) {
      proxy.closeAllConnections();
      await new Promise<void>((resolve) => proxy?.close(() => resolve()));
    }
    if (child) await stopChild(child);
    if (seed && !seed.destroyed)
      await new Promise<void>((resolve) => seed?.destroy(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await runCommand(
      ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=640x360:rate=24:duration=40",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-b:v",
        "1M",
        "-minrate",
        "1M",
        "-maxrate",
        "1M",
        "-bufsize",
        "2M",
        "-x264-params",
        "nal-hrd=cbr:force-cfr=1",
        "-g",
        "24",
        "-movflags",
        "+faststart",
        path.join(source, names[0]),
      ],
      { signal: AbortSignal.timeout(30_000) },
    );
    for (const name of names.slice(1))
      await runCommand(
        ffmpegPath,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          path.join(source, names[0]),
          "-c",
          "copy",
          path.join(source, name),
        ],
        { signal: AbortSignal.timeout(30_000) },
      );
    const files = await Promise.all(
      names.map(async (name, index) => ({
        id: String(index),
        name,
        bytes: await readFile(path.join(source, name)),
      })),
    );
    const connect = async () => {
      seed = new WebTorrent({
        dht: false,
        tracker: false,
        lsd: false,
        utp: false,
        natUpnp: false,
        natPmp: false,
      });
      seed.throttleUpload(uploadLimit);
      const torrent = await new Promise<Torrent>((resolve, reject) => {
        seed?.once("error", reject);
        const options = { announce: [], private: true, pieceLength: 16_384 };
        seed?.seed(source, options, resolve);
      });
      seedPort = seed.torrentPort;
      if (infoHash && torrent.infoHash !== infoHash)
        throw new Error("Reconnect changed the private torrent info hash");
      infoHash = torrent.infoHash;
      magnetURI = torrent.magnetURI;
      torrent.on("wire", (wire) => wire.on("request", (piece) => requests.push(piece)));
      child?.send({ peerPort: seedPort });
    };
    await connect();
    if (serveApp)
      await cp(path.resolve("dist"), path.join(directory, "dist"), {
        recursive: true,
      });
    const reservation = createServer().listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const address = reservation.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture port");
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    let origin = `http://127.0.0.1:${address.port}`;
    child = spawn(
      process.execPath,
      [
        "--import",
        pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href,
        "--input-type",
        "module",
        "--eval",
        `
      const { default: WebTorrent } = await import(${JSON.stringify(pathToFileURL(path.resolve("node_modules/webtorrent/index.js")).href)});
      const add = WebTorrent.prototype.add;
      const torrents = new Set();
      let peerAddress = "127.0.0.1:${seedPort}";
      const connect = (torrent) => { if (!torrent.destroyed) torrent.addPeer(peerAddress); };
      WebTorrent.prototype.add = function (...args) {
        const torrent = add.apply(this, args);
        torrents.add(torrent);
        torrent.once("close", () => torrents.delete(torrent));
        if (torrent.infoHash) connect(torrent); else torrent.once("infoHash", () => connect(torrent));
        return torrent;
      };
      process.on("message", (message) => {
        if (message === "shutdown") process.emit("SIGTERM");
        if (message && typeof message === "object" && typeof message.peerPort === "number") {
          peerAddress = "127.0.0.1:" + message.peerPort;
          for (const torrent of torrents) connect(torrent);
        }
      });
      await import(${JSON.stringify(pathToFileURL(path.resolve("server/index.ts")).href)});`,
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
    await waitForPlayback(
      async () => {
        if (child?.exitCode !== null) throw new Error(output);
        return fetch(`${origin}/health`, { signal: AbortSignal.timeout(1_000) })
          .then(
            async (response) =>
              response.ok && ((await response.json()) as { ready?: boolean }).ready === true,
          )
          .catch(() => false);
      },
      Boolean,
      60_000,
    ).catch((error: unknown) => {
      throw new Error(`Playback server startup failed: ${output}`, {
        cause: error,
      });
    });
    const client: ContractRouterClient<typeof serverContract> = createORPCClient(
      new RPCLink({ url: `${origin}/rpc` }),
    );
    if (frontendOrigin) {
      const backendOrigin = origin;
      proxy = createServer((req, res) => {
        const target = new URL(
          req.url ?? "/",
          /^\/(api|rpc|health)(\/|\?|$)/.test(req.url ?? "/") ? backendOrigin : frontendOrigin,
        );
        const upstream = request(
          target,
          {
            method: req.method,
            headers: { ...req.headers, host: target.host },
          },
          (response) => {
            res.writeHead(response.statusCode ?? 502, response.headers);
            response.pipe(res);
          },
        );
        res.once("close", () => upstream.destroy());
        upstream.on("error", () => {
          if (!res.headersSent) res.statusCode = 502;
          res.end();
        });
        req.pipe(upstream);
      }).listen(0, "127.0.0.1");
      await once(proxy, "listening");
      const proxyAddress = proxy.address();
      if (!proxyAddress || typeof proxyAddress === "string")
        throw new Error("Missing browser fixture port");
      origin = `http://127.0.0.1:${proxyAddress.port}`;
    }
    const enqueue = async () => {
      const result = await client.jobs.enqueue({ items: [{ url: magnetURI }] });
      const id = result.items[0].id;
      await waitForPlayback(
        async () => (await client.jobs.list()).items.find((job) => job.id === id),
        (job) => job?.status === "awaiting_selection",
      );
      return id;
    };
    return {
      origin,
      client,
      magnetURI,
      files,
      requests,
      serverOutput: () => output,
      enqueue,
      close,
      setUploadLimit(bytesPerSecond: number) {
        uploadLimit = bytesPerSecond;
        seed?.throttleUpload(uploadLimit);
      },
      async disconnect() {
        if (seed && !seed.destroyed)
          await new Promise<void>((resolve) => seed?.destroy(() => resolve()));
      },
      reconnect: connect,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export type TorrentPlaybackFixture = Awaited<ReturnType<typeof startTorrentPlaybackFixture>>;
