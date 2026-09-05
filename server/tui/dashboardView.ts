import type { Session, SessionJob } from "../domain/models.js";

export const TERMINAL_ESCAPE = "\u001b[";
export type DashboardJob = Pick<
  SessionJob,
  | "id"
  | "url"
  | "status"
  | "phase"
  | "percent"
  | "downloadedBytes"
  | "reportedSize"
  | "downloadSpeedBytesPerSec"
  | "etaSeconds"
  | "retryCount"
  | "queuePosition"
  | "message"
  | "error"
>;
export type DashboardSession = Pick<Session, "id" | "stats" | "lastAccessedAt">;

export function color(code: number, value: string): string {
  return `${TERMINAL_ESCAPE}${String(code)}m${value}${TERMINAL_ESCAPE}0m`;
}

export function crop(value: string, width: number): string {
  return value.length <= width
    ? value
    : `${value.slice(0, Math.max(0, width - 1))}…`;
}

function percent(value: number | null): string {
  return value === null ? "--" : `${value.toFixed(0)}%`;
}

export function jobLine(
  job: DashboardJob,
  selected: boolean,
  width: number,
): string {
  const marker = selected ? color(36, ">") : " ";
  const state =
    job.status === "error"
      ? color(31, job.status)
      : job.status === "ready"
        ? color(32, job.status)
        : color(33, job.status);
  return crop(
    `${marker} ${job.id.slice(0, 8)} ${state.padEnd(18)} ${percent(job.percent).padStart(4)} ${job.url}`,
    width,
  );
}

export function sessionLine(
  session: DashboardSession,
  selected: boolean,
  width: number,
): string {
  return crop(
    `${selected ? color(36, ">") : " "} ${session.id.slice(0, 8)}  ${String(session.stats.fileCount)} files`,
    width,
  );
}
