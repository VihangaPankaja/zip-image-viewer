import type { RefObject } from "react";

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
};

export type VideoPreviewProps = {
  activeJob: VideoJob | null;
  formatBytes: (value: number) => string;
  formatDate: (value: number) => string;
  keyboardSettings: KeyboardSettings;
  selectedNode: PreviewFileNode;
  selectedVideoQuality: string;
  setSelectedVideoQuality: (value: string) => void;
  videoPlaybackError: string;
  videoQualityOptions: PreviewOption[];
  videoRef: RefObject<HTMLVideoElement | null>;
  videoShellRef: RefObject<HTMLDivElement | null>;
};
