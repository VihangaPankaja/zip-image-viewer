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

async function prepareRetainedVideo(
  entry: VideoTranscodeEntry,
  session: Session,
  windows: HlsWindows,
  signal: AbortSignal,
  startSequential: (_rendition: VideoRendition) => Promise<void>,
  enforceBudget: () => Promise<void>,
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
    await rendition.completion;
    if (audio) {
      const audioRendition = getRenditionState(entry, session, audio.id);
      await startSequential(audioRendition);
      await audioRendition.completion;
    }
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
    await enforceBudget();
  }
}

type PreparationDependencies = {
  windows: HlsWindows;
  signalFor: (_session: Session) => AbortSignal;
  startSequential: (
    _entry: VideoTranscodeEntry,
    _session: Session,
    _rendition: VideoRendition,
  ) => Promise<void>;
  track: (_session: Session, _task: Promise<void>) => Promise<void>;
  enforceBudget: () => Promise<void>;
  onError: (_session: Session, _error: unknown) => void;
};

export class RetainedVideoPreparation {
  private readonly videos = new WeakMap<VideoTranscodeEntry, Promise<void>>();
  private readonly sessions = new WeakMap<Session, Promise<void>>();
  constructor(private readonly deps: PreparationDependencies) {}

  async ensure(
    entry: VideoTranscodeEntry,
    session: Session,
    priority: "interactive" | "background",
  ): Promise<VideoTranscodeEntry> {
    if (!session.retained) return entry;
    let preparation = this.videos.get(entry);
    if (!preparation) {
      const signal = this.deps.signalFor(session);
      preparation = (this.sessions.get(session) ?? Promise.resolve())
        .catch(() => undefined)
        .then(async () => {
          signal.throwIfAborted();
          await prepareRetainedVideo(
            entry,
            session,
            this.deps.windows,
            signal,
            (rendition) => this.deps.startSequential(entry, session, rendition),
            this.deps.enforceBudget,
          );
          await this.deps.enforceBudget();
        });
      this.videos.set(entry, preparation);
      this.sessions.set(session, preparation);
      void this.deps.track(session, preparation).catch((error: unknown) => {
        if (!signal.aborted) this.deps.onError(session, error);
      });
    }
    if (priority === "background") await preparation;
    return entry;
  }
}
