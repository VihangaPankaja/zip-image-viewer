import type { Session } from "./domain/models.js";
import type { DownloadSettings } from "./application/downloads/downloadOptions.js";
import type { RemoteMetadata } from "./infrastructure/downloads/remoteMetadata.js";
import {
  ensureImagePreview as generateImagePreview,
  ensureThumbnail as generateThumbnail,
} from "./infrastructure/media/imagePreviews.js";
import {
  detectArchiveEncryption as inspectArchiveEncryption,
  extractWith7zip as extractArchiveWith7zip,
} from "./infrastructure/process/commandRunner.js";
import { logEvent } from "./infrastructure/runtime/runtimePrimitives.js";
import { downloadWithSegmentedManager } from "./services/segmentedDownloader.js";
import { CONFIRM_SIZE_BYTES } from "./config/runtimeConstants.js";

type DownloadState = {
  downloadedBytes: number;
  reportedSize: number;
  statusText: string;
};

export function ensureRuntimeThumbnail(
  session: Session,
  normalizedPath: string,
  targetPath: string,
  size: unknown,
): Promise<string> {
  return generateThumbnail(session, normalizedPath, targetPath, size, logEvent);
}

export function ensureRuntimeImagePreview(
  session: Session,
  normalizedPath: string,
  targetPath: string,
  profileName: string,
): Promise<string> {
  return generateImagePreview(
    session,
    normalizedPath,
    targetPath,
    profileName,
    logEvent,
  );
}

export function extractRuntimeArchive(
  path7za: string,
  archivePath: string,
  extractDir: string,
): Promise<void> {
  return extractArchiveWith7zip(path7za, archivePath, extractDir);
}

export function detectRuntimeArchiveEncryption(
  path7za: string,
  archivePath: string,
): Promise<boolean> {
  return inspectArchiveEncryption(path7za, archivePath);
}

export async function downloadRuntimeSource({
  url,
  targetPath,
  signal,
  settings,
  state,
  metadata,
  confirmOversize,
}: {
  url: string;
  targetPath: string;
  signal: AbortSignal;
  settings: DownloadSettings;
  state: DownloadState;
  metadata: RemoteMetadata;
  confirmOversize: boolean;
}): Promise<void> {
  await downloadWithSegmentedManager({
    url,
    targetPath,
    signal,
    settings,
    state,
    metadata,
  });
  if (!confirmOversize && state.downloadedBytes > CONFIRM_SIZE_BYTES) {
    throw Object.assign(new Error("Archive exceeds 1 GB."), {
      code: "OVERSIZE_CONFIRM",
    });
  }
}
