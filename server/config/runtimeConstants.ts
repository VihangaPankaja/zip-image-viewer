import "zod/compile";
import { z } from "zod";

const runtimeEnvironmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
});

export function parseRuntimeEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): { port: number } {
  const parsed = runtimeEnvironmentSchema.parse(environment);
  return { port: parsed.PORT };
}

export const PORT = parseRuntimeEnvironment(process.env).port;
export const SESSION_TTL_MS = 30 * 60 * 1000;
export const JOB_TTL_MS = 30 * 60 * 1000;
export const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
export const CONFIRM_SIZE_BYTES = 1024 * 1024 * 1024;
export const TEXT_PREVIEW_LIMIT = 2 * 1024 * 1024;
export const PROGRESS_EMIT_INTERVAL_MS = 1000;
export const MAX_THUMBNAIL_SIZE = 320;

export const DEFAULT_DOWNLOAD_SETTINGS = {
  threadMode: "auto",
  threadCount: 3,
  enableMultithread: true,
  enableResume: true,
  maxRetries: 3,
};

export const DEFAULT_DOWNLOAD_OPTIONS = {
  transport: {
    mode: "auto",
    threads: 3,
    multithread: true,
    resume: true,
  },
  retry: {
    maxRetries: 3,
    timeoutMs: 30000,
  },
  media: {
    videoQuality: "720p",
  },
  extraction: {
    enabled: true,
  },
  request: {
    headers: {},
  },
};
