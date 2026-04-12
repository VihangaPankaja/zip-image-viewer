// @ts-nocheck

export function registerSessionRoutes(app, deps) {
  app.post("/api/sessions", async (req, res) => {
    const {
      url,
      confirmOversize = false,
      downloadOptions = null,
      downloadSettings = null,
    } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: "File URL is required." });
    }
    const job = deps.createJob(url, downloadOptions || downloadSettings || {});

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
