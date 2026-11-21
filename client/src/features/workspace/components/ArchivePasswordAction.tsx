import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Job } from "../../../../../shared/contracts";
import { workspaceRpc, workspaceRpcClient } from "../../../services/orpcClient";
import { useModalDialog } from "../../../hooks/useModalDialog";
import { ArchivePasswordForm } from "./ArchivePasswordForm";

function PasswordDialog({ job, onClose }: { job: Job; onClose: () => void }) {
  const dialog = useModalDialog();
  const query = useQueryClient();
  const busy = job.status !== "awaiting_password";
  return (
    <dialog
      ref={dialog}
      className="download-dialog archive-password-dialog"
      aria-labelledby="archive-password-title"
      onCancel={onClose}
    >
      <div className="download-dialog-sheet">
        <header>
          <h2 id="archive-password-title">Unlock archive</h2>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="archive-password-body">
          <p className="nested-archive-name">
            {job.localFile?.name ??
              (new URL(job.url).pathname.split("/").at(-1) || "Downloaded archive")}
          </p>
          <p role="status">{job.message}</p>
          {job.status === "ready" ? (
            <p>Archive unlocked. Close this dialog to browse its files.</p>
          ) : job.status === "error" || job.status === "cancelled" ? null : (
            <ArchivePasswordForm
              busy={busy}
              onSubmit={async (password) => {
                await workspaceRpcClient.jobs.password({ id: job.id, password });
                await query.invalidateQueries({ queryKey: workspaceRpc.jobs.list.key() });
              }}
            />
          )}
        </div>
      </div>
    </dialog>
  );
}

export function ArchivePasswordAction({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {job.status === "awaiting_password" || open ? (
        <button type="button" onClick={() => setOpen(true)}>
          Enter password
        </button>
      ) : null}
      {open ? <PasswordDialog job={job} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
