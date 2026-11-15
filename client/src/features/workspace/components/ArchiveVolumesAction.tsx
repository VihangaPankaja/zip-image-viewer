import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supplyVolumesInputSchema, type Job } from "../../../../../shared/contracts";
import { workspaceRpc, workspaceRpcClient } from "../../../services/orpcClient";
import { useModalDialog } from "../../../hooks/useModalDialog";

function VolumeUrlsForm({ job }: { job: Job }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const query = useQueryClient();
  const [urls, setUrls] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const busy = pending || job.status !== "awaiting_volumes";
  useEffect(() => {
    if (!busy) field.current?.focus();
  }, [busy]);
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const parsed = supplyVolumesInputSchema.safeParse({
      id: job.id,
      urls: urls
        .split(/\r?\n/)
        .map((url) => url.trim())
        .filter(Boolean),
    });
    if (!parsed.success) {
      setError("Enter up to 50 public HTTP(S) volume URLs, one per line.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await workspaceRpcClient.jobs.volumes(parsed.data);
      setUrls("");
      await query.invalidateQueries({ queryKey: workspaceRpc.jobs.list.key() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not accept these volumes.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="archive-password-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor="archive-volume-urls">Volume URLs</label>
      <textarea
        ref={field}
        id="archive-volume-urls"
        rows={4}
        value={urls}
        onChange={(event) => setUrls(event.currentTarget.value)}
        disabled={busy}
        required
        spellCheck={false}
      />
      {error ? (
        <p role="alert" className="download-confirm-error">
          {error}
        </p>
      ) : null}
      <button type="submit" className="primary-button" disabled={busy}>
        Check volumes
      </button>
    </form>
  );
}

function VolumesDialog({ job, onClose }: { job: Job; onClose: () => void }) {
  const dialog = useModalDialog();
  return (
    <dialog
      ref={dialog}
      className="download-dialog archive-password-dialog"
      aria-labelledby="archive-volumes-title"
      onCancel={onClose}
    >
      <div className="download-dialog-sheet">
        <header>
          <h2 id="archive-volumes-title">Supply archive volumes</h2>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="archive-password-body">
          <p role="status">{job.message}</p>
          <p>
            Verified parts are kept. Add the missing parts using their original filenames. Only URLs
            you supply are downloaded.
          </p>
          {job.volumes?.names.length ? (
            <p className="nested-archive-name">Supplied: {job.volumes.names.join(", ")}</p>
          ) : null}
          {job.status !== "ready" && job.status !== "cancelled" ? (
            <VolumeUrlsForm job={job} />
          ) : null}
        </div>
      </div>
    </dialog>
  );
}

export function ArchiveVolumesAction({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);
  if (job.sourceKind !== "http") return null;
  return (
    <>
      {job.status === "awaiting_volumes" || open ? (
        <button type="button" onClick={() => setOpen(true)}>
          Supply volumes
        </button>
      ) : null}
      {open ? <VolumesDialog job={job} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
