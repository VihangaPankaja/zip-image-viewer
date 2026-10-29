import "zod/compile";
import { oc } from "@orpc/contract";
import { z } from "zod";

export const TEXT_PREVIEW_BYTES = 128 * 1024;
export const textPreviewInputSchema = z.object({
  offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
});
export const textPreviewSchema = z
  .object({
    text: z.string().max(TEXT_PREVIEW_BYTES),
    offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    nextOffset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    totalBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    encoding: z.enum(["utf-8", "utf-16le", "utf-16be"]),
    binary: z.boolean(),
    replacementCharacters: z.boolean(),
  })
  .refine(
    (value) =>
      value.offset <= value.nextOffset &&
      value.nextOffset <= value.totalBytes &&
      value.nextOffset - value.offset <= TEXT_PREVIEW_BYTES &&
      (value.nextOffset > value.offset || value.nextOffset === value.totalBytes),
    "Invalid text byte range.",
  );
export type TextPreviewChunk = z.infer<typeof textPreviewSchema>;

const blockedHostnames = new Set(["localhost", "localhost.localdomain"]);

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

export const publicHttpUrlSchema = z
  .url()
  .max(2_048)
  .superRefine((value, context) => {
    if (!URL.canParse(value)) {
      return;
    }
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const invalidProtocol = url.protocol !== "http:" && url.protocol !== "https:";
    const invalidHost =
      blockedHostnames.has(hostname) ||
      hostname.endsWith(".localhost") ||
      hostname === "::1" ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd") ||
      hostname.startsWith("fe80:") ||
      isPrivateIpv4(hostname);
    if (invalidProtocol || invalidHost || url.username || url.password) {
      context.addIssue({
        code: "custom",
        message: "A public HTTP(S) URL is required.",
      });
    }
  });

const magnetUrlSchema = z
  .string()
  .max(8_192)
  .refine((value) => {
    if (!value.startsWith("magnet:") || !URL.canParse(value)) return false;
    return new URL(value).searchParams
      .getAll("xt")
      .some((item) => /^urn:btih:(?:[a-f\d]{40}|[a-z2-7]{32})$/i.test(item));
  }, "A valid BitTorrent magnet link is required.");

const downloadSourceSchema = z.union([publicHttpUrlSchema, magnetUrlSchema]);
const sourcePreferenceSchema = z.enum(["auto", "http", "torrent"]);

const safeRelativePathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => {
    const normalized = value.replace(/\\/g, "/");
    return (
      !normalized.startsWith("/") &&
      !/^[a-zA-Z]:/.test(normalized) &&
      normalized.split("/").every((part) => part !== ".." && part !== "")
    );
  }, "A safe relative path is required.");

const jobStatusSchema = z.enum([
  "queued",
  "downloading",
  "extracting",
  "awaiting_confirmation",
  "awaiting_selection",
  "paused",
  "ready",
  "cancelled",
  "error",
]);

const jobPhaseSchema = z.enum([
  "queued",
  "resolving",
  "downloading",
  "indexing",
  "extracting",
  "confirm",
  "selecting",
  "paused",
  "ready",
  "cancelled",
  "error",
]);

const torrentFileSchema = z.object({
  id: z.string().min(1),
  path: safeRelativePathSchema,
  size: z.number().int().nonnegative(),
  selected: z.boolean(),
  downloadedBytes: z.number().nonnegative(),
  complete: z.boolean(),
  priority: z.enum(["low", "normal", "high"]).optional(),
});
export type TorrentFile = z.infer<typeof torrentFileSchema>;
export type TorrentPriority = NonNullable<TorrentFile["priority"]>;

export const httpDownloadStateSchema = z.object({
  originalUrl: publicHttpUrlSchema,
  resolvedUrl: publicHttpUrlSchema,
  size: z.number().int().nonnegative(),
  validator: z.string().max(512),
  files: z
    .array(
      z.object({
        index: z.number().int().min(-1).max(7),
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative().nullable(),
        bytes: z.number().int().nonnegative(),
        sha256: z
          .string()
          .regex(/^[a-f\d]{64}$/)
          .or(z.literal("")),
      }),
    )
    .min(1)
    .max(8),
  completedSha256: z
    .string()
    .regex(/^[a-f\d]{64}$/)
    .or(z.literal("")),
});
export type HttpDownloadState = z.infer<typeof httpDownloadStateSchema>;

