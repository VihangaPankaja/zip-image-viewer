import { pipeline } from "node:stream/promises";
import type { Express, Request } from "express";
import type { TorrentAdapter } from "../application/torrents/torrentDownloader.js";
import { inspectTorrentVideo } from "../application/torrents/torrentVideo.js";
import { openCompletedTorrentVideoFile } from "../application/torrents/torrentVideoFiles.js";
import { ApplicationError, type SessionJob } from "../domain/models.js";
import { parseRangeHeader } from "../infrastructure/runtime/runtimePrimitives.js";
import { applyByteRange } from "./httpUtils.js";

export function registerTorrentVideoRoutes(
  app: Express,
  jobs: Map<string, SessionJob>,
  adapter: TorrentAdapter,
): void {
  app.get("/api/session-jobs/:id/video/:action", async (req, res) => {
    if (req.params.action !== "info" && req.params.action !== "stream") {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const controller = new AbortController();
    const disconnect = () => controller.abort();
    res.once("close", disconnect);
    let file: ReturnType<NonNullable<TorrentAdapter["openVideoFile"]>> | undefined;
    try {
      file = await resolveTorrentVideo(req, jobs, adapter);
      const range =
        req.headers.range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(req.headers.range)
          ? "invalid"
          : parseRangeHeader(req.headers.range, file.size);
      if (req.params.action === "stream" && range === "invalid") {
        applyByteRange(res, range, file.size);
        return;
      }
      const info = await inspectTorrentVideo(
        file,
        AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      );
      res.setHeader("cache-control", "no-store");
      if (req.params.action === "info") {
        res.json(info);
        return;
      }
      if (info.state !== "ready") {
        res.status(409).json({ error: info.message });
        return;
      }
      res.type("video/mp4");
      const selectedRange = applyByteRange(res, range, file.size);
      if (selectedRange === null) return;
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const signal = controller.signal;
      await pipeline(file.stream(selectedRange ?? { start: 0, end: file.size - 1 }, signal), res, {
        signal,
      });
    } catch (error) {
      if (res.headersSent) res.destroy();
      else if (!controller.signal.aborted)
        res.status(error instanceof ApplicationError ? error.status : 503).json({
          error:
            error instanceof ApplicationError
              ? error.message
              : "Waiting for verified torrent pieces timed out or playback stopped. Check peers, resume the download and retry, or download first.",
        });
    } finally {
      res.removeListener("close", disconnect);
      controller.abort();
      file?.release();
    }
  });
}

function resolveTorrentVideo(req: Request, jobs: Map<string, SessionJob>, adapter: TorrentAdapter) {
  const job = jobs.get(typeof req.params.id === "string" ? req.params.id : "");
  if (!job) throw new ApplicationError("NOT_FOUND", "Job not found.", 404);
  const fileId = typeof req.query.fileId === "string" ? req.query.fileId : "";
  const selected = job.torrentFiles.find(({ id }) => id === fileId);
  if (!selected) throw new ApplicationError("NOT_FOUND", "Torrent file not found.", 404);
  if (
    job.sourceKind === "torrent" &&
    (job.status === "ready" || (job.status === "downloading" && job.phase === "indexing")) &&
    selected.selected &&
    selected.complete
  )
    return openCompletedTorrentVideoFile(job, selected);
  if (
    job.sourceKind !== "torrent" ||
    job.status !== "downloading" ||
    job.phase !== "downloading" ||
    !selected.selected ||
    !adapter.openVideoFile
  )
    throw new ApplicationError(
      "CONFLICT",
      "Select the file and resume its download, or open the completed file in Explore.",
      409,
    );
  return adapter.openVideoFile(job.id, fileId);
}
