import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { localImportInputSchema, type LocalImportInput } from "../../../shared/contracts.js";
import { ApplicationError, type SessionJob } from "../../domain/models.js";
import type { createJobManager } from "./jobManager.js";
import {
  assertHttpWorkspace,
  httpSourcePath,
} from "../../infrastructure/downloads/httpWorkspace.js";
import {
  cleanupIncompleteLocalSource,
  receiveLocalUpload,
} from "../../infrastructure/downloads/localUpload.js";

const UPLOAD_TIMEOUT_MS = 15 * 60_000;
type Dependencies = {
  directory: string;
  jobs: Map<string, SessionJob>;
  manager: ReturnType<typeof createJobManager>;
  registerJob: (_job: SessionJob) => void;
  enqueue: (_job: SessionJob, _confirmed: boolean) => void;
};

class LocalImports {
  private active = 0;
  private readonly initializing = new Map<string, Promise<SessionJob>>();
  constructor(private readonly deps: Dependencies) {}
  private find(id: string) {
    const job = this.deps.jobs.get(id);
    if (!job || job.sourceKind !== "local" || !job.localSource)
      throw new ApplicationError("NOT_FOUND", "Local import not found.", 404);
    return { job, source: job.localSource };
  }
  private async create(input: LocalImportInput) {
    const deps = this.deps;
    const previous = deps.jobs.get(input.id);
    if (previous) {
      if (
        previous.sourceKind !== "local" ||
        previous.localSource?.name !== input.name ||
        previous.localSource.size !== input.size
      )
        throw new ApplicationError(
          "CONFLICT",
          "This import ID already belongs to another file.",
          409,
        );
      return previous;
    }
    if (
      [...deps.jobs.values()].filter(
        (job) => job.sourceKind === "local" && !job.localSource?.sha256,
      ).length +
        this.initializing.size >=
      50
    )
      throw new ApplicationError(
        "CONFLICT",
        "Remove an unfinished import before adding more files.",
        429,
      );
    const workspaceDir = path.join(deps.directory, input.id);
    const sourceDir = path.join(workspaceDir, "source");
    await assertHttpWorkspace({
      id: input.id,
      sourceKind: "local",
      storageRoot: deps.directory,
      workspaceDir,
    });
    await mkdir(sourceDir, { recursive: true, mode: 0o700 });
    if ((await realpath(sourceDir)) !== path.join(await realpath(workspaceDir), "source"))
      throw new ApplicationError("CONFLICT", "Local import source is not an owned directory.", 409);
    const job = deps.manager.createLocalJob(input);
    job.storageRoot = deps.directory;
    job.workspaceDir = workspaceDir;
    job.zipPath = httpSourcePath(job);
    job.extractDir = path.join(workspaceDir, "extracted");
    deps.manager.emitJob(job, {
      status: "uploading",
      phase: "uploading",
      reportedSize: input.size,
      cleanupAt: Date.now() + UPLOAD_TIMEOUT_MS,
      message: "Waiting for the local file upload.",
    });
    deps.registerJob(job);
    return job;
  }
  initialize(value: unknown) {
    const parsed = localImportInputSchema.safeParse(value);
    if (!parsed.success)
      throw new ApplicationError(
        "INVALID_INPUT",
        parsed.error.issues[0]?.message ?? "Invalid local file.",
        400,
      );
    const pending = this.initializing.get(parsed.data.id);
    if (pending) return pending.then(() => this.create(parsed.data));
    const promise = this.create(parsed.data).finally(() =>
      this.initializing.delete(parsed.data.id),
    );
    this.initializing.set(parsed.data.id, promise);
    return promise;
  }
  async upload(id: string, input: Readable, size: string | undefined, disconnected: AbortSignal) {
    const { job, source } = this.find(id);
    if (job.uploadOperation)
      throw new ApplicationError("CONFLICT", "This file is already uploading.", 409);
    if (source.sha256) return job;
    if (this.active >= 2)
      throw new ApplicationError(
        "CONFLICT",
        "Two files are already uploading. Retry when one finishes.",
        429,
      );
    if (size !== undefined && (!/^\d+$/.test(size) || Number(size) !== source.size))
      throw new ApplicationError(
        "INVALID_INPUT",
        "Upload size does not match the selected file.",
        400,
      );
    this.active++;
    const deps = this.deps;
    job.abortController = new AbortController();
    const controller = job.abortController;
    const abort = () => controller.abort();
    disconnected.addEventListener("abort", abort, { once: true });
    if (disconnected.aborted) abort();
    const timeout = setTimeout(abort, UPLOAD_TIMEOUT_MS);
    let lastProgress = 0;
    deps.manager.emitJob(job, {
      status: "uploading",
      phase: "uploading",
      error: "",
      downloadedBytes: 0,
      percent: 0,
      message: "Uploading local file",
      cleanupAt: 0,
    });
    const operation = receiveLocalUpload(job, input, (bytes) => {
      if (Date.now() - lastProgress < 200) return;
      lastProgress = Date.now();
      deps.manager.emitJob(job, {
        downloadedBytes: bytes,
        percent: source.size ? (bytes / source.size) * 100 : 100,
      });
    });
    job.uploadOperation = operation;
    try {
      const sha256 = await operation;
      controller.signal.throwIfAborted();
      source.sha256 = sha256;
      deps.manager.emitJob(job, {
        status: "queued",
        phase: "queued",
        percent: null,
        downloadedBytes: source.size,
        message: "Upload complete. Waiting to inspect the file.",
      });
      deps.enqueue(job, true);
      return job;
    } catch (error) {
      if (controller.signal.aborted) await cleanupIncompleteLocalSource(job);
      const message = uploadError(error, controller.signal.aborted);
      deps.manager.emitJob(job, {
        status: controller.signal.aborted ? "cancelled" : "error",
        phase: controller.signal.aborted ? "cancelled" : "error",
        error: message,
        message,
        downloadedBytes: 0,
        percent: null,
        cleanupAt: Date.now() + UPLOAD_TIMEOUT_MS,
      });
      throw error;
    } finally {
      clearTimeout(timeout);
      disconnected.removeEventListener("abort", abort);
      job.uploadOperation = undefined;
      this.active--;
    }
  }
}

export function createLocalImports(deps: Dependencies) {
  return new LocalImports(deps);
}

function uploadError(error: unknown, cancelled: boolean) {
  return cancelled
    ? "Upload cancelled. Partial data was removed; choose or retry the file."
    : error instanceof Error
      ? error.message
      : "Upload failed. Retry the file.";
}
