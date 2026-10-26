import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vite-plus/test";
import { downloadWithSegmentedManager } from "../../../../server/services/segmentedDownloader.js";

const disk = vi.hoisted(() => ({ root: "", capacity: 0 }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    statfsSync: () => {
      const used = actual
        .readdirSync(disk.root)
        .reduce((total, name) => total + actual.statSync(path.join(disk.root, name)).size, 0);
      return { bsize: 1, bavail: disk.capacity - used };
    },
  };
});

it.each([
  {
    segmented: false,
    resume: false,
    ranged: false,
    oversized: false,
    ranges: ["full"],
  },
  {
    segmented: false,
    resume: true,
    ranged: false,
    oversized: false,
    ranges: ["full"],
  },
  {
    segmented: false,
    resume: true,
    ranged: true,
    oversized: false,
    ranges: ["bytes=80-119"],
  },
  {
    segmented: true,
    resume: false,
    ranged: true,
    oversized: false,
    ranges: ["bytes=0-59", "bytes=60-119"],
  },
  {
    segmented: true,
    resume: true,
    ranged: true,
    oversized: false,
    ranges: ["bytes=80-119"],
  },
  {
    segmented: true,
    resume: true,
    ranged: true,
    oversized: true,
    ranges: ["bytes=0-59", "bytes=80-119"],
  },
])(
  "retries within the original disk footprint (%j)",
  async ({ segmented, resume, ranged, oversized, ranges }) => {
    const directory = await mkdtemp(path.join(tmpdir(), "retry-admission-"));
    const target = path.join(directory, "download.bin");
    const payload = Buffer.alloc(120, 7);
    const retained = Buffer.from("other retained bytes");
    const backup = Buffer.from("personal backup");
    disk.root = directory;
    disk.capacity = 64 * 1024 ** 2 + retained.length + backup.length + (segmented ? 240 : 120);
    await writeFile(path.join(directory, "retained.bin"), retained);
    await writeFile(`${target}.part.backup`, backup);
    await writeFile(target, payload.subarray(0, segmented ? 40 : 80));
    await writeFile(`${target}.part.9`, "obsolete partial");
    if (segmented) {
      await writeFile(`${target}.part.0`, oversized ? Buffer.alloc(61) : payload.subarray(0, 60));
      await writeFile(`${target}.part.1`, payload.subarray(60, 80));
    }
    const requests: string[] = [];
    const server = createServer((request, response) => {
      const range = request.headers.range;
      requests.push(range ?? "full");
      const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? "");
      const body = match ? payload.subarray(Number(match[1]), Number(match[2]) + 1) : payload;
      response
        .writeHead(match ? 206 : 200, {
          etag: '"fixture"',
          "content-length": body.length,
          ...(match ? { "content-range": `bytes ${match[1]}-${match[2]}/${payload.length}` } : {}),
        })
        .end(body);
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No TCP port");
      const url = `http://127.0.0.1:${address.port}/file`;
      const files = segmented
        ? [
            {
              index: 0,
              start: 0,
              end: 59,
              bytes: oversized ? 61 : 60,
              sha256: createHash("sha256")
                .update(oversized ? Buffer.alloc(61) : payload.subarray(0, 60))
                .digest("hex"),
            },
            {
              index: 1,
              start: 60,
              end: 119,
              bytes: 20,
              sha256: createHash("sha256").update(payload.subarray(60, 80)).digest("hex"),
            },
          ]
        : [
            {
              index: -1,
              start: 0,
              end: 119,
              bytes: 80,
              sha256: createHash("sha256").update(payload.subarray(0, 80)).digest("hex"),
            },
          ];
      await downloadWithSegmentedManager({
        checkpoint: {
          current: {
            originalUrl: url,
            resolvedUrl: url,
            validator: '"fixture"',
            size: 120,
            files,
            completedSha256: "",
          },
          save: () => undefined,
        },
        url: `http://127.0.0.1:${address.port}/file`,
        targetPath: target,
        signal: new AbortController().signal,
        state: { downloadedBytes: 0 },
        metadata: { etag: '"fixture"', size: payload.length, acceptRanges: ranged },
        settings: {
          enableResume: resume,
          enableMultithread: segmented,
          threadCount: 2,
          maxRetries: 0,
        },
      });
      expect(await readFile(target)).toEqual(payload);
      expect(await readFile(path.join(directory, "retained.bin"))).toEqual(retained);
      expect(await readFile(`${target}.part.backup`)).toEqual(backup);
      expect((await readdir(directory)).sort()).toEqual([
        "download.bin",
        "download.bin.part.backup",
        "retained.bin",
      ]);
      expect(requests.sort()).toEqual([...ranges].sort());
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
      disk.root = "";
    }
  },
);
