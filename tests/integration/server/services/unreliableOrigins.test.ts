import { createServer, type RequestListener } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vite-plus/test";
import { gzipSync } from "node:zlib";
import { fetchRemoteMetadata } from "../../../../server/infrastructure/downloads/remoteMetadata.js";
import { downloadWithSegmentedManager } from "../../../../server/services/segmentedDownloader.js";
import type { HttpDownloadState } from "../../../../shared/contracts.js";
import { createJobManager } from "../../../../server/application/jobs/jobManager.js";
import { normalizeDownloadSettings } from "../../../../server/application/downloads/downloadOptions.js";
import { downloadSessionSource } from "../../../../server/application/jobs/downloadSessionSource.js";

const payload = Buffer.from("a complete payload, never an old prefix plus new bytes");
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const settings = { enableResume: true, enableMultithread: false, threadCount: 2, maxRetries: 0 };

async function withOrigin(
  handler: RequestListener,
  run: (_url: string, _target: string) => Promise<void>,
) {
  const directory = await mkdtemp(path.join(tmpdir(), "unreliable-origin-"));
  const server = createServer(handler);
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture port");
    await run(`http://127.0.0.1:${address.port}/archive.zip`, path.join(directory, "source.bin"));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}

it("probes HEAD 405 with exactly one byte before establishing ranged metadata", async () => {
  const requests: string[] = [];
  await withOrigin(
    (request, response) => {
      requests.push(`${request.method} ${request.headers.range ?? "full"}`);
      if (request.method === "HEAD") return response.writeHead(405).end();
      response
        .writeHead(206, {
          "content-range": `bytes 0-0/${payload.length}`,
          "content-length": 1,
          etag: '"probe"',
        })
        .end(payload.subarray(0, 1));
    },
    async (url) => {
      expect(await fetchRemoteMetadata(url, new AbortController().signal)).toEqual({
        size: payload.length,
        acceptRanges: true,
        etag: '"probe"',
        lastModified: "",
        resolvedUrl: url,
      });
      expect(requests).toEqual(["HEAD full", "GET bytes=0-0"]);
    },
  );
});

it("immediately closes an ignored probe without consuming a streaming body or trusting its validators", async () => {
  let closed!: () => void;
  const disconnected = new Promise<void>((resolve) => {
    closed = resolve;
  });
  let requests = 0;
  await withOrigin(
    (request, response) => {
      requests++;
      if (request.method === "HEAD") return response.writeHead(405).end();
      response.writeHead(200, { etag: '"unverified"' });
      response.write(Buffer.alloc(64 * 1024));
      response.once("close", closed);
    },
    async (url) => {
      expect(await fetchRemoteMetadata(url, new AbortController().signal)).toEqual({
        size: 0,
        acceptRanges: false,
        etag: "",
        lastModified: "",
        resolvedUrl: undefined,
      });
      expect(requests).toBe(2);
      await disconnected;
    },
  );
});

it.each(["ignored", "malformed", "416", "length", "chunked short", "chunked long"])(
  "discards retained bytes before a single fresh stream when ranges are %s",
  async (scenario) => {
    const ranges: (string | undefined)[] = [];
    await withOrigin(
      (request, response) => {
        ranges.push(request.headers.range);
        if (!request.headers.range)
          return response
            .writeHead(200, { "content-length": payload.length, etag: '"v2"' })
            .end(payload);
        if (scenario === "416") return response.writeHead(416).end();
        response
          .writeHead(scenario === "ignored" ? 200 : 206, {
            etag: '"v1"',
            ...(scenario.startsWith("chunked")
              ? {}
              : { "content-length": scenario === "length" ? 1 : payload.length }),
            "content-range":
              scenario === "malformed"
                ? "bytes 3-8/*"
                : `bytes 3-${payload.length - 1}/${payload.length}`,
          })
          .end(
            scenario === "length"
              ? "x"
              : scenario === "chunked short"
                ? payload.subarray(4)
                : payload,
          );
      },
      async (url, targetPath) => {
        const prefix = Buffer.from("OLD");
        await writeFile(targetPath, prefix);
        let saved: HttpDownloadState | undefined;
        const current: HttpDownloadState = {
          originalUrl: url,
          resolvedUrl: url,
          size: payload.length,
          validator: '"v1"',
          completedSha256: "",
          files: [
            { index: -1, start: 0, end: payload.length - 1, bytes: 3, sha256: digest(prefix) },
          ],
        };
        await downloadWithSegmentedManager({
          url,
          targetPath,
          signal: new AbortController().signal,
          settings,
          state: { downloadedBytes: 0 },
          metadata: { size: payload.length, acceptRanges: true, etag: '"v1"', resolvedUrl: url },
          checkpoint: {
            current,
            save(value) {
              saved = structuredClone(value);
            },
          },
        });
        expect(digest(await readFile(targetPath))).toBe(digest(payload));
        expect(saved?.completedSha256).toBe(digest(payload));
        expect(ranges).toEqual([`bytes=3-${payload.length - 1}`, undefined]);
      },
    );
  },
);

