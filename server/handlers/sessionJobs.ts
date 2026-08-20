import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Express } from "express";
import mime from "mime-types";
import type { SessionJob } from "../domain/models.js";
import { applyByteRange } from "./httpUtils.js";

type RangeValue = { start: number; end: number };

export type SessionJobRouteDependencies = {
  getJob: (_jobId: string) => SessionJob | undefined;
  sanitizeJob: (_job: SessionJob) => unknown;
  enqueueSessionJob: (_job: SessionJob, _confirmOversize: boolean) => void;
  parseRangeHeader: (
    _rangeHeader: string | undefined,
    _fileSize: number,
  ) => RangeValue | "invalid" | null;
  emitJob: (
    _job: SessionJob,
    _payload: Partial<SessionJob>,
    _socketEvent?: string,
  ) => void;
  closeJob: (_job: SessionJob, _reason: SessionJob["status"]) => void;
  cleanupJob: (_jobId: string, _reason: string) => Promise<void>;
};

function registerStateRoutes(
  app: Express,
  deps: SessionJobRouteDependencies,
): void {
  app.get("/api/session-jobs/:id", (req, res) => {
    const job = deps.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found." });
    return res.json(deps.sanitizeJob(job));
  });

  app.get("/api/session-jobs/:id/events", (req, res) => {
    const job = deps.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found." });
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders();
    job.subscribers.add(res);
    res.write("retry: 1500\n\n");
    res.write("event: progress\n");
    res.write(`data: ${JSON.stringify(deps.sanitizeJob(job))}\n\n`);
    req.on("close", () => {
      job.subscribers.delete(res);
    });
  });

  app.post("/api/session-jobs/:id/confirm", (req, res) => {
    const job = deps.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found." });
    if (job.status !== "awaiting_confirmation") {
      return res
        .status(400)
        .json({ error: "Job is not awaiting confirmation." });
    }
    if (!job.requiresConfirmation) {
      return res
        .status(400)
        .json({ error: "This job does not need confirmation." });
    }
    job.requiresConfirmation = false;
    job.cleanupAt = 0;
    deps.enqueueSessionJob(job, true);
    return res.json(deps.sanitizeJob(job));
  });
}

function registerStreamRoute(
  app: Express,
  deps: SessionJobRouteDependencies,
): void {
  app.get("/api/session-jobs/:id/stream", async (req, res) => {
    const job = deps.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found." });
    if (!job.zipPath) {
      return res
        .status(409)
        .json({ error: "Streaming source is not ready yet." });
    }
    const fileStats = await stat(job.zipPath).catch(() => null);
    if (!fileStats?.isFile() || fileStats.size <= 0) {
      return res
        .status(409)
        .json({ error: "No downloaded bytes available yet." });
    }
    let contentType = "application/octet-stream";
    try {
      contentType = mime.lookup(new URL(job.url).pathname) || contentType;
    } catch {
      contentType = mime.lookup(job.zipPath) || contentType;
    }
    res.setHeader("cache-control", "no-store");
    res.type(contentType);
    const range = applyByteRange(
      res,
      deps.parseRangeHeader(req.headers.range, fileStats.size),
      fileStats.size,
    );
    if (range === null) return;
    return createReadStream(job.zipPath, range).pipe(res);
  });
}

function registerCancelRoute(
  app: Express,
  deps: SessionJobRouteDependencies,
): void {
  app.delete("/api/session-jobs/:id", async (req, res) => {
    const job = deps.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found." });
    job.abortController?.abort();
    deps.emitJob(
      job,
      {
        status: "cancelled",
        phase: "cancelled",
        error: "",
        downloadSpeedBytesPerSec: 0,
        message: "Archive loading was cancelled.",
      },
      "cancelled",
    );
    deps.closeJob(job, "cancelled");
    await deps.cleanupJob(job.id, "cancelled");
    return res.status(204).end();
  });
}

export function registerSessionJobRoutes(
  app: Express,
  deps: SessionJobRouteDependencies,
): void {
  registerStateRoutes(app, deps);
  registerStreamRoute(app, deps);
  registerCancelRoute(app, deps);
}
