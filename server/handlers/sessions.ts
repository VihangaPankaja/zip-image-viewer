import type { Express } from "express";
import { createSessionInputSchema } from "../../shared/contracts.js";
import type { Session, SessionJob } from "../domain/models.js";

type SessionRouteDependencies = {
  createJob: (_url: string, _options: unknown) => SessionJob;
  emitJob: (_job: SessionJob, _patch: Partial<SessionJob>) => void;
  enqueueSessionJob: (_job: SessionJob, _confirmOversize: boolean) => void;
  sanitizeJob: (_job: SessionJob) => object;
  touchSession: (_sessionId: string) => Session | undefined;
  logEvent: (
    _level: "info" | "warn" | "error",
    _event: string,
    _details?: Record<string, unknown>,
  ) => void;
  sessionStore: ReadonlyMap<string, unknown>;
  removeSession: (_sessionId: string, _reason: string) => Promise<void>;
};

export function registerSessionRoutes(
  app: Express,
  deps: SessionRouteDependencies,
): void {
  app.post("/api/sessions", (req, res) => {
    const parsed = createSessionInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: "INVALID_INPUT",
          message: "A valid public archive URL is required.",
        },
      });
    }
    const { url, confirmOversize, downloadOptions, downloadSettings } =
      parsed.data;
    const job = deps.createJob(url, downloadOptions ?? downloadSettings ?? {});

    deps.emitJob(job, { message: "Queued archive request" });
    deps.enqueueSessionJob(job, confirmOversize);

    return res.status(202).json({ jobId: job.id, ...deps.sanitizeJob(job) });
  });

  app.get("/api/sessions/:id/tree", (req, res) => {
    const session = deps.touchSession(req.params.id);
    if (!session) {
      deps.logEvent("warn", "session.tree.missing", {
        sessionId: req.params.id,
      });
      return res
        .status(404)
        .json({ error: "Session not found or already cleaned up." });
    }

    deps.logEvent("info", "session.tree.read", {
      sessionId: session.id,
      fileCount: session.stats.fileCount,
    });

    return res.json({
      id: session.id,
      tree: session.tree,
      firstFilePath: session.firstFilePath,
      stats: session.stats,
    });
  });

  app.delete("/api/sessions/:id", async (req, res) => {
    if (!deps.sessionStore.has(req.params.id)) {
      deps.logEvent("warn", "session.delete.missing", {
        sessionId: req.params.id,
      });
      return res.status(404).json({ error: "Session not found." });
    }

    await deps.removeSession(req.params.id, "manual");
    return res.status(204).end();
  });
}
