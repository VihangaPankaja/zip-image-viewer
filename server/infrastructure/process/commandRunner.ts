import { chunkText, waitForClose, ensureExecutable } from "./commandProcess.js";
import { writeArchiveEntry } from "./archiveEntryStream.js";
import { spawn } from "node:child_process";
import path from "node:path";
import { mkdir, utimes } from "node:fs/promises";
import { validateArchiveEntries } from "../archive/archiveLimits.js";
import {
  assertResourceSize,
  reserveStorage,
  resourceLimitError,
} from "../runtime/resourceLimits.js";
import { sanitizeEntryPath } from "../runtime/runtimePrimitives.js";
import type { ExtractionProgress } from "../../../shared/contracts.js";
import { ArchivePasswordRequired, checkArchiveFailure } from "../archive/archivePassword.js";

const MAX_COMMAND_OUTPUT_BYTES = 10 * 1024 ** 2;

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
    stdin?: string;
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  await ensureExecutable(command);
  const { allowNonZeroExit = false, stdin, ...spawnOptions } = options;
  const controller = new AbortController();
  const child = spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    ...spawnOptions,
    signal: spawnOptions.signal
      ? AbortSignal.any([spawnOptions.signal, controller.signal])
      : controller.signal,
  });
  child.stdin.on("error", () => undefined);
  child.stdin.end(stdin ?? "");
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

export async function inspect7zip(
  executable: string,
  archivePath: string,
  signal?: AbortSignal,
  password?: string,
) {
  const { stdout, stderr } = await runCommandCapture(
    executable,
    ["l", "-slt", "-sccUTF-8", "--", archivePath],
    { signal, allowNonZeroExit: true, stdin: password === undefined ? "" : `${password}\n` },
  );
  const encrypted =
    /Encrypted\s*=\s*\+/i.test(stdout) || /7zAES|AES256|ZipCrypto|enter password/i.test(stdout);
  if (encrypted && password === undefined) throw new ArchivePasswordRequired();
  if (stderr.trim()) checkArchiveFailure(stderr, password !== undefined);
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
  return { entries, encrypted, gzip: /^Type = gzip\r?$/m.test(stdout), entryCount: paths.size };
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
    onProgress?: (_progress: ExtractionProgress) => void;
    password?: string;
  } = {},
): Promise<void> {
  const index =
    options.index ?? (await inspect7zip(executable, archivePath, options.signal, options.password));
  if (index.encrypted && options.password === undefined) throw new ArchivePasswordRequired();
  const entries = selectedArchiveEntries(index.entries, options.filePaths);
  const bytes = validateArchiveEntries(entries);
  const storage = reserveStorage(extractDirectory, bytes);
  const gzip = index.gzip;
  const state = { downloadedBytes: 0 };
  const progress: ExtractionProgress = {
    stage: "extracting",
    completedEntries: 0,
    totalEntries: entries.filter((entry) => !entry.directory).length,
    expandedBytes: 0,
    totalExpandedBytes: gzip ? null : bytes,
    currentEntry: "",
  };
  const report = (expandedBytes = state.downloadedBytes) =>
    options.onProgress?.({ ...progress, expandedBytes });
  try {
    report();
    // Gzip listings can report only one member's modulo-32-bit output size.
    if (gzip) storage.reserveAvailable();
    for (const entry of entries) {
      options.signal?.throwIfAborted();
      const destination = path.join(extractDirectory, sanitizeEntryPath(entry.path));
      if (entry.directory) await mkdir(destination, { recursive: true });
      else {
        progress.currentEntry = sanitizeEntryPath(entry.path);
        report();
        await mkdir(path.dirname(destination), { recursive: true });
        await writeArchiveEntry({
          executable,
          password: options.password,
          archivePath,
          entry,
          destination,
          gzip,
          storage,
          state,
          onBytes: report,
          signal: options.signal,
          remainingBytes:
            options.maxBytes === undefined ? undefined : options.maxBytes - state.downloadedBytes,
        });
        progress.completedEntries++;
        report();
      }
    }
    for (const entry of [...entries].reverse()) {
      options.signal?.throwIfAborted();
      if (!Number.isFinite(entry.modifiedAt)) continue;
      const destination = path.join(extractDirectory, sanitizeEntryPath(entry.path));
      await utimes(destination, new Date(entry.modifiedAt), new Date(entry.modifiedAt));
    }
    options.onProgress?.({
      ...progress,
      expandedBytes: state.downloadedBytes,
      stage: "publishing",
      currentEntry: "",
    });
  } finally {
    storage.release();
  }
}

function selectedArchiveEntries(
  entries: Awaited<ReturnType<typeof inspect7zip>>["entries"],
  filePaths?: readonly string[],
) {
  if (!filePaths) return entries;
  const selected = new Set(filePaths.map(sanitizeEntryPath));
  const result = entries.filter((entry) => selected.has(sanitizeEntryPath(entry.path)));
  if (result.length !== selected.size || result.some((entry) => entry.directory))
    throw resourceLimitError("Invalid archive selection.");
  return result;
}

export async function detectArchiveEncryption(
  executable: string,
  archivePath: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!executable) return false;
  const { stdout, stderr } = await runCommandCapture(executable, ["l", "-slt", "--", archivePath], {
    allowNonZeroExit: true,
    signal,
  });
  return /Encrypted\s*=\s*\+|7zAES|AES256|ZipCrypto|enter password|wrong password/i.test(
    stdout + stderr,
  );
}
