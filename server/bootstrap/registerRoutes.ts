import type { Express } from "express";
import { registerHealthRoute } from "../handlers/health.js";
import { registerWebhookRoutes } from "../handlers/webhooks.js";
import { registerSseRoutes } from "../handlers/sse.js";

type RouteDependencies = {
  getSessionCount: () => number;
  getJobCount: () => number;
};

export function registerBaseRoutes(app: Express, deps: RouteDependencies) {
  registerHealthRoute(app, deps);
  registerWebhookRoutes(app);
  registerSseRoutes(app);
}
