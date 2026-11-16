import express, { type Express, type RequestHandler, type Response } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Session } from "../domain/models.js";
import { ApplicationError } from "../domain/models.js";
import { selectionExportInputSchema } from "../../shared/contracts.js";
import { planSelectionExport } from "../application/sessions/selectionExport.js";
import { streamSelectionZip } from "../infrastructure/archive/streamSelectionZip.js";
import { queryText } from "./httpUtils.js";
import { z } from "zod";

type Dependencies = { touchSession: (_id: string) => Session | undefined };

function exportError(res: Response, error: unknown) {
  if (res.headersSent) res.destroy();
  else
    res.status(error instanceof ApplicationError ? error.status : 400).json({
      error:
        error instanceof ApplicationError
          ? error.message
          : "Export source is unavailable. Select the files again.",
    });
}

function parseInput(body: unknown) {
  const form = z.object({ selection: z.string() }).safeParse(body);
  try {
    return selectionExportInputSchema.safeParse(
      form.success ? JSON.parse(form.data.selection) : body,
    );
  } catch {
    return selectionExportInputSchema.safeParse(null);
  }
}

export function registerSelectionExportRoutes(app: Express, deps: Dependencies) {
  const state = { active: 0 };
  app.post("/api/sessions/:id/export/plan", createHandler(deps, state, false));
  app.post(
    "/api/sessions/:id/export",
    express.urlencoded({ extended: false, limit: "1mb" }),
    createHandler(deps, state, true),
  );
}

function createHandler(
  deps: Dependencies,
  state: { active: number },
  download: boolean,
): RequestHandler {
  return async (req, res) => {
    const parsed = parseInput(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Select safe relative file or folder paths." });
      return;
    }
    const id = queryText(req.params.id);
    const session = deps.touchSession(id);
    if (!session) {
      res.status(404).json({ error: "Session not found or already cleaned up." });
      return;
    }
    if (state.active >= 2) {
      res
        .status(429)
        .json({ error: "Two exports are already running. Try again after one finishes." });
      return;
    }
    state.active++;
    const controller = new AbortController();
    const abort = () => controller.abort();
    res.on("close", abort);
    const timer = setTimeout(abort, 15 * 60_000);
    timer.unref();
    let finish!: () => void;
    const operation = {
      controller,
      done: new Promise<void>((resolve) => {
        finish = resolve;
      }),
    };
    (session.archiveOperations ??= new Set()).add(operation);
    try {
      const plan = await planSelectionExport(session, parsed.data.paths, controller.signal);
      controller.signal.throwIfAborted();
      if (deps.touchSession(id) !== session || session.archiveRefreshing)
        throw new ApplicationError("CONFLICT", "Session changed. Select the files again.", 409);
      res.setHeader("cache-control", "no-store");
      if (!download) {
        res.json(plan.summary);
        return;
      }
      if (plan.summary.requiresConfirmation && !parsed.data.confirmed)
        throw new ApplicationError(
          "CONFLICT",
          "Confirm this large export before downloading.",
          409,
        );
      res.type("application/zip");
      res.attachment("selection.zip");
      await pipeline(
        Readable.from(streamSelectionZip(plan.entries, plan.root, controller.signal), {
          objectMode: false,
          highWaterMark: 64 * 1024,
        }),
        res,
        { signal: controller.signal },
      );
    } catch (error) {
      if (!controller.signal.aborted) exportError(res, error);
    } finally {
      clearTimeout(timer);
      res.off("close", abort);
      session.archiveOperations.delete(operation);
      state.active--;
      finish();
    }
  };
}
