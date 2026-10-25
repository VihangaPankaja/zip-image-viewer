import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { SessionJob } from "../../domain/models.js";

export function httpSourcePath(job: SessionJob) {
  const extension = path.extname(new URL(job.url).pathname);
  return path.join(
    job.workspaceDir,
    `source${/^\.[a-z\d]{1,8}$/i.test(extension) ? extension : ".bin"}`,
  );
}

export async function assertHttpWorkspace(job: SessionJob) {
  if (job.sourceKind !== "http" || !job.storageRoot) return;
  const expected = path.join(job.storageRoot, job.id);
  if (path.resolve(job.workspaceDir) !== path.resolve(expected))
    throw new Error("HTTP workspace ownership mismatch.");
  const info = await lstat(expected).catch(() => null);
  if (
    info &&
    (!info.isDirectory() ||
      info.isSymbolicLink() ||
      (await realpath(expected)) !== path.join(await realpath(job.storageRoot), job.id))
  )
    throw new Error("HTTP workspace is not an owned directory.");
}
