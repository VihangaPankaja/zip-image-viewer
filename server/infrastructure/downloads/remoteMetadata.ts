export type RemoteMetadata = {
  size: number;
  acceptRanges: boolean;
  etag: string;
  lastModified: string;
};

const emptyMetadata: RemoteMetadata = {
  size: 0,
  acceptRanges: false,
  etag: "",
  lastModified: "",
};

export async function fetchRemoteMetadata(
  url: string,
  signal: AbortSignal,
): Promise<RemoteMetadata> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal,
      headers: { "cache-control": "no-cache" },
    });
    if (!response.ok) return emptyMetadata;
    return {
      size: Number(response.headers.get("content-length")) || 0,
      acceptRanges: /bytes/i.test(response.headers.get("accept-ranges") ?? ""),
      etag: response.headers.get("etag") ?? "",
      lastModified: response.headers.get("last-modified") ?? "",
    };
  } catch {
    return emptyMetadata;
  }
}
