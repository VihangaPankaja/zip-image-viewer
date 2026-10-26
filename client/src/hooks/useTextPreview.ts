import { useCallback, useEffect, useRef, useState } from "react";
import { loadTextPreview } from "../features/workspace/textPreviewLoader";
import type { TextPreviewChunk } from "../../../shared/contracts";

type UseTextPreviewParams = {
  selectedNode: { path: string } | null;
  selectedKind: string;
  selectedPreviewUrl: string;
  sessionId: string;
};

type PreviewResult = {
  owner: string;
  offset: number;
  chunk: TextPreviewChunk | null;
  error: string;
};
export type TextPreviewState = {
  chunk: TextPreviewChunk | null;
  error: string;
  loading: boolean;
  loadOffset: (offset: number) => void;
};

export function useTextPreview({
  selectedNode,
  selectedKind,
  selectedPreviewUrl,
  sessionId,
}: UseTextPreviewParams) {
  const owner =
    selectedKind === "text" && selectedNode && sessionId
      ? JSON.stringify([sessionId, selectedNode.path, selectedPreviewUrl])
      : "";
  const [page, setPage] = useState({ owner: "", offset: 0 });
  const [result, setResult] = useState<PreviewResult | null>(null);
  const cache = useRef(new Map<string, TextPreviewChunk>());
  const active = useRef<AbortController | null>(null);
  const offset = page.owner === owner ? page.offset : 0;
  const resetTextPreview = useCallback(() => {
    active.current?.abort();
    setResult(null);
    setPage({ owner: "", offset: 0 });
  }, []);
  const clearTextPreviewCache = useCallback(() => {
    active.current?.abort();
    cache.current.clear();
    setResult(null);
  }, []);
  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    active.current = controller;
    void loadTextPreview({
      cache: cache.current,
      cacheKey: owner,
      previewUrl: selectedPreviewUrl,
      offset,
      signal: controller.signal,
    }).then(
      (chunk) => {
        if (!controller.signal.aborted) setResult({ owner, offset, chunk, error: "" });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            owner,
            offset,
            chunk: null,
            error: error instanceof Error ? error.message : "Could not read this file.",
          });
      },
    );
    return () => controller.abort();
  }, [owner, selectedPreviewUrl, offset]);
  const selected = owner && result?.owner === owner ? result : null;
  const current = selected?.offset === offset ? selected : null;
  const textPreview: TextPreviewState = {
    chunk: (current ?? selected)?.chunk ?? null,
    error: current?.error ?? "",
    loading: !!owner && !current,
    loadOffset: (nextOffset) => setPage({ owner, offset: nextOffset }),
  };
  return { textPreview, resetTextPreview, clearTextPreviewCache };
}
