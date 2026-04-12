import type { Express } from "express";

type HealthDependencies = {
  getSessionCount: () => number;
  getJobCount: () => number;
};

export function registerHealthRoute(app: Express, deps: HealthDependencies) {
  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      sessions: deps.getSessionCount(),
      jobs: deps.getJobCount(),
    });
  });
}
