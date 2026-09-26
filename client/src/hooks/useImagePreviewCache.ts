import { useCallback, useEffect, useRef, useState } from "react";
import { getImageCacheKey } from "../lib/archiveUiUtils";
import { buildFileUrl } from "../lib/fileUrl";

type ImagePreviewNode = {
  path: string;
};

type ImagePreviewCacheEntry = {
  objectUrl?: string;
  promise?: Promise<string>;
};

type UseImagePreviewCacheParams = {
  sessionId: string;
  selectedNode: ImagePreviewNode | null;
  selectedKind: string;
  previewQuality: string;
  selectedImagePreviewUrl: string;
};

function clearPreviewCache(cache: Map<string, ImagePreviewCacheEntry>): void {
  cache.forEach((entry) => {
    if (entry.objectUrl) {
      URL.revokeObjectURL(entry.objectUrl);
    }
  });
  cache.clear();
}

async function requestImagePreview(
  cache: Map<string, ImagePreviewCacheEntry>,
  cacheKey: string,
  requestUrl: string,
  entry: ImagePreviewCacheEntry,
): Promise<string> {
  try {
    const response = await fetch(requestUrl);
    if (!response.ok) {
      throw new Error("Could not load image preview.");
    }
    const blob = await response.blob();
    // A cleared session must not be repopulated by an older in-flight request.
    if (cache.get(cacheKey) !== entry) return "";
    const objectUrl = URL.createObjectURL(blob);
    entry.objectUrl = objectUrl;
    return objectUrl;
  } catch (error) {
    if (cache.get(cacheKey) === entry) cache.delete(cacheKey);
    throw error;
  }
}

function useImageCache(sessionId: string) {
  const imagePreviewCacheRef = useRef<Map<string, ImagePreviewCacheEntry>>(
    new Map(),
  );

  const clearImagePreviewCache = useCallback(() => {
    clearPreviewCache(imagePreviewCacheRef.current);
  }, []);

  const loadImagePreview = useCallback(
    async (imagePath: string, quality: string) => {
      if (!sessionId || !imagePath) {
        return "";
      }

      const cacheKey = getImageCacheKey(sessionId, imagePath, quality);
      const cache = imagePreviewCacheRef.current;
      const existing = cache.get(cacheKey);
      const cached = existing?.objectUrl ?? existing?.promise;
      if (cached) {
        return cached;
      }
      const entry: ImagePreviewCacheEntry = {};
      cache.set(cacheKey, entry);
      entry.promise = requestImagePreview(
        cache,
        cacheKey,
        buildFileUrl(sessionId, imagePath, { imagePreview: true, quality }),
        entry,
      );
      return entry.promise;
    },
    [sessionId],
  );

  useEffect(() => clearImagePreviewCache, [clearImagePreviewCache, sessionId]);
  return { clearImagePreviewCache, loadImagePreview };
}

export function useImagePreviewCache({
  sessionId,
  selectedNode,
  selectedKind,
  previewQuality,
  selectedImagePreviewUrl,
}: UseImagePreviewCacheParams) {
  const [selectedImageSrc, setSelectedImageSrc] = useState("");
  const { clearImagePreviewCache, loadImagePreview } = useImageCache(sessionId);
  const resetSelectedImageSrc = useCallback(() => setSelectedImageSrc(""), []);

  useEffect(() => {
    if (!selectedNode || !sessionId || selectedKind !== "image") {
      setSelectedImageSrc("");
      return;
    }

    let cancelled = false;

    loadImagePreview(selectedNode.path, previewQuality)
      .then((objectUrl) => {
        if (!cancelled) {
          setSelectedImageSrc(objectUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedImageSrc(selectedImagePreviewUrl);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    loadImagePreview,
    previewQuality,
    selectedImagePreviewUrl,
    selectedKind,
    selectedNode,
    sessionId,
  ]);

  return {
    selectedImageSrc,
    resetSelectedImageSrc,
    clearImagePreviewCache,
    loadImagePreview,
  };
}
