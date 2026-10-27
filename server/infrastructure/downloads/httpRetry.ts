import { isRecord } from "../runtime/mediaClassification.js";

export function downloadErrorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === "string" ? error.code : "";
}

export type RetryBudget = { retries: number; waitedMs: number };

// Legacy unlimited settings still stop after eight retries or two minutes of waiting.
export function retryDelay(
  error: unknown,
  maxRetries: number,
  budget: RetryBudget,
  now = Date.now(),
): number | undefined {
  const details = isRecord(error) ? error : {};
  if (
    details.name === "AbortError" ||
    [
      "DOWNLOAD_FATAL",
      "DOWNLOAD_AUTH",
      "DOWNLOAD_LOGIN",
      "DOWNLOAD_PERMANENT",
      "OVERSIZE_CONFIRM",
      "SOURCE_CHANGED",
      "RANGE_UNSUPPORTED",
    ].includes(downloadErrorCode(error))
  )
    return undefined;
  const status = typeof details.statusCode === "number" ? details.statusCode : 0;
  if (status && status < 500 && status !== 408 && status !== 429) return undefined;
  if (budget.retries >= Math.min(8, maxRetries === -1 ? 8 : maxRetries)) return undefined;
  const value = typeof details.retryAfter === "string" ? details.retryAfter.trim() : "";
  const seconds = /^\d+$/.test(value) ? Number(value) * 1_000 : Number.NaN;
  const date = new Date(value);
  const after = /^\d+$/.test(value)
    ? seconds
    : date.toUTCString() === value
      ? Math.max(0, date.getTime() - now)
      : Number.NaN;
  const delay = !Number.isNaN(after)
    ? after
    : Math.min(30_000, 1_200 * 2 ** Math.min(budget.retries, 5) + Math.floor(Math.random() * 400));
  if (delay > 30_000 || budget.waitedMs + delay > 120_000) return undefined;
  budget.retries++;
  budget.waitedMs += delay;
  return delay;
}
