import type { Express } from "express";
import { registerHealthRoute } from "../handlers/health.js";

type RouteDependencies = {
  getSessionCount: () => number;
  getJobCount: () => number;
};

export function registerBaseRoutes(app: Express, deps: RouteDependencies) {
  registerHealthRoute(app, deps);
}
