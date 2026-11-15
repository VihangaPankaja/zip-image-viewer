import { ArchiveInspectionFeedback } from "./ArchiveInspectionFeedback";
import { NestedChoices } from "./NestedArchiveChoices";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { workspaceRpc, workspaceRpcClient } from "../../../services/orpcClient";
import { useModalDialog } from "../../../hooks/useModalDialog";
import type { ArchiveManifest } from "../../../../../shared/contracts";
import { ArchivePasswordForm } from "./ArchivePasswordForm";

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
  const { manifest, unlock } = useNestedManifest(id, path, active);
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
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  async function extract(fileIds: string[], password?: string) {
    if (!manifest.data) return;
    setOpening(true);
    setOpenError("");
    try {
      const child = await workspaceRpcClient.nestedArchives.open({
        id,
        path,
        fingerprint: manifest.data.fingerprint,
        fileIds,
        password,
      });
      if (active.current) {
        onClose();
        await onOpen(child.id);
      }
    } catch (error) {
      if (active.current)
        setOpenError(error instanceof Error ? error.message : "Could not open archive.");
    } finally {
      setOpening(false);
    }
  }
  async function close() {
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
  return { manifest, extract, unlock, opening, openError, close, closing, canceling, cancelError };
}
function useNestedManifest(id: string, path: string, active: RefObject<boolean>) {
  const [unlocked, setUnlocked] = useState<ArchiveManifest>();
  const [unlockError, setUnlockError] = useState<Error | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const query = useQuery(
    workspaceRpc.nestedArchives.inspect.queryOptions({
      input: { id, path },
      retry: false,
      staleTime: 0,
    }),
  );
  const manifest = {
    ...query,
    data: unlocked ?? query.data,
    error: unlocked ? null : (unlockError ?? query.error),
    isPending: unlocking || query.isPending,
  };
  async function unlock(password: string) {
    setUnlocking(true);
    setUnlockError(null);
    try {
      const data = await workspaceRpcClient.nestedArchives.inspect({ id, path, password });
      if (active.current) setUnlocked(data);
    } catch (error) {
      if (active.current)
        setUnlockError(error instanceof Error ? error : new Error("Could not inspect archive."));
    } finally {
      setUnlocking(false);
    }
  }
  return { manifest, unlock };
}

export function NestedArchiveDialog(props: Props) {
  const { path } = props;
  const dialog = useModalDialog();
  const work = useNestedWork(props);
  const { manifest, extract, opening, openError, close, canceling, cancelError } = work;
  const [selection, setSelection] = useState<string[]>();
  const needsPassword =
    manifest.error && "code" in manifest.error && manifest.error.code === "PASSWORD_REQUIRED";
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
        {!needsPassword && !selection ? (
          <ArchiveInspectionFeedback
            pending={manifest.isPending}
            error={manifest.error?.message}
            onRetry={() => void manifest.refetch()}
            label="archive"
          />
        ) : null}
        {needsPassword || selection ? (
          <NestedPasswordEntry
            work={work}
            selection={selection}
            onBack={() => setSelection(undefined)}
          />
        ) : manifest.data ? (
          <NestedChoices
            key={manifest.data.fingerprint}
            manifest={manifest.data}
            busy={opening || canceling}
            error={cancelError || openError}
            onExtract={(fileIds) => {
              if (manifest.data?.passwordProtected) setSelection(fileIds);
              else void extract(fileIds);
            }}
          />
        ) : cancelError ? (
          <p role="alert">{cancelError}</p>
        ) : null}
      </div>
    </dialog>
  );
}

function NestedPasswordEntry({
  work,
  selection,
  onBack,
}: {
  work: ReturnType<typeof useNestedWork>;
  selection?: string[];
  onBack: () => void;
}) {
  const { manifest, extract, unlock, opening, openError, closing } = work;
  return (
    <div className="archive-password-body">
      <p role="status">
        {openError ||
          manifest.error?.message ||
          "Enter the password again to open the selected files."}
      </p>
      <ArchivePasswordForm
        busy={opening || closing || manifest.isPending}
        onSubmit={async (password) => {
          if (selection) await extract(selection, password);
          else await unlock(password);
        }}
      />
      {selection ? (
        <button type="button" className="ghost-button" disabled={opening} onClick={() => onBack()}>
          Back to files
        </button>
      ) : null}
    </div>
  );
}
