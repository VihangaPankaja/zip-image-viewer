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
  "ready",
  "cancelled",
  "error",
]);

const jobPhaseSchema = z.enum([
  "queued",
  "downloading",
  "extracting",
  "confirm",
  "ready",
  "cancelled",
  "error",
]);

export const jobSchema = z.object({
  id: z.uuid(),
  url: publicHttpUrlSchema,
  status: jobStatusSchema,
  phase: jobPhaseSchema,
  percent: z.number().min(0).max(100).nullable(),
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
  urls: z.array(publicHttpUrlSchema).min(1).max(50),
  confirmOversize: z.boolean().default(false),
  downloadOptions: z.unknown().optional(),
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

export const serverContract = {
  sessions: {
    create: createSessionContract,
    get: getSessionContract,
    list: listSessionsContract,
  },
  jobs: {
    list: listJobsContract,
    enqueue: enqueueSessionsContract,
    cancel: cancelJobContract,
    retry: retryJobContract,
  },
};

export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;
export type EnqueueSessionsInput = z.infer<typeof enqueueSessionsInputSchema>;
export type Job = z.infer<typeof jobSchema>;
export type SessionSummary = z.infer<typeof sessionSchema>;
