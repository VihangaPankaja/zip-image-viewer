import { useEffect, useRef, useState } from "react";
import type { ExplorerNode } from "../../components/TreeExplorer";
import { formatBytes } from "../../lib/formatterUtils";
import { planSelectionDownload, startSelectionDownload } from "../../services/selectionDownload";

function descendants(node: ExplorerNode): string[] {
  const pending = [node];
  const paths: string[] = [];
  while (pending.length) {
    const current = pending.pop();
    if (!current) break;
    paths.push(current.path);
    for (const child of current.children ?? []) pending.push(child);
  }
  return paths;
}

function toggleSubtree(root: ExplorerNode | null, node: ExplorerNode, current: Set<string>) {
  const pending = root ? [root] : [];
  let full = node;
  while (pending.length) {
    const candidate = pending.pop();
    if (candidate?.path === node.path) {
      full = candidate;
      break;
    }
    for (const child of candidate?.children ?? []) pending.push(child);
  }
  const subtree = descendants(full);
  const next = new Set(current);
  const remove = subtree.every((name) => next.has(name));
  for (const name of subtree) {
    if (remove) next.delete(name);
    else next.add(name);
  }
  // Remove selected ancestors so a deselected child cannot reappear in the export.
  const parts = node.path.split("/");
  for (let i = 1; i < parts.length; i++) next.delete(parts.slice(0, i).join("/"));
  if (node.path !== ".") next.delete(".");
  return next;
}

export function useSelectionExport(sessionId: string | undefined, root: ExplorerNode | null) {
  const [selecting, setSelecting] = useState(false);
  const [paths, setPaths] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null);
  const downloads = useRef<Array<() => void>>([]);
  useEffect(() => {
    const cleanups = downloads.current;
    setSelecting(false);
    setPaths(new Set());
    setError("");
    setMessage("");
    setBusy(false);
    return () => {
      request.current?.abort();
      cleanups.splice(0).forEach((cleanup) => cleanup());
    };
  }, [sessionId]);
  function toggle(node: ExplorerNode) {
    request.current?.abort();
    setBusy(false);
    setPaths((current) => toggleSubtree(root, node, current));
    setError("");
    setMessage("");
  }
  async function download() {
    if (!sessionId || busy || !paths.size) return;
    const selected = [...paths].filter(
      (name) =>
        name !== "." &&
        !paths.has(".") &&
        !name.split("/").some((_, i, parts) => paths.has(parts.slice(0, i).join("/"))),
    );
    if (paths.has(".")) selected.push(".");
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const plan = await planSelectionDownload(sessionId, selected, controller.signal);
      if (controller.signal.aborted) return;
      if (
        plan.requiresConfirmation &&
        !window.confirm(
          `Download ${plan.entries} entries (${formatBytes(plan.bytes)}) as a ZIP? Keep this session open until the download finishes.`,
        )
      )
        return;
      downloads.current.push(
        startSelectionDownload(sessionId, selected, plan.requiresConfirmation, setError),
      );
      setMessage("Download requested. Check your browser's downloads to track or cancel it.");
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : "Could not export selection.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return {
    selecting,
    setSelecting,
    paths,
    toggle,
    busy,
    error,
    message,
    download,
    clear: () => {
      setPaths(new Set());
      setError("");
      setMessage("");
    },
  };
}

export type SelectionExport = ReturnType<typeof useSelectionExport>;
