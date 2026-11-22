import {
  useEffect,
  useRef,
  useState,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { localImportInputSchema } from "../../../../shared/contracts";
import { initializeLocalImport, uploadLocalFile } from "../../services/localImports";
import { workspaceRpcClient } from "../../services/orpcClient";

export type LocalImportItem = {
  id: string;
  name: string;
  size: number;
  sent: number;
  status: "waiting" | "uploading" | "error" | "cancelled";
  error: string;
};
type PendingImport = { file: File; controller: AbortController | null; initialized: boolean };

function createImportId() {
  // The self-hosted app also runs on plain HTTP, where randomUUID is unavailable.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validateFiles(files: File[], count: number) {
  if (files.length + count > 50) throw new Error("Choose up to 50 local files at a time.");
  return files.map((file) => ({
    file,
    input: localImportInputSchema.parse({
      id: createImportId(),
      name: file.name,
      size: file.size,
    }),
  }));
}

async function cancelLocalImport(id: string) {
  await workspaceRpcClient.jobs.cancel({ id }).catch(() => undefined);
}

export function useLocalImports() {
  const [items, setItems] = useState<LocalImportItem[]>([]);
  const pending = useRef(new Map<string, PendingImport>());
  const chain = useRef(Promise.resolve());
  const queryClient = useQueryClient();
  const patch = (id: string, update: Partial<LocalImportItem>) =>
    setItems((previous) =>
      previous.map((item) => (item.id === id ? { ...item, ...update } : item)),
    );
  async function send(id: string) {
    const entry = pending.current.get(id);
    if (!entry || entry.controller) return;
    const controller = new AbortController();
    entry.controller = controller;
    patch(id, { status: "uploading", sent: 0, error: "" });
    try {
      const job = await initializeLocalImport(
        { id, name: entry.file.name, size: entry.file.size },
        AbortSignal.timeout(30_000),
      );
      entry.initialized = true;
      await queryClient.invalidateQueries();
      controller.signal.throwIfAborted();
      if (!job.localFile?.complete)
        await uploadLocalFile(id, entry.file, controller.signal, (sent) => patch(id, { sent }));
      else if (job.status === "cancelled" || job.status === "error")
        await workspaceRpcClient.jobs.retry({ id });
      pending.current.delete(id);
      setItems((previous) => previous.filter((item) => item.id !== id));
    } catch (failure) {
      if (controller.signal.aborted) await cancelLocalImport(id);
      patch(id, {
        status: controller.signal.aborted ? "cancelled" : "error",
        error: failure instanceof Error ? failure.message : "Upload failed.",
      });
    } finally {
      entry.controller = null;
      await queryClient.invalidateQueries();
    }
  }
  function schedule(id: string) {
    patch(id, { status: "waiting", error: "" });
    chain.current = chain.current.then(() => send(id));
  }
  function cancel(id: string) {
    const entry = pending.current.get(id);
    if (!entry) return false;
    const dismiss = !entry.controller || entry.controller.signal.aborted;
    entry.controller?.abort();
    if (dismiss) {
      pending.current.delete(id);
      setItems((previous) => previous.filter((item) => item.id !== id));
    }
    if (entry.initialized)
      void cancelLocalImport(id).finally(() => {
        void queryClient.invalidateQueries();
      });
    return true;
  }
  useEffect(() => {
    const entries = pending.current;
    return () => {
      for (const entry of entries.values()) entry.controller?.abort();
    };
  }, []);
  return {
    items,
    cancel,
    retry: schedule,
    ...useLocalFilePicker(pending, setItems, schedule),
  };
}

function useLocalFilePicker(
  pending: RefObject<Map<string, PendingImport>>,
  setItems: Dispatch<SetStateAction<LocalImportItem[]>>,
  schedule: (_id: string) => void,
) {
  const [error, setError] = useState("");
  return {
    error,
    add(files: File[]) {
      setError("");
      if (!files.length) return;
      let inputs;
      try {
        inputs = validateFiles(files, pending.current.size);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Invalid local file.");
        return;
      }
      for (const { file, input } of inputs) {
        const id = input.id;
        pending.current.set(id, { file, controller: null, initialized: false });
        setItems((previous) => [
          ...previous,
          { id, name: file.name, size: file.size, sent: 0, status: "waiting", error: "" },
        ]);
        schedule(id);
      }
    },
  };
}
