import { publicHttpUrlSchema } from "../../../shared/contracts.js";
import type { IncomingMessage } from "node:http";

export function validateDownloadResponse(
  response: IncomingMessage,
  hasRange: boolean,
  strictRange: boolean,
) {
  const statusCode = response.statusCode ?? 0;
  // Got removes content-encoding after decoding; raw headers retain it.
  const encoded = response.rawHeaders.some(
    (header, index) =>
      index % 2 === 0 &&
      header.toLowerCase() === "content-encoding" &&
      response.rawHeaders[index + 1].trim().toLowerCase() !== "identity",
  );
  if (statusCode >= 400 && !(hasRange && statusCode === 416)) {
    const auth = statusCode === 401 || statusCode === 403;
    throw Object.assign(
      new Error(
        auth
          ? `Download authorization failed (HTTP ${statusCode}). The link may have expired; add a fresh public link.`
          : `Download failed with HTTP ${statusCode}`,
      ),
      {
        statusCode,
        retryAfter: response.headers["retry-after"],
        code: auth
          ? "DOWNLOAD_AUTH"
          : statusCode < 500 && statusCode !== 408 && statusCode !== 429
            ? "DOWNLOAD_PERMANENT"
            : "DOWNLOAD_TRANSIENT",
      },
    );
  }
  if (encoded && hasRange)
    throw Object.assign(new Error("Encoded responses do not support ranged downloads."), {
      code: "RANGE_UNSUPPORTED",
    });
  if (strictRange && hasRange && statusCode !== 206)
    throw Object.assign(
      new Error("Server does not support range requests for segmented download."),
      { code: "RANGE_UNSUPPORTED" },
    );
  if (!hasRange && (statusCode !== 200 || response.headers["content-range"] !== undefined))
    throw Object.assign(new Error("Server returned an invalid full download response."), {
      code: "DOWNLOAD_FATAL",
    });
  return { statusCode, encoded };
}

export function assertPublicDownloadUrl(url: string | URL): void {
  if (!publicHttpUrlSchema.safeParse(String(url)).success)
    throw Object.assign(new Error("A public HTTP(S) URL is required."), {
      code: "DOWNLOAD_FATAL",
    });
}

export async function fetchWithValidatedRedirects(
  url: string,
  options: RequestInit,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  let target = url;
  for (let redirects = 0; ; redirects++) {
    const response = await fetcher(target, { ...options, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || redirects >= 10)
      throw Object.assign(new Error("Download redirect limit or invalid redirect."), {
        code: "DOWNLOAD_FATAL",
      });
    target = URL.canParse(location, target) ? new URL(location, target).href : "";
    assertPublicDownloadUrl(target);
  }
}
