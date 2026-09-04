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

export type ExplorerNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  extension?: string;
  children?: ExplorerNode[];
};

function iconForNode(node: ExplorerNode | null | undefined) {
  if (!node || node.type === "directory") return <Folder size={14} />;
  const ext = (node.extension || "").toLowerCase();
  const kind = classifyNodeKind(node);
  if (kind === "image") return <FileImage size={14} />;
  if (kind === "video") return <FileVideo size={14} />;
  if (kind === "audio") return <FileAudio size={14} />;
  if (kind === "text") return <FileText size={14} />;
  if (["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"].includes(ext))
    return <FileArchive size={14} />;
  return <File size={14} />;
}

export type TreeExplorerProps = {
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
  const id = node.path;
  const children = node.children ?? [];
  const hasChildren = node.type === "directory" && children.length > 0;
  const rows: FlatTreeItem[] = [
    {
      node,
      depth,
      id,
      parentId,
      hasChildren,
    },
  ];

  if (hasChildren && expanded.has(id)) {
    for (const child of children) {
      rows.push(...flattenVisible(child, expanded, depth + 1, id));
    }
  }

  return rows;
}

type TreeNavigation = {
  activeIndex: number;
  expanded: Set<string>;
  focusItem: (index: number) => void;
  onSelect: (node: ExplorerNode) => void;
  rows: FlatTreeItem[];
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  setItemRef: (index: number, element: HTMLButtonElement | null) => void;
  toggleExpanded: (id: string) => void;
};

function focusRow(navigation: TreeNavigation, index: number) {
  navigation.setActiveIndex(index);
  navigation.focusItem(index);
}

function handlePositionKey(
  event: React.KeyboardEvent<HTMLDivElement>,
  navigation: TreeNavigation,
): boolean {
  const { activeIndex, rows } = navigation;
  const targets: Partial<Record<string, number>> = {
    ArrowDown: Math.min(rows.length - 1, activeIndex + 1),
    ArrowUp: Math.max(0, activeIndex - 1),
    Home: 0,
    End: rows.length - 1,
  };
  const target = targets[event.key];
  if (target === undefined) return false;
  event.preventDefault();
  focusRow(navigation, target);
  return true;
}

function handleHierarchyKey(
  event: React.KeyboardEvent<HTMLDivElement>,
  current: FlatTreeItem,
  navigation: TreeNavigation,
): boolean {
  if (event.key === "ArrowRight") {
    event.preventDefault();
    if (current.hasChildren && !navigation.expanded.has(current.id)) {
      navigation.toggleExpanded(current.id);
    }
    return true;
  }
  if (event.key !== "ArrowLeft") return false;
  event.preventDefault();
  if (current.hasChildren && navigation.expanded.has(current.id)) {
    navigation.toggleExpanded(current.id);
    return true;
  }
  const parentIndex = navigation.rows.findIndex(
    (item) => item.id === current.parentId,
  );
  if (current.parentId && parentIndex >= 0) {
    focusRow(navigation, parentIndex);
  }
  return true;
}

function handleTreeKeyDown(
  event: React.KeyboardEvent<HTMLDivElement>,
  navigation: TreeNavigation,
) {
  if (!navigation.rows.length || handlePositionKey(event, navigation)) return;
  const index = Math.max(
    0,
    Math.min(navigation.rows.length - 1, navigation.activeIndex),
  );
  const current = navigation.rows[index];
  if (handleHierarchyKey(event, current, navigation)) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  if (current.hasChildren) {
    navigation.toggleExpanded(current.id);
  } else {
    navigation.onSelect(current.node);
  }
}

function useTreeNavigation(
  rootNode: ExplorerNode | null,
  onSelect: (node: ExplorerNode) => void,
): TreeNavigation {
  const rootPath = rootNode?.path ?? null;
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([rootPath || "."]),
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    setExpanded(new Set([rootPath || "."]));
    setActiveIndex(0);
  }, [rootPath]);
  const rows = useMemo(
    () => (rootNode ? flattenVisible(rootNode, expanded) : []),
    [rootNode, expanded],
  );
  useEffect(() => {
    setActiveIndex((current) =>
      rows.length ? Math.max(0, Math.min(rows.length - 1, current)) : 0,
    );
    itemRefs.current = itemRefs.current.slice(0, rows.length);
  }, [rows.length]);
  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function focusItem(index: number) {
    itemRefs.current[index]?.focus();
  }
  function setItemRef(index: number, element: HTMLButtonElement | null) {
    itemRefs.current[index] = element;
  }
  return {
    activeIndex,
    expanded,
    focusItem,
    onSelect,
    rows,
    setActiveIndex,
    setItemRef,
    toggleExpanded,
  };
}

function TreeItem({
  row,
  index,
  selectedPath,
  navigation,
}: {
  row: FlatTreeItem;
  index: number;
  selectedPath: string;
  navigation: TreeNavigation;
}) {
  const isExpanded = navigation.expanded.has(row.id);
  const isSelected = row.id === selectedPath;
  function activate() {
    if (row.hasChildren) navigation.toggleExpanded(row.id);
    else navigation.onSelect(row.node);
  }
  return (
    <button
      ref={(element) => {
        navigation.setItemRef(index, element);
      }}
      type="button"
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={row.hasChildren ? isExpanded : undefined}
      aria-selected={isSelected}
      tabIndex={index === navigation.activeIndex ? 0 : -1}
      className={`tree-item ${isSelected ? "selected" : ""}`}
      style={{ paddingInlineStart: `${10 + row.depth * 14}px` }}
      onFocus={() => navigation.setActiveIndex(index)}
      onClick={activate}
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
        {iconForNode(row.node)}
      </span>
      <span className="tree-item-label">{row.node.name}</span>
      <span className="tree-item-meta">
        {row.node.type === "directory"
          ? "Folder"
          : row.node.extension || "file"}
      </span>
    </button>
  );
}

export function TreeExplorer({
  rootNode,
  selectedPath,
  onSelect,
  compact = false,
}: TreeExplorerProps) {
  const navigation = useTreeNavigation(rootNode, onSelect);
  if (!rootNode) {
    return null;
  }

  return (
    <div
      className={`tree-shell ${compact ? "compact" : ""}`}
      role="tree"
      aria-label="Explorer tree"
      onKeyDown={(event) => handleTreeKeyDown(event, navigation)}
    >
      {navigation.rows.map((row, index) => (
        <TreeItem
          key={row.id}
          row={row}
          index={index}
          selectedPath={selectedPath}
          navigation={navigation}
        />
      ))}
    </div>
  );
}
