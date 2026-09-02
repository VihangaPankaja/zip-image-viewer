import type { Session, SessionJob } from "../domain/models.js";
import {
  formatBytes,
  type LogEntry,
} from "../infrastructure/runtime/runtimePrimitives.js";

const ESC = "\u001b[";
const FRAME_MS = 34;
const panes = ["jobs", "sessions", "logs"] as const;
type Pane = (typeof panes)[number];

type DashboardJob = Pick<
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
type DashboardSession = Pick<Session, "id" | "stats" | "lastAccessedAt">;

type TerminalInput = {
  isTTY?: boolean;
  on: (_event: "data", _listener: (_chunk: string | Buffer) => void) => unknown;
  off: (
    _event: "data",
    _listener: (_chunk: string | Buffer) => void,
  ) => unknown;
  setRawMode?: (_enabled: boolean) => unknown;
  resume?: () => unknown;
  pause?: () => unknown;
};

type TerminalOutput = {
  isTTY?: boolean;
  columns?: number;
  rows?: number;
  write: (_chunk: string) => unknown;
  on: (_event: "resize", _listener: () => void) => unknown;
  off: (_event: "resize", _listener: () => void) => unknown;
};

type DashboardActions = {
  pause: (_id: string) => unknown;
  resume: (_id: string) => unknown;
  cancel: (_id: string) => unknown;
  retry: (_id: string) => unknown;
  removeJob: (_id: string) => unknown;
  removeSession: (_id: string) => unknown;
  reorder: (_jobIds: readonly string[]) => unknown;
  setMaxConcurrent: (_value: number) => unknown;
};

type DashboardDependencies = {
  input: TerminalInput;
  output: TerminalOutput;
  getJobs: () => readonly DashboardJob[];
  getSessions: () => readonly DashboardSession[];
  getSchedulerState: () => { activeCount: number; maxConcurrent: number };
  getLogs: () => readonly LogEntry[];
  subscribeLogs: (_listener: (_entry: LogEntry) => void) => () => void;
  setPlainLogging: (_enabled: boolean) => void;
  actions: DashboardActions;
  interrupt: () => void;
};

export function shouldUseTerminalDashboard(input: {
  inputTTY?: boolean;
  outputTTY?: boolean;
  nodeEnv?: string;
  lifecycleEvent?: string;
}): boolean {
  return Boolean(
    input.inputTTY &&
    input.outputTTY &&
    input.nodeEnv?.toLowerCase() !== "development" &&
    !input.lifecycleEvent?.startsWith("dev"),
  );
}

function color(code: number, value: string): string {
  return `${ESC}${String(code)}m${value}${ESC}0m`;
}

function crop(value: string, width: number): string {
  if (value.length <= width) return value;
  return `${value.slice(0, Math.max(0, width - 1))}…`;
}

function percent(value: number | null): string {
  return value === null ? "--" : `${value.toFixed(0)}%`;
}

