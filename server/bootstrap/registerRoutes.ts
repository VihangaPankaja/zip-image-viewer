import type { Express } from "express";
import { registerHealthRoute } from "../handlers/health.js";
import { registerSessionJobRoutes } from "../handlers/sessionJobs.js";
import type { SessionJobRouteDependencies } from "../handlers/sessionJobs.js";
import { registerWebhookRoutes } from "../handlers/webhooks.js";
import { registerSseRoutes } from "../handlers/sse.js";

type RouteDependencies = {
  getSessionCount: () => number;
  getJobCount: () => number;
} & SessionJobRouteDependencies;

export function registerBaseRoutes(app: Express, deps: RouteDependencies) {
  registerHealthRoute(app, deps);
  registerSessionJobRoutes(app, {
    getJob: deps.getJob,
    sanitizeJob: deps.sanitizeJob,
    enqueueSessionJob: deps.enqueueSessionJob,
    parseRangeHeader: deps.parseRangeHeader,
    emitJob: deps.emitJob,
    closeJob: deps.closeJob,
    cleanupJob: deps.cleanupJob,
  });
  registerWebhookRoutes(app);
  registerSseRoutes(app);
}
