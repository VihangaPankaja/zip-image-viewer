export const MAX_BATCH_URLS = 50;

export function parseWorkspaceUrls(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/\r?\n/)
        .map((url) => url.trim())
        .filter(Boolean),
    ),
  );
}

export function getBatchValidationMessage(urls: readonly string[]): string {
  if (urls.length === 0) return "Paste at least one public URL.";
  if (urls.length > MAX_BATCH_URLS) {
    return `A batch can contain up to ${MAX_BATCH_URLS} URLs.`;
  }
  return "";
}
