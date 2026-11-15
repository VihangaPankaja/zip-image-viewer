import got, { type Response } from "got";
import type { LookupFunction } from "node:net";
import { parsePage } from "./parsePage.js";
import { assertPublicPageUrl, publicPageLookup } from "./publicPageUrl.js";

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
    const charset =
      body[0] === 0xff && body[1] === 0xfe
        ? "utf-16le"
        : body[0] === 0xfe && body[1] === 0xff
          ? "utf-16be"
          : body.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
            ? "utf-8"
            : (/\bcharset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1] ?? "utf-8");
    let markup: string;
    try {
      markup = new TextDecoder(charset).decode(body);
    } catch {
      throw new Error("This page uses an unsupported text encoding.");
    }
    return await parsePage(markup, sourcePage, signal);
  } finally {
    request.destroy();
  }
}
