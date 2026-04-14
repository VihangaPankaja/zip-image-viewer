import { useCallback, useEffect, useRef, useState } from "react";

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

    async function fetchTextPreview() {
      try {
        const cached = textPreviewCacheRef.current.get(cacheKey);
        if (cached) {
          if (!cancelled) {
            setTextPreview(cached);
          }
          return;
        }

        const response = await fetch(selectedPreviewUrl);
        if (!response.ok) {
          throw new Error("Could not read this file.");
        }

        const content = await response.text();
        textPreviewCacheRef.current.set(cacheKey, content);

        if (!cancelled) {
          setTextPreview(content);
        }
      } catch (previewError) {
        if (!cancelled) {
          const message =
            previewError instanceof Error
              ? previewError.message
              : "Unknown error.";
          setTextPreview(`Preview unavailable: ${message}`);
        }
      }
    }

    fetchTextPreview();

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
