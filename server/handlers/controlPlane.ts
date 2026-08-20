import type { Express } from "express";

export type ControlPlaneReadDependencies = {
  listJobs: () => readonly object[];
  listSessions: () => readonly object[];
};

export function registerControlPlaneReadRoutes(
  app: Express,
  deps: ControlPlaneReadDependencies,
): void {
  app.get("/api/session-jobs", (_request, response) => {
    response.json({ items: deps.listJobs() });
  });

  app.get("/api/sessions", (_request, response) => {
    response.json({ items: deps.listSessions() });
  });
}
