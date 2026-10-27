import { html, parse, type DefaultTreeAdapterMap } from "parse5";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
const HTML_NAMESPACE = html.NS.HTML;

function decodePrefix(prefix: Buffer, contentType: string) {
  const bom =
    prefix[0] === 0xff && prefix[1] === 0xfe
      ? "utf-16le"
      : prefix[0] === 0xfe && prefix[1] === 0xff
        ? "utf-16be"
        : prefix.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
          ? "utf-8"
          : "";
  const charset = /\bcharset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(bom || charset || "utf-8").decode(prefix);
  } catch {
    return new TextDecoder("utf-8").decode(prefix);
  }
}

function* descendants(root: Node): Generator<Node> {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    yield node;
    if ("tagName" in node && ["script", "style", "template"].includes(node.tagName)) continue;
    if ("childNodes" in node) pending.push(...node.childNodes.slice().reverse());
  }
}

function attribute(element: Element, name: string) {
  return element.attrs.find((item) => item.name === name)?.value;
}

function hasForm(input: Element, elements: Element[]) {
  const id = attribute(input, "form");
  if (id !== undefined) {
    const owner = id ? elements.find((element) => attribute(element, "id") === id) : undefined;
    return owner?.tagName === "form" && owner.namespaceURI === HTML_NAMESPACE;
  }
  for (let parent = input.parentNode; parent && "tagName" in parent; parent = parent.parentNode) {
    if (parent.tagName === "form" && parent.namespaceURI === HTML_NAMESPACE) return true;
  }
  return false;
}

export function hasHtmlFailure(prefix: Buffer, contentType: string): boolean {
  // This flag selects browser HTML parsing states; parse5 never executes scripts or loads URLs.
  const document = parse(decodePrefix(prefix, contentType), { scriptingEnabled: true });
  const elements = [...descendants(document)].filter((node): node is Element => "tagName" in node);
  return elements.some((element) => {
    if (element.namespaceURI !== HTML_NAMESPACE) return false;
    if (element.tagName === "input")
      return attribute(element, "type")?.toLowerCase() === "password" && hasForm(element, elements);
    if (element.tagName !== "title" && element.tagName !== "h1") return false;
    const text = [...descendants(element)]
      .flatMap((node) => ("value" in node ? [node.value] : []))
      .join("");
    return /^\s*(?:access denied|(?:download |signed )?(?:link|request) (?:has )?expired)\b/i.test(
      text,
    );
  });
}
