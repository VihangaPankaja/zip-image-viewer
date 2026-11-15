import type { ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod } from "node:fs/promises";
import path from "node:path";

export function chunkText(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (Buffer.isBuffer(chunk)) return chunk.toString("utf8");
  return "";
}

export function waitForClose(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let failure: Error | undefined;
    child.once("error", (error) => {
      failure = error;
    });
    child.once("close", (code) => (failure ? reject(failure) : resolve(code)));
  });
}

export async function ensureExecutable(command: string): Promise<void> {
  if (process.platform === "win32" || !path.isAbsolute(command)) return;
  try {
    await access(command, constants.X_OK);
  } catch {
    await chmod(command, 0o755);
  }
}
