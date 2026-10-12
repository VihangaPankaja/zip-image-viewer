import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { workspaceRpc } from "../../../services/orpcClient";
import { useModalDialog } from "../../../hooks/useModalDialog";
import { formatTransferBytes } from "../../../lib/formatterUtils";
import type { SessionStorage } from "../../../../../shared/contracts";

type Props = {
  id: string;
  onClose: () => void;
  onDeleted: () => Promise<void>;
};
function useStorageActions({ id, onClose, onDeleted }: Props) {
  const client = useQueryClient();
  const clear = useMutation(workspaceRpc.storage.clear.mutationOptions());
  const pin = useMutation(workspaceRpc.storage.pin.mutationOptions());
  const remove = useMutation(workspaceRpc.sessions.remove.mutationOptions());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function perform(action: () => Promise<unknown>, success: string) {
    setError("");
    setMessage("");
    try {
      await action();
      await client.invalidateQueries();
      setMessage(success);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update storage.",
      );
    }
  }
  return {
    busy: clear.isPending || pin.isPending || remove.isPending,
    message,
    error,
    clear: () =>
      void perform(
        () => clear.mutateAsync({ id }),
        "Cache cleared. Original files kept.",
      ),
    pin: (pinned: boolean) =>
      void perform(
        () => pin.mutateAsync({ id, pinned }),
        pinned
          ? "Session kept until the server stops."
          : "Session is temporary again.",
      ),
    remove: () =>
      void perform(async () => {
        await remove.mutateAsync({ id });
        await onDeleted();
        onClose();
      }, ""),
  };
}
type Actions = ReturnType<typeof useStorageActions>;

export function SessionStorageDialog({ id, onClose, onDeleted }: Props) {
  const dialog = useModalDialog();
  const actions = useStorageActions({ id, onClose, onDeleted });
  const storage = useQuery(
    workspaceRpc.storage.get.queryOptions({ input: { id }, retry: false }),
  );
  const data = storage.data;
  return (
    <dialog
      ref={dialog}
      className="download-dialog storage-dialog"
      aria-labelledby="storage-title"
      onCancel={(event) => {
        if (actions.busy) event.preventDefault();
        else onClose();
      }}
    >
      <div className="storage-dialog-content">
        <header>
          <h2 id="storage-title">Session storage</h2>
          <button
            className="ghost-button"
            type="button"
            onClick={onClose}
            disabled={actions.busy}
          >
            Close
          </button>
        </header>
        {storage.isPending ? <p role="status">Measuring storage…</p> : null}
        {storage.error ? <p role="alert">{storage.error.message}</p> : null}
        {data ? (
          <>
            <dl className="storage-totals">
              <div>
                <dt>Original files</dt>
                <dd>{formatTransferBytes(data.originalsBytes)}</dd>
              </div>
              <div>
                <dt>Previews & thumbnails</dt>
                <dd>{formatTransferBytes(data.previewsBytes)}</dd>
              </div>
              <div>
                <dt>Transcodes & remuxes</dt>
                <dd>{formatTransferBytes(data.transcodesBytes)}</dd>
              </div>
            </dl>
            <StorageRetention data={data} actions={actions} />
            <button
              className="ghost-button"
              type="button"
              disabled={actions.busy}
              onClick={actions.clear}
            >
              Clear preview & transcode cache
            </button>
            <p>
              Deletes generated media only. Originals stay available and
              previews regenerate when needed. Close playback before clearing.
            </p>
            <StorageDeletion retained={data.retained} actions={actions} />
          </>
        ) : null}
        {actions.message ? <p role="status">{actions.message}</p> : null}
        {actions.error ? <p role="alert">{actions.error}</p> : null}
      </div>
    </dialog>
  );
}

function StorageRetention({
  data,
  actions,
}: {
  data: SessionStorage;
  actions: Actions;
}) {
  if (data.retained)
    return (
      <p>
        Retained torrent. Files survive viewer close, expiry and server restart
        until you delete them.
      </p>
    );
  return (
    <>
      <label className="storage-pin">
        <input
          type="checkbox"
          checked={data.pinned}
          disabled={actions.busy}
          onChange={(event) => actions.pin(event.target.checked)}
        />
        Keep until the server stops
      </label>
      <p>
        {data.pinned
          ? "Closing the viewer and expiry keep these files. Server shutdown removes them."
          : "Temporary session. Closing the session, expiry or server shutdown removes its files."}
      </p>
    </>
  );
}

function StorageDeletion({
  retained,
  actions,
}: {
  retained: boolean;
  actions: Actions;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!confirmDelete)
    return (
      <button
        className="ghost-button storage-delete"
        type="button"
        disabled={actions.busy}
        onClick={() => setConfirmDelete(true)}
      >
        Delete session files…
      </button>
    );
  return (
    <section aria-label="Confirm file deletion">
      <p>
        {retained
          ? "This removes the retained torrent, its queue entry and all downloaded files, including files needed to download skipped items later."
          : "This deletes all original files and generated media in this session."}{" "}
        This cannot be undone.
      </p>
      <button
        className="ghost-button"
        type="button"
        disabled={actions.busy}
        onClick={() => setConfirmDelete(false)}
      >
        Keep files
      </button>
      <button
        className="ghost-button storage-delete"
        type="button"
        disabled={actions.busy}
        onClick={actions.remove}
      >
        Delete permanently
      </button>
    </section>
  );
}
