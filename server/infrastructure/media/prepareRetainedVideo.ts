import type {
  Session,
  VideoRendition,
  VideoTranscodeEntry,
} from "../../domain/models.js";
import { calculateRenditions } from "../../media/hlsManifest.js";
import { getRenditionState } from "../../media/videoRendition.js";
import {
  HlsWindows,
  WINDOW_SEGMENTS,
  WINDOWED_AFTER_SECONDS,
} from "./hlsWindows.js";

export async function prepareRetainedVideo(
  entry: VideoTranscodeEntry,
  session: Session,
  windows: HlsWindows,
  signal: AbortSignal,
  startSequential: (_rendition: VideoRendition) => Promise<void>,
): Promise<void> {
  const lowest = calculateRenditions(entry).at(0);
  if (!lowest) return;
  const rendition = getRenditionState(entry, session, lowest.id);
  const audio =
    (entry.audioTracks?.length ?? 0) > 1
      ? (entry.audioTracks?.find(({ isDefault }) => isDefault) ??
        entry.audioTracks?.at(0))
      : undefined;
  if (entry.durationSeconds <= WINDOWED_AFTER_SECONDS) {
    signal.throwIfAborted();
    await startSequential(rendition);
    if (audio)
      await startSequential(getRenditionState(entry, session, audio.id));
    return;
  }
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