export const torrentVideoInfoSchema = z.object({
  state: z.enum(["ready", "download-first"]),
  message: z.string(),
});
export type TorrentVideoInfo = z.infer<typeof torrentVideoInfoSchema>;

export const zipSelectionSchema = z.object({
  fingerprint: z.string().regex(/^[a-f\d]{64}$/),
  selectedIds: z.array(z.string().min(1)).max(10_000),
  extractedIds: z.array(z.string().min(1)).max(10_000),
});
export type ZipSelection = z.infer<typeof zipSelectionSchema>;

const archiveSummarySchema = z.object({
  fingerprint: z.string().regex(/^[a-f\d]{64}$/),
  sourceBytes: z.number().int().nonnegative(),
  compressedBytes: z.number().int().nonnegative(),
  expandedBytes: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative().max(10_000),
  extractedCount: z.number().int().nonnegative(),
});
const archiveManifestSchema = archiveSummarySchema.extend({
  entries: z
    .array(
      z.object({
        id: z.string().min(1),
        path: safeRelativePathSchema,
        type: z.enum(["file", "directory"]),
        compressedBytes: z.number().int().nonnegative(),
        expandedBytes: z.number().int().nonnegative(),
        extracted: z.boolean(),
      }),
    )
    .max(10_000),
});
export type ArchiveManifest = z.infer<typeof archiveManifestSchema>;

export const jobSchema = z.object({
  id: z.uuid(),
  url: downloadSourceSchema,
  sourceKind: z.enum(["http", "torrent"]).default("http"),
  retained: z.boolean().optional(),
  sourcePreference: sourcePreferenceSchema.default("auto"),
  status: jobStatusSchema,
  torrentFiles: z.array(torrentFileSchema).default([]),
  archive: archiveSummarySchema.optional(),
  phase: jobPhaseSchema,
  percent: z.number().min(0).max(100).nullable(),
  downloadedBytes: z.number().nonnegative().default(0),
  reportedSize: z.number().nonnegative().default(0),
  downloadSpeedBytesPerSec: z.number().nonnegative().default(0),
  averageSpeedBytesPerSec: z.number().nonnegative().default(0),
  etaSeconds: z.number().nonnegative().nullable().default(null),
  retryCount: z.number().int().nonnegative().default(0),
  maxRetries: z.number().int().min(-1).max(8).default(3),
  canResume: z.boolean().default(false),
  canPause: z.boolean().default(false),
  queuePosition: z.number().int().nonnegative().default(0),
  threadMode: z.enum(["single", "segmented", "auto"]).default("auto"),
  threadCount: z.number().int().min(1).max(8).default(1),
  peerCount: z.number().int().nonnegative().default(0),
  verifiedBytes: z.number().nonnegative().default(0),
  uploadedBytes: z.number().nonnegative().default(0),
  uploadSpeedBytesPerSec: z.number().nonnegative().default(0),
  message: z.string().default(""),
  error: z.string().default(""),
  sessionId: z.uuid().or(z.literal("")).default(""),
  requiresConfirmation: z.boolean().default(false),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

const sessionSchema = z.object({
  id: z.uuid(),
  jobId: z.uuid().optional(),
  firstFilePath: safeRelativePathSchema.or(z.literal("")),
  fileCount: z.number().int().nonnegative(),
  lastAccessedAt: z.number().int().nonnegative(),
});

export const createSessionInputSchema = z.object({
  url: publicHttpUrlSchema,
  confirmOversize: z.boolean().default(false),
  downloadOptions: z.unknown().optional(),
  downloadSettings: z.unknown().optional(),
});

export const enqueueSessionsInputSchema = z.object({
  items: z
    .array(
      z.object({
        url: downloadSourceSchema.refine(
          (value) =>
            !value.startsWith("magnet:") ||
            !URL.canParse(value) ||
            !new URL(value).searchParams.has("x.pe"),
          "Direct peer hints (x.pe) are not supported. Use tracker or DHT discovery.",
        ),
        sourcePreference: sourcePreferenceSchema.default("auto"),
        downloadOptions: z.unknown().optional(),
      }),
    )
    .min(1)
    .max(50),
  confirmOversize: z.boolean().default(false),
});

export const mediaPathQuerySchema = z.object({
  sessionId: z.uuid().optional(),
  path: safeRelativePathSchema,
});

const videoQualitiesInputSchema = mediaPathQuerySchema.extend({
  sessionId: z.uuid(),
});
const videoMediaTrackSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().nonnegative(),
  language: z.string(),
  label: z.string().min(1),
  isDefault: z.boolean(),
});
export type VideoMediaTrack = z.infer<typeof videoMediaTrackSchema>;

