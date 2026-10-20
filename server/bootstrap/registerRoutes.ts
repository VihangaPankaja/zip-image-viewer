import type { Express } from "express";
import { registerSessionJobRoutes } from "../handlers/sessionJobs.js";
import type { SessionJobRouteDependencies } from "../handlers/sessionJobs.js";
import { registerSseRoutes } from "../handlers/sse.js";
import { registerTorrentVideoRoutes } from "../handlers/torrentVideoRoutes.js";
import type { TorrentAdapter } from "../application/torrents/torrentDownloader.js";
import type { SessionJob } from "../domain/models.js";

type RouteDependencies = {
  playback?: { jobs: Map<string, SessionJob>; adapter: TorrentAdapter };
  getSessionCount: () => number;
  getJobCount: () => number;
} & SessionJobRouteDependencies;

export function registerBaseRoutes(app: Express, deps: RouteDependencies) {
  if (deps.playback) registerTorrentVideoRoutes(app, deps.playback.jobs, deps.playback.adapter);
  registerSessionJobRoutes(app, {
    getJob: deps.getJob,
    sanitizeJob: deps.sanitizeJob,
    confirmSessionJob: deps.confirmSessionJob,
    parseRangeHeader: deps.parseRangeHeader,
    emitJob: deps.emitJob,
    closeJob: deps.closeJob,
    cleanupJob: deps.cleanupJob,
    removeJob: deps.removeJob,
  });
  registerSseRoutes(app);
}
