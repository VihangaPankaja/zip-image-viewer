import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { expect, it } from "vite-plus/test";
import { downloadWithSegmentedManager } from "../../../../server/services/segmentedDownloader.js";
import type { HttpDownloadState } from "../../../../shared/contracts.js";

it.each(["same", "changed", "corrupt", "weak", "last-modified", "origin", "fragment"])(
  "reconciles partial bytes against source identity and disk hashes after restart (%s)",
  async (scenario) => {
    const directory = await mkdtemp(path.join(tmpdir(), "durable-http-"));
    const targetPath = path.join(directory, "source.bin");
    const original = Buffer.alloc(2 * 1024 * 1024, 17);
    let payload = original;
    let etag = scenario === "weak" || scenario === "last-modified" ? 'W/"v1"' : '"v1"';
    const lastModified = "Wed, 21 Oct 2015 07:28:00 GMT";
    const requests: { range?: string; validator?: string }[] = [];
    let interrupted = false;
    const controller = new AbortController();
    let saved: HttpDownloadState | undefined;
    const server = createServer((request, response) => {
      requests.push({
        range: request.headers.range,
        validator:
          typeof request.headers["if-range"] === "string" ? request.headers["if-range"] : undefined,
      });
      const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? "");
      const start = match ? Number(match[1]) : 0;
      const end = match ? Number(match[2]) : payload.length - 1;
      response.writeHead(match ? 206 : 200, {
        etag,
        "last-modified": lastModified,
        "content-length": end - start + 1,
        ...(match ? { "content-range": `bytes ${start}-${end}/${payload.length}` } : {}),
      });
      response.end(payload.subarray(start, end + 1));
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing TCP port");
      const url = `http://127.0.0.1:${address.port}/source.bin${scenario === "fragment" ? "#download" : ""}`;
      const metadata = () => ({
        size: payload.length,
        acceptRanges: true,
        etag,
        lastModified: scenario === "last-modified" ? lastModified : "",
        resolvedUrl: url.split("#")[0],
      });
      const settings = {
        enableResume: true,
        enableMultithread: false,
        threadCount: 1,
        maxRetries: 0,
      };
      const checkpoint = {
        current: saved,
        save(value: HttpDownloadState) {
          saved = structuredClone(value);
          if (
            !interrupted &&
            value.files.some((file) => file.bytes > 0 && file.bytes < payload.length)
          ) {
            interrupted = true;
            controller.abort();
          }
        },
      };
      await expect(
        downloadWithSegmentedManager({
          url,
          targetPath,
          metadata: metadata(),
          settings,
          state: { downloadedBytes: 0 },
          signal: controller.signal,
          checkpoint,
        }),
      ).rejects.toThrow();
      expect(interrupted).toBe(true);
      const retained = saved?.files[0].bytes ?? 0;
      expect(retained).toBeGreaterThan(0);
      if (scenario === "origin" && saved) {
        saved.resolvedUrl = "https://previous.example/file";
        payload = Buffer.alloc(original.length, 39);
      }
      if (scenario === "changed") {
        payload = Buffer.alloc(original.length, 39);
        etag = '"v2"';
      }
      if (scenario === "corrupt") await writeFile(targetPath, Buffer.alloc(retained, 88));
      const before = requests.length;
      const state = { downloadedBytes: 0 };
      await downloadWithSegmentedManager({
        url,
        targetPath,
        metadata: metadata(),
        settings,
        state,
        signal: new AbortController().signal,
        checkpoint: { ...checkpoint, current: saved },
      });
      expect(
        createHash("sha256")
          .update(await readFile(targetPath))
          .digest("hex"),
      ).toBe(createHash("sha256").update(payload).digest("hex"));
      expect(state.downloadedBytes).toBe(payload.length);
      const reused = scenario === "same" || scenario === "last-modified" || scenario === "fragment";
      expect(requests[before]).toEqual(
        reused
          ? {
              range: `bytes=${retained}-${payload.length - 1}`,
              validator: scenario === "last-modified" ? lastModified : '"v1"',
            }
          : { range: undefined, validator: undefined },
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
