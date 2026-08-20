import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { getImageNavigationTarget } from "../features/workspace/imageNavigation";

type KeyboardSettings = {
  jumpSeconds?: number;
  rateStep?: number;
};

type UseKeyboardShortcutsParams = {
  keyboardSettings: KeyboardSettings;
  selectedKind: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  videoShellRef: RefObject<HTMLDivElement | null>;
  setVideoVolume: Dispatch<SetStateAction<number>>;
  setVideoPlaybackRate: Dispatch<SetStateAction<number>>;
  currentImageIndex: number;
  nextImagePath: string;
  previousImagePath: string;
  currentFolderImages: string[];
  slideshowOpen: boolean;
  setSelectedPath: Dispatch<SetStateAction<string>>;
  setSlideshowOpen: Dispatch<SetStateAction<boolean>>;
};

export function useKeyboardShortcuts({
  keyboardSettings,
  selectedKind,
  videoRef,
  videoShellRef,
  setVideoVolume,
  setVideoPlaybackRate,
  currentImageIndex,
  nextImagePath,
  previousImagePath,
  currentFolderImages,
  slideshowOpen,
  setSelectedPath,
  setSlideshowOpen,
}: UseKeyboardShortcutsParams) {
  useEffect(() => {
    const context = {
      currentFolderImages,
      currentImageIndex,
      keyboardSettings,
      nextImagePath,
      previousImagePath,
      selectedKind,
      setSelectedPath,
      setSlideshowOpen,
      setVideoPlaybackRate,
      setVideoVolume,
      slideshowOpen,
      videoRef,
      videoShellRef,
    };
    const onKeyDown = (event: KeyboardEvent) =>
      handleKeyboardShortcut(event, context);

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    currentFolderImages,
    currentImageIndex,
    keyboardSettings,
    nextImagePath,
    previousImagePath,
    selectedKind,
    setSelectedPath,
    setSlideshowOpen,
    setVideoPlaybackRate,
    setVideoVolume,
    slideshowOpen,
    videoRef,
    videoShellRef,
  ]);
}

function handleKeyboardShortcut(
  event: KeyboardEvent,
  context: UseKeyboardShortcutsParams,
): void {
  if (isInteractiveTarget(document.activeElement)) {
    return;
  }
  if (handleVideoShortcut(event, context)) {
    return;
  }
  handleImageShortcut(event, context);
}

function isInteractiveTarget(element: Element | null): boolean {
  return Boolean(
    element?.matches(
      "a[href], audio, button, input, select, summary, textarea, video, [contenteditable]:not([contenteditable='false'])",
    ),
  );
}

function handleVideoShortcut(
  event: KeyboardEvent,
  context: UseKeyboardShortcutsParams,
): boolean {
  const player = context.videoRef.current;
  if (context.selectedKind !== "video" || !player) {
    return false;
  }
  const jump = Math.max(1, Number(context.keyboardSettings.jumpSeconds) || 5);
  const rateStep = Math.max(
    0.05,
    Number(context.keyboardSettings.rateStep) || 0.25,
  );
  const key = event.key.toLowerCase();
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    const direction = event.key === "ArrowRight" ? 1 : -1;
    player.currentTime = Math.max(
      0,
      (player.currentTime || 0) + jump * direction,
    );
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    const direction = event.key === "ArrowUp" ? 1 : -1;
    const nextVolume = Math.max(
      0,
      Math.min(1, (player.volume || 0) + 0.05 * direction),
    );
    player.volume = nextVolume;
    context.setVideoVolume(nextVolume);
  } else if (event.key === "]" || event.key === "[") {
    const direction = event.key === "]" ? 1 : -1;
    const nextRate = Math.max(
      0.25,
      Math.min(3, (player.playbackRate || 1) + rateStep * direction),
    );
    player.playbackRate = nextRate;
    context.setVideoPlaybackRate(nextRate);
  } else if (key === "f") {
    toggleFullscreen(context.videoShellRef.current);
  } else {
    return false;
  }
  event.preventDefault();
  return true;
}

function toggleFullscreen(shell: HTMLDivElement | null): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
    return;
  }
  void shell?.requestFullscreen?.().catch(() => undefined);
}

function handleImageShortcut(
  event: KeyboardEvent,
  context: UseKeyboardShortcutsParams,
): void {
  const { currentFolderImages, currentImageIndex, slideshowOpen } = context;
  if (currentImageIndex === -1) {
    if (event.key === "Escape") {
      context.setSlideshowOpen(false);
    }
    return;
  }
  const isBoundaryKey = event.key === "Home" || event.key === "End";
  const target =
    !isBoundaryKey || slideshowOpen
      ? getImageNavigationTarget(
          event.key,
          currentFolderImages,
          currentImageIndex,
          context.nextImagePath,
          context.previousImagePath,
        )
      : "";
  if (target) {
    event.preventDefault();
    context.setSelectedPath(target);
  }
  if (
    currentImageIndex !== -1 &&
    !slideshowOpen &&
    context.selectedKind === "image" &&
    (event.key === "Enter" || event.key.toLowerCase() === "f")
  ) {
    event.preventDefault();
    context.setSlideshowOpen(true);
  }
  if (event.key === "Escape") {
    event.preventDefault();
    context.setSlideshowOpen(false);
  }
}
