import { useEffect, useRef, useState } from "react";

type SeekPreviewParams = {
  selectedKind: string;
  selectedPath: string | undefined;
  selectedQuality: string;
  sessionId: string | undefined;
  time: number | null;
};

export function useVideoSeekPreview({
  selectedKind,
  selectedPath,
  selectedQuality,
  sessionId,
  time,
}: SeekPreviewParams) {
  const [url, setUrl] = useState("");
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (
      selectedKind !== "video" ||
      !sessionId ||
      !selectedPath ||
      time == null
    ) {
      setUrl("");
      return;
    }
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      const query = new URLSearchParams({
        path: selectedPath,
        quality: selectedQuality,
        time: String(time),
        width: "260",
      });
      setUrl(`/api/sessions/${sessionId}/video/thumbnail?${query.toString()}`);
    }, 140);
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, [selectedKind, selectedPath, selectedQuality, sessionId, time]);

  return url;
}