it.each([401, 403, 404, 410])(
  "preserves permanent HTTP %s classification without accepting an error body",
  async (status) => {
    let requests = 0;
    await withOrigin(
      (_request, response) => {
        requests++;
        response.writeHead(status).end("secret signed URL expired");
      },
      async (url, targetPath) => {
        await expect(
          downloadWithSegmentedManager({
            url: `${url}?signature=DO_NOT_EXPOSE`,
            targetPath,
            signal: new AbortController().signal,
            settings: { ...settings, enableMultithread: true, maxRetries: 2 },
            state: { downloadedBytes: 0 },
            metadata: { size: payload.length, acceptRanges: false },
          }),
        ).rejects.toMatchObject({
          statusCode: status,
          code: status === 401 || status === 403 ? "DOWNLOAD_AUTH" : "DOWNLOAD_PERMANENT",
        });
        expect(requests).toBe(1);
        expect(await readFile(targetPath)).toHaveLength(0);
      },
    );
  },
);

it("rejects a bounded HTML login page for an archive before checkpointing its body", async () => {
  await withOrigin(
    (_request, response) =>
      response
        .writeHead(200, { "content-type": "text/html" })
        .end('<html><form><input type="password">Sign in</form></html>'),
    async (url, targetPath) => {
      const state = { downloadedBytes: 0 };
      await expect(
        downloadWithSegmentedManager({
          url,
          targetPath,
          signal: new AbortController().signal,
          settings,
          state,
          metadata: { size: 0, acceptRanges: false },
        }),
      ).rejects.toMatchObject({ code: "DOWNLOAD_LOGIN" });
      expect(state.downloadedBytes).toBe(0);
      expect(await readFile(targetPath)).toHaveLength(0);
    },
  );
});

it.each(["unknown total", "wrong length", "gzip", "short", "long"])(
  "does not authorize reuse from a malformed probe (%s)",
  async (scenario) => {
    await withOrigin(
      (request, response) => {
        if (request.method === "HEAD") return response.writeHead(501).end();
        response
          .writeHead(206, {
            etag: '"untrusted"',
            "content-range": scenario === "unknown total" ? "bytes 0-0/*" : "bytes 0-0/99",
            ...(scenario === "wrong length" ? { "content-length": "2" } : {}),
            ...(scenario === "gzip" ? { "content-encoding": "gzip" } : {}),
          })
          .end(scenario === "short" ? "" : scenario === "long" ? "xx" : "x");
      },
      async (url) => {
        expect(await fetchRemoteMetadata(url, new AbortController().signal)).toEqual({
          size: 0,
          acceptRanges: false,
          etag: "",
          lastModified: "",
          resolvedUrl: undefined,
        });
      },
    );
  },
);

it("bounds a stalled probe by time and closes its connection", async () => {
  let closed!: () => void;
  const disconnected = new Promise<void>((resolve) => {
    closed = resolve;
  });
  await withOrigin(
    (request, response) => {
      if (request.method === "HEAD") return response.writeHead(405).end();
      response.once("close", closed);
    },
    async (url) => {
      const started = Date.now();
      expect(
        (await fetchRemoteMetadata(url, new AbortController().signal)).resolvedUrl,
      ).toBeUndefined();
      expect(Date.now() - started).toBeLessThan(6_500);
      await disconnected;
    },
  );
}, 10_000);

