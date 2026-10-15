import { mkdir } from "node:fs/promises";
import type {
  Session,
  VideoRendition,
  VideoTranscodeEntry,
} from "../../domain/models.js";
import {
  buildFmp4AudioGroupArgs,
  buildFmp4HlsArgs,
} from "../../media/ffmpegHls.js";
import { getRenditionState } from "../../media/videoRendition.js";
import { runCommand } from "../process/commandRunner.js";
import { errorFromUnknown } from "../runtime/mediaClassification.js";

type Dependencies = {
  ffmpegPath: string | null;
  segmentSeconds: number;
  runVideoTask: <Result>(
    _session: Session,
    _task: (_signal?: AbortSignal) => Promise<Result>,
    _signal: AbortSignal | undefined,
    _priority: "interactive" | "background",
  ) => Promise<Result>;
  refreshRenditionAvailability: (_rendition: VideoRendition) => Promise<number>;
  enforceDerivedMediaBudget: () => Promise<void>;
  logEvent: (
    _level: "info" | "warn" | "error",
    _event: string,
    _details?: Record<string, unknown>,
  ) => void;
};

function renditionArgs(
  entry: VideoTranscodeEntry,
  renditions: VideoRendition[],
  audio: boolean,
  segmentSeconds: number,
): string[] {
  if (audio) {
    const outputs = (entry.audioTracks ?? []).flatMap((track) => {
      const rendition = renditions.find(
        ({ qualityId }) => qualityId === track.id,
      );
      return rendition
        ? [{ index: track.index, directory: rendition.dir }]
        : [];
    });
    return buildFmp4AudioGroupArgs(entry.targetPath, outputs, segmentSeconds);
  }
  return buildFmp4HlsArgs({
    inputPath: entry.targetPath,
    outputDirectory: renditions[0].dir,
    height: renditions[0].selectedHeight,
    segmentDurationSeconds: segmentSeconds,
    videoOnly: (entry.audioTracks?.length ?? 0) > 1,
  });
}

export function startRenditionJob(
  entry: VideoTranscodeEntry,
  session: Session,
  requested: VideoRendition,
  deps: Dependencies,
  priority?: "interactive" | "background",
): Promise<void> {
  const executable = deps.ffmpegPath;
  if (!executable || requested.status !== "idle") return Promise.resolve();
  const audioTracks = entry.audioTracks ?? [];
  const audioTrack = audioTracks.find(
    (track) => track.id === requested.qualityId,
  );
  if (!audioTrack && requested.qualityId.startsWith("audio-"))
    return Promise.reject(new Error("Unknown audio track."));
  const renditions = audioTrack
    ? audioTracks
        .map((track) => getRenditionState(entry, session, track.id))
        .filter((rendition) => rendition.status === "idle")
    : [requested];
  const queuedAt = Date.now();
  let startedAt = queuedAt;
  const log = (
    event: string,
    details: Record<string, unknown> = {},
    level: "info" | "warn" = "info",
  ) => {
    for (const rendition of renditions)
      deps.logEvent(level, event, {
        sessionId: session.id,
        path: entry.path,
        quality: rendition.qualityId,
        cache: "miss",
        ...details,
      });
  };
  for (const rendition of renditions) {
    rendition.status = "queued";
    rendition.queuedAt = queuedAt;
  }
  log("video.transcode.queued");
  const encode = async (signal?: AbortSignal) => {
    startedAt = await prepareRenditions(renditions, queuedAt);
    log("video.transcode.started", { queueMs: startedAt - queuedAt });
    const args = renditionArgs(
      entry,
      renditions,
      Boolean(audioTrack),
      deps.segmentSeconds,
    );
    await runCommand(executable, args, { signal });
  };
  void deps
    .runVideoTask(
      session,
      encode,
      undefined,
      priority ?? (audioTrack ? "interactive" : "background"),
    )
    .then(async () => {
      await finishRenditions(renditions, deps);
      log("video.transcode.completed", {
        queueMs: startedAt - queuedAt,
        encodeMs: Date.now() - startedAt,
      });
    })
    .catch((error: unknown) => {
      for (const rendition of renditions) rendition.status = "error";
      log(
        "video.transcode.failed",
        { error: errorFromUnknown(error).message },
        "warn",
      );
    });
  return Promise.resolve();
}

async function prepareRenditions(
  renditions: VideoRendition[],
  queuedAt: number,
): Promise<number> {
  await Promise.all(
    renditions.map((rendition) => mkdir(rendition.dir, { recursive: true })),
  );
  const startedAt = Date.now();
  for (const rendition of renditions) {
    rendition.status = "running";
    rendition.encoderWaitMs = startedAt - queuedAt;
  }
  return startedAt;
}

async function finishRenditions(
  renditions: VideoRendition[],
  deps: Dependencies,
): Promise<void> {
  await Promise.all(
    renditions.map((rendition) => deps.refreshRenditionAvailability(rendition)),
  );
  for (const rendition of renditions) rendition.status = "done";
  void deps.enforceDerivedMediaBudget().catch((error: unknown) =>
    deps.logEvent("warn", "media.cache.cleanup.failed", {
      error: errorFromUnknown(error).message,
    }),
  );
}
