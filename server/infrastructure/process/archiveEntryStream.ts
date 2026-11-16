import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import {
  createDownloadBudget,
  MAX_RESOURCE_BYTES,
  reserveStorage,
  resourceLimitError,
} from "../runtime/resourceLimits.js";
import { chunkText, waitForClose } from "./commandProcess.js";
import { checkArchiveFailure } from "../archive/archivePassword.js";

const MAX_COMMAND_OUTPUT_BYTES = 10 * 1024 ** 2;

type ArchiveEntryOptions = {
  executable: string;
  archivePath: string;
  entry: { path: string; size: number };
  destination: string;
  gzip: boolean;
  storage: ReturnType<typeof reserveStorage>;
  state: { downloadedBytes: number };
  signal?: AbortSignal;
  remainingBytes?: number;
  onBytes?: (_bytes: number) => void;
  password?: string;
};

export async function writeArchiveEntry(options: ArchiveEntryOptions) {
  const {
    executable,
    archivePath,
    entry,
    destination,
    gzip,
    storage,
    state,
    signal,
    remainingBytes,
    onBytes,
    password,
  } = options;
  const controller = new AbortController();
  const child = spawn(
    executable,
    [
      "x",
      "-so",
      "-y",
      "-bso0",
      "-bsp0",
      "-sccUTF-8",
      "-spd",
      "-ssc",
      `-i!${entry.path}`,
      "--",
      archivePath,
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    },
  );
  // Passwords use an anonymous pipe, never argv, environment, files or a shell.
  child.stdin.on("error", () => undefined);
  child.stdin.end(password === undefined ? "" : `${password}\n`);
  const errors = archiveErrors(child.stderr, controller);
  const closed = waitForClose(child).catch((error: unknown) => {
    controller.abort(error);
    return null;
  });
  const before = state.downloadedBytes;
  const budget = createDownloadBudget(
    () => Math.min(gzip ? MAX_RESOURCE_BYTES : entry.size, remainingBytes ?? MAX_RESOURCE_BYTES),
    state,
    (received) => {
      storage.check(before + received);
      onBytes?.(before + received);
    },
  );
  const timer = setInterval(() => {
    try {
      storage.check(state.downloadedBytes);
    } catch (error) {
      controller.abort(error);
    }
  }, 100);
  try {
    await pipeline(child.stdout, budget, createWriteStream(destination, { flags: "wx" }), {
      signal,
    });
    const code = await closed;
    controller.signal.throwIfAborted();
    if (code !== 0) checkArchiveFailure(errors(), password !== undefined, archivePath);
    if (!gzip && state.downloadedBytes - before !== entry.size)
      throw resourceLimitError("Archive entry does not match its declared size.");
  } catch (error) {
    controller.abort(error);
    await closed;
    controller.signal.throwIfAborted();
    throw error;
  } finally {
    clearInterval(timer);
  }
}

function archiveErrors(stderrStream: import("node:stream").Readable, controller: AbortController) {
  let stderr = "";
  let stderrBytes = 0;
  stderrStream.setEncoding("utf8");
  stderrStream.on("data", (chunk: unknown) => {
    const text = chunkText(chunk);
    stderrBytes += Buffer.byteLength(text);
    if (stderrBytes > MAX_COMMAND_OUTPUT_BYTES)
      controller.abort(resourceLimitError("Command metadata exceeds the 10 MiB limit."));
    else stderr += text;
  });
  return () => stderr;
}
