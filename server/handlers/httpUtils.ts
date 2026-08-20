import path from "node:path";
import type { Response } from "express";

export type ByteRange = { start: number; end: number };

export function applyByteRange(
  response: Response,
  range: ByteRange | "invalid" | null,
  size: number,
): ByteRange | null | undefined {
  response.setHeader("accept-ranges", "bytes");
  if (range === "invalid") {
    response.setHeader("content-range", `bytes */${String(size)}`);
    response.status(416).end();
    return null;
  }
  if (range) {
    response.status(206);
    response.setHeader(
      "content-range",
      `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`,
    );
    response.setHeader("content-length", String(range.end - range.start + 1));
    return range;
  }
  response.setHeader("content-length", String(size));
  return undefined;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function isWithinRoot(targetPath: string, rootPath: string): boolean {
  return (
    targetPath === rootPath || targetPath.startsWith(`${rootPath}${path.sep}`)
  );
}

export function queryText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return fallback;
}