it("cancels a probe while its first byte is pending", async () => {
  const controller = new AbortController();
  let closed!: () => void;
  const disconnected = new Promise<void>((resolve) => {
    closed = resolve;
  });
  let requests = 0;
  await withOrigin(
    (request, response) => {
      requests++;
      if (request.method === "HEAD") return response.writeHead(405).end();
      response.once("close", closed);
      response.writeHead(206, { "content-range": "bytes 0-0/99", "content-length": 1 });
      response.flushHeaders();
      controller.abort();
    },
    async (url) => {
      expect((await fetchRemoteMetadata(url, controller.signal)).resolvedUrl).toBeUndefined();
      await disconnected;
      expect(requests).toBe(2);
    },
  );
});

it.each(["gzip", "chunked", "HEAD length differs"])(
  "hashes a complete fresh %s response",
  async (scenario) => {
    await withOrigin(
      (_request, response) => {
        const body = scenario === "gzip" ? gzipSync(payload) : payload;
        response.writeHead(200, {
          etag: '"actual-get"',
          ...(scenario === "gzip"
            ? { "content-encoding": "gzip", "content-length": body.length }
            : scenario === "chunked"
              ? {}
              : { "content-length": body.length }),
        });
        response.write(body.subarray(0, 5));
        response.end(body.subarray(5));
      },
      async (url, targetPath) => {
        let saved: HttpDownloadState | undefined;
        await downloadWithSegmentedManager({
          url,
          targetPath,
          signal: new AbortController().signal,
          settings,
          state: { downloadedBytes: 0 },
          metadata: { size: 1, acceptRanges: false, etag: '"head"', resolvedUrl: `${url}?head` },
          checkpoint: {
            save(value) {
              saved = structuredClone(value);
            },
          },
        });
        expect(digest(await readFile(targetPath))).toBe(digest(payload));
        expect(saved).toMatchObject({
          size: payload.length,
          validator: '"actual-get"',
          resolvedUrl: url,
          completedSha256: digest(payload),
        });
      },
    );
  },
);

it.each([false, true])(
  "falls back from encoded ranges with all workers drained (segmented=%s)",
  async (segmented) => {
    let full = 0;
    await withOrigin(
      (request, response) => {
        if (request.headers.range)
          return response
            .writeHead(206, { "content-encoding": "gzip", etag: '"v1"' })
            .end(gzipSync(payload));
        full++;
        response.writeHead(200, { "content-encoding": "gzip" }).end(gzipSync(payload));
      },
      async (url, targetPath) => {
        const prefix = Buffer.from("OLD");
        if (!segmented) await writeFile(targetPath, prefix);
        const current: HttpDownloadState = {
          originalUrl: url,
          resolvedUrl: url,
          size: payload.length,
          validator: '"v1"',
          completedSha256: "",
          files: [
            { index: -1, start: 0, end: payload.length - 1, bytes: 3, sha256: digest(prefix) },
          ],
        };
        await downloadWithSegmentedManager({
          url,
          targetPath,
          signal: new AbortController().signal,
          settings: { ...settings, enableMultithread: segmented },
          state: { downloadedBytes: 0 },
          metadata: { size: payload.length, acceptRanges: true, etag: '"v1"', resolvedUrl: url },
          checkpoint: { current, save() {} },
        });
        expect(digest(await readFile(targetPath))).toBe(digest(payload));
        expect(full).toBe(1);
      },
    );
  },
);

it("rejects an unsolicited 206 in the one permitted fallback without accepting its bytes", async () => {
  let requests = 0;
  await withOrigin(
    (_request, response) => {
      requests++;
      response.writeHead(206, { "content-range": "bytes 0-1/99", etag: '"v1"' }).end("XX");
    },
    async (url, targetPath) => {
      let saved: HttpDownloadState | undefined;
      const state = { downloadedBytes: 0 };
      await expect(
        downloadWithSegmentedManager({
          url,
          targetPath,
          signal: new AbortController().signal,
          settings: { ...settings, enableMultithread: true },
          state,
          metadata: { size: 2, acceptRanges: true, etag: '"v1"' },
          checkpoint: {
            save(value) {
              saved = structuredClone(value);
            },
          },
        }),
      ).rejects.toMatchObject({ code: "DOWNLOAD_FATAL" });
      expect(state.downloadedBytes).toBe(0);
      expect(saved?.completedSha256).toBe("");
      expect(await readFile(targetPath)).toHaveLength(0);
      expect(requests).toBe(3);
    },
  );
});

