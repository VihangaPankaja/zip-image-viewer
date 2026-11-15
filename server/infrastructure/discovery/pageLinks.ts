import { html, parse, type DefaultTreeAdapterMap } from "parse5";
import type { PageDiscovery } from "../../../shared/contracts.js";
import { assertPublicPageUrl } from "./publicPageUrl.js";
import { htmlNodes as descendants, htmlAttribute as attribute } from "../downloads/htmlParsing.js";

type Element = DefaultTreeAdapterMap["element"];
const fileExtension =
  /\.(zip|7z|rar|tar|gz|bz2|xz|tgz|pdf|epub|cbz|cbr|png|jpe?g|gif|webp|avif|svg|bmp|tiff?|mp4|mkv|webm|mov|avi|m4v|mp3|m4a|aac|ogg|opus|wav|flac|txt|md|csv|tsv|json|xml|srt|vtt|torrent)$/i;

function candidate(element: Element, base: string, sourcePage: string) {
  const href = attribute(element, "href")?.trim();
  if (!href || href.startsWith("#") || !URL.canParse(href, base)) return;
  const target = new URL(href, base);
  target.hash = "";
  try {
    assertPublicPageUrl(target);
  } catch {
    return;
  }
  if (target.href === sourcePage.split("#", 1)[0]) return;
  const download = attribute(element, "download");
  const mime = attribute(element, "type")?.trim().slice(0, 100);
  const extension = fileExtension.exec(target.pathname)?.[1]?.toUpperCase();
  const hinted =
    download !== undefined ||
    Boolean(mime && !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(mime));
  const text = [...descendants(element)]
    .flatMap((node) => ("value" in node ? [node.value] : []))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  let fallback = target.pathname.split("/").at(-1) || target.hostname;
  try {
    fallback = decodeURIComponent(fallback);
  } catch {
    /* Keep malformed escapes readable. */
  }
  return {
    url: target.href,
    name: (download?.trim() || text || fallback).slice(0, 300),
    type: extension || mime || "Unknown",
    kind: extension || hinted ? ("file" as const) : ("page" as const),
    confidence: extension || hinted ? ("high" as const) : ("low" as const),
    sizeBytes: null,
    sourcePage,
  };
}

export function extractPageLinks(markup: string, sourcePage: string): PageDiscovery {
  const document = parse(markup, { scriptingEnabled: true });
  let base = sourcePage;
  let baseSeen = false;
  const anchors: Element[] = [];
  for (const node of descendants(document)) {
    if (!("tagName" in node) || node.namespaceURI !== html.NS.HTML) continue;
    if (node.tagName === "base" && !baseSeen && attribute(node, "href") !== undefined) {
      baseSeen = true;
      const href = attribute(node, "href") ?? "";
      // An unsafe base must not silently turn its relative links into safe-looking candidates.
      base = URL.canParse(href, sourcePage) ? new URL(href, sourcePage).href : "about:blank";
    }
    if (node.tagName === "a" || node.tagName === "area") anchors.push(node);
  }
  const items = new Map<string, PageDiscovery["items"][number]>();
  let truncated = false;
  for (const anchor of anchors) {
    const item = candidate(anchor, base, sourcePage);
    if (!item) continue;
    const previous = items.get(item.url);
    if (previous) {
      if (previous.kind === "page" && item.kind === "file") items.set(item.url, item);
      continue;
    }
    if (items.size === 500) {
      truncated = true;
      break;
    }
    items.set(item.url, item);
  }
  return {
    sourcePage,
    items: [...items.values()].sort(
      (a, b) => Number(b.kind === "file") - Number(a.kind === "file"),
    ),
    truncated,
  };
}
