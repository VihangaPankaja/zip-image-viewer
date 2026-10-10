import { fetchWithValidatedRedirects } from "./publicDownload.js";

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
    const response = await fetchWithValidatedRedirects(url, {
      method: "HEAD",
      signal,
      headers: { "cache-control": "no-cache", "accept-encoding": "identity" },
    });
    if (!response.ok) return emptyMetadata;
    const encoding = response.headers.get("content-encoding");
    const encoded = Boolean(encoding && encoding.toLowerCase() !== "identity");
    return {
      size: encoded ? 0 : Number(response.headers.get("content-length")) || 0,
      acceptRanges:
        !encoded && /bytes/i.test(response.headers.get("accept-ranges") ?? ""),
      etag: response.headers.get("etag") ?? "",
      lastModified: response.headers.get("last-modified") ?? "",
    };
  } catch {
    return emptyMetadata;
  }
}
