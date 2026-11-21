import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ApplicationError, type SessionJob } from "../../domain/models.js";
import { assertHttpWorkspace, httpSourcePath } from "./httpWorkspace.js";
import { hashDownloadFile } from "./httpCheckpoint.js";
import { reserveStorage } from "../runtime/resourceLimits.js";

async function assertLocalSource(job: SessionJob) {
  await assertHttpWorkspace(job);
  if (!job.localSource || path.resolve(job.zipPath) !== httpSourcePath(job))
    throw new Error("Local source ownership mismatch.");
  const directory = path.dirname(job.zipPath);
  if ((await realpath(directory)) !== path.join(await realpath(job.workspaceDir), "source"))
    throw new Error("Local source directory is outside its owning workspace.");
  return job.localSource;
}

export async function verifyLocalSource(job: SessionJob) {
  await assertLocalSource(job);
  const source = await lstat(job.zipPath).catch(() => null);
  if (
    !source?.isFile() ||
    source.isSymbolicLink() ||
    source.size !== job.localSource?.size ||
    !job.localSource.sha256 ||
    (await hashDownloadFile(job.zipPath, undefined, job.abortController?.signal)) !==
      job.localSource.sha256
  )
    throw new ApplicationError(
      "CONFLICT",
      "Local source is missing or changed. Choose the file again to import it.",
      409,
    );
}

export async function cleanupIncompleteLocalSource(job: SessionJob) {
  await assertLocalSource(job);
  await rm(`${job.zipPath}.uploading`, { force: true });
  if (!job.localSource?.sha256) await rm(job.zipPath, { force: true });
}

export async function receiveLocalUpload(
  job: SessionJob,
  input: Readable,
  progress: (_bytes: number) => void,
): Promise<string> {
  const { size } = await assertLocalSource(job);
  const partial = `${job.zipPath}.uploading`;
  if ((await lstat(partial).catch(() => null)) || (await lstat(job.zipPath).catch(() => null)))
    throw new ApplicationError(
      "CONFLICT",
      "An upload source already exists. Retry after cleanup.",
      409,
    );
  const storage = reserveStorage(job.workspaceDir, size);
  const hash = createHash("sha256");
  let received = 0;
  const state = { created: false };
  const output = createWriteStream(partial, { flags: "wx", mode: 0o600, highWaterMark: 64 * 1024 });
  output.once("open", () => {
    state.created = true;
  });
  const budget = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        received += chunk.length;
        if (received > size)
          throw new ApplicationError("INVALID_INPUT", "Upload exceeds its declared size.", 400);
        storage.check(received);
        hash.update(chunk);
        progress(received);
        callback(null, chunk);
      } catch (error) {
        callback(error as Error);
      }
    },
  });
  // An iterator waiting for the next request chunk must also wake on cancellation.
  const abort = () => input.destroy();
  const signal = job.abortController?.signal;
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    await pipeline(Readable.from(input.iterator({ destroyOnReturn: false })), budget, output, {
      signal: job.abortController?.signal,
    });
    if (received !== size)
      throw new ApplicationError(
        "INVALID_INPUT",
        "Upload ended before its declared size. Retry this file.",
        400,
      );
    job.abortController?.signal.throwIfAborted();
    await rename(partial, job.zipPath);
    return hash.digest("hex");
  } finally {
    signal?.removeEventListener("abort", abort);
    storage.release();
    if (state.created) await rm(partial, { force: true });
  }
}
