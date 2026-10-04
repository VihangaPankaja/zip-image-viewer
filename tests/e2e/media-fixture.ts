import express from "express";
import { once } from "node:events";
import { request } from "node:http";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { test as base } from "@playwright/test";
import { prepareMedia } from "../review/fixtures";

export const test = base.extend<{ appOrigin: string; withAudio: boolean }>({
  withAudio: [false, { option: true }],
  appOrigin: async ({ baseURL, withAudio }, provide) => {
    if (!baseURL) throw new Error("The app base URL is required.");
    const mediaDirectory = await prepareMedia();
    const filename = withAudio ? "sample-with-audio.mp4" : "sample.mp4";
    if (withAudio) {
      // Audible media follows WebKit's user-initiated background playback policy.
      execFileSync(
        createRequire(import.meta.url)("ffmpeg-static") as string,
        [
          "-y",
          "-loglevel",
          "error",
          "-i",
          path.join(mediaDirectory, "sample.mp4"),
          "-i",
          path.join(mediaDirectory, "sample.wav"),
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-movflags",
          "+faststart",
          "-shortest",
          path.join(mediaDirectory, filename),
        ],
        { timeout: 30_000 },
      );
    }
    const app = express();
    app.get("/api/sessions/:id/video/play", (_req, res) =>
      res.sendFile(path.join(mediaDirectory, filename)),
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

export const audioTest = test.extend({ withAudio: true });
