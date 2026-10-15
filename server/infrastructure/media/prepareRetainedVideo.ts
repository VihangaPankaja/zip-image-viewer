import type { Session, VideoTranscodeEntry } from "../../domain/models.js";
import { calculateRenditions } from "../../media/hlsManifest.js";
import { getRenditionState } from "../../media/videoRendition.js";
import { HlsWindows, WINDOW_SEGMENTS } from "./hlsWindows.js";

export async function prepareRetainedVideo(
  entry: VideoTranscodeEntry,
  session: Session,
  windows: HlsWindows,
  signal: AbortSignal,
): Promise<void> {
  const lowest = calculateRenditions(entry).at(0);
  if (!lowest) return;
  const rendition = getRenditionState(entry, session, lowest.id);
  const audio =
    (entry.audioTracks?.length ?? 0) > 1
      ? (entry.audioTracks?.find(({ isDefault }) => isDefault) ??
        entry.audioTracks?.at(0))
      : undefined;
  for (
    let index = 0;
    index < entry.expectedSegments;
    index += WINDOW_SEGMENTS
  ) {
    signal.throwIfAborted();
    await windows.ensure(
      entry,
      session,
      rendition,
      index,
      signal,
      "background",
    );
    if (audio)
      await windows.ensure(
        entry,
        session,
        getRenditionState(entry, session, audio.id),
        index,
        signal,
        "background",
      );
  }
}
