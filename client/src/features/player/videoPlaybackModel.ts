export type VideoQualityOption = { id: string; label: string };

type VideoPlaybackNode = {
  path?: string;
  type?: string;
};

type BuildVideoPlaybackUrlsParams = {
  quality: string;
  selectedKind: string;
  selectedNode: VideoPlaybackNode | null;
  sessionId?: string;
};

export function buildVideoPlaybackUrls({
  quality,
  selectedKind,
  selectedNode,
  sessionId,
}: BuildVideoPlaybackUrlsParams) {
  if (selectedNode?.type !== "file" || selectedKind !== "video") {
    return { hlsUrl: "", originalUrl: "" };
  }
  const path = selectedNode.path ?? "";
  const originalQuery = new URLSearchParams({ path, quality: "source" });
  const hlsQuery = new URLSearchParams({ path, quality });
  return {
    hlsUrl: `/api/sessions/${sessionId}/video/hls/playlist?${hlsQuery.toString()}`,
    originalUrl: `/api/sessions/${sessionId}/video/play?${originalQuery.toString()}`,
  };
}

type RawVideoQualityOption = { id?: string; label?: string };

export function normalizeVideoQualityOptions(
  options: readonly RawVideoQualityOption[] | undefined,
): VideoQualityOption[] {
  return (options ?? []).map((option) => {
    const id = option.id ?? "";
    return { id, label: option.label || id };
  });
}

export function chooseVideoQuality(
  options: readonly VideoQualityOption[],
  defaultQuality?: string,
): string {
  return (
    options.find((item) => item.id === defaultQuality)?.id ??
    options.find((item) => item.id === "source")?.id ??
    options.at(0)?.id ??
    "source"
  );
}
