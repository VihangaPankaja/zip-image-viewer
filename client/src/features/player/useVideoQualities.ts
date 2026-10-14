import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { workspaceRpc } from "../../services/orpcClient";
import type { VideoMediaTrack } from "../../../../shared/contracts";
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
    audioTracks: payload.audioTracks ?? [],
    subtitleTracks: payload.subtitleTracks ?? [],
  };
}

export function useVideoQualities(params: VideoQualitiesParams) {
  const [loadedFile, setLoadedFile] = useState("");
  const [audioTracks, setAudioTracks] = useState<VideoMediaTrack[]>([]);
  const [subtitleTracks, setSubtitleTracks] = useState<VideoMediaTrack[]>([]);
  const {
    isFile,
    path,
    selectedKind,
    sessionId,
    setOptions,
    setSelectedQuality,
  } = params;
  useEffect(() => {
    setLoadedFile("");
    setAudioTracks([]);
    setSubtitleTracks([]);
    if (selectedKind !== "video" || !sessionId || !isFile) {
      setOptions([]);
      setSelectedQuality("source");
      return;
    }
    let cancelled = false;
    void loadVideoQualities(sessionId, path ?? "").then(
      ({ options, selected, audioTracks, subtitleTracks }) => {
        if (!cancelled) {
          setOptions(options);
          setSelectedQuality(selected);
          setAudioTracks(audioTracks);
          setSubtitleTracks(subtitleTracks);
          setLoadedFile(JSON.stringify([sessionId, path]));
        }
      },
      () => {
        if (!cancelled) {
          setOptions([{ id: "source", label: "Original" }]);
          setSelectedQuality("source");
          setLoadedFile(JSON.stringify([sessionId, path]));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [isFile, path, selectedKind, sessionId, setOptions, setSelectedQuality]);
  const ready =
    selectedKind === "video" &&
    loadedFile === JSON.stringify([sessionId, path]);
  return { ready, audioTracks, subtitleTracks };
}
