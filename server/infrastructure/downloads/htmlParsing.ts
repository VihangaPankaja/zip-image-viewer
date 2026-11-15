import type { DefaultTreeAdapterMap } from "parse5";

type Node = DefaultTreeAdapterMap["node"];

export function* htmlNodes(root: Node): Generator<Node> {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    yield node;
    if ("tagName" in node && ["script", "style", "template"].includes(node.tagName)) continue;
    if ("childNodes" in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index--)
        pending.push(node.childNodes[index]);
    }
  }
}

export function htmlAttribute(element: DefaultTreeAdapterMap["element"], name: string) {
  return element.attrs.find((item) => item.name === name)?.value;
}
