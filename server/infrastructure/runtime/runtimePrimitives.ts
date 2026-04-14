import path from "node:path";

export function logEvent(
  level: "info" | "warn" | "error",
  event: string,
  details: Record<string, unknown> = {},
) {
  const logger =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.log;
  const payload = Object.keys(details).length
    ? ` ${JSON.stringify(details)}`
    : "";

  logger(
    `[${new Date().toISOString()}] [${level.toUpperCase()}] ${event}${payload}`,
  );
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

  const [rawStart, rawEnd] = rangeHeader.replace("bytes=", "").split("-");
  if (rawStart.includes(",") || rawEnd?.includes(",")) {
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
  const normalized = path.posix.normalize(
    String(entryPath || "").replace(/\\/g, "/"),
  );
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
