type TextPreviewResponse = Pick<Response, "ok" | "text">;
type TextPreviewRequest = (url: string) => Promise<TextPreviewResponse>;

type LoadTextPreviewParams = {
  cache: Map<string, string>;
  cacheKey: string;
  previewUrl: string;
  request?: TextPreviewRequest;
};

async function requestTextPreview(url: string): Promise<TextPreviewResponse> {
  return fetch(url);
}

export async function loadTextPreview({
  cache,
  cacheKey,
  previewUrl,
  request = requestTextPreview,
}: LoadTextPreviewParams): Promise<string> {
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const response = await request(previewUrl);
  if (!response.ok) throw new Error("Could not read this file.");

  const content = await response.text();
  cache.set(cacheKey, content);
  return content;
}
