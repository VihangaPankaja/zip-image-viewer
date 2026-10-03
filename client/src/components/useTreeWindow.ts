import { useLayoutEffect, useRef, useState } from "react";
import type { ExplorerNode } from "./TreeExplorer";

// The windowed row is 44px high with 3px spacing; keep this in sync with explorer.css.
const rowHeight = 47;
export function useTreeWindow(root: ExplorerNode | null) {
  const treeRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);
  useLayoutEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    const measure = () => setViewportHeight(tree.clientHeight || 400);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tree);
    return () => observer.disconnect();
  }, [root]);
  useLayoutEffect(() => {
    if (treeRef.current) treeRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [root]);
  function revealIndex(index: number) {
    const tree = treeRef.current;
    if (!tree) return;
    const top = index * rowHeight;
    if (
      top < tree.scrollTop ||
      top + rowHeight > tree.scrollTop + tree.clientHeight
    ) {
      tree.scrollTop = top;
      setScrollTop(top);
    }
  }
  function range(length: number): [number, number] {
    if (length <= 500) return [0, length];
    const start = Math.max(
      0,
      Math.min(length - 1, Math.floor(scrollTop / rowHeight) - 5),
    );
    return [
      start,
      Math.min(length, start + Math.ceil(viewportHeight / rowHeight) + 10),
    ];
  }
  return { treeRef, setScrollTop, revealIndex, range };
}
