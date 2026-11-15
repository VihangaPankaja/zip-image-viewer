import { html, parse } from "parse5";
import { htmlAttribute, htmlNodes } from "../downloads/htmlParsing.js";

function declaredCharset(contentType: string) {
  return /\bcharset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1];
}

function metaCharset(body: Buffer) {
  // HTML encoding declarations belong in the first 1024 bytes; bound this prescan too.
  const prefix = parse(body.subarray(0, 1024).toString("latin1"), { scriptingEnabled: true });
  for (const node of htmlNodes(prefix)) {
    if (!("tagName" in node) || node.tagName !== "meta" || node.namespaceURI !== html.NS.HTML)
      continue;
    const label =
      htmlAttribute(node, "charset") ??
      (htmlAttribute(node, "http-equiv")?.trim().toLowerCase() === "content-type"
        ? declaredCharset(htmlAttribute(node, "content") ?? "")
        : undefined);
    if (!label) continue;
    try {
      const encoding = new TextDecoder(
        label.trim().toLowerCase() === "x-user-defined" ? "windows-1252" : label,
      ).encoding;
      return encoding === "utf-16le" || encoding === "utf-16be" ? "utf-8" : encoding;
    } catch {
      // Ignore an unsupported declaration and allow a later valid meta element.
    }
  }
  return undefined;
}

export function decodePage(body: Buffer, contentType: string): string {
  const bom =
    body[0] === 0xff && body[1] === 0xfe
      ? "utf-16le"
      : body[0] === 0xfe && body[1] === 0xff
        ? "utf-16be"
        : body.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
          ? "utf-8"
          : undefined;
  const charset = bom || declaredCharset(contentType) || metaCharset(body) || "utf-8";
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    throw new Error("This page uses an unsupported text encoding.");
  }
}
