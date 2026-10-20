import { readFile } from "node:fs/promises";
import type { Response } from "express";
import type { VideoRendition } from "../../domain/models.js";
import { publishedSegments } from "../../media/hlsManifest.js";

type Availability = "ready" | "preparing" | "failed" | "cancelled";

export async function readRenditionPlaylist(rendition: VideoRendition): Promise<string> {
  return readFile(rendition.playlistPath, "utf8").catch(() => "");
}

export async function waitForPublishedSegment(
  rendition: VideoRendition,
  index: number,
  response: Response,
  timeoutMs = 14_000,
): Promise<Availability> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (response.destroyed) return "cancelled";
    const finished = rendition.status === "error" || rendition.status === "done";
    if (publishedSegments(await readRenditionPlaylist(rendition)).includes(index)) return "ready";
    if (finished) return "failed";
    await new Promise<void>((resolve) => setTimeout(resolve, 160));
  } while (Date.now() < deadline);
  // Publication may finish after the last read. Retry that snapshot rather than
  // reporting a terminal error for media that has just become available.
  return "preparing";
}

export function sendPreparationStatus(
  response: Response,
  availability: Exclude<Availability, "ready">,
) {
  if (response.destroyed || availability === "cancelled") return;
  const preparing = availability === "preparing";
  response.set("Cache-Control", "private, no-store");
  if (preparing) response.set("Retry-After", "1");
  return response.status(preparing ? 425 : 503).json({
    error: preparing ? "Rendition is being prepared." : "Rendition could not be prepared.",
  });
}
