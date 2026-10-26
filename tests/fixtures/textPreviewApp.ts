import express from "express";
import { listenFixtureApp, registerFixtureSession } from "./fixtureApp";
import { mkdir, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { registerFileRoutes } from "../../server/handlers/fileRoutes";
import type { Session } from "../../server/domain/models";
import {
  formatBytes,
  parseRangeHeader,
  sanitizeEntryPath,
} from "../../server/infrastructure/runtime/runtimePrimitives";
import {
  classifyMimeType,
  shouldPreserveOriginalPreview,
} from "../../server/infrastructure/runtime/mediaClassification";
import { proxyApp } from "./proxyApp";

const sessionId = "00000000-0000-4000-8000-000000000008";

async function writeTextFixtures(directory: string) {
  const log = await open(path.join(directory, "01-large-200MB.log"), "w");
  try {
    const block = Buffer.from(
      "2026-10-26 INFO fixture log: bounded preview keeps the workspace responsive\n".repeat(14000),
    );
    let written = 0;
    while (written < 200 * 1024 * 1024) {
      const bytes = block.subarray(0, Math.min(block.length, 200 * 1024 * 1024 - written));
      await log.write(bytes);
      written += bytes.length;
    }
    await log.write(Buffer.from("FINAL LOG RECORD\n"), 0, 17, 200 * 1024 * 1024 - 17);
  } finally {
    await log.close();
  }
  const values = {
    "02-quoted.csv":
      'name,note\r\n"Coast, west","line one\nline ""two"""\r\n"<img src=x onerror=alert(1)>","HTML stays text"\r\n' +
      "sample,bounded row\n".repeat(250),
    "03-data.json":
      '{"id":9007199254740993,"files":["coast.png","notes.txt"],"safe":"<script>alert(1)</script>"}',
    "04-malformed.json": '{"missing":',
    "05-utf16be.txt": Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("UTF-16 fixture\nGrüße 😀\n", "utf16le"),
    ]).swap16(),
    "06-long-line.txt": "x".repeat(70000) + "NEEDLE" + "y".repeat(70000),
    "07-binary.txt": Buffer.from([0, 1, 2, 3, 4, 5]),
    "08-tabs.tsv": 'name\tnote\n"a\tb"\t"quoted ""value"""\n',
    "09-wide-lines.txt":
      "\t".repeat(100) + "\n" + "界".repeat(100) + "\n" + "İ".repeat(8) + "\nNEEDLE\nWRONG",
  };
  await Promise.all(
    Object.entries(values).map(([name, data]) => writeFile(path.join(directory, name), data)),
  );
}

export async function startTextPreviewApp(baseURL: string, port = 0) {
  await mkdir("test-results", { recursive: true });
  const directory = await mkdtemp(path.resolve("test-results/f02-runtime-"));
  await writeTextFixtures(directory);
  const session = { id: sessionId, extractDir: directory } as Session;
  const files = await Promise.all(
    (await readdir(directory)).map(async (name) => ({
      name,
      path: name,
      type: "file",
      extension: name.split(".").at(-1),
      size: (await stat(path.join(directory, name))).size,
    })),
  );
  const app = express();
  app.get("/api/sessions/:id/tree", (_req, res) =>
    res.json({
      id: sessionId,
      firstFilePath: files[0].path,
      tree: { name: "F02 local fixtures", path: ".", type: "directory", children: files },
    }),
  );
  registerFileRoutes(app, {
    touchSession: (id) => (id === sessionId ? session : undefined),
    logEvent: () => {},
    sanitizeEntryPath,
    formatBytes,
    parseRangeHeader,
    classifyMimeType,
    shouldPreserveOriginalPreview,
    readPreviewChunk: readFile,
    ensureThumbnail: () => Promise.reject(new Error("Not an image fixture")),
    ensureImagePreview: () => Promise.reject(new Error("Not an image fixture")),
  });
  registerFixtureSession(app, {
    id: sessionId,
    firstFilePath: files[0].path,
    fileCount: files.length,
  });
  app.use(proxyApp(baseURL));
  const server = await listenFixtureApp(app, port);
  return {
    origin: server.origin,
    directory,
    close: async () => {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
