export type BuildFileUrlOptions = {
  previewText?: boolean;
  thumbnail?: boolean;
  size?: number;
  imagePreview?: boolean;
  quality?: string;
};

export type DownloadOptions = {
  transport: {
    mode: "auto" | "single" | "segmented";
    threads: number;
    multithread: boolean;
    resume: boolean;
  };
  retry: {
    maxRetries: number;
    timeoutMs: number;
  };
  media: {
    videoQuality: string;
  };
  extraction: {
    enabled: boolean;
  };
  request: {
    headers: Record<string, string>;
  };
};
