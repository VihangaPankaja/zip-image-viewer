import type { Express, Response } from "express";
import type { createLocalImports } from "../application/jobs/localImports.js";
import { ApplicationError, type SessionJob } from "../domain/models.js";

function fail(response: Response, error: unknown) {
  if (response.destroyed || response.headersSent) return;
  const status =
    error instanceof ApplicationError
      ? error.status
      : error instanceof Error && "code" in error && error.code === "DOWNLOAD_FATAL"
        ? 507
        : 400;
  response
    .status(status)
    .json({ error: error instanceof Error ? error.message : "Local import failed." });
}

export function registerLocalImportRoutes(
  app: Express,
  imports: ReturnType<typeof createLocalImports>,
  sanitize: (_job: SessionJob) => unknown,
) {
  app.post("/api/local-imports", async (req, res) => {
    res.setHeader("cache-control", "no-store");
    try {
      res.status(201).json(sanitize(await imports.initialize(req.body)));
    } catch (error) {
      fail(res, error);
    }
  });
  app.put("/api/local-imports/:id/content", async (req, res) => {
    res.setHeader("cache-control", "no-store");
    const disconnected = new AbortController();
    const abort = () => {
      if (!res.writableFinished) disconnected.abort();
    };
    req.once("aborted", abort);
    res.once("close", abort);
    try {
      if (
        req.headers["content-type"] !== "application/octet-stream" ||
        req.headers["content-encoding"]
      )
        throw new ApplicationError(
          "INVALID_INPUT",
          "Send the raw file as application/octet-stream without content encoding.",
          415,
        );
      const job = await imports.upload(
        req.params.id,
        req,
        req.headers["content-length"],
        disconnected.signal,
      );
      res.json(sanitize(job));
    } catch (error) {
      req.resume();
      fail(res, error);
    } finally {
      req.removeListener("aborted", abort);
      res.removeListener("close", abort);
    }
  });
}
