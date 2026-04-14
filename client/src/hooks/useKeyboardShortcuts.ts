import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

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
    function onKeyDown(event: KeyboardEvent) {
      const activeElement = document.activeElement;
      const activeTag = activeElement?.tagName;
      if (
        activeTag === "INPUT" ||
        activeTag === "TEXTAREA" ||
        activeTag === "SELECT" ||
        activeElement?.closest?.(".custom-dropdown-shell")
      ) {
        return;
      }

      if (selectedKind === "video" && videoRef.current) {
        const player = videoRef.current;
        const step = Math.max(1, Number(keyboardSettings.jumpSeconds) || 5);
        const rateStep = Math.max(
          0.05,
          Number(keyboardSettings.rateStep) || 0.25,
        );

        if (event.key === "ArrowRight") {
          event.preventDefault();
          player.currentTime = Math.max(0, (player.currentTime || 0) + step);
          return;
        }

        if (event.key === "ArrowLeft") {
          event.preventDefault();
          player.currentTime = Math.max(0, (player.currentTime || 0) - step);
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          const nextVolume = Math.min(1, (player.volume || 0) + 0.05);
          player.volume = nextVolume;
          setVideoVolume(nextVolume);
          return;
        }

        if (event.key === "ArrowDown") {
          event.preventDefault();
          const nextVolume = Math.max(0, (player.volume || 0) - 0.05);
          player.volume = nextVolume;
          setVideoVolume(nextVolume);
          return;
        }

        if (event.key === "]") {
          event.preventDefault();
          const nextRate = Math.min(3, (player.playbackRate || 1) + rateStep);
          player.playbackRate = nextRate;
          setVideoPlaybackRate(nextRate);
          return;
        }

        if (event.key === "[") {
          event.preventDefault();
          const nextRate = Math.max(
            0.25,
            (player.playbackRate || 1) - rateStep,
          );
          player.playbackRate = nextRate;
          setVideoPlaybackRate(nextRate);
          return;
        }

        if (event.key.toLowerCase() === "f") {
          event.preventDefault();
          const shell = videoShellRef.current;
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          } else {
            shell?.requestFullscreen?.().catch(() => {});
          }
          return;
        }
      }

      if (currentImageIndex === -1) {
        if (event.key === "Escape") {
          setSlideshowOpen(false);
        }
        return;
      }

      if (event.key === "ArrowRight") {
        if (nextImagePath) {
          event.preventDefault();
          setSelectedPath(nextImagePath);
        }
      }

      if (event.key === "ArrowLeft") {
        if (previousImagePath) {
          event.preventDefault();
          setSelectedPath(previousImagePath);
        }
      }

      if (slideshowOpen && event.key === "Home" && currentFolderImages[0]) {
        event.preventDefault();
        setSelectedPath(currentFolderImages[0]);
      }

      if (
        slideshowOpen &&
        event.key === "End" &&
        currentFolderImages[currentFolderImages.length - 1]
      ) {
        event.preventDefault();
        setSelectedPath(currentFolderImages[currentFolderImages.length - 1]);
      }

      if (
        !slideshowOpen &&
        selectedKind === "image" &&
        (event.key === "Enter" || event.key.toLowerCase() === "f")
      ) {
        event.preventDefault();
        setSlideshowOpen(true);
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setSlideshowOpen(false);
      }
    }

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
