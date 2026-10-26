import { textPreviewSchema, type TextPreviewChunk } from "../../../../shared/contracts";

type LoadTextPreviewParams = {
  cache: Map<string, TextPreviewChunk>;
  cacheKey: string;
  previewUrl: string;
  offset: number;
  signal: AbortSignal;
  request?: (url: string, init: RequestInit) => Promise<Response>;
};

function retainedBytes(cache: Map<string, TextPreviewChunk>): number {
  let bytes = 0;
  for (const [key, chunk] of cache)
    bytes += (key.length + chunk.text.length + chunk.encoding.length) * 2 + 256;
  return bytes;
}

async function readBoundedResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error("Could not read this file.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1024 * 1024) throw new Error("Text preview response exceeds its byte limit.");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export async function loadTextPreview({
  cache,
  cacheKey,
  previewUrl,
  offset,
  signal,
  request = fetch,
}: LoadTextPreviewParams): Promise<TextPreviewChunk> {
  signal.throwIfAborted();
  const key = `${cacheKey}:${offset}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const [pathname, query = ""] = previewUrl.split("?");
  const params = new URLSearchParams(query);
  params.delete("preview");
  params.set("textPreview", "1");
  params.set("offset", String(offset));
  const response = await request(`${pathname}?${params}`, { signal });
  const chunk = textPreviewSchema.parse(await readBoundedResponse(response, signal));
  signal.throwIfAborted();
  cache.set(key, chunk);
  while (retainedBytes(cache) > 2 * 1024 * 1024) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return chunk;
}
