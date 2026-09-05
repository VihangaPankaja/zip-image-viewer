import {
  formatBytes,
  type LogEntry,
} from "../infrastructure/runtime/runtimePrimitives.js";
import {
  color,
  crop,
  jobLine,
  sessionLine,
  TERMINAL_ESCAPE as ESC,
  type DashboardJob,
  type DashboardSession,
} from "./dashboardView.js";

const FRAME_MS = 34;
const panes = ["jobs", "sessions", "logs"] as const;
type Pane = (typeof panes)[number];
type TerminalInput = {
  on: (event: "data", listener: (chunk: string | Buffer) => void) => unknown;
  off: (event: "data", listener: (chunk: string | Buffer) => void) => unknown;
  setRawMode?: (enabled: boolean) => unknown;
  resume?: () => unknown;
  pause?: () => unknown;
};
type TerminalOutput = {
  columns?: number;
  rows?: number;
  write: (chunk: string) => unknown;
  on: (event: "resize", listener: () => void) => unknown;
  off: (event: "resize", listener: () => void) => unknown;
};
type DashboardDependencies = {
  input: TerminalInput;
  output: TerminalOutput;
  getJobs: () => readonly DashboardJob[];
  getSessions: () => readonly DashboardSession[];
  getSchedulerState: () => { activeCount: number; maxConcurrent: number };
  getLogs: () => readonly LogEntry[];
  subscribeLogs: (listener: (entry: LogEntry) => void) => () => void;
  setPlainLogging: (enabled: boolean) => void;
  actions: {
    pause: (id: string) => unknown;
    resume: (id: string) => unknown;
    cancel: (id: string) => unknown;
    retry: (id: string) => unknown;
    removeJob: (id: string) => unknown;
    removeSession: (id: string) => unknown;
    reorder: (jobIds: readonly string[]) => unknown;
    setMaxConcurrent: (value: number) => unknown;
  };
  interrupt: () => void;
};

class TerminalDashboard {
  private paneIndex = 0;
  private jobIndex = 0;
  private sessionIndex = 0;
  private logOffset = 0;
  private confirmation = "";
  private notice = "";
  private stopped = true;
  private renderTimer: NodeJS.Timeout | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private unsubscribeLogs: (() => void) | undefined;
  private lastFrame = "";

  constructor(private readonly deps: DashboardDependencies) {}

  private pane(): Pane {
    return panes[this.paneIndex] ?? "jobs";
  }

  private jobs(): DashboardJob[] {
    return [...this.deps.getJobs()].sort(
      (a, b) => a.queuePosition - b.queuePosition,
    );
  }

  private sessions(): DashboardSession[] {
    return [...this.deps.getSessions()];
  }

  private selectedJob(): DashboardJob | undefined {
    const items = this.jobs();
    this.jobIndex = Math.min(this.jobIndex, Math.max(0, items.length - 1));
    return items.at(this.jobIndex);
  }

  private selectedSession(): DashboardSession | undefined {
    const items = this.sessions();
    this.sessionIndex = Math.min(
      this.sessionIndex,
      Math.max(0, items.length - 1),
    );
    return items.at(this.sessionIndex);
  }

  private filteredLogs(): LogEntry[] {
    const jobId = this.selectedJob()?.id ?? "";
    const sessionId = this.selectedSession()?.id ?? "";
    return this.deps
      .getLogs()
      .filter((entry) =>
        this.pane() === "sessions"
          ? entry.sessionId === sessionId
          : entry.jobId === jobId,
      );
  }

