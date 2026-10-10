import { publicHttpUrlSchema } from "../../../shared/contracts.js";

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
