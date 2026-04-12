import type { Express } from "express";

export function registerWebhookRoutes(app: Express) {
  app.post("/api/webhooks/ping", (req, res) => {
    res.json({
      ok: true,
      channel: "webhook",
      receivedAt: Date.now(),
      hasBody: Boolean(req.body && Object.keys(req.body).length > 0),
    });
  });
}