it.each(["html file", "attachment", "ordinary html"])(
  "allows legitimate HTML content (%s)",
  async (scenario) => {
    const html = Buffer.from(
      scenario === "ordinary html"
        ? "<html><h1>A saved document</h1><p>Read how to log in to the example.</p></html>"
        : '<html><form><input type="password">Sign in</form></html>',
    );
    await withOrigin(
      (_request, response) =>
        response
          .writeHead(200, {
            "content-type": "text/html",
            ...(scenario === "attachment"
              ? { "content-disposition": 'attachment; filename="login-example.html"' }
              : {}),
          })
          .end(html),
      async (url, targetPath) => {
        await downloadWithSegmentedManager({
          url: scenario === "html file" ? url.replace("archive.zip", "page.html") : url,
          targetPath,
          signal: new AbortController().signal,
          settings,
          state: { downloadedBytes: 0 },
          metadata: { size: 0, acceptRanges: false },
        });
        expect(digest(await readFile(targetPath))).toBe(digest(html));
      },
    );
  },
);

async function runJob(
  url: string,
  targetPath: string,
  maxRetries: number,
  controller = new AbortController(),
  onMessage: (_message: string) => void = () => {},
) {
  const manager = createJobManager(new Map(), () => {});
  const job = manager.createJob(url);
  job.abortController = controller;
  await downloadSessionSource(
    job,
    normalizeDownloadSettings({ ...settings, maxRetries }),
    { url, zipPath: targetPath, workspaceDir: path.dirname(targetPath), confirmOversize: true },
    {
      emitJob(current, patch, event) {
        manager.emitJob(current, patch, event);
        if (patch.message) onMessage(patch.message);
      },
      closeJob: manager.closeJob,
      download: downloadWithSegmentedManager,
    },
  );
  return job;
}

it.each(["0", "date", "malformed"])(
  "retries real HTTP 429 using Retry-After %s with exact counts",
  async (after) => {
    let gets = 0;
    let heads = 0;
    const times: number[] = [];
    await withOrigin(
      (request, response) => {
        if (request.method === "HEAD") {
          heads++;
          return response.writeHead(200, { "content-length": payload.length }).end();
        }
        gets++;
        times.push(Date.now());
        if (gets === 1)
          return response
            .writeHead(429, {
              "retry-after": after === "date" ? new Date(Date.now() - 1000).toUTCString() : after,
            })
            .end("rate limited");
        response.writeHead(200, { "content-length": payload.length }).end(payload);
      },
      async (url, targetPath) => {
        const job = await runJob(url, targetPath, 1);
        expect(job.retryCount).toBe(1);
        expect(gets).toBe(2);
        expect(heads).toBe(2);
        if (after === "malformed") expect(times[1] - times[0]).toBeGreaterThanOrEqual(1200);
        expect(digest(await readFile(targetPath))).toBe(digest(payload));
      },
    );
  },
);

it.each([0, 2, -1])(
  "bounds repeated HTTP 429 at the configured retry budget %s",
  async (maxRetries) => {
    let gets = 0;
    await withOrigin(
      (request, response) => {
        if (request.method === "HEAD") return response.writeHead(200).end();
        gets++;
        response.writeHead(429, { "retry-after": "0" }).end();
      },
      async (url, targetPath) => {
        await expect(runJob(url, targetPath, maxRetries)).rejects.toMatchObject({
          statusCode: 429,
        });
        expect(gets).toBe((maxRetries === -1 ? 8 : maxRetries) + 1);
      },
    );
  },
);

