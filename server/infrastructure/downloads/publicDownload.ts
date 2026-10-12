import { publicHttpUrlSchema } from "../../../shared/contracts.js";
import type { IncomingMessage } from "node:http";
import { resourceLimitError } from "../runtime/resourceLimits.js";

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
  if (encoded && hasRange)
    throw resourceLimitError(
      "Encoded responses do not support ranged downloads.",
    );
  if (statusCode >= 400)
    throw new Error(`Download failed with HTTP ${String(statusCode)}`);
  if (strictRange && hasRange && statusCode !== 206)
    throw Object.assign(
      new Error(
        "Server does not support range requests for segmented download.",
      ),
      { code: "RANGE_UNSUPPORTED" },
    );
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
      throw Object.assign(
        new Error("Download redirect limit or invalid redirect."),
        {
          code: "DOWNLOAD_FATAL",
        },
      );
    target = URL.canParse(location, target)
      ? new URL(location, target).href
      : "";
    assertPublicDownloadUrl(target);
  }
}
