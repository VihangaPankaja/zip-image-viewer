import type { Express } from "express";

function hasProperties(value: unknown): boolean {
  return (
    typeof value === "object" && value !== null && Object.keys(value).length > 0
  );
}

export function registerWebhookRoutes(app: Express): void {
  app.post("/api/webhooks/ping", (req, res) => {
    res.json({
      ok: true,
      channel: "webhook",
      receivedAt: Date.now(),
      hasBody: hasProperties(req.body),
    });
  });
}
