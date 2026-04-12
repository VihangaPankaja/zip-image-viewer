import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Folder,
  File,
  FileImage,
  FileVideo,
  FileAudio,
  FileText,
  FileArchive,
} from "lucide-react";
import { classifyNodeKind } from "../lib/mimeTypeSystem";

type ExplorerNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  extension?: string;
  children?: ExplorerNode[];
};

function iconForNode(node: ExplorerNode | null | undefined) {
  if (!node || node.type === "directory") return Folder;
  const ext = String(node.extension || "").toLowerCase();
  const kind = classifyNodeKind(node);
  if (kind === "image") return FileImage;
  if (kind === "video") return FileVideo;
  if (kind === "audio") return FileAudio;
  if (kind === "text") return FileText;
  if (["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"].includes(ext))
    return FileArchive;
  return File;
}

type TreeExplorerProps = {
  rootNode: ExplorerNode | null;
  selectedPath: string;
  onSelect: (_node: ExplorerNode) => void;
  compact?: boolean;
};

type FlatTreeItem = {
  node: ExplorerNode;
  depth: number;
  id: string;
  parentId: string;
  hasChildren: boolean;
};

function flattenVisible(
  node: ExplorerNode,
  expanded: Set<string>,
  depth = 0,
  parentId = "",
): FlatTreeItem[] {
  if (!node) return [];
  const id = String(node.path || "");
  const hasChildren = node.type === "directory" && Array.isArray(node.children);
  const rows: FlatTreeItem[] = [
    {
      node,
      depth,
      id,
      parentId,
      hasChildren: Boolean(hasChildren && node.children.length),
    },
  ];

  if (hasChildren && expanded.has(id)) {
    for (const child of node.children || []) {
      rows.push(...flattenVisible(child, expanded, depth + 1, id));
    }
  }

  return rows;
}

export function TreeExplorer({
  rootNode,
  selectedPath,
  onSelect,
  compact = false,
}: TreeExplorerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([String(rootNode?.path || ".")]),
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const rootPath = rootNode?.path ?? null;
  useEffect(() => {
    setExpanded(new Set([String(rootPath || ".")]));
    setActiveIndex(0);
  }, [rootPath]);

  const rows = useMemo(
    () => flattenVisible(rootNode, expanded),
    [rootNode, expanded],
  );

  useEffect(() => {
    setActiveIndex((current) => {
      if (rows.length === 0) {
        return 0;
      }
      return Math.max(0, Math.min(rows.length - 1, current));
    });
    itemRefs.current = itemRefs.current.slice(0, rows.length);
  }, [rows.length]);

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function onTreeKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!rows.length) return;
    const current = rows[Math.max(0, Math.min(rows.length - 1, activeIndex))];

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = Math.min(rows.length - 1, activeIndex + 1);
      setActiveIndex(nextIndex);
      itemRefs.current[nextIndex]?.focus();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex = Math.max(0, activeIndex - 1);
      setActiveIndex(nextIndex);
      itemRefs.current[nextIndex]?.focus();
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      itemRefs.current[0]?.focus();
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      const nextIndex = rows.length - 1;
      setActiveIndex(nextIndex);
      itemRefs.current[nextIndex]?.focus();
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (current.hasChildren && !expanded.has(current.id)) {
        toggleExpanded(current.id);
      }
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (current.hasChildren && expanded.has(current.id)) {
        toggleExpanded(current.id);
        return;
      }
      if (current.parentId) {
        const parentIndex = rows.findIndex(
          (item) => item.id === current.parentId,
        );
        if (parentIndex >= 0) {
          setActiveIndex(parentIndex);
          itemRefs.current[parentIndex]?.focus();
        }
      }
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (current.hasChildren) {
        toggleExpanded(current.id);
      } else {
        onSelect(current.node);
      }
    }
  }

  if (!rootNode) {
    return null;
  }

  return (
    <div
      className={`tree-shell ${compact ? "compact" : ""}`}
      role="tree"
      aria-label="Explorer tree"
      onKeyDown={onTreeKeyDown}
    >
      {rows.map((row, index) => {
        const Icon = iconForNode(row.node);
        const isExpanded = expanded.has(row.id);
        const isSelected = row.id === selectedPath;
        return (
          <button
            key={row.id}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            type="button"
            role="treeitem"
            aria-level={row.depth + 1}
            aria-expanded={row.hasChildren ? isExpanded : undefined}
            aria-selected={isSelected}
            tabIndex={index === activeIndex ? 0 : -1}
            className={`tree-item ${isSelected ? "selected" : ""}`}
            style={{ paddingInlineStart: `${10 + row.depth * 14}px` }}
            onFocus={() => setActiveIndex(index)}
            onClick={() => {
              if (row.hasChildren) {
                toggleExpanded(row.id);
              } else {
                onSelect(row.node);
              }
            }}
          >
            <span className="tree-item-caret" aria-hidden="true">
              {row.hasChildren ? (
                <ChevronRight
                  size={14}
                  style={{
                    transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                  }}
                />
              ) : null}
            </span>
            <span className="tree-item-icon" aria-hidden="true">
              <Icon size={14} />
            </span>
            <span className="tree-item-label">{row.node.name}</span>
            <span className="tree-item-meta">
              {row.node.type === "directory"
                ? "Folder"
                : row.node.extension || "file"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
