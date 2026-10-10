import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createWebTorrentAdapter } from "./torrentDownloader.js";

it("ignores torrent HTTP web seeds rather than bypassing guarded download requests", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "torrent-http-source-"));
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response
      .writeHead(206, { "content-length": 3, "content-range": "bytes 0-2/3" })
      .end("abc");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP port");
  const url = `http://127.0.0.1:${String(address.port)}/private`;
  const metadata = Buffer.concat([
    Buffer.from(
      "d4:infod6:lengthi3e4:name10:secret.txt12:piece lengthi16384e6:pieces20:",
    ),
    createHash("sha1").update("abc").digest(),
    Buffer.from(`e8:url-list${String(Buffer.byteLength(url))}:${url}e`),
  ]);
  const adapter = createWebTorrentAdapter();
  const controller = new AbortController();
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const download = adapter
    .download({
      source: metadata,
      downloadDir: directory,
      signal: controller.signal,
      retainStoreOnAbort: () => true,
      onMetadata: () => {
        ready();
        return ["0"];
      },
      onProgress: () => undefined,
      onNoPeers: () => undefined,
    })
    .catch((error: unknown) => error);
  try {
    await started;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    controller.abort();
    await download;
    expect(requests).toBe(0);
  } finally {
    controller.abort();
    await download;
    await adapter.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
