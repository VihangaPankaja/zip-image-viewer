import { useEffect, useRef, useState } from "react";
import { buildAudioQueue, shuffleAudioQueue, type AudioTrack } from "./audioQueue";
import { useAudioElement } from "./useAudioElement";
import type { PreviewNode } from "../workspace/types";

export type AudioWorkspace = {
  sessionId: string;
  files: readonly PreviewNode[];
  selectedPath: string;
  onSelect: (path: string) => void;
};

function useAudioSelection(
  workspace: AudioWorkspace,
  element: ReturnType<typeof useAudioElement>,
  setQueue: React.Dispatch<React.SetStateAction<AudioTrack[]>>,
  shuffle: boolean,
) {
  const ownedSession = useRef("");
  const lastSelection = useRef("");
  const { sessionId, files, selectedPath } = workspace;
  const { audioRef, load, track } = element;
  useEffect(() => {
    const changedSession = ownedSession.current !== sessionId;
    if (changedSession) {
      ownedSession.current = sessionId;
      setQueue([]);
      load(null, false);
    }
    if (!sessionId) return;
    const selection = JSON.stringify([sessionId, selectedPath]);
    if (!changedSession && lastSelection.current === selection) return;
    lastSelection.current = selection;
    const tracks = buildAudioQueue(sessionId, files);
    const selected = tracks.find(({ path }) => path === selectedPath);
    if (!selected || (!changedSession && selected.url === track?.url)) return;
    setQueue((current) =>
      changedSession || !current.length
        ? shuffle
          ? shuffleAudioQueue(tracks, selected.path)
          : tracks
        : current.some(({ path }) => path === selected.path)
          ? current
          : [...current, selected],
    );
    load(selected, !changedSession && audioRef.current?.paused === false);
  }, [sessionId, files, selectedPath, load, shuffle, track?.url, audioRef, setQueue]);
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio?.pause();
      audio?.removeAttribute("src");
      audio?.load();
    };
  }, [audioRef]);
  return () => {
    const tracks = buildAudioQueue(sessionId, files);
    const first = tracks.find((item) => item.path === selectedPath) ?? tracks.at(0);
    setQueue(shuffle ? shuffleAudioQueue(tracks, first?.path ?? "") : tracks);
    if (first) {
      load(first, false);
      workspace.onSelect(first.path);
    }
  };
}

export function useAudioPlayback(workspace: AudioWorkspace) {
  const element = useAudioElement();
  const [queue, setQueue] = useState<AudioTrack[]>([]);
  const [repeat, setRepeat] = useState("off");
  const [shuffle, setShuffle] = useState(false);
  const restoreQueue = useAudioSelection(workspace, element, setQueue, shuffle);
  const choose = (next: AudioTrack, keepPlaying?: boolean) => {
    element.load(next, keepPlaying ?? element.audioRef.current?.paused === false);
    if (workspace.selectedPath === element.track?.path) workspace.onSelect(next.path);
  };
  const index = queue.findIndex(({ path }) => path === element.track?.path);
  const neighbor = (direction: number): AudioTrack | undefined => {
    if (!queue.length || index < 0) return undefined;
    return repeat === "all"
      ? queue[(index + direction + queue.length) % queue.length]
      : queue[index + direction];
  };
  const move = (direction: number, keepPlaying?: boolean) => {
    const next = neighbor(direction);
    if (next) choose(next, keepPlaying);
  };
  const ended = () => {
    if (repeat === "one") {
      element.seek(0);
      element.play();
    } else move(1, true);
    element.sync();
  };
  const remove = (path: string) => {
    const next = queue.filter((item) => item.path !== path);
    if (element.track?.path === path) {
      const replacement: AudioTrack | undefined = next.at(Math.min(index, next.length - 1));
      element.load(replacement ?? null, element.audioRef.current?.paused === false);
      if (replacement) workspace.onSelect(replacement.path);
    }
    setQueue(next);
  };
  const toggleShuffle = () => {
    setShuffle(!shuffle);
    if (!shuffle) setQueue(shuffleAudioQueue(queue, element.track?.path || ""));
    else {
      const order = new Map(workspace.files.map((file, position) => [file.path, position]));
      setQueue(
        [...queue].sort(
          (left, right) => (order.get(left.path) ?? 0) - (order.get(right.path) ?? 0),
        ),
      );
    }
  };
  const reorder = (path: string, direction: number) => {
    const next = [...queue];
    const position = next.findIndex((item) => item.path === path);
    const target = position + direction;
    if (position < 0 || target < 0 || target >= next.length) return;
    [next[position], next[target]] = [next[target], next[position]];
    setQueue(next);
  };
  return {
    ...element,
    restoreQueue,
    queue,
    repeat,
    setRepeat,
    shuffle,
    toggleShuffle,
    choose,
    move,
    remove,
    reorder,
    ended,
    canPrevious: Boolean(neighbor(-1)),
    canNext: Boolean(neighbor(1)),
    retry: () => element.load(element.track, false),
  };
}
export type AudioPlayback = ReturnType<typeof useAudioPlayback>;
