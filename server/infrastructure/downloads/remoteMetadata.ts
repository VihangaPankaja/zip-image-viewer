import { fetchWithValidatedRedirects } from "./publicDownload.js";

export type RemoteMetadata = {
  size: number;
  acceptRanges: boolean;
  etag: string;
  lastModified: string;
  resolvedUrl?: string;
};

const emptyMetadata: RemoteMetadata = {
  size: 0,
  acceptRanges: false,
  etag: "",
  lastModified: "",
  resolvedUrl: undefined,
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
    if (!response.ok) return { ...emptyMetadata };
    const encoding = response.headers.get("content-encoding");
    const encoded = Boolean(encoding && encoding.toLowerCase() !== "identity");
    const size = Number(response.headers.get("content-length"));
    return {
      size: encoded || !Number.isSafeInteger(size) || size < 0 ? 0 : size,
      acceptRanges: !encoded && /bytes/i.test(response.headers.get("accept-ranges") ?? ""),
      resolvedUrl: response.url || url,
      etag: response.headers.get("etag") ?? "",
      lastModified: response.headers.get("last-modified") ?? "",
    };
  } catch {
    return { ...emptyMetadata };
  }
}
