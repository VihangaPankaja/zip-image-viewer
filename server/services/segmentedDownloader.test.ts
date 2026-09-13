import { createServer } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { path7za } from "7zip-bin";
import unzipper from "unzipper";
import { describe, expect, it } from "vitest";
import { runCommand } from "../infrastructure/process/commandRunner.js";
import { downloadWithSegmentedManager } from "./segmentedDownloader.js";

describe("downloadWithSegmentedManager", () => {
  it("downloads a real ZIP over HTTP, opens it, and removes segment files", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "segmented-download-"));
    const sourceDirectory = join(workspace, "source");
    const servedArchive = join(workspace, "served.zip");
    const targetPath = join(workspace, "download.zip");
    await mkdir(sourceDirectory);
    await writeFile(join(sourceDirectory, "caption.txt"), "hello download");
    await runCommand(path7za, ["a", "-tzip", servedArchive, "."], {
      cwd: sourceDirectory,
    });
    const payload = await readFile(servedArchive);
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

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("HTTP test server did not bind to a TCP port.");
      }

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
      const archive = await unzipper.Open.file(targetPath);
      const caption = archive.files.find(
        (entry) => entry.path.replace(/\\/g, "/") === "caption.txt",
      );
      expect(await caption?.buffer()).toEqual(Buffer.from("hello download"));
      expect(state.downloadedBytes).toBe(payload.length);
      expect((await readdir(workspace)).sort()).toEqual([
        "download.zip",
        "served.zip",
        "source",
      ]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
