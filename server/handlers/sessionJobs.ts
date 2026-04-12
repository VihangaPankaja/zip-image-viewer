import type { Express, Response } from "express";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import mime from "mime-types";

type RangeValue = {
  start: number;
  end: number;
};

export type SessionJob = {
  id: string;
  url: string;
  status: string;
  phase?: string;
  zipPath?: string;
  requiresConfirmation?: boolean;
  cleanupAt?: number;
  abortController?: { abort: () => void } | null;
  subscribers: Set<Response>;
  message?: string;
  reportedSize?: number;
  downloadedBytes?: number;
  isStalled?: boolean;
  extractedEntries?: number;
  totalEntries?: number;
};

export type SessionJobRouteDependencies = {
  getJob: (_jobId: string) => SessionJob | undefined;
  sanitizeJob: (_job: SessionJob) => unknown;
  enqueueSessionJob: (
    _job: SessionJob,
    _confirmOversize: boolean,
  ) => void;
  parseRangeHeader: (
    _rangeHeader: string | undefined,
    _fileSize: number,
  ) => RangeValue | "invalid" | null;
  emitJob: (
    _job: SessionJob,
    _payload: Record<string, unknown>,
    _socketEvent?: string,
  ) => void;
  closeJob: (_job: SessionJob, _reason: string) => void;
  cleanupJob: (_jobId: string, _reason: string) => Promise<void>;
};

export function registerSessionJobRoutes(
  app: Express,
  deps: SessionJobRouteDependencies,
) {
  app.get("/api/session-jobs/:id", (req, res) => {
    const job = deps.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found." });
    }

    return res.json(deps.sanitizeJob(job));
  });

  app.get("/api/session-jobs/:id/events", (req, res) => {
    const job = deps.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found." });
    }

    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders?.();

    job.subscribers.add(res);
    res.write("retry: 1500\n\n");
    res.write(`event: progress\n`);
    res.write(`data: ${JSON.stringify(deps.sanitizeJob(job))}\n\n`);

    req.on("close", () => {
      job.subscribers.delete(res);
    });
  });

  app.post("/api/session-jobs/:id/confirm", (req, res) => {
    const job = deps.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found." });
    }

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

  app.get("/api/session-jobs/:id/stream", async (req, res) => {
    const job = deps.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found." });
    }

    if (!job.zipPath) {
      return res.status(409).json({
        error: "Streaming source is not ready yet.",
      });
    }

    const fileStats = await stat(job.zipPath).catch(() => null);
    if (!fileStats || !fileStats.isFile() || fileStats.size <= 0) {
      return res.status(409).json({
        error: "No downloaded bytes available yet.",
      });
    }

    let contentType = "application/octet-stream";
    try {
      const parsedUrl = new URL(job.url);
      contentType = mime.lookup(parsedUrl.pathname) || contentType;
    } catch {
      contentType = mime.lookup(job.zipPath) || contentType;
    }

    res.setHeader("accept-ranges", "bytes");
    res.setHeader("cache-control", "no-store");
    res.type(contentType);

    const range = deps.parseRangeHeader(req.headers.range, fileStats.size);
    if (range === "invalid") {
      res.setHeader("content-range", `bytes */${fileStats.size}`);
      return res.status(416).end();
    }

    if (range) {
      const contentLength = range.end - range.start + 1;
      res.status(206);
      res.setHeader(
        "content-range",
        `bytes ${range.start}-${range.end}/${fileStats.size}`,
      );
      res.setHeader("content-length", String(contentLength));
      return createReadStream(job.zipPath, {
        start: range.start,
        end: range.end,
      }).pipe(res);
    }

    res.setHeader("content-length", String(fileStats.size));
    return createReadStream(job.zipPath).pipe(res);
  });

  app.delete("/api/session-jobs/:id", async (req, res) => {
    const job = deps.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found." });
    }

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
