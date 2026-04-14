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
    imagePreviewCacheRef.current.forEach((value) => {
      if (value?.objectUrl) {
        URL.revokeObjectURL(value.objectUrl);
      }
    });
    imagePreviewCacheRef.current.clear();
  }, []);

  const loadImagePreview = useCallback(
    async (imagePath: string, quality: string) => {
      if (!sessionId || !imagePath) {
        return "";
      }

      const cacheKey = getImageCacheKey(sessionId, imagePath, quality);
      const existing = imagePreviewCacheRef.current.get(cacheKey);

      if (existing?.objectUrl) {
        return existing.objectUrl;
      }

      if (existing?.promise) {
        return existing.promise;
      }

      const request = fetch(
        buildFileUrl(sessionId, imagePath, { imagePreview: true, quality }),
      )
        .then(async (response) => {
          if (!response.ok) {
            throw new Error("Could not load image preview.");
          }

          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);

          imagePreviewCacheRef.current.set(cacheKey, {
            objectUrl,
            touchedAt: Date.now(),
          });

          return objectUrl;
        })
        .catch((error) => {
          imagePreviewCacheRef.current.delete(cacheKey);
          throw error;
        });

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
