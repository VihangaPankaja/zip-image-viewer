import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { downloadWithSegmentedManager } from "./segmentedDownloader.js";

describe("downloadWithSegmentedManager", () => {
  it("merges HTTP ranges and removes segment files", async () => {
    const payload = Buffer.from("0123456789abcdef".repeat(64));
    const server = createServer((request, response) => {
      const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? "");
      if (!match) {
        response.writeHead(400).end();
        return;
      }

      const start = Number(match[1]);
      const end = Number(match[2]);
      const body = payload.subarray(start, end + 1);
      response.writeHead(206, {
        "accept-ranges": "bytes",
        "content-length": body.length,
        "content-range": `bytes ${String(start)}-${String(end)}/${String(payload.length)}`,
      });
      response.end(body);
    });
    const workspace = await mkdtemp(join(tmpdir(), "segmented-download-"));

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("HTTP test server did not bind to a TCP port.");
      }

      const targetPath = join(workspace, "download.bin");
      const state = { downloadedBytes: 0 };
      await downloadWithSegmentedManager({
        url: `http://127.0.0.1:${String(address.port)}/archive.bin`,
        targetPath,
        signal: new AbortController().signal,
        settings: {
          enableResume: true,
          enableMultithread: true,
          threadCount: 3,
          maxRetries: 0,
        },
        state,
        metadata: { acceptRanges: true, size: payload.length },
      });

      expect(await readFile(targetPath)).toEqual(payload);
      expect(state.downloadedBytes).toBe(payload.length);
      expect(await readdir(workspace)).toEqual(["download.bin"]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
