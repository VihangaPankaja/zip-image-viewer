import type { Express } from "express";

export function registerSseRoutes(app: Express) {
  app.get("/api/events/ping", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    res.write(
      `event: ready\ndata: ${JSON.stringify({ ok: true, channel: "sse" })}\n\n`,
    );
    const timer = setInterval(() => {
      res.write(
        `event: heartbeat\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`,
      );
    }, 15000);

    _req.on("close", () => {
      clearInterval(timer);
      res.end();
    });
  });
}