const videoQualitiesSchema = z.object({
  path: safeRelativePathSchema,
  source: z.object({
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    durationSeconds: z.number().nonnegative(),
  }),
  options: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      height: z.number().nonnegative().nullable(),
    }),
  ),
  defaultQuality: z.string().min(1),
  audioTracks: z.array(videoMediaTrackSchema).optional(),
  subtitleTracks: z.array(videoMediaTrackSchema).optional(),
});
export type VideoQualitiesInput = z.infer<typeof videoQualitiesInputSchema>;
export type VideoQualities = z.infer<typeof videoQualitiesSchema>;

const videoQualitiesContract = oc
  .route({ method: "GET", path: "/sessions/{sessionId}/video/qualities" })
  .input(videoQualitiesInputSchema)
  .output(videoQualitiesSchema);

const createSessionContract = oc
  .route({ method: "POST", path: "/sessions" })
  .input(createSessionInputSchema)
  .output(jobSchema);

const getSessionContract = oc
  .route({ method: "GET", path: "/sessions/{id}" })
  .input(z.object({ id: z.uuid() }))
  .output(sessionSchema);

const listJobsContract = oc
  .route({ method: "GET", path: "/session-jobs" })
  .output(z.object({ items: z.array(jobSchema) }));

const listSessionsContract = oc
  .route({ method: "GET", path: "/sessions" })
  .output(z.object({ items: z.array(sessionSchema) }));

const enqueueSessionsContract = oc
  .route({ method: "POST", path: "/session-jobs/batch" })
  .input(enqueueSessionsInputSchema)
  .output(z.object({ items: z.array(jobSchema) }));

const jobControlInputSchema = z.object({ id: z.uuid() });
const selectTorrentFilesInputSchema = jobControlInputSchema.extend({
  fileIds: z
    .array(z.string().min(1))
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, "File IDs must be unique."),
});
const selectTorrentFilesContract = oc
  .route({ method: "POST", path: "/session-jobs/{id}/files" })
  .input(selectTorrentFilesInputSchema)
  .output(jobSchema);
const setTorrentFilePriorityContract = oc
  .route({
    method: "PATCH",
    path: "/session-jobs/{id}/files/{fileId}/priority",
  })
  .input(
    jobControlInputSchema.extend({
      fileId: z.string().min(1),
      priority: z.enum(["low", "normal", "high"]),
    }),
  )
  .output(jobSchema);
const cancelJobContract = oc
  .route({ method: "POST", path: "/session-jobs/{id}/cancel" })
  .input(jobControlInputSchema)
  .output(jobSchema);
const confirmJobContract = oc
  .route({ method: "POST", path: "/session-jobs/{id}/confirm" })
  .input(jobControlInputSchema)
  .output(jobSchema);
const retryJobContract = oc
  .route({ method: "POST", path: "/session-jobs/{id}/retry" })
  .input(jobControlInputSchema)
  .output(jobSchema);
const pauseJobContract = oc
  .route({ method: "POST", path: "/session-jobs/{id}/pause" })
  .input(jobControlInputSchema)
  .output(jobSchema);
const resumeJobContract = oc
  .route({ method: "POST", path: "/session-jobs/{id}/resume" })
  .input(jobControlInputSchema)
  .output(jobSchema);
const removeJobContract = oc
  .route({ method: "DELETE", path: "/session-jobs/{id}" })
  .input(jobControlInputSchema)
  .output(z.void());
const reorderJobsContract = oc
  .route({ method: "POST", path: "/session-jobs/reorder" })
  .input(z.object({ jobIds: z.array(z.uuid()).min(1).max(50) }))
  .output(z.array(jobSchema));
