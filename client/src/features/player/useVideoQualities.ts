import { useEffect, type Dispatch, type SetStateAction } from "react";
import { workspaceRpc } from "../../services/orpcClient";
import {
  chooseVideoQuality,
  normalizeVideoQualityOptions,
  type VideoQualityOption,
} from "./videoPlaybackModel";

type VideoQualitiesParams = {
  path?: string;
  selectedKind: string;
  sessionId?: string;
  isFile: boolean;
  setOptions: Dispatch<SetStateAction<VideoQualityOption[]>>;
  setSelectedQuality: Dispatch<SetStateAction<string>>;
};

async function loadVideoQualities(sessionId: string, path: string) {
  const payload = await workspaceRpc.video.qualities.call({ sessionId, path });
  const options = normalizeVideoQualityOptions(payload.options);
  return {
    options,
    selected: chooseVideoQuality(options, payload.defaultQuality),
  };
}

export function useVideoQualities(params: VideoQualitiesParams) {
  const {
    isFile,
    path,
    selectedKind,
    sessionId,
    setOptions,
    setSelectedQuality,
  } = params;
  useEffect(() => {
    if (selectedKind !== "video" || !sessionId || !isFile) {
      setOptions([]);
      setSelectedQuality("source");
      return;
    }
    let cancelled = false;
    void loadVideoQualities(sessionId, path ?? "").then(
      ({ options, selected }) => {
        if (!cancelled) {
          setOptions(options);
          setSelectedQuality(selected);
        }
      },
      () => {
        if (!cancelled) {
          setOptions([{ id: "source", label: "Original" }]);
          setSelectedQuality("source");
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [isFile, path, selectedKind, sessionId, setOptions, setSelectedQuality]);
}
