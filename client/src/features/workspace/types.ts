import type { Dispatch, RefObject, SetStateAction } from "react";

export type PreviewNode = {
  extension?: string;
  modifiedAt?: number;
  name: string;
  path: string;
  size?: number;
  type: "file" | "directory";
};

export type PreviewFileNode = PreviewNode & { type: "file" };

export type PreviewOption = { id: string; label: string };
export type SelectOption = { label: string; value: string };
export type ThumbnailItem = {
  name: string;
  path: string;
  thumbnailUrl: string;
};
export type KeyboardSettings = { jumpSeconds: number; rateStep: number };
export type VideoJob = {
  phase?: string;
  totalTranscodeEntries?: number;
  transcodedEntries?: number;
  videoQuality?: string;
};

export type ImagePreviewProps = {
  currentFolderImageItems: ThumbnailItem[];
  currentFolderImages: string[];
  currentImageIndex: number;
  formatBytes: (value: number) => string;
  formatDate: (value: number) => string;
  previewQuality: string;
  previewQualityOptions: SelectOption[];
  selectedImagePreviewUrl: string;
  selectedImageSrc: string;
  selectedNode: PreviewFileNode;
  selectedPath: string;
  setPreviewQuality: (value: string) => void;
  setSelectedPath: (value: string) => void;
  setThumbnailStripExpanded: Dispatch<SetStateAction<boolean>>;
  thumbnailStripExpanded: boolean;
  visibleThumbnailItems: ThumbnailItem[];
};

export type VideoPreviewProps = {
  activeJob: VideoJob | null;
  formatBytes: (value: number) => string;
  formatDate: (value: number) => string;
  keyboardSettings: KeyboardSettings;
  seekVideoTo: (time: number) => void;
  selectedNode: PreviewFileNode;
  selectedVideoQuality: string;
  setSelectedVideoQuality: (value: string) => void;
  setVideoPlaybackRate: (rate: number) => void;
  setVideoSeekHoverTime: Dispatch<SetStateAction<number | null>>;
  setVideoVolume: (volume: number) => void;
  toggleVideoFullscreen: () => void;
  toggleVideoPlayback: () => void;
  videoBufferedPercent: number;
  videoCurrentTime: number;
  videoDuration: number;
  videoIsFullscreen: boolean;
  videoIsPlaying: boolean;
  videoPlaybackError: string;
  videoPlaybackRate: number;
  videoPlayedPercent: number;
  videoQualityOptions: PreviewOption[];
  videoRef: RefObject<HTMLVideoElement | null>;
  videoSeekHoverTime: number | null;
  videoSeekPreviewUrl: string;
  videoShellRef: RefObject<HTMLDivElement | null>;
  videoVolume: number;
};