it.each([401, 403, 404, 410])(
  "does not automatically retry an expired or permanent HTTP %s URL",
  async (status) => {
    let gets = 0;
    await withOrigin(
      (request, response) => {
        if (request.method === "HEAD") return response.writeHead(status).end();
        gets++;
        response.writeHead(status).end("DO_NOT_EXPOSE");
      },
      async (url, targetPath) => {
        try {
          await runJob(`${url}?signed=DO_NOT_EXPOSE`, targetPath, -1);
          throw new Error("Expected HTTP failure");
        } catch (error) {
          expect(error).toMatchObject({ statusCode: status });
          expect(String(error)).not.toContain("DO_NOT_EXPOSE");
        }
        expect(gets).toBe(1);
        expect(await readFile(targetPath)).toHaveLength(0);
      },
    );
  },
);

it("cancels during Retry-After without sending another HEAD or GET", async () => {
  const controller = new AbortController();
  const requests: string[] = [];
  await withOrigin(
    (request, response) => {
      requests.push(request.method ?? "");
      response.writeHead(request.method === "HEAD" ? 200 : 429, { "retry-after": "30" }).end();
    },
    async (url, targetPath) => {
      await expect(
        runJob(url, targetPath, -1, controller, (message) => {
          if (message.includes("retrying")) controller.abort();
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(requests).toEqual(["HEAD", "GET"]);
    },
  );
});

it("resumes flushed bytes after a dropped connection and hashes the entire result", async () => {
  const body = Buffer.alloc(2 * 1024 * 1024, 39);
  const ranges: (string | undefined)[] = [];
  await withOrigin(
    (request, response) => {
      if (request.method === "HEAD")
        return response
          .writeHead(200, {
            "content-length": body.length,
            "accept-ranges": "bytes",
            etag: '"stable"',
          })
          .end();
      ranges.push(request.headers.range);
      const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? "");
      const start = Number(match?.[1] ?? 0);
      response.writeHead(match ? 206 : 200, {
        etag: '"stable"',
        "content-length": body.length - start,
        ...(match ? { "content-range": `bytes ${start}-${body.length - 1}/${body.length}` } : {}),
      });
      if (ranges.length === 1) {
        response.write(body.subarray(0, 1024 * 1024));
        setTimeout(() => response.destroy(), 25);
      } else response.end(body.subarray(start));
    },
    async (url, targetPath) => {
      const job = await runJob(url, targetPath, 1);
      expect(ranges).toHaveLength(2);
      expect(ranges[0]).toBeUndefined();
      expect(ranges[1]).toMatch(/^bytes=\d+-2097151$/);
      expect(Number(/^bytes=(\d+)/.exec(ranges[1] ?? "")?.[1])).toBeGreaterThan(0);
      expect(job.httpDownload?.completedSha256).toBe(digest(body));
      expect(job.downloadedBytes).toBe(body.length);
      expect(digest(await readFile(targetPath))).toBe(digest(body));
    },
  );
});

it("completes and hashes a segmented download using the HEAD 405 probe", async () => {
  const requests: string[] = [];
  await withOrigin(
    (request, response) => {
      requests.push(`${request.method} ${request.headers.range ?? "full"}`);
      if (request.method === "HEAD") return response.writeHead(405).end();
      const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? "");
      const start = Number(match?.[1]);
      const end = Number(match?.[2]);
      response
        .writeHead(206, {
          etag: '"probe"',
          "content-range": `bytes ${start}-${end}/${payload.length}`,
          "content-length": end - start + 1,
        })
        .end(payload.subarray(start, end + 1));
    },
    async (url, targetPath) => {
      const metadata = await fetchRemoteMetadata(url, new AbortController().signal);
      await downloadWithSegmentedManager({
        url,
        targetPath,
        metadata,
        signal: new AbortController().signal,
        settings: { ...settings, enableMultithread: true },
        state: { downloadedBytes: 0 },
      });
      expect(digest(await readFile(targetPath))).toBe(digest(payload));
      expect(requests.slice(0, 2)).toEqual(["HEAD full", "GET bytes=0-0"]);
      expect(requests.slice(2).sort()).toEqual(["GET bytes=0-26", "GET bytes=27-53"]);
    },
  );
});

it("cancels a streaming response without completing its checkpoint or retrying", async () => {
  const controller = new AbortController();
  let requests = 0;
  await withOrigin(
    (_request, response) => {
      requests++;
      response.writeHead(200, { etag: '"stream"' });
      response.write(Buffer.alloc(1024 * 1024, 19));
    },
    async (url, targetPath) => {
      let saved: HttpDownloadState | undefined;
      await expect(
        downloadWithSegmentedManager({
          url,
          targetPath,
          metadata: { size: 0, acceptRanges: false },
          signal: controller.signal,
          settings,
          state: { downloadedBytes: 0 },
          checkpoint: {
            save(value) {
              saved = structuredClone(value);
              if (value.files[0].bytes > 0) controller.abort();
            },
          },
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(requests).toBe(1);
      expect(saved?.completedSha256).toBe("");
      expect(saved?.files[0].bytes).toBeGreaterThan(0);
    },
  );
});

it("accepts a validator-free chunked origin without reusing an existing prefix", async () => {
  await withOrigin(
    (_request, response) => {
      response.writeHead(200);
      response.write(payload.subarray(0, 5));
      response.end(payload.subarray(5));
    },
    async (url, targetPath) => {
      await writeFile(targetPath, "OLD");
      await downloadWithSegmentedManager({
        url,
        targetPath,
        metadata: { size: 0, acceptRanges: false },
        signal: new AbortController().signal,
        settings,
        state: { downloadedBytes: 0 },
      });
      expect(digest(await readFile(targetPath))).toBe(digest(payload));
    },
  );
});

it("honors a future HTTP-date Retry-After on a real 503 response", async () => {
  let gets = 0;
  let notBefore = 0;
  await withOrigin(
    (request, response) => {
      if (request.method === "HEAD") return response.writeHead(200).end();
      gets++;
      if (gets === 1) {
        notBefore = Math.ceil(Date.now() / 1000) * 1000 + 1000;
        return response.writeHead(503, { "retry-after": new Date(notBefore).toUTCString() }).end();
      }
      expect(Date.now()).toBeGreaterThanOrEqual(notBefore);
      response.writeHead(200).end(payload);
    },
    async (url, targetPath) => {
      await runJob(url, targetPath, 1);
      expect(gets).toBe(2);
      expect(digest(await readFile(targetPath))).toBe(digest(payload));
    },
  );
});

it("stops rather than retrying before a Retry-After beyond its delay cap", async () => {
  let gets = 0;
  await withOrigin(
    (request, response) => {
      if (request.method === "HEAD") return response.writeHead(200).end();
      gets++;
      response.writeHead(429, { "retry-after": "31" }).end();
    },
    async (url, targetPath) => {
      await expect(runJob(url, targetPath, 1)).rejects.toMatchObject({ statusCode: 429 });
      expect(gets).toBe(1);
    },
  );
});

it("preserves retained bytes when cancellation interrupts metadata discovery", async () => {
  const controller = new AbortController();
  let gets = 0;
  await withOrigin(
    (request, response) => {
      if (request.method === "HEAD") {
        controller.abort();
        return response.writeHead(200).end();
      }
      gets++;
      response.end(payload);
    },
    async (url, targetPath) => {
      await writeFile(targetPath, "owned partial");
      await expect(runJob(url, targetPath, 0, controller)).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(await readFile(targetPath, "utf8")).toBe("owned partial");
      expect(gets).toBe(0);
    },
  );
});

it("does not advertise encoded fresh bytes as resumable after identity HEAD metadata", async () => {
  await withOrigin(
    (request, response) => {
      if (request.method === "HEAD")
        return response
          .writeHead(200, {
            "content-length": payload.length,
            "accept-ranges": "bytes",
            etag: '"gzip"',
          })
          .end();
      response
        .writeHead(200, { "content-encoding": "gzip", etag: '"gzip"' })
        .end(gzipSync(payload));
    },
    async (url, targetPath) => {
      const job = await runJob(url, targetPath, 0);
      expect(job.canResume).toBe(false);
      expect(job.canPause).toBe(false);
      expect(digest(await readFile(targetPath))).toBe(digest(payload));
    },
  );
});
