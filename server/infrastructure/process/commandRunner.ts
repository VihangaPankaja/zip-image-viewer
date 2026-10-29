import { spawn, type ChildProcess } from "node:child_process";
import { constants, createWriteStream } from "node:fs";
import { access, chmod, mkdir, utimes } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { validateArchiveEntries } from "../archive/archiveLimits.js";
import {
  createDownloadBudget,
  assertResourceSize,
  MAX_RESOURCE_BYTES,
  reserveStorage,
  resourceLimitError,
} from "../runtime/resourceLimits.js";
import { sanitizeEntryPath } from "../runtime/runtimePrimitives.js";

const MAX_COMMAND_OUTPUT_BYTES = 10 * 1024 ** 2;

function chunkText(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (Buffer.isBuffer(chunk)) return chunk.toString("utf8");
  return "";
}

function waitForClose(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let failure: Error | undefined;
    child.once("error", (error) => {
      failure = error;
    });
    child.once("close", (code) => (failure ? reject(failure) : resolve(code)));
  });
}

async function ensureExecutable(command: string): Promise<void> {
  if (process.platform === "win32" || !path.isAbsolute(command)) return;
  try {
    await access(command, constants.X_OK);
  } catch {
    await chmod(command, 0o755);
  }
}

export async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; signal?: AbortSignal } = {},
): Promise<void> {
  await ensureExecutable(command);
  const child = spawn(command, args, {
    stdio: ["ignore", "ignore", "pipe"],
    ...options,
  });
  let stderr = "";
  child.stderr.on("data", (chunk: unknown) => {
    stderr += chunkText(chunk);
  });
  const code = await waitForClose(child);
  if (code !== 0) {
    throw new Error(stderr || `Command failed with code ${String(code)}`);
  }
}

export async function runCommandCapture(
  command: string,
  args: string[],
  options: {
    allowNonZeroExit?: boolean;
    cwd?: string;
    signal?: AbortSignal;
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  await ensureExecutable(command);
  const { allowNonZeroExit = false, ...spawnOptions } = options;
  const controller = new AbortController();
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    ...spawnOptions,
    signal: spawnOptions.signal
      ? AbortSignal.any([spawnOptions.signal, controller.signal])
      : controller.signal,
  });
  let stdout = "";
  let stderr = "";
  let capturedBytes = 0;
  const capture = (chunk: unknown) => {
    const text = chunkText(chunk);
    capturedBytes += Buffer.byteLength(text);
    if (capturedBytes > MAX_COMMAND_OUTPUT_BYTES) {
      controller.abort(resourceLimitError("Command metadata exceeds the 10 MiB limit."));
      return "";
    }
    return text;
  };
  child.stdout.on("data", (chunk: unknown) => {
    stdout += capture(chunk);
  });
  child.stderr.on("data", (chunk: unknown) => {
    stderr += capture(chunk);
  });
  try {
    const code = await waitForClose(child);
    controller.signal.throwIfAborted();
    if (code !== 0 && !allowNonZeroExit)
      throw new Error(stderr || `Command failed with code ${String(code)}`);
    return { stdout, stderr };
  } catch (error) {
    controller.signal.throwIfAborted();
    throw error;
  }
}

