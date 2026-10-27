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
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
  try {
    const response = await fetchWithValidatedRedirects(url, {
      method: "HEAD",
      signal: boundedSignal,
      headers: { "cache-control": "no-cache", "accept-encoding": "identity" },
    });
    if (response.status === 405 || response.status === 501) {
      await response.body?.cancel();
      return await probeRange(url, boundedSignal);
    }
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

async function probeRange(url: string, signal: AbortSignal): Promise<RemoteMetadata> {
  const response = await fetchWithValidatedRedirects(url, {
    signal,
    headers: { range: "bytes=0-0", "accept-encoding": "identity", "cache-control": "no-cache" },
  });
  const reader = response.body?.getReader();
  try {
    const range = /^bytes 0-0\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
    const size = Number(range?.[1]);
    const encoding = response.headers.get("content-encoding")?.toLowerCase();
    const length = response.headers.get("content-length");
    if (
      response.status !== 206 ||
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      (encoding && encoding !== "identity") ||
      (length !== null && length !== "1") ||
      !reader
    )
      return { ...emptyMetadata };
    const first = await reader.read();
    if (first.value?.byteLength !== 1 || !(await reader.read()).done) return { ...emptyMetadata };
    return {
      size,
      acceptRanges: true,
      etag: response.headers.get("etag") ?? "",
      lastModified: response.headers.get("last-modified") ?? "",
      resolvedUrl: response.url || url,
    };
  } finally {
    await reader?.cancel();
  }
}