function jobLine(job: DashboardJob, selected: boolean, width: number): string {
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

function sessionLine(
  session: DashboardSession,
  selected: boolean,
  width: number,
): string {
  return crop(
    `${selected ? color(36, ">") : " "} ${session.id.slice(0, 8)}  ${String(session.stats.fileCount)} files`,
    width,
  );
}

export function createTerminalDashboard(deps: DashboardDependencies) {
  let paneIndex = 0;
  let jobIndex = 0;
  let sessionIndex = 0;
  let logOffset = 0;
  let confirmation = "";
  let notice = "";
  let stopped = true;
  let renderTimer: NodeJS.Timeout | undefined;
  let refreshTimer: NodeJS.Timeout | undefined;
  let unsubscribeLogs: (() => void) | undefined;
  let lastFrame = "";

  const pane = (): Pane => panes[paneIndex] ?? "jobs";
  const jobs = () =>
    [...deps.getJobs()].sort((a, b) => a.queuePosition - b.queuePosition);
  const sessions = () => [...deps.getSessions()];
  const selectedJob = () => {
    const items = jobs();
    jobIndex = Math.min(jobIndex, Math.max(0, items.length - 1));
    return items[jobIndex];
  };
  const selectedSession = () => {
    const items = sessions();
    sessionIndex = Math.min(sessionIndex, Math.max(0, items.length - 1));
    return items[sessionIndex];
  };
  const filteredLogs = () => {
    const jobId = selectedJob()?.id ?? "";
    const sessionId = selectedSession()?.id ?? "";
    return deps
      .getLogs()
      .filter((entry) =>
        pane() === "sessions"
          ? entry.sessionId === sessionId
          : entry.jobId === jobId,
      );
  };

  function render(): void {
    const width = Math.max(40, deps.output.columns ?? 80);
    const height = Math.max(12, deps.output.rows ?? 24);
    const compact = width < 80 || height < 24;
    const scheduler = deps.getSchedulerState();
    const currentJob = selectedJob();
    const currentSession = selectedSession();
    const jobItems = jobs();
    const sessionItems = sessions();
    const logItems = filteredLogs().slice(-(compact ? 4 : 8) - logOffset);
    const lines = [
      color(
        36,
        `ZIP IMAGE VIEWER • Backend Dashboard${compact ? " • COMPACT" : ""}`,
      ),
      `Scheduler: ${String(scheduler.activeCount)}/${String(scheduler.maxConcurrent)} active   Pane: ${pane().toUpperCase()}`,
      "",
    ];

    if (!compact || pane() === "jobs") {
      lines.push(color(1, "Jobs"));
      lines.push(
        ...jobItems
          .slice(0, compact ? 5 : 8)
          .map((job, index) => jobLine(job, index === jobIndex, width)),
      );
    }
    if (!compact || pane() === "sessions") {
      lines.push(color(1, "Sessions"));
      lines.push(
        ...sessionItems
          .slice(0, compact ? 5 : 6)
          .map((session, index) =>
            sessionLine(session, index === sessionIndex, width),
          ),
      );
    }
    if (!compact && pane() !== "sessions" && currentJob) {
      lines.push(
        color(1, "Selected job"),
        crop(
          `${currentJob.phase} • ${formatBytes(currentJob.downloadedBytes)}/${formatBytes(currentJob.reportedSize)} • ${formatBytes(currentJob.downloadSpeedBytesPerSec)}/s • ETA ${currentJob.etaSeconds === null ? "--" : `${String(currentJob.etaSeconds)}s`} • retries ${String(currentJob.retryCount)}`,
          width,
        ),
        crop(currentJob.error || currentJob.message, width),
      );
    } else if (!compact && currentSession) {
      lines.push(
        color(1, "Selected session"),
        `${currentSession.id} • ${String(currentSession.stats.fileCount)} files`,
      );
    }
    if (!compact || pane() === "logs") {
      lines.push(color(1, "Filtered live logs"));
      lines.push(
        ...logItems.map((entry) =>
          crop(
            `${new Date(entry.timestamp).toISOString().slice(11, 19)} ${entry.level.toUpperCase()} ${entry.event}`,
            width,
          ),
        ),
      );
    }
    lines.push(
      "",
      crop(
        notice ||
          "Tab pane • ↑/↓ select • Shift+↑/↓ priority • P pause/resume • X cancel • R retry • Delete remove • [/] concurrency",
        width,
      ),
    );
    const frame = lines.slice(0, height).join("\n");
    if (frame === lastFrame) return;
    lastFrame = frame;
    deps.output.write(`${ESC}H${ESC}2J${frame}`);
  }

  function requestRender(): void {
    if (stopped || renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = undefined;
      try {
        render();
      } catch (error) {
        close();
        deps.output.write(
          `Dashboard failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    }, FRAME_MS);
    renderTimer.unref();
  }

  function run(action: () => unknown): void {
    const fail = (error: unknown) => {
      notice = error instanceof Error ? error.message : "Action failed.";
      requestRender();
    };
    try {
      void Promise.resolve(action()).catch(fail);
    } catch (error) {
      fail(error);
    }
  }

  function moveSelection(delta: number): void {
    if (pane() === "jobs") {
      jobIndex = Math.max(0, Math.min(jobs().length - 1, jobIndex + delta));
    } else if (pane() === "sessions") {
      sessionIndex = Math.max(
        0,
        Math.min(sessions().length - 1, sessionIndex + delta),
      );
    } else {
      logOffset = Math.max(0, logOffset + delta);
    }
    confirmation = "";
    notice = "";
    requestRender();
  }

  function movePriority(delta: number): void {
    const items = jobs();
    const target = jobIndex + delta;
    if (target < 0 || target >= items.length) return;
    [items[jobIndex], items[target]] = [items[target], items[jobIndex]];
    run(() => deps.actions.reorder(items.map(({ id }) => id)));
  }

  function removeSelected(): void {
    const item = pane() === "sessions" ? selectedSession() : selectedJob();
    if (!item) return;
    const key = `${pane()}:${item.id}`;
    if (confirmation !== key) {
      confirmation = key;
      notice = `Press Delete again to remove ${item.id.slice(0, 8)}.`;
      requestRender();
      return;
    }
    confirmation = "";
    notice = "";
    run(() =>
      pane() === "sessions"
        ? deps.actions.removeSession(item.id)
        : deps.actions.removeJob(item.id),
    );
  }

  function handleData(chunk: string | Buffer): void {
    const key = chunk.toString();
    const current = selectedJob();
    if (key === "\u0003") return deps.interrupt();
    if (key === "\t") paneIndex = (paneIndex + 1) % panes.length;
    else if (key === "\u001b[A") moveSelection(-1);
    else if (key === "\u001b[B") moveSelection(1);
    else if (key === "\u001b[1;2A") movePriority(-1);
    else if (key === "\u001b[1;2B") movePriority(1);
    else if (key.toLowerCase() === "p" && current)
      run(() =>
        current.status === "paused"
          ? deps.actions.resume(current.id)
          : deps.actions.pause(current.id),
      );
    else if (key.toLowerCase() === "x" && current)
      run(() => deps.actions.cancel(current.id));
    else if (key.toLowerCase() === "r" && current)
      run(() => deps.actions.retry(current.id));
    else if (key === "\u001b[3~") removeSelected();
    else if (key === "[")
      run(() =>
        deps.actions.setMaxConcurrent(
          Math.max(1, deps.getSchedulerState().maxConcurrent - 1),
        ),
      );
    else if (key === "]")
      run(() =>
        deps.actions.setMaxConcurrent(
          Math.min(8, deps.getSchedulerState().maxConcurrent + 1),
        ),
      );
    confirmation = key === "\u001b[3~" ? confirmation : "";
    requestRender();
  }

  function close(): void {
    if (stopped) return;
    stopped = true;
    if (renderTimer) clearTimeout(renderTimer);
    if (refreshTimer) clearInterval(refreshTimer);
    renderTimer = undefined;
    refreshTimer = undefined;
    unsubscribeLogs?.();
    unsubscribeLogs = undefined;
    deps.input.off("data", handleData);
    deps.output.off("resize", requestRender);
    deps.input.setRawMode?.(false);
    deps.input.pause?.();
    deps.setPlainLogging(true);
    deps.output.write(`${ESC}0m${ESC}?25h${ESC}?1049l\n`);
  }

  function start(): void {
    if (!stopped) return;
    stopped = false;
    deps.setPlainLogging(false);
    deps.output.write(`${ESC}?1049h${ESC}?25l`);
    deps.input.setRawMode?.(true);
    deps.input.resume?.();
    deps.input.on("data", handleData);
    deps.output.on("resize", requestRender);
    unsubscribeLogs = deps.subscribeLogs(requestRender);
    refreshTimer = setInterval(requestRender, 250);
    refreshTimer.unref();
    render();
  }

  return { close, start };
}
