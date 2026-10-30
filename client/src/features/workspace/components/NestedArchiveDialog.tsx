import { ArchiveInspectionFeedback } from "./ArchiveInspectionFeedback";
import { NestedChoices } from "./NestedArchiveChoices";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { workspaceRpc } from "../../../services/orpcClient";
import { useModalDialog } from "../../../hooks/useModalDialog";

type Props = {
  id: string;
  path: string;
  onClose: () => void;
  onOpen: (id: string) => Promise<void>;
};

function useNestedWork({ id, path, onClose, onOpen }: Props) {
  const [closing, setClosing] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [canceling, setCanceling] = useState(false);
  const active = useRef(false);
  const manifest = useQuery(
    workspaceRpc.nestedArchives.inspect.queryOptions({
      input: { id, path },
      retry: false,
      staleTime: 0,
    }),
  );
  const { mutateAsync: cancelArchive } = useMutation(
    workspaceRpc.nestedArchives.cancel.mutationOptions(),
  );
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      queueMicrotask(() => {
        if (!active.current) void cancelArchive({ id, path }).catch(() => undefined);
      });
    };
  }, [id, path, cancelArchive]);
  const open = useMutation(workspaceRpc.nestedArchives.open.mutationOptions());
  const { data: opened, isSuccess, reset } = open;
  useEffect(() => {
    if (!isSuccess || closing) return;
    const childId = opened.id;
    reset();
    onClose();
    void onOpen(childId);
  }, [opened, isSuccess, reset, closing, onOpen, onClose]);
  async function close() {
    open.reset();
    setClosing(true);
    active.current = false;
    setCanceling(true);
    setCancelError("");
    try {
      await cancelArchive({ id, path });
      onClose();
    } catch {
      setClosing(false);
      active.current = true;
      setCancelError("Could not cancel archive work. Try closing again.");
    } finally {
      setCanceling(false);
    }
  }
  return { manifest, open, close, canceling, cancelError };
}
export function NestedArchiveDialog(props: Props) {
  const { id, path } = props;
  const dialog = useModalDialog();
  const { manifest, open, close, canceling, cancelError } = useNestedWork(props);
  return (
    <dialog
      ref={dialog}
      className="download-dialog torrent-file-dialog"
      aria-labelledby="nested-archive-title"
      onCancel={(event) => {
        event.preventDefault();
        void close();
      }}
    >
      <div className="download-dialog-sheet archive-file-sheet">
        <header>
          <div className="panel-title-group">
            <h2 id="nested-archive-title">Open archive</h2>
            <p className="nested-archive-name" title={path}>
              {path}
            </p>
          </div>
          <button
            className="ghost-button"
            type="button"
            disabled={canceling}
            onClick={() => void close()}
          >
            {canceling ? "Canceling…" : "Close"}
          </button>
        </header>
        <ArchiveInspectionFeedback
          pending={manifest.isPending}
          error={manifest.error?.message}
          onRetry={() => void manifest.refetch()}
          label="archive"
        />
        {manifest.data ? (
          <NestedChoices
            key={manifest.data.fingerprint}
            manifest={manifest.data}
            busy={open.isPending || canceling}
            error={cancelError || open.error?.message}
            onExtract={(fileIds) =>
              open.mutate({ id, path, fingerprint: manifest.data.fingerprint, fileIds })
            }
          />
        ) : cancelError ? (
          <p role="alert">{cancelError}</p>
        ) : null}
      </div>
    </dialog>
  );
}
