import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { inspectPage } from "../../../../server/infrastructure/discovery/inspectPage.js";
import {
  assertPublicPageUrl,
  publicPageLookup,
} from "../../../../server/infrastructure/discovery/publicPageUrl.js";
import type { LookupFunction } from "node:net";

const requests: string[] = [];
const server = createServer((req, res) => {
  requests.push(req.url ?? "");
  if (req.url === "/redirect") return res.writeHead(302, { location: "/files/index" }).end();
  if (req.url === "/unsafe")
    return res.writeHead(302, { location: "http://127.0.0.1/private" }).end();
  if (req.url === "/loop") return res.writeHead(302, { location: "/loop" }).end();
  if (req.url === "/binary")
    return res.writeHead(200, { "content-type": "application/zip" }).end("zip");
  if (req.url === "/error") return res.writeHead(403).end("denied");
  if (req.url === "/slow") return;
  res.setHeader("content-type", "text/html; charset=utf-8");
  if (req.url === "/large") return res.end("x".repeat(2 * 1024 ** 2 + 1));
  if (req.url === "/compressed") {
    res.setHeader("content-encoding", "gzip");
    return res.end(gzipSync("x".repeat(2 * 1024 ** 2 + 1)));
  }
  if (req.url === "/invalid-encoding") {
    res.setHeader("content-type", "text/html; charset=made-up");
    return res.end("bad");
  }
  if (req.url === "/malformed") return res.end("<html><a href='broken");
  if (req.url === "/utf16")
    return res.end(Buffer.from("\ufeff<a href='/unicode.zip'>Résumé</a>", "utf16le"));
  if (req.url === "/optional-login")
    return res.end(
      "<!doctype html><form><input type=password></form><a href='/public.zip'>Public file</a>",
    );
  return res.end(
    "<!doctype html><a href='../archive.zip'>Archive</a><a download='data.csv' href='/get?sig=abc'>Data</a>",
  );
});
let origin: string;
// Use a real local server without weakening production URL or redirect validation.
const fixtureLookup: LookupFunction = (_hostname, _options, callback) =>
  callback(null, "127.0.0.1", 4);
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port.");
  origin = `http://fixture.example.com:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("bounded HTML inspection", () => {
  it("honors a UTF-16 BOM ahead of the HTTP charset", async () => {
    const result = await inspectPage(`${origin}/utf16`, { lookup: fixtureLookup });
    expect(result.items[0]).toMatchObject({ name: "Résumé", url: `${origin}/unicode.zip` });
  });
  it("accepts public file links alongside an optional sign-in form", async () => {
    const result = await inspectPage(`${origin}/optional-login`, { lookup: fixtureLookup });
    expect(result.items[0]).toMatchObject({ url: `${origin}/public.zip`, kind: "file" });
  });
  it("uses the final redirect URL and never fetches file candidates", async () => {
    requests.length = 0;
    const result = await inspectPage(`${origin}/redirect`, { lookup: fixtureLookup });
    expect(result.sourcePage).toBe(`${origin}/files/index`);
    expect(result.items.map(({ url }) => url)).toEqual([
      `${origin}/archive.zip`,
      `${origin}/get?sig=abc`,
    ]);
    expect(requests).toEqual(["/redirect", "/files/index"]);
  });
  it.each(["large", "compressed"])("rejects oversized decoded %s HTML", async (route) => {
    await expect(inspectPage(`${origin}/${route}`, { lookup: fixtureLookup })).rejects.toThrow(
      /2 MiB/,
    );
  });
  it.each(["binary", "error", "unsafe", "loop", "invalid-encoding"])(
    "rejects %s responses cleanly",
    async (route) => {
      await expect(inspectPage(`${origin}/${route}`, { lookup: fixtureLookup })).rejects.toThrow();
      expect(requests).not.toContain("/private");
    },
  );
  it("returns an empty review for broken anchors and cancels an unresponsive server", async () => {
    expect((await inspectPage(`${origin}/malformed`, { lookup: fixtureLookup })).items).toEqual([]);
    await expect(
      inspectPage(`${origin}/slow`, { lookup: fixtureLookup, signal: AbortSignal.timeout(30) }),
    ).rejects.toThrow();
  });
  it.each([
    "http://127.0.0.1/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::]/",
    "http://100.64.0.1/",
    "http://169.254.169.254/",
    "file:///a",
    "https://user:secret@example.com/",
  ])("rejects unsafe source %s", async (url) => {
    expect(() => assertPublicPageUrl(url)).toThrow();
    await expect(inspectPage(url)).rejects.toThrow();
  });
  it("rejects private DNS results at the socket lookup boundary", async () => {
    await expect(
      new Promise((resolve, reject) =>
        publicPageLookup("localhost", { family: 4 }, (error, address) =>
          error ? reject(error) : resolve(address),
        ),
      ),
    ).rejects.toThrow(/public network/);
    expect(() => assertPublicPageUrl("https://[2606:4700:4700::1111]/")).not.toThrow();
  });
});
