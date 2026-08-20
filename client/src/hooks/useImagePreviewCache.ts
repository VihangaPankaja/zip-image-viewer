import { useCallback, useEffect, useRef, useState } from "react";
import { getImageCacheKey } from "../lib/archiveUiUtils";
import { buildFileUrl } from "../lib/fileUrl";

type ImagePreviewNode = {
  path: string;
};

type ImagePreviewCacheEntry = {
  objectUrl?: string;
  promise?: Promise<string>;
  touchedAt: number;
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
): Promise<string> {
  try {
    const response = await fetch(requestUrl);
    if (!response.ok) {
      throw new Error("Could not load image preview.");
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    cache.set(cacheKey, { objectUrl, touchedAt: Date.now() });
    return objectUrl;
  } catch (error) {
    cache.delete(cacheKey);
    throw error;
  }
}

function getCachedPreview(
  cache: Map<string, ImagePreviewCacheEntry>,
  cacheKey: string,
): string | Promise<string> | null {
  const existing = cache.get(cacheKey);
  return existing?.objectUrl ?? existing?.promise ?? null;
}

export function useImagePreviewCache({
  sessionId,
  selectedNode,
  selectedKind,
  previewQuality,
  selectedImagePreviewUrl,
}: UseImagePreviewCacheParams) {
  const [selectedImageSrc, setSelectedImageSrc] = useState("");
  const imagePreviewCacheRef = useRef<Map<string, ImagePreviewCacheEntry>>(
    new Map(),
  );

  const resetSelectedImageSrc = useCallback(() => {
    setSelectedImageSrc("");
  }, []);

  const clearImagePreviewCache = useCallback(() => {
    clearPreviewCache(imagePreviewCacheRef.current);
  }, []);

  const loadImagePreview = useCallback(
    async (imagePath: string, quality: string) => {
      if (!sessionId || !imagePath) {
        return "";
      }

      const cacheKey = getImageCacheKey(sessionId, imagePath, quality);
      const cached = getCachedPreview(imagePreviewCacheRef.current, cacheKey);
      if (cached) {
        return cached;
      }
      const request = requestImagePreview(
        imagePreviewCacheRef.current,
        cacheKey,
        buildFileUrl(sessionId, imagePath, { imagePreview: true, quality }),
      );

      imagePreviewCacheRef.current.set(cacheKey, {
        promise: request,
        touchedAt: Date.now(),
      });

      return request;
    },
    [sessionId],
  );

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
