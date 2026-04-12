import { classifyNodeKind } from "./mimeTypeSystem";

const NAME_COLLATOR = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: false,
});

type TreeNode = {
  type: "file" | "directory";
  path: string;
  name: string;
  modifiedAt?: number;
  size?: number;
  extension?: string;
  parentPath?: string;
  children?: TreeNode[];
  [key: string]: unknown;
};

function getNameBase(name: string): string {
  return String(name || "").replace(/\.[^.]+$/, "");
}

function parseTrailingNumber(name: string) {
  const baseName = getNameBase(name).trim();
  const match = baseName.match(/^(.*?)(?:[\s._-]*\(?([0-9]+)\)?)$/);
  if (!match) {
    return null;
  }

  return {
    prefix: match[1].trim(),
    number: Number(match[2]),
  };
}

function compareByName(left: TreeNode, right: TreeNode): number {
  return NAME_COLLATOR.compare(left.name, right.name);
}

function compareByNaturalTail(left: TreeNode, right: TreeNode): number {
  const leftTail = parseTrailingNumber(left.name);
  const rightTail = parseTrailingNumber(right.name);

  if (leftTail && rightTail) {
    const prefixCompare = NAME_COLLATOR.compare(
      leftTail.prefix,
      rightTail.prefix,
    );
    if (prefixCompare !== 0) {
      return prefixCompare;
    }
    if (leftTail.number !== rightTail.number) {
      return leftTail.number - rightTail.number;
    }
  }

  return compareByName(left, right);
}

function compareByDate(
  left: TreeNode,
  right: TreeNode,
  direction: "asc" | "desc",
): number {
  const leftValue = left.modifiedAt || 0;
  const rightValue = right.modifiedAt || 0;
  if (leftValue !== rightValue) {
    return direction === "asc"
      ? leftValue - rightValue
      : rightValue - leftValue;
  }
  return compareByName(left, right);
}

export function compareNodes(
  left: TreeNode,
  right: TreeNode,
  sortMode: string,
): number {
  if (left.type !== right.type) {
    return left.type === "directory" ? -1 : 1;
  }

  switch (sortMode) {
    case "name-desc":
      return compareByName(right, left);
    case "date-asc":
      return compareByDate(left, right, "asc");
    case "date-desc":
      return compareByDate(left, right, "desc");
    case "natural-tail":
      return compareByNaturalTail(left, right);
    case "name-asc":
    default:
      return compareByName(left, right);
  }
}

export function cloneAndSortTree(node: TreeNode, sortMode: string): TreeNode {
  if (node.type !== "directory") {
    return { ...node };
  }

  const children = (node.children || []).map((child) =>
    cloneAndSortTree(child, sortMode),
  );
  children.sort((left, right) => compareNodes(left, right, sortMode));

  return {
    ...node,
    children,
  };
}

export function flattenTree(tree: TreeNode) {
  const nodesByPath = new Map<string, TreeNode>();
  const folderImages = new Map<string, string[]>();
  const folderPreview = new Map<string, string>();

  function walk(node: TreeNode) {
    nodesByPath.set(node.path, node);
    if (node.type === "directory") {
      const directoryChildren = node.children || [];
      const imageChildren = directoryChildren.filter(
        (child) => classifyNodeKind(child) === "image",
      );
      folderImages.set(
        node.path,
        imageChildren.map((child) => child.path),
      );
      folderPreview.set(node.path, imageChildren[0]?.path || "");
      directoryChildren.forEach(walk);
    }
  }

  walk(tree);
  return { nodesByPath, folderImages, folderPreview };
}

export function getFirstFilePath(node: TreeNode | null | undefined): string {
  if (!node) {
    return "";
  }

  if (node.type === "file") {
    return node.path;
  }

  for (const child of node.children || []) {
    const match = getFirstFilePath(child);
    if (match) {
      return match;
    }
  }

  return node.path;
}
