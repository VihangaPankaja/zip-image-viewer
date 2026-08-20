import { spawn, type ChildProcess } from "node:child_process";

function chunkText(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (Buffer.isBuffer(chunk)) return chunk.toString("utf8");
  return "";
}

function waitForClose(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
}

export async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<void> {
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
  options: { allowNonZeroExit?: boolean; cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
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

export function extractWith7zip(
  executable: string,
  archivePath: string,
  extractDirectory: string,
): Promise<void> {
  return runCommand(executable, [
    "x",
    "-y",
    `-o${extractDirectory}`,
    archivePath,
  ]);
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