const schedulerSettingsSchema = z.object({
  activeCount: z.number().int().nonnegative(),
  maxConcurrent: z.number().int().min(1).max(8),
});
const getSchedulerContract = oc
  .route({ method: "GET", path: "/scheduler" })
  .output(schedulerSettingsSchema);
const updateSchedulerContract = oc
  .route({ method: "PATCH", path: "/scheduler" })
  .input(schedulerSettingsSchema.pick({ maxConcurrent: true }))
  .output(schedulerSettingsSchema);
const torrentLimitsSchema = z.object({
  downloadBytesPerSec: z.number().int().min(0).max(1_073_741_824),
  uploadBytesPerSec: z.number().int().min(0).max(1_073_741_824),
});
const getTorrentLimitsContract = oc
  .route({ method: "GET", path: "/torrent-limits" })
  .output(torrentLimitsSchema);
const updateTorrentLimitsContract = oc
  .route({ method: "PATCH", path: "/torrent-limits" })
  .input(torrentLimitsSchema)
  .output(torrentLimitsSchema);
const removeSessionContract = oc
  .route({ method: "DELETE", path: "/sessions/{id}" })
  .input(z.object({ id: z.uuid() }))
  .output(z.void());

const sessionStorageSchema = z.object({
  originalsBytes: z.number().nonnegative(),
  previewsBytes: z.number().nonnegative(),
  transcodesBytes: z.number().nonnegative(),
  retained: z.boolean(),
  pinned: z.boolean(),
});
export type SessionStorage = z.infer<typeof sessionStorageSchema>;
const storageInputSchema = z.object({ id: z.uuid() });
const storageContract = {
  get: oc.input(storageInputSchema).output(sessionStorageSchema),
  clear: oc.input(storageInputSchema).output(z.void()),
  pin: oc.input(storageInputSchema.extend({ pinned: z.boolean() })).output(z.void()),
};

const archiveSelectionFields = {
  fingerprint: zipSelectionSchema.shape.fingerprint,
  fileIds: z
    .array(z.string().min(1))
    .min(1)
    .max(10_000)
    .refine((ids) => new Set(ids).size === ids.length, "File IDs must be unique."),
};

export const serverContract = {
  nestedArchives: {
    inspect: oc
      .input(z.object({ id: z.uuid(), path: safeRelativePathSchema }))
      .output(archiveManifestSchema),
    open: oc
      .input(
        z.object({
          id: z.uuid(),
          path: safeRelativePathSchema,
          ...archiveSelectionFields,
        }),
      )
      .output(z.object({ id: z.uuid() })),
    cancel: oc.input(z.object({ id: z.uuid(), path: safeRelativePathSchema })).output(z.void()),
  },
  archives: {
    get: oc.input(jobControlInputSchema).output(archiveManifestSchema),
    select: oc.input(jobControlInputSchema.extend(archiveSelectionFields)).output(jobSchema),
  },
  storage: storageContract,
  video: { qualities: videoQualitiesContract },
  sessions: {
    create: createSessionContract,
    get: getSessionContract,
    list: listSessionsContract,
    remove: removeSessionContract,
  },
  jobs: {
    list: listJobsContract,
    enqueue: enqueueSessionsContract,
    cancel: cancelJobContract,
    confirm: confirmJobContract,
    selectFiles: selectTorrentFilesContract,
    setFilePriority: setTorrentFilePriorityContract,
    retry: retryJobContract,
    pause: pauseJobContract,
    resume: resumeJobContract,
    remove: removeJobContract,
    reorder: reorderJobsContract,
  },
  scheduler: {
    get: getSchedulerContract,
    update: updateSchedulerContract,
  },
  torrentLimits: {
    get: getTorrentLimitsContract,
    update: updateTorrentLimitsContract,
  },
};

export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;
export type EnqueueSessionsInput = z.infer<typeof enqueueSessionsInputSchema>;
export type Job = z.infer<typeof jobSchema>;
export type SessionSummary = z.infer<typeof sessionSchema>;
export type SchedulerSettings = z.infer<typeof schedulerSettingsSchema>;
export type TorrentLimits = z.infer<typeof torrentLimitsSchema>;

export type VideoStoryboard = {
  intervalSeconds: number;
  width: number;
  height: number;
  columns: number;
  rows: number;
  frames: { time: number; sheet: number; x: number; y: number }[];
};
