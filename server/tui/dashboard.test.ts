import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "../infrastructure/runtime/runtimePrimitives.js";
import {
  createTerminalDashboard,
  shouldUseTerminalDashboard,
} from "./dashboard.js";

class InputFixture extends EventEmitter {
  isTTY = true;
  rawModes: boolean[] = [];
  setRawMode(value: boolean) {
    this.rawModes.push(value);
    return this;
  }
  resume() {
    return this;
  }
  pause() {
    return this;
  }
}

class OutputFixture extends EventEmitter {
  isTTY = true;
  columns = 100;
  rows = 30;
  chunks: string[] = [];
  failNextWrite = false;
  write(chunk: string) {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("terminal write failed");
    }
    this.chunks.push(chunk);
    return true;
  }
}

const job = (status: "downloading" | "paused" | "error" = "downloading") => ({
  id: "job-1",
  url: "https://example.com/archive.zip",
  status,
  phase: status,
  percent: 50,
  downloadedBytes: 512,
  reportedSize: 1024,
  downloadSpeedBytesPerSec: 128,
  etaSeconds: 4,
  retryCount: 0,
  queuePosition: 0,
  message: "Working",
  error: "",
});

function setup() {
  const input = new InputFixture();
  const output = new OutputFixture();
  const jobs = [job(), { ...job(), id: "job-2", queuePosition: 1 }];
  const sessions = [
    {
      id: "session-1",
      stats: { fileCount: 3, directoryCount: 1, totalBytes: 1024 },
      lastAccessedAt: 1,
    },
  ];
  let logListener: ((_entry: LogEntry) => void) | undefined;
  const logs: LogEntry[] = [
    {
      timestamp: 1,
      level: "info",
      event: "selected event",
      details: {},
      jobId: "job-1",
      sessionId: "",
    },
    {
      timestamp: 2,
      level: "error",
      event: "other event",
      details: {},
      jobId: "job-2",
      sessionId: "",
    },
  ];
  const actions = {
    pause: vi.fn(() => Promise.resolve()),
    resume: vi.fn(),
    cancel: vi.fn(),
    retry: vi.fn(),
    removeJob: vi.fn(),
    removeSession: vi.fn(() => Promise.resolve()),
    reorder: vi.fn(),
    setMaxConcurrent: vi.fn(),
  };
  const interrupt = vi.fn();
  const dashboard = createTerminalDashboard({
    input,
    output,
    getJobs: () => jobs,
    getSessions: () => sessions,
    getSchedulerState: () => ({ activeCount: 1, maxConcurrent: 2 }),
    getLogs: () => logs,
    subscribeLogs: (listener) => {
      logListener = listener;
      return () => {
        logListener = undefined;
      };
    },
    setPlainLogging: vi.fn(),
    actions,
    interrupt,
  });
  return {
    actions,
    dashboard,
    input,
    interrupt,
    jobs,
    logs,
    notifyLog: () => {
      const entry = { ...logs[0], timestamp: logs.length + 2 };
      logs.push(entry);
      logListener?.(entry);
    },
    output,
  };
}

describe("terminal dashboard", () => {
  beforeEach(() => vi.useFakeTimers());

  it("requires both TTY streams and stays off in development", () => {
    expect(
      shouldUseTerminalDashboard({ inputTTY: true, outputTTY: true }),
    ).toBe(true);
    expect(
      shouldUseTerminalDashboard({
        inputTTY: true,
        outputTTY: true,
        nodeEnv: "development",
      }),
    ).toBe(false);
    expect(
      shouldUseTerminalDashboard({
        inputTTY: true,
        outputTTY: true,
        lifecycleEvent: "dev:server",
      }),
    ).toBe(false);
    expect(
      shouldUseTerminalDashboard({ inputTTY: false, outputTTY: true }),
    ).toBe(false);
  });

  it("renders wide and compact views with logs filtered to the selection", () => {
    const { dashboard, output } = setup();
    dashboard.start();
    expect(output.chunks.join("")).toContain("Backend Dashboard");
    expect(output.chunks.join("")).toContain("selected event");
    expect(output.chunks.join("")).not.toContain("other event");

    output.columns = 70;
    output.rows = 20;
    output.emit("resize");
    vi.advanceTimersByTime(34);
    expect(output.chunks.at(-1)).toContain("COMPACT");
    dashboard.close();
  });

  it("dispatches selection, priority, job controls, and concurrency keys", () => {
    const { actions, dashboard, input, jobs } = setup();
    dashboard.start();
    input.emit("data", "\u001b[1;2B");
    expect(actions.reorder).toHaveBeenCalledWith(["job-2", "job-1"]);
    input.emit("data", "p");
    expect(actions.pause).toHaveBeenCalledWith("job-1");
    jobs[0] = job("paused");
    input.emit("data", "p");
    expect(actions.resume).toHaveBeenCalledWith("job-1");
    input.emit("data", "x");
    input.emit("data", "r");
    input.emit("data", "]");
    expect(actions.cancel).toHaveBeenCalledWith("job-1");
    expect(actions.retry).toHaveBeenCalledWith("job-1");
    expect(actions.setMaxConcurrent).toHaveBeenCalledWith(3);
    dashboard.close();
  });

  it("confirms job and session removal, handles Ctrl+C, and restores ANSI state", () => {
    const { actions, dashboard, input, interrupt, output } = setup();
    dashboard.start();
    input.emit("data", "\u001b[3~");
    expect(actions.removeJob).not.toHaveBeenCalled();
    input.emit("data", "\u001b[3~");
    expect(actions.removeJob).toHaveBeenCalledWith("job-1");
    input.emit("data", "\t");
    input.emit("data", "\u001b[3~");
    input.emit("data", "\u001b[3~");
    expect(actions.removeSession).toHaveBeenCalledWith("session-1");
    input.emit("data", "\u0003");
    expect(interrupt).toHaveBeenCalledOnce();
    dashboard.close();
    expect(input.rawModes).toEqual([true, false]);
    expect(output.chunks.at(-1)).toContain("\u001b[?25h");
  });

  it("throttles log-driven redraws to at most 30 FPS", () => {
    const { dashboard, notifyLog, output } = setup();
    dashboard.start();
    const initialWrites = output.chunks.length;
    notifyLog();
    notifyLog();
    notifyLog();
    expect(output.chunks).toHaveLength(initialWrites);
    vi.advanceTimersByTime(34);
    expect(output.chunks).toHaveLength(initialWrites + 1);
    dashboard.close();
  });

  it("restores the terminal when rendering fails", () => {
    const { dashboard, input, output } = setup();
    dashboard.start();
    output.failNextWrite = true;
    output.columns = 70;
    output.emit("resize");
    vi.advanceTimersByTime(34);

    expect(input.rawModes.at(-1)).toBe(false);
    expect(output.chunks.join("")).toContain("Dashboard failed");
  });
});
