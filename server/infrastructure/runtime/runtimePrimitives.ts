import path from "node:path";

export type LogLevel = "info" | "warn" | "error";
export type LogEntry = {
  timestamp: number;
  level: LogLevel;
  event: string;
  details: Record<string, unknown>;
  jobId: string;
  sessionId: string;
};

const LOG_LIMIT = 1_000;
const logEntries: LogEntry[] = [];
const logSubscribers = new Set<(_entry: LogEntry) => void>();
let plainLoggingEnabled = true;

function detailId(details: Record<string, unknown>, key: string): string {
  const value = details[key];
  return typeof value === "string" ? value : "";
}

function writeLogLine(entry: LogEntry): void {
  const logger =
    entry.level === "error"
      ? console.error
      : entry.level === "warn"
        ? console.warn
        : console.log;
  const payload = Object.keys(entry.details).length
    ? ` ${JSON.stringify(entry.details)}`
    : "";
  logger(
    `[${new Date(entry.timestamp).toISOString()}] [${entry.level.toUpperCase()}] ${entry.event}${payload}`,
  );
}

export function logEvent(
  level: LogLevel,
  event: string,
  details: Record<string, unknown> = {},
): void {
  const entry = {
    timestamp: Date.now(),
    level,
    event,
    details,
    jobId: detailId(details, "jobId"),
    sessionId: detailId(details, "sessionId"),
  } satisfies LogEntry;
  logEntries.push(entry);
  if (logEntries.length > LOG_LIMIT) logEntries.shift();
  if (plainLoggingEnabled) writeLogLine(entry);
  for (const subscriber of logSubscribers) subscriber(entry);
}

export function getLogEntries(): readonly LogEntry[] {
  return [...logEntries];
}

export function subscribeLogEvents(
  subscriber: (_entry: LogEntry) => void,
): () => void {
  logSubscribers.add(subscriber);
  return () => logSubscribers.delete(subscriber);
}

export function setPlainLoggingEnabled(enabled: boolean): void {
  plainLoggingEnabled = enabled;
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

export function parseRangeHeader(
  rangeHeader: string | undefined,
  size: number,
) {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) {
    return null;
  }

  const [rawStart = "", rawEnd = ""] = rangeHeader
    .replace("bytes=", "")
    .split("-");
  if (rawStart.includes(",") || rawEnd.includes(",")) {
    return null;
  }

  let start: number;
  let end: number;

  if (rawStart === "") {
    const suffixLength = Number(rawEnd);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return "invalid";
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return "invalid";
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
}

export function sanitizeEntryPath(entryPath: string) {
  const normalized = path.posix.normalize(entryPath.replace(/\\/g, "/"));
  const cleaned = normalized.replace(/^\/+/, "").replace(/\/+$/, "");

  if (
    !cleaned ||
    cleaned === "." ||
    cleaned.startsWith("../") ||
    cleaned.includes("/../")
  ) {
    throw new Error(`Unsafe entry path: ${entryPath}`);
  }

  return cleaned;
}

export function isTerminalJobStatus(status: string | undefined) {
  return status === "ready" || status === "error" || status === "cancelled";
}