  private render(): void {
    const width = Math.max(40, this.deps.output.columns ?? 80);
    const height = Math.max(12, this.deps.output.rows ?? 24);
    const compact = width < 80 || height < 24;
    const scheduler = this.deps.getSchedulerState();
    const currentJob = this.selectedJob();
    const currentSession = this.selectedSession();
    const jobItems = this.jobs();
    const sessionItems = this.sessions();
    const logItems = this.filteredLogs().slice(
      -(compact ? 4 : 8) - this.logOffset,
    );
    const lines = [
      color(
        36,
        `ZIP IMAGE VIEWER • Backend Dashboard${compact ? " • COMPACT" : ""}`,
      ),
      `Scheduler: ${String(scheduler.activeCount)}/${String(scheduler.maxConcurrent)} active   Pane: ${this.pane().toUpperCase()}`,
      "",
    ];
    if (!compact || this.pane() === "jobs") {
      lines.push(color(1, "Jobs"));
      lines.push(
        ...jobItems
          .slice(0, compact ? 5 : 8)
          .map((job, index) => jobLine(job, index === this.jobIndex, width)),
      );
    }
    if (!compact || this.pane() === "sessions") {
      lines.push(color(1, "Sessions"));
      lines.push(
        ...sessionItems
          .slice(0, compact ? 5 : 6)
          .map((session, index) =>
            sessionLine(session, index === this.sessionIndex, width),
          ),
      );
    }
    this.appendSelection(lines, compact, width, currentJob, currentSession);
    if (!compact || this.pane() === "logs") {
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
        this.notice ||
          "Tab pane • ↑/↓ select • Shift+↑/↓ priority • P pause/resume • X cancel • R retry • Delete remove • [/] concurrency",
        width,
      ),
    );
    const frame = lines.slice(0, height).join("\n");
    if (frame === this.lastFrame) return;
    this.lastFrame = frame;
    this.deps.output.write(`${ESC}H${ESC}2J${frame}`);
  }

  private appendSelection(
    lines: string[],
    compact: boolean,
    width: number,
    job: DashboardJob | undefined,
    session: DashboardSession | undefined,
  ): void {
    if (!compact && this.pane() !== "sessions" && job) {
      lines.push(
        color(1, "Selected job"),
        crop(
          `${job.phase} • ${formatBytes(job.downloadedBytes)}/${formatBytes(job.reportedSize)} • ${formatBytes(job.downloadSpeedBytesPerSec)}/s • ETA ${job.etaSeconds === null ? "--" : `${String(job.etaSeconds)}s`} • retries ${String(job.retryCount)}`,
          width,
        ),
        crop(job.error || job.message, width),
      );
    } else if (!compact && session) {
      lines.push(
        color(1, "Selected session"),
        `${session.id} • ${String(session.stats.fileCount)} files`,
      );
    }
  }

  private requestRender = (): void => {
    if (this.stopped || this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined;
      try {
        this.render();
      } catch (error) {
        this.close();
        this.deps.output.write(
          `Dashboard failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    }, FRAME_MS);
    this.renderTimer.unref();
  };

  private run(action: () => unknown): void {
    const fail = (error: unknown) => {
      this.notice = error instanceof Error ? error.message : "Action failed.";
      this.requestRender();
    };
    try {
      void Promise.resolve(action()).catch(fail);
    } catch (error) {
      fail(error);
    }
  }

  private moveSelection(delta: number): void {
    if (this.pane() === "jobs")
      this.jobIndex = Math.max(
        0,
        Math.min(this.jobs().length - 1, this.jobIndex + delta),
      );
    else if (this.pane() === "sessions")
      this.sessionIndex = Math.max(
        0,
        Math.min(this.sessions().length - 1, this.sessionIndex + delta),
      );
    else this.logOffset = Math.max(0, this.logOffset + delta);
    this.confirmation = "";
    this.notice = "";
    this.requestRender();
  }

  private movePriority(delta: number): void {
    const items = this.jobs();
    const target = this.jobIndex + delta;
    const current = items.at(this.jobIndex);
    const next = items.at(target);
    if (!current || !next) return;
    [items[this.jobIndex], items[target]] = [next, current];
    this.run(() => this.deps.actions.reorder(items.map(({ id }) => id)));
  }

  private removeSelected(): void {
    const item =
      this.pane() === "sessions" ? this.selectedSession() : this.selectedJob();
    if (!item) return;
    const key = `${this.pane()}:${item.id}`;
    if (this.confirmation !== key) {
      this.confirmation = key;
      this.notice = `Press Delete again to remove ${item.id.slice(0, 8)}.`;
      this.requestRender();
      return;
    }
    this.confirmation = "";
    this.notice = "";
    this.run(() =>
      this.pane() === "sessions"
        ? this.deps.actions.removeSession(item.id)
        : this.deps.actions.removeJob(item.id),
    );
  }

  private handleData = (chunk: string | Buffer): void => {
    const key = chunk.toString();
    const current = this.selectedJob();
    if (key === "\u0003") {
      this.deps.interrupt();
      return;
    }
    if (key === "\t") this.paneIndex = (this.paneIndex + 1) % panes.length;
    else if (key === "\u001b[A") this.moveSelection(-1);
    else if (key === "\u001b[B") this.moveSelection(1);
    else if (key === "\u001b[1;2A") this.movePriority(-1);
    else if (key === "\u001b[1;2B") this.movePriority(1);
    else if (key.toLowerCase() === "p" && current)
      this.run(() =>
        current.status === "paused"
          ? this.deps.actions.resume(current.id)
          : this.deps.actions.pause(current.id),
      );
    else if (key.toLowerCase() === "x" && current)
      this.run(() => this.deps.actions.cancel(current.id));
    else if (key.toLowerCase() === "r" && current)
      this.run(() => this.deps.actions.retry(current.id));
    else if (key === "\u001b[3~") this.removeSelected();
    else if (key === "[")
      this.run(() =>
        this.deps.actions.setMaxConcurrent(
          Math.max(1, this.deps.getSchedulerState().maxConcurrent - 1),
        ),
      );
    else if (key === "]")
      this.run(() =>
        this.deps.actions.setMaxConcurrent(
          Math.min(8, this.deps.getSchedulerState().maxConcurrent + 1),
        ),
      );
    this.confirmation = key === "\u001b[3~" ? this.confirmation : "";
    this.requestRender();
  };

  close = (): void => {
    if (this.stopped) return;
    this.stopped = true;
    if (this.renderTimer) clearTimeout(this.renderTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.renderTimer = undefined;
    this.refreshTimer = undefined;
    this.unsubscribeLogs?.();
    this.unsubscribeLogs = undefined;
    this.deps.input.off("data", this.handleData);
    this.deps.output.off("resize", this.requestRender);
    this.deps.input.setRawMode?.(false);
    this.deps.input.pause?.();
    this.deps.setPlainLogging(true);
    this.deps.output.write(`${ESC}0m${ESC}?25h${ESC}?1049l\n`);
  };

  start = (): void => {
    if (!this.stopped) return;
    this.stopped = false;
    this.deps.setPlainLogging(false);
    this.deps.output.write(`${ESC}?1049h${ESC}?25l`);
    this.deps.input.setRawMode?.(true);
    this.deps.input.resume?.();
    this.deps.input.on("data", this.handleData);
    this.deps.output.on("resize", this.requestRender);
    this.unsubscribeLogs = this.deps.subscribeLogs(this.requestRender);
    this.refreshTimer = setInterval(this.requestRender, 250);
    this.refreshTimer.unref();
    this.render();
  };
}

export function createTerminalDashboard(deps: DashboardDependencies) {
  const dashboard = new TerminalDashboard(deps);
  return { close: dashboard.close, start: dashboard.start };
}
