import type { Session, VideoRendition, VideoTranscodeEntry } from "../../domain/models.js";
import { calculateRenditions } from "../../media/hlsManifest.js";
import { getRenditionState } from "../../media/videoRendition.js";
import { HlsWindows, WINDOW_SEGMENTS } from "./hlsWindows.js";

type Dependencies = {
  signalFor: (_session: Session) => AbortSignal;
  track: (_session: Session, _task: Promise<void>) => Promise<void>;
  enforceBudget: () => Promise<void>;
  onError: (_session: Session, _error: unknown) => void;
};

export class HlsPlaybackPreparation {
  private readonly warming = new WeakMap<VideoRendition, Map<number, Promise<void>>>();
  constructor(
    private readonly windows: HlsWindows,
    private readonly deps: Dependencies,
  ) {}
  async ensure(
    entry: VideoTranscodeEntry,
    session: Session,
    rendition: VideoRendition,
    index: number,
    signal?: AbortSignal,
  ): Promise<void> {
    rendition.lastAccessedAt = Date.now();
    const levels = calculateRenditions(entry);
    const level = levels.findIndex(({ id }) => id === rendition.qualityId);
    // Audio and single-level videos have no adaptive video fallback to warm.
    for (const fallback of levels.slice(0, Math.max(0, level))) {
      const state = getRenditionState(entry, session, fallback.id);
      state.lastAccessedAt = Date.now();
      await this.windows.ensure(entry, session, state, index, signal);
    }
    await this.windows.ensure(entry, session, rendition, index, signal);
    signal?.throwIfAborted();
    if (level < 0 || levels.length < 2) return;
    const start = Math.floor(index / WINDOW_SEGMENTS) * WINDOW_SEGMENTS;
    let jobs = this.warming.get(rendition);
    if (!jobs) {
      jobs = new Map();
      this.warming.set(rendition, jobs);
    }
    if (jobs.has(start)) return;
    const sessionSignal = this.deps.signalFor(session);
    const candidates = levels.slice(0, level + 1).map(({ id }) => id);
    const task = (async () => {
      for (const quality of candidates) {
        const candidate = getRenditionState(entry, session, quality);
        candidate.lastAccessedAt = Date.now();
        for (const next of [start, start + WINDOW_SEGMENTS]) {
          if (next >= entry.expectedSegments) continue;
          await this.windows.ensure(entry, session, candidate, next, sessionSignal, "background");
          await this.deps.enforceBudget();
        }
      }
    })();
    jobs.set(start, task);
    void this.deps
      .track(session, task)
      .catch((error: unknown) => {
        if (!sessionSignal.aborted) this.deps.onError(session, error);
      })
      .finally(() => jobs.delete(start));
  }
}