async function writeArchiveEntry({
  executable,
  archivePath,
  entry,
  destination,
  gzip,
  storage,
  state,
  signal,
  remainingBytes,
}: {
  executable: string;
  archivePath: string;
  entry: { path: string; size: number };
  destination: string;
  gzip: boolean;
  storage: ReturnType<typeof reserveStorage>;
  state: { downloadedBytes: number };
  signal?: AbortSignal;
  remainingBytes?: number;
}) {
  const controller = new AbortController();
  const child = spawn(
    executable,
    ["x", "-so", "-y", "-spd", "-ssc", `-i!${entry.path}`, "--", archivePath],
    {
      stdio: ["ignore", "pipe", "pipe"],
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    },
  );
  let stderr = "";
  let stderrBytes = 0;
  child.stderr.on("data", (chunk: unknown) => {
    const text = chunkText(chunk);
    stderrBytes += Buffer.byteLength(text);
    if (stderrBytes > MAX_COMMAND_OUTPUT_BYTES)
      controller.abort(resourceLimitError("Command metadata exceeds the 10 MiB limit."));
    else stderr += text;
  });
  const closed = waitForClose(child).catch((error: unknown) => {
    controller.abort(error);
    return null;
  });
  const before = state.downloadedBytes;
  const budget = createDownloadBudget(
    () => Math.min(gzip ? MAX_RESOURCE_BYTES : entry.size, remainingBytes ?? MAX_RESOURCE_BYTES),
    state,
    (received) => storage.check(before + received),
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
    if (code !== 0) throw new Error(stderr || `Command failed with code ${String(code)}`);
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

export async function inspect7zip(executable: string, archivePath: string, signal?: AbortSignal) {
  const { stdout } = await runCommandCapture(
    executable,
    ["l", "-slt", "-sccUTF-8", "--", archivePath],
    { signal },
  );
  if (/Encrypted\s*=\s*\+/i.test(stdout) || /Method\s*=\s*\w+\s+AES/i.test(stdout))
    throw resourceLimitError("Password-protected archives are not supported.");
  const listing = stdout.split(/^----------\r?$/m).at(-1) ?? "";
  const entries = listing
    .trim()
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .map((record) => {
      const values: Record<string, string | undefined> = Object.fromEntries(
        record.split(/\r?\n/).map((line) => {
          const separator = line.indexOf(" = ");
          return [line.slice(0, separator), line.slice(separator + 3)];
        }),
      );
      return {
        path: values.Path ?? "",
        size: Number(values.Size ?? 0),
        compressedSize: Number(values["Packed Size"] ?? 0),
        directory: values.Folder === "+" || (values.Attributes ?? "").startsWith("D"),
        modifiedAt: Date.parse(values.Modified ?? ""),
        isLink:
          Boolean(values["Symbolic Link"] || values["Hard Link"]) ||
          (values.Attributes ?? "").startsWith("l"),
      };
    });
  validateArchiveEntries(entries);
  const names = new Map<string, boolean>();
  for (const entry of entries) {
    assertResourceSize(entry.compressedSize);
    const name = sanitizeEntryPath(entry.path).normalize("NFC").toLowerCase();
    if (
      !name ||
      name
        .split("/")
        .some(
          (part) =>
            !part ||
            part === "." ||
            /[. ]$/.test(part) ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
        ) ||
      names.has(name)
    )
      throw resourceLimitError("Archive contains duplicate or conflicting paths.");
    names.set(name, entry.directory);
  }
  for (const name of names.keys()) {
    const parts = name.split("/");
    for (let index = 1; index < parts.length; index++)
      if (names.get(parts.slice(0, index).join("/")) === false)
        throw resourceLimitError("Archive contains conflicting file and folder paths.");
  }
  const paths = new Set<string>();
  for (const name of names.keys()) {
    const parts = name.split("/");
    for (let index = 1; index <= parts.length; index++) paths.add(parts.slice(0, index).join("/"));
  }
  return { entries, gzip: /^Type = gzip\r?$/m.test(stdout), entryCount: paths.size };
}

export async function extractWith7zip(
  executable: string,
  archivePath: string,
  extractDirectory: string,
  options: {
    signal?: AbortSignal;
    filePaths?: readonly string[];
    index?: Awaited<ReturnType<typeof inspect7zip>>;
    maxBytes?: number;
  } = {},
): Promise<void> {
  const index = options.index ?? (await inspect7zip(executable, archivePath, options.signal));
  const selected = options.filePaths ? new Set(options.filePaths) : undefined;
  const entries = index.entries.filter((entry) => !selected || selected.has(entry.path));
  if (selected && (entries.length !== selected.size || entries.some((entry) => entry.directory)))
    throw resourceLimitError("Invalid archive selection.");
  const bytes = validateArchiveEntries(entries);
  const storage = reserveStorage(extractDirectory, bytes);
  const gzip = index.gzip;
  const state = { downloadedBytes: 0 };
  try {
    // Gzip listings can report only one member's modulo-32-bit output size.
    if (gzip) storage.reserveAvailable();
    for (const entry of entries) {
      options.signal?.throwIfAborted();
      const destination = path.join(extractDirectory, sanitizeEntryPath(entry.path));
      if (entry.directory) await mkdir(destination, { recursive: true });
      else {
        await mkdir(path.dirname(destination), { recursive: true });
        await writeArchiveEntry({
          executable,
          archivePath,
          entry,
          destination,
          gzip,
          storage,
          state,
          signal: options.signal,
          remainingBytes:
            options.maxBytes === undefined ? undefined : options.maxBytes - state.downloadedBytes,
        });
      }
    }
    for (const entry of [...entries].reverse()) {
      if (!Number.isFinite(entry.modifiedAt)) continue;
      const destination = path.join(extractDirectory, sanitizeEntryPath(entry.path));
      await utimes(destination, new Date(entry.modifiedAt), new Date(entry.modifiedAt));
    }
  } finally {
    storage.release();
  }
}

export async function detectArchiveEncryption(
  executable: string,
  archivePath: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!executable) return false;
  const { stdout } = await runCommandCapture(executable, ["l", "-slt", archivePath], {
    allowNonZeroExit: true,
    signal,
  });
  return /Encrypted\s*=\s*\+/i.test(stdout) || /Method\s*=\s*\w+\s+AES/i.test(stdout);
}
