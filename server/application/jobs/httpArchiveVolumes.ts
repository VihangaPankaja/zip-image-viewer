import path from "node:path";
import { mkdir } from "node:fs/promises";
import { archiveVolume, groupArchiveVolumes } from "../../../shared/archiveVolumes.js";
import {
  archiveVolumeSourcesSchema,
  type EnqueueSessionsInput,
} from "../../../shared/contracts.js";
import { ApplicationError, type SessionJob } from "../../domain/models.js";
import { assertResourceSize } from "../../infrastructure/runtime/resourceLimits.js";
import { downloadSessionSource } from "./downloadSessionSource.js";
import { fetchRemoteMetadata } from "../../infrastructure/downloads/remoteMetadata.js";
import { CONFIRM_SIZE_BYTES } from "../../config/runtimeConstants.js";

async function volumeMetadata(
  job: SessionJob,
  sources: NonNullable<SessionJob["volumeSources"]>,
  confirmed: boolean,
  deps: Parameters<typeof downloadSessionSource>[3],
) {
  const metadata = [];
  let total = 0;
  for (const source of sources) {
    job.abortController?.signal.throwIfAborted();
    const info = source.checkpoint?.completedSha256
      ? undefined
      : await fetchRemoteMetadata(source.url, job.abortController?.signal ?? AbortSignal.abort());
    metadata.push(info);
    total += info?.size ?? source.checkpoint?.size ?? 0;
    assertResourceSize(total);
  }
  if (total > CONFIRM_SIZE_BYTES && !confirmed) {
    deps.emitJob(job, {
      status: "awaiting_confirmation",
      phase: "confirm",
      requiresConfirmation: true,
      reportedSize: total,
      percent: null,
      message: "Archive volumes exceed 1 GiB. Confirm the combined download before continuing.",
    });
    deps.closeJob(job, "awaiting_confirmation");
    return undefined;
  }
  return metadata;
}

export function volumeUrlName(url: string) {
  return decodePath(new URL(url).pathname.split("/").at(-1) ?? "");
}

function decodePath(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function httpVolumeSources(urls: string[]) {
  const sources = archiveVolumeSourcesSchema.parse(
    urls.map((url) => ({ url, name: volumeUrlName(url) })),
  );
  const key = archiveVolume(sources[0].name)?.key;
  if (!key || sources.some((source) => archiveVolume(source.name)?.key !== key))
    throw new ApplicationError(
      "INVALID_INPUT",
      "Supply volumes from the same archive with their original filenames.",
      400,
    );
  if (new Set(sources.map((source) => source.name)).size !== sources.length)
    throw new ApplicationError("INVALID_INPUT", "Supply one URL per archive volume.", 400);
  return sources.sort(
    (a, b) => (archiveVolume(a.name)?.number ?? 0) - (archiveVolume(b.name)?.number ?? 0),
  );
}

export function groupHttpArchiveDownloads(items: EnqueueSessionsInput["items"]) {
  return groupArchiveVolumes(items, (item) => {
    if (item.url.startsWith("magnet:") || item.sourcePreference === "torrent") return "single";
    const url = new URL(item.url);
    return `${JSON.stringify(item.downloadOptions ?? {})}:${url.origin}${decodePath(url.pathname)}`;
  });
}

export function supplyHttpVolumes(job: SessionJob, urls: string[]) {
  if (job.sourceKind !== "http" || job.status !== "awaiting_volumes" || !job.volumeSources)
    throw new ApplicationError("CONFLICT", "This download is not awaiting archive volumes.", 409);
  const added = httpVolumeSources(urls);
  if (archiveVolume(added[0].name)?.key !== archiveVolume(job.volumeSources[0].name)?.key)
    throw new ApplicationError("INVALID_INPUT", "Supply volumes from the same archive.", 400);
  const replaced = new Set(added.map((source) => source.name));
  const combined = [...job.volumeSources.filter((source) => !replaced.has(source.name)), ...added];
  archiveVolumeSourcesSchema.parse(combined);
  job.volumeSources = combined;
  job.volumes = { names: job.volumeSources.map((source) => source.name), missing: [] };
  job.status = "queued";
  job.phase = "queued";
  job.error = "";
  job.cleanupAt = 0;
  job.message = "Waiting to check the supplied archive volumes.";
}

export async function downloadHttpVolumes(
  job: SessionJob,
  settings: Parameters<typeof downloadSessionSource>[1],
  confirmOversize: boolean,
  deps: Parameters<typeof downloadSessionSource>[3],
) {
  if (!job.volumeSources) throw new Error("No archive volumes supplied.");
  const sources = job.volumeSources;
  const metadata = await volumeMetadata(job, sources, confirmOversize, deps);
  if (!metadata) return "paused";
  const directory = path.join(job.workspaceDir, "volumes");
  await mkdir(directory, { recursive: true });
  for (const [index, source] of sources.entries()) {
    job.httpDownload = source.checkpoint;
    try {
      const result = await downloadSessionSource(
        job,
        settings,
        {
          url: source.url,
          zipPath: path.join(directory, source.name),
          workspaceDir: job.workspaceDir,
          confirmOversize,
          metadata: metadata[index],
        },
        {
          ...deps,
          emitJob: (current, patch, event) => {
            if (patch.httpDownload !== undefined) source.checkpoint = patch.httpDownload;
            assertResourceSize(
              job.volumeSources?.reduce((total, part) => total + (part.checkpoint?.size ?? 0), 0) ??
                0,
            );
            if (patch.message) patch.message = `${source.name}: ${patch.message}`;
            deps.emitJob(current, patch, event);
          },
        },
      );
      if (result === "paused") return result;
    } finally {
      source.checkpoint = job.httpDownload;
      job.httpDownload = undefined;
    }
  }
  job.volumes = { names: job.volumeSources.map((source) => source.name), missing: [] };
  const bytes = sources.reduce((total, source) => total + (source.checkpoint?.size ?? 0), 0);
  deps.emitJob(job, { downloadedBytes: bytes, reportedSize: bytes });
  return "complete";
}
