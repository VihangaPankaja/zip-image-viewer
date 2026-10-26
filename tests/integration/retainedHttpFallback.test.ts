import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vite-plus/test";
import { createRetainedTorrentStore } from "../../server/repositories/retainedTorrents.js";
import { startHttpRestartServer, stopHttpRestartServer } from "../fixtures/httpRestartServer.js";

it.each(["HEAD rejected", "HEAD original URL", "HEAD different validator"])(
  "records independent fresh GET redirect identities (%s)",
  async (scenario) => {
    const directory = await mkdtemp(path.join(tmpdir(), "http-head-fallback-"));
    const payloads = [Buffer.alloc(512 * 1024, 65), Buffer.alloc(2 * 1024 * 1024, 66)];
    const requests: string[] = [];
    let sourcePort = 0;
    const source = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`);
      const index = request.url?.includes("second") ? 1 : 0;
      if (request.method === "HEAD") {
        if (scenario === "HEAD rejected") return response.writeHead(405).end();
        return response
          .writeHead(200, {
            "content-length": payloads[index].length,
            "accept-ranges": "bytes",
            etag:
              scenario === "HEAD different validator" ? `"head-${index}"` : `"payload-${index}"`,
          })
          .end();
      }
      if (!request.url?.startsWith("/payload-"))
        return response
          .writeHead(302, {
            location: `${scenario === "HEAD rejected" ? "" : `http://${index ? "second" : "first"}.example:${sourcePort}`}/payload-${index ? "second" : "first"}.txt`,
          })
          .end();
      response
        .writeHead(200, {
          "content-length": payloads[index].length,
          "accept-ranges": "bytes",
          etag: `"payload-${index}"`,
        })
        .end(payloads[index]);
    });
    let api: Awaited<ReturnType<typeof startHttpRestartServer>> | undefined;
    try {
      await new Promise<void>((resolve) => source.listen(0, "127.0.0.1", resolve));
      const address = source.address();
      if (!address || typeof address === "string") throw new Error("Missing source port");
      sourcePort = address.port;
      const origin = `http://download.example:${address.port}`;
      api = await startHttpRestartServer(directory);
      const client = api.client;
      for (const [index, name] of ["first", "second"].entries()) {
        const url = `${origin}/${name}.txt`;
        const { items } = await client.jobs.enqueue({
          items: [
            {
              url,
              downloadOptions: { retry: { maxRetries: 0 }, transport: { multithread: false } },
            },
          ],
        });
        const id = items[0].id;
        await expect
          .poll(async () => (await client.jobs.list()).items.find((job) => job.id === id)?.status, {
            timeout: 15_000,
          })
          .toBe("ready");
        expect(await readFile(path.join(directory, "sessions", id, "source.txt"))).toEqual(
          payloads[index],
        );
        const store = createRetainedTorrentStore(path.join(directory, "sessions"));
        try {
          expect(store.readHttp().find((job) => job.id === id)?.httpDownload).toMatchObject({
            originalUrl: url,
            resolvedUrl: `${scenario === "HEAD rejected" ? origin : `http://${name}.example:${sourcePort}`}/payload-${name}.txt`,
            size: payloads[index].length,
            validator: `"payload-${index}"`,
            files: [{ bytes: payloads[index].length }],
          });
        } finally {
          store.close();
        }
      }
      expect(requests).toEqual([
        "HEAD /first.txt",
        "GET /first.txt",
        "GET /payload-first.txt",
        "HEAD /second.txt",
        "GET /second.txt",
        "GET /payload-second.txt",
      ]);
    } finally {
      if (api) await stopHttpRestartServer(api.child, true);
      source.closeAllConnections();
      await new Promise<void>((resolve) => source.close(() => resolve()));
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  },
  45_000,
);
