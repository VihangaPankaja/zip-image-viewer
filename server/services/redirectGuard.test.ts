import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { downloadWithSegmentedManager } from "./segmentedDownloader.js";

it("rejects private redirects before a payload request reaches the destination", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "redirect-guard-"));
  let payloadRequests = 0;
  const server = createServer((req, res) => {
    if (req.url === "/source") {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing address");
      res
        .writeHead(302, {
          location: `http://127.0.0.1:${String(address.port)}/private`,
        })
        .end();
    } else {
      payloadRequests++;
      res.end("private payload");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing address");
    await expect(
      downloadWithSegmentedManager({
        url: `http://127.0.0.1:${String(address.port)}/source`,
        targetPath: path.join(directory, "download.bin"),
        signal: new AbortController().signal,
        state: { downloadedBytes: 0 },
        metadata: { size: 0, acceptRanges: false },
        settings: {
          enableResume: false,
          enableMultithread: false,
          threadCount: 1,
          maxRetries: 0,
        },
      }),
    ).rejects.toThrow(/public HTTP/);
    expect(payloadRequests).toBe(0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
