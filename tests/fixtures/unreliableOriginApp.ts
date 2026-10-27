import express from "express";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startHttpRestartServer, stopHttpRestartServer } from "./httpRestartServer";
import { proxyApp } from "./proxyApp";

export async function startUnreliableOriginApp(baseURL: string, retrySeconds = 3) {
  const directory = await mkdtemp(path.join(tmpdir(), "unreliable-browser-"));
  const payload = Buffer.from("Recovered complete text from an unreliable origin.\n");
  const requests: { method: string; path: string; range?: string }[] = [];
  let loginFixed = false;
  const source = createServer((request, response) => {
    const name = (request.url ?? "").split("?", 1)[0];
    requests.push({ method: request.method ?? "", path: name, range: request.headers.range });
    if (request.method === "HEAD") {
      if (name === "/recovered-notes.txt") return response.writeHead(405).end();
      return response.writeHead(200, { "content-length": payload.length }).end();
    }
    if (name === "/expired-notes.txt" && !loginFixed)
      return response
        .writeHead(200, { "content-type": "text/html" })
        .end('<html><form><input type="password">Sign in</form></html>');
    if (
      (name === "/retry-notes.txt" || name === "/cancel-notes.txt") &&
      requests.filter((entry) => entry.method === "GET" && entry.path === name).length === 1
    )
      return response
        .writeHead(429, { "retry-after": String(name === "/cancel-notes.txt" ? 30 : retrySeconds) })
        .end("Rate limited");
    if (name === "/recovered-notes.txt" && request.headers.range === "bytes=0-0")
      return response
        .writeHead(206, {
          etag: '"browser"',
          "content-range": `bytes 0-0/${payload.length}`,
          "content-length": 1,
        })
        .end(payload.subarray(0, 1));
    response.writeHead(200, { etag: '"browser"', "content-length": payload.length }).end(payload);
  });
  source.listen(0, "127.0.0.1");
  await once(source, "listening");
  const api = await startHttpRestartServer(directory);
  const app = express();
  app.use((request, response, next) =>
    proxyApp(
      request.path.startsWith("/api") || request.path.startsWith("/rpc") ? api.origin : baseURL,
    )(request, response, next),
  );
  const ui = app.listen(0, "127.0.0.1");
  await once(ui, "listening");
  const sourceAddress = source.address();
  const uiAddress = ui.address();
  if (
    !sourceAddress ||
    typeof sourceAddress === "string" ||
    !uiAddress ||
    typeof uiAddress === "string"
  )
    throw new Error("Missing fixture port");
  return {
    origin: `http://127.0.0.1:${uiAddress.port}`,
    sourceOrigin: `http://download.example:${sourceAddress.port}`,
    directory,
    payload,
    requests,
    client: api.client,
    fixLogin() {
      loginFixed = true;
    },
    async close() {
      await stopHttpRestartServer(api.child, true);
      source.closeAllConnections();
      ui.closeAllConnections();
      await Promise.all([
        new Promise<void>((resolve) => source.close(() => resolve())),
        new Promise<void>((resolve) => ui.close(() => resolve())),
      ]);
      await rm(directory, { recursive: true, force: true });
    },
  };
}
