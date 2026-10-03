import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ExplorerNode } from "./TreeExplorer";

export type FlatTreeItem = {
  node: ExplorerNode;
  depth: number;
  id: string;
  parentId: string;
  hasChildren: boolean;
  position: number;
  siblingCount: number;
};

function flattenVisible(
  node: ExplorerNode,
  expanded: Set<string>,
  depth = 0,
  parentId = "",
  position = 1,
  siblingCount = 1,
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
      position,
      siblingCount,
    },
  ];

  if (hasChildren && expanded.has(id)) {
    for (const [index, child] of children.entries()) {
      rows.push(
        ...flattenVisible(
          child,
          expanded,
          depth + 1,
          id,
          index + 1,
          children.length,
        ),
      );
    }
  }

  return rows;
}

export type TreeNavigation = {
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
    } else if (current.hasChildren) {
      focusRow(navigation, navigation.activeIndex + 1);
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

export function handleTreeKeyDown(
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

export function useTreeNavigation(
  rootNode: ExplorerNode | null,
  onSelect: (node: ExplorerNode) => void,
  revealIndex: (index: number) => void,
  revealMatches: boolean,
): TreeNavigation {
  const rootPath = rootNode?.path ?? null;
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([rootPath || "."]),
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchCollapsed, setSearchCollapsed] = useState<Set<string>>(
    () => new Set(),
  );
  const visibleExpanded = useMemo(() => {
    if (!revealMatches || !rootNode) return expanded;
    const matches = expandedDirectories(rootNode);
    for (const id of searchCollapsed) matches.delete(id);
    return matches;
  }, [expanded, revealMatches, rootNode, searchCollapsed]);
  useEffect(() => setSearchCollapsed(new Set()), [rootNode, revealMatches]);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    setExpanded(new Set([rootPath || "."]));
    setActiveIndex(0);
  }, [rootPath]);
  const rows = useMemo(
    () => (rootNode ? flattenVisible(rootNode, visibleExpanded) : []),
    [rootNode, visibleExpanded],
  );
  useEffect(() => {
    setActiveIndex((current) =>
      rows.length ? Math.max(0, Math.min(rows.length - 1, current)) : 0,
    );
    itemRefs.current = itemRefs.current.slice(0, rows.length);
  }, [rows.length]);
  function toggleExpanded(id: string) {
    const update = revealMatches ? setSearchCollapsed : setExpanded;
    update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const pendingFocus = useRef<number | null>(null);
  useLayoutEffect(() => {
    const index = pendingFocus.current;
    if (index !== null && itemRefs.current[index]) {
      itemRefs.current[index]?.focus();
      pendingFocus.current = null;
    }
  });
  function focusItem(index: number) {
    pendingFocus.current = index;
    revealIndex(index);
    itemRefs.current[index]?.focus();
  }
  function setItemRef(index: number, element: HTMLButtonElement | null) {
    itemRefs.current[index] = element;
  }
  return {
    activeIndex,
    expanded: visibleExpanded,
    focusItem,
    onSelect,
    rows,
    setActiveIndex,
    setItemRef,
    toggleExpanded,
  };
}

function expandedDirectories(
  node: ExplorerNode,
  result = new Set<string>(),
): Set<string> {
  if (node.type === "directory") {
    result.add(node.path);
    for (const child of node.children ?? []) expandedDirectories(child, result);
  }
  return result;
}
