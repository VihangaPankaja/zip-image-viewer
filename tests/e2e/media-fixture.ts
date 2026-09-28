import express from "express";
import { once } from "node:events";
import { request } from "node:http";
import path from "node:path";
import { test as base } from "@playwright/test";
import { prepareMedia } from "../review/fixtures";

export const test = base.extend<{ appOrigin: string }>({
  appOrigin: async ({ baseURL }, provide) => {
    if (!baseURL) throw new Error("The app base URL is required.");
    const mediaDirectory = await prepareMedia();
    const app = express();
    app.get("/api/sessions/:id/video/play", (_req, res) =>
      res.sendFile(path.join(mediaDirectory, "sample.mp4")),
    );
    app.use((req, res) => {
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
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Media fixture did not bind.");
      await provide("http://127.0.0.1:" + String(address.port));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
});
