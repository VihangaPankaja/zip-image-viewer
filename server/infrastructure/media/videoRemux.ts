import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { Session } from "../../domain/models.js";
import { runCommand } from "../process/commandRunner.js";

const pendingRemuxes = new WeakMap<Session, Map<string, Promise<string>>>();

export function getSessionQualityOutputPath(
  session: Session,
  normalizedPath: string,
  quality: string,
): string {
  return path.join(
    session.workspaceDir,
    "video-quality",
    quality,
    `${crypto.createHash("sha1").update(normalizedPath).digest("hex")}.mp4`,
  );
}

export function remuxVideo(
  session: Session,
  normalizedPath: string,
  targetPath: string,
  executable: string | null,
  runTask: (
    _task: (_signal?: AbortSignal) => Promise<string>,
  ) => Promise<string>,
  enforceBudget: () => Promise<void>,
): Promise<string> {
  let pending = pendingRemuxes.get(session);
  if (!pending) {
    pending = new Map();
    pendingRemuxes.set(session, pending);
  }
  const existing = pending.get(normalizedPath);
  if (existing) return existing;
  const outputPath = getSessionQualityOutputPath(
    session,
    normalizedPath,
    "remux",
  );
  const remux = runTask(async (signal) => {
    if ((await stat(outputPath).catch(() => null))?.isFile()) return outputPath;
    if (!executable) throw new Error("Video transcoder is unavailable.");
    await mkdir(path.dirname(outputPath), { recursive: true });
    const temporaryPath = `${outputPath}.${crypto.randomUUID()}.mp4`;
    try {
      await runCommand(
        executable,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          targetPath,
          "-map",
          "0:v:0",
          "-map",
          "0:a:0?",
          "-c",
          "copy",
          "-movflags",
          "+faststart",
          temporaryPath,
        ],
        { signal },
      );
      await rename(temporaryPath, outputPath);
      await enforceBudget();
      return outputPath;
    } finally {
      await rm(temporaryPath, { force: true });
    }
  });
  pending.set(normalizedPath, remux);
  void remux
    .finally(() => pending.delete(normalizedPath))
    .catch(() => undefined);
  return remux;
}
