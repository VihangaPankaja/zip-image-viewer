import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { path7za } from "7zip-bin";
import { expect, it } from "vite-plus/test";
import { runCommand } from "../../server/infrastructure/process/commandRunner.js";
import { startHttpRestartServer, stopHttpRestartServer } from "../fixtures/httpRestartServer.js";

it.each(["transfer", "assembly", "extraction"])(
  "recovers an actual killed server during %s without corrupting bytes or deleting another owner",
  async (stage) => {
    const directory = await mkdtemp(path.join(tmpdir(), "http-restart-"));
    const fixture = path.join(directory, "fixture");
    await mkdir(fixture);
    const contents = Buffer.alloc(8 * 1024 * 1024, 73);
    await writeFile(path.join(fixture, "notes.txt"), contents);
    const archive = path.join(directory, "fixture.zip");
    await runCommand(path7za, ["a", "-tzip", "-mx=0", archive, "."], { cwd: fixture });
    const payload = await readFile(archive);
    let sent = 0;
    const requests: { range: string; validator: string | string[] | undefined }[] = [];
    const source = createServer((request, response) => {
      const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? "");
      const start = match ? Number(match[1]) : 0;
      const end = match ? Number(match[2]) : payload.length - 1;
      response.writeHead(match ? 206 : 200, {
        "content-length": end - start + 1,
        "accept-ranges": "bytes",
        etag: '"archive-v1"',
        ...(match ? { "content-range": `bytes ${start}-${end}/${payload.length}` } : {}),
      });
      if (request.method === "HEAD") return response.end();
      requests.push({
        range: request.headers.range ?? "full",
        validator: request.headers["if-range"],
      });
      let offset = start;
      const timer = setInterval(() => {
        const next = Math.min(end + 1, offset + 64 * 1024);
        sent += next - offset;
        response.write(payload.subarray(offset, next));
        offset = next;
        if (offset > end) {
          clearInterval(timer);
          response.end();
        }
      }, 8);
      response.on("close", () => clearInterval(timer));
    });
    let server: Awaited<ReturnType<typeof startHttpRestartServer>> | undefined;
    try {
      await new Promise<void>((resolve) => source.listen(0, "127.0.0.1", resolve));
      const address = source.address();
      if (!address || typeof address === "string") throw new Error("Missing source port");
      server = await startHttpRestartServer(directory, stage);
      const result = await server.client.jobs.enqueue({
        items: [
          {
            url: `http://download.example:${address.port}/archive.zip`,
            downloadOptions: {
              retry: { maxRetries: 0 },
              transport: { threads: 3, multithread: stage !== "transfer" },
            },
          },
        ],
      });
      const id = result.items[0].id;
      const workspace = path.join(directory, "sessions", id);
      const sourcePath = path.join(workspace, "source.zip");
      const interrupted =
        stage === "assembly"
          ? `${sourcePath}.assembling`
          : stage === "extraction"
            ? path.join(workspace, "extracted", "notes.txt")
            : sourcePath;
      await expect
        .poll(async () => (await stat(interrupted).catch(() => null))?.size ?? 0, {
          timeout: 20_000,
          interval: 10,
        })
        .toBeGreaterThan(stage === "transfer" ? 1024 * 1024 : 0);
      await stopHttpRestartServer(server.child, true);
      const before = requests.length;
      const beforeBytes = sent;
      const unrelated = path.join(directory, "sessions", "unrelated.txt");
      await writeFile(unrelated, "another owner");
      server = await startHttpRestartServer(directory);
      let job = (await server.client.jobs.list()).items.find((item) => item.id === id);
      if (!job) throw new Error("Missing restored HTTP job");
      if (stage !== "extraction") {
        expect(job.status).toBe("paused");
        expect(job.downloadedBytes).toBeGreaterThan(0);
        expect(job.downloadedBytes).toBeLessThanOrEqual(payload.length);
        await server.client.jobs.resume({ id });
      }
      const client = server.client;
      await expect
        .poll(async () => (await client.jobs.list()).items.find((item) => item.id === id)?.status, {
          timeout: 30_000,
        })
        .toBe("ready");
      job = (await client.jobs.list()).items.find((item) => item.id === id);
      if (!job) throw new Error("Missing completed HTTP job");
      expect(job.downloadedBytes).toBe(payload.length);
      expect(
        createHash("sha256")
          .update(await readFile(sourcePath))
          .digest("hex"),
      ).toBe(createHash("sha256").update(payload).digest("hex"));
      expect(
        (await readFile(path.join(workspace, "extracted", "notes.txt"))).equals(contents),
      ).toBe(true);
      if (stage === "transfer") {
        expect(requests[before].range).not.toBe("full");
        expect(requests[before].validator).toBe('"archive-v1"');
        expect(sent - beforeBytes).toBeLessThan(payload.length);
      } else expect(requests.length).toBe(before);
      await stopHttpRestartServer(server.child);
      server = await startHttpRestartServer(directory);
      expect((await server.client.jobs.list()).items.find((item) => item.id === id)).toMatchObject({
        status: "ready",
        sessionId: job.sessionId,
      });
      await fetch(`${server.origin}/api/sessions/${job.sessionId}`, { method: "DELETE" });
      await fetch(`${server.origin}/api/session-jobs/${id}?release=true`, { method: "DELETE" });
      expect((await readFile(sourcePath)).equals(payload)).toBe(true);
      await server.client.jobs.remove({ id });
      await expect(stat(workspace)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(unrelated, "utf8")).toBe("another owner");
    } catch (error) {
      console.error(server?.logs());
      throw error;
    } finally {
      if (server) await stopHttpRestartServer(server.child, true);
      source.closeAllConnections();
      await new Promise<void>((resolve) => source.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
  90_000,
);
