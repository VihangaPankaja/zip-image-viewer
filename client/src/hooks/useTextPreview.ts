import { useCallback, useEffect, useRef, useState } from "react";
import { loadTextPreview } from "../features/workspace/textPreviewLoader";

type TextPreviewNode = {
  path: string;
};

type UseTextPreviewParams = {
  selectedNode: TextPreviewNode | null;
  selectedKind: string;
  selectedPreviewUrl: string;
  sessionId: string;
};

export function useTextPreview({
  selectedNode,
  selectedKind,
  selectedPreviewUrl,
  sessionId,
}: UseTextPreviewParams) {
  const [textPreview, setTextPreview] = useState("");
  const textPreviewCacheRef = useRef(new Map<string, string>());

  const resetTextPreview = useCallback(() => {
    setTextPreview("");
  }, []);

  const clearTextPreviewCache = useCallback(() => {
    textPreviewCacheRef.current.clear();
  }, []);

  useEffect(() => {
    if (!selectedNode || !sessionId || selectedKind !== "text") {
      setTextPreview("");
      return;
    }

    let cancelled = false;
    const cacheKey = `${sessionId}:${selectedNode.path}`;

    void loadTextPreview({
      cache: textPreviewCacheRef.current,
      cacheKey,
      previewUrl: selectedPreviewUrl,
    }).then(
      (content) => {
        if (!cancelled) setTextPreview(content);
      },
      (previewError: unknown) => {
        if (!cancelled) {
          const message =
            previewError instanceof Error
              ? previewError.message
              : "Unknown error.";
          setTextPreview(`Preview unavailable: ${message}`);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [selectedKind, selectedNode, selectedPreviewUrl, sessionId]);

  return {
    textPreview,
    resetTextPreview,
    clearTextPreviewCache,
  };
}
