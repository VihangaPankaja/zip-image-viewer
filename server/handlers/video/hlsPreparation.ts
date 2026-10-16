import type { Response } from "express";
import type { VideoTranscodeEntry } from "../../domain/models.js";
import { calculateRenditions } from "../../media/hlsManifest.js";
import { WINDOWED_AFTER_SECONDS } from "../../infrastructure/media/hlsWindows.js";
import type { VideoRouteDependencies } from "./types.js";
import type { VideoContext } from "./routeContext.js";

export async function prepareHlsMaster(
  response: Response,
  deps: VideoRouteDependencies,
  context: VideoContext,
  entry: VideoTranscodeEntry,
): Promise<boolean> {
  const disconnected = () => response.destroyed;
  if (disconnected()) return false;
  const lowest = calculateRenditions(entry).at(0);
  if (lowest) {
    const low = deps.getRenditionState(entry, context.session, lowest.id);
    low.lastAccessedAt = Date.now();
    if (entry.durationSeconds > WINDOWED_AFTER_SECONDS) {
      // Prepare a usable starting level before advertising the full ladder.
      const controller = new AbortController();
      const close = () => controller.abort();
      response.once("close", close);
      try {
        await deps.startPrioritySegmentWindow(
          entry,
          context.session,
          low,
          0,
          controller.signal,
        );
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        response.removeListener("close", close);
      }
      if (disconnected()) return false;
    } else {
      await deps.startRenditionTranscode(entry, context.session, low);
    }
  }
  return true;
}
