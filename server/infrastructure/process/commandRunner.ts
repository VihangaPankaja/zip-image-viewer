import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod } from "node:fs/promises";
import path from "node:path";
import { validateArchiveEntries } from "../archive/archiveLimits.js";
import { listExtractedEntries } from "../archive/listExtractedEntries.js";
import { reserveStorage } from "../runtime/resourceLimits.js";

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
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    ...spawnOptions,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: unknown) => {
    stdout += chunkText(chunk);
  });
  child.stderr.on("data", (chunk: unknown) => {
    stderr += chunkText(chunk);
  });
  const code = await waitForClose(child);
  if (code !== 0 && !allowNonZeroExit) {
    throw new Error(stderr || `Command failed with code ${String(code)}`);
  }
  return { stdout, stderr };
}

export async function extractWith7zip(
  executable: string,
  archivePath: string,
  extractDirectory: string,
): Promise<void> {
  const { stdout } = await runCommandCapture(executable, [
    "l",
    "-slt",
    archivePath,
  ]);
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
        isLink:
          Boolean(values["Symbolic Link"] || values["Hard Link"]) ||
          /^l/.test(values.Attributes ?? ""),
      };
    });
  const bytes = validateArchiveEntries(entries);
  const storage = reserveStorage(extractDirectory, bytes);
  const controller = new AbortController();
  let checking: Promise<void> | undefined;
  const check = () =>
    (checking ??= (async () => {
      try {
        storage.check();
        const output = await listExtractedEntries(extractDirectory);
        storage.check(output.reduce((total, entry) => total + entry.size, 0));
      } catch (error) {
        controller.abort(error);
      }
    })().finally(() => {
      checking = undefined;
    }));
  // shortcut: output can grow between scans; use an OS quota for a strict write ceiling.
  const timer = setInterval(() => {
    void check();
  }, 100);
  try {
    // Gzip listings can report only one member's modulo-32-bit output size.
    if (/^Type = gzip\r?$/m.test(stdout)) storage.reserveAvailable();
    await runCommand(
      executable,
      ["x", "-y", `-o${extractDirectory}`, archivePath],
      { signal: controller.signal },
    );
    await checking;
    await check();
    controller.signal.throwIfAborted();
  } catch (error) {
    await checking;
    controller.signal.throwIfAborted();
    throw error;
  } finally {
    clearInterval(timer);
    await checking;
    storage.release();
  }
}

export async function detectArchiveEncryption(
  executable: string,
  archivePath: string,
): Promise<boolean> {
  if (!executable) return false;
  const { stdout } = await runCommandCapture(
    executable,
    ["l", "-slt", archivePath],
    { allowNonZeroExit: true },
  );
  return (
    /Encrypted\s*=\s*\+/i.test(stdout) || /Method\s*=\s*\w+\s+AES/i.test(stdout)
  );
}
