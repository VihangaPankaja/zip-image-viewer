import { oc } from "@orpc/contract";
import { z } from "zod";

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

const publicHttpUrlSchema = z
  .url()
  .max(2_048)
  .superRefine((value, context) => {
    if (!URL.canParse(value)) {
      return;
    }
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const invalidProtocol =
      url.protocol !== "http:" && url.protocol !== "https:";
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
  "paused",
  "ready",
  "cancelled",
  "error",
]);

export const jobSchema = z.object({
  id: z.uuid(),
  url: downloadSourceSchema,
  sourceKind: z.enum(["http", "torrent"]).default("http"),
  sourcePreference: sourcePreferenceSchema.default("auto"),
  status: jobStatusSchema,
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
        url: downloadSourceSchema,
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
const cancelJobContract = oc
  .route({ method: "POST", path: "/session-jobs/{id}/cancel" })
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
const removeSessionContract = oc
  .route({ method: "DELETE", path: "/sessions/{id}" })
  .input(z.object({ id: z.uuid() }))
  .output(z.void());

export const serverContract = {
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
};

export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;
export type EnqueueSessionsInput = z.infer<typeof enqueueSessionsInputSchema>;
export type Job = z.infer<typeof jobSchema>;
export type SessionSummary = z.infer<typeof sessionSchema>;
export type SchedulerSettings = z.infer<typeof schedulerSettingsSchema>;
