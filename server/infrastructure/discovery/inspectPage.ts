import got, { type Response } from "got";
import type { LookupFunction } from "node:net";
import { parsePage } from "./parsePage.js";
import { assertPublicPageUrl, publicPageLookup } from "./publicPageUrl.js";
import { decodePage } from "./decodePage.js";

const MAX_HTML_BYTES = 2 * 1024 ** 2;

export async function inspectPage(
  url: string,
  options: { signal?: AbortSignal; lookup?: LookupFunction } = {},
) {
  assertPublicPageUrl(url);
  const signal = AbortSignal.any([
    AbortSignal.timeout(10_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  const request = got.stream(url, {
    signal,
    dnsLookup: options.lookup ?? publicPageLookup,
    retry: { limit: 0 },
    maxRedirects: 5,
    headers: { accept: "text/html, application/xhtml+xml" },
    hooks: {
      beforeRedirect: [
        (redirect) => {
          if (redirect.url) assertPublicPageUrl(redirect.url);
        },
      ],
    },
  });
  let sourcePage = url;
  let contentType = "";
  request.once("response", (response: Response) => {
    sourcePage = response.url;
    contentType = response.headers["content-type"] ?? "";
    if (!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(contentType)) {
      request.destroy(
        new Error("This URL did not return an HTML page. Use direct download entry for files."),
      );
    }
  });
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      bytes += buffer.length;
      if (bytes > MAX_HTML_BYTES) throw new Error("Page HTML exceeds the 2 MiB inspection limit.");
      chunks.push(buffer);
    }
    signal.throwIfAborted();
    const body = Buffer.concat(chunks);
    const markup = decodePage(body, contentType);
    return await parsePage(markup, sourcePage, signal);
  } finally {
    request.destroy();
  }
}
