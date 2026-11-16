import type { RequestHandler } from "express";
import { request, type Server } from "node:http";
import express from "express";

export async function closeFixtureServers(servers: (Server | undefined)[]) {
  for (const server of servers) {
    if (!server) continue;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export function proxyApp(baseURL: string): RequestHandler {
  return (req, res) => {
    const upstream = request(
      new URL(req.originalUrl, baseURL),
      {
        method: req.method,
        headers: { ...req.headers, host: new URL(baseURL).host },
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.status(502);
      res.end();
    });
    req.pipe(upstream);
  };
}

export function workspaceProxy(frontend: string, apiOrigin: () => string) {
  const app = express();
  app.use((request, response, next) =>
    proxyApp(
      request.path.startsWith("/api") || request.path.startsWith("/rpc") ? apiOrigin() : frontend,
    )(request, response, next),
  );
  return app;
}
