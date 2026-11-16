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
  const parsed = archiveVolumeSourcesSchema.safeParse(
    urls.map((url) => ({ url, name: volumeUrlName(url) })),
  );
  if (!parsed.success)
    throw new ApplicationError(
      "INVALID_INPUT",
      "Supply archive volume URLs with portable original filenames within the 10000-volume limit.",
      400,
    );
  const groups = groupArchiveVolumes(parsed.data, (source) => source.name);
  if (groups.length !== 1 || !archiveVolume(groups[0][0].name))
    throw new ApplicationError(
      "INVALID_INPUT",
      "Supply volumes from the same archive with their original filenames.",
      400,
    );
  const sources = groups[0];
  if (new Set(sources.map((source) => source.name)).size !== sources.length)
    throw new ApplicationError("INVALID_INPUT", "Supply one URL per archive volume.", 400);
  return sources;
}

export function groupHttpArchiveDownloads(items: EnqueueSessionsInput["items"]) {
  const groups = groupArchiveVolumes(items, (item) => {
    if (item.url.startsWith("magnet:") || item.sourcePreference === "torrent") return "single";
    const url = new URL(item.url);
    return `${JSON.stringify(item.downloadOptions ?? {})}:${url.origin}${decodePath(url.pathname)}`;
  });
  // Validate every set before the caller creates or persists the first job.
  for (const group of groups) {
    const first = group[0];
    if (
      !first.url.startsWith("magnet:") &&
      first.sourcePreference !== "torrent" &&
      archiveVolume(volumeUrlName(first.url))
    )
      httpVolumeSources(group.map((item) => item.url));
  }
  return groups;
}

export function supplyHttpVolumes(job: SessionJob, urls: string[]) {
  if (job.sourceKind !== "http" || job.status !== "awaiting_volumes" || !job.volumeSources)
    throw new ApplicationError("CONFLICT", "This download is not awaiting archive volumes.", 409);
  const added = httpVolumeSources(urls);
  if (archiveVolume(added[0].name)?.key !== archiveVolume(job.volumeSources[0].name)?.key)
    throw new ApplicationError("INVALID_INPUT", "Supply volumes from the same archive.", 400);
  const replaced = new Set(added.map((source) => source.name));
  const combined = [...job.volumeSources.filter((source) => !replaced.has(source.name)), ...added];
  if (!archiveVolumeSourcesSchema.safeParse(combined).success)
    throw new ApplicationError("INVALID_INPUT", "Archive exceeds the 10000-volume limit.", 400);
  const groups = groupArchiveVolumes(combined, (source) => source.name);
  if (groups.length !== 1)
    throw new ApplicationError(
      "INVALID_INPUT",
      "Use consistent volume filenames from the same archive.",
      400,
    );
  job.volumeSources = groups[0];
  job.zipPath = "";
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
