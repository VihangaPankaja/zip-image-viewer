import { archivePasswordSchema } from "../../../shared/contracts.js";
import { ApplicationError, type SessionJob } from "../../domain/models.js";
import { ArchivePasswordRequired } from "../../infrastructure/archive/archivePassword.js";

// Separate from jobs so serialization and persistence cannot capture a pending secret.
const pending = new WeakMap<SessionJob, string>();
function acceptArchivePassword(job: SessionJob, password: string) {
  if (job.status !== "awaiting_password")
    throw new ApplicationError("CONFLICT", "Job is not awaiting a password.", 409);
  pending.set(job, archivePasswordSchema.parse(password));
  Object.assign(job, {
    status: "queued",
    phase: "queued",
    error: "",
    cleanupAt: 0,
    message: "Waiting to unlock the retained archive.",
  });
}

export function archivePasswordAction(
  jobs: Map<string, { job: SessionJob; confirmOversize: boolean }>,
  enqueue: (_job: SessionJob, _confirmed: boolean) => void,
) {
  return (id: string, password: string) => {
    const item = jobs.get(id);
    if (!item) throw new ApplicationError("NOT_FOUND", "Job not found.", 404);
    acceptArchivePassword(item.job, password);
    enqueue(item.job, item.confirmOversize);
    return item.job;
  };
}
export function takeArchivePassword(job: SessionJob) {
  const password = pending.get(job);
  pending.delete(job);
  return password;
}

export function waitForArchivePassword(
  job: SessionJob,
  error: unknown,
  emit: (_job: SessionJob, _patch: Partial<SessionJob>) => void,
) {
  if (!(error instanceof ArchivePasswordRequired) || job.abortController?.signal.aborted)
    return false;
  emit(job, {
    status: "awaiting_password",
    phase: "password",
    passwordProtected: true,
    extraction: undefined,
    percent: null,
    error: "",
    canPause: false,
    canResume: false,
    message: error.message,
  });
  return true;
}
