import path from "node:path";
import type { ExplorerNode } from "./models.js";

export type ExtractedEntry = {
  relativePath: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: number;
};

function createNode(
  name: string,
  nodePath: string,
  type: "file" | "directory",
): ExplorerNode {
  return {
    name,
    path: nodePath,
    type,
    extension: type === "file" ? path.extname(name).slice(1).toLowerCase() : "",
    modifiedAt: 0,
    children: type === "directory" ? [] : undefined,
  };
}

export function buildTree(entries: ExtractedEntry[], rootName: string) {
  const root: ExplorerNode = {
    name: rootName,
    path: ".",
    type: "directory",
    parentPath: "",
    modifiedAt: 0,
    children: [],
  };
  const nodes = new Map<string, ExplorerNode>([[".", root]]);
  let firstFilePath = "";
  let fileCount = 0;

  for (const entry of entries) {
    const parts = entry.relativePath.split("/").filter(Boolean);
    let currentPath = ".";
    for (const [index, name] of parts.entries()) {
      const nextPath = currentPath === "." ? name : `${currentPath}/${name}`;
      const isFile = index === parts.length - 1 && entry.type === "file";
      const node = nodes.get(nextPath);
      if (!node) {
        const created = createNode(
          name,
          nextPath,
          isFile ? "file" : "directory",
        );
        created.parentPath = currentPath;
        created.modifiedAt = entry.modifiedAt;
        if (isFile) created.size = entry.size;
        nodes.set(nextPath, created);
        nodes.get(currentPath)?.children?.push(created);
      } else if (entry.modifiedAt > node.modifiedAt) {
        node.modifiedAt = entry.modifiedAt;
      }
      currentPath = nextPath;
    }
    if (entry.type === "file") {
      fileCount += 1;
      firstFilePath ||= entry.relativePath;
    }
  }
  return { tree: root, firstFilePath, stats: { fileCount } };
}
