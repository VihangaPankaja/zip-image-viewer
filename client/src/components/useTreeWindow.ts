import { useLayoutEffect, useRef, useState } from "react";
import type { ExplorerNode } from "./TreeExplorer";

export function useTreeWindow(root: ExplorerNode | null, density: string) {
  const treeRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);
  const [rowHeight, setRowHeight] = useState(44);
  const resizedScrollTop = useRef<number | null>(null);
  useLayoutEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    const row = tree.querySelector<HTMLElement>(".tree-item");
    const measure = () => {
      const viewport = tree.clientHeight || 400;
      const height = tree.querySelector(".tree-item")?.getBoundingClientRect().height || 44;
      if (height !== rowHeight || viewport !== viewportHeight) {
        let top = (tree.scrollTop / rowHeight) * height;
        const focusedIndex = Number(
          tree.querySelector<HTMLElement>(".tree-item:focus")?.dataset.rowIndex,
        );
        if (Number.isFinite(focusedIndex)) {
          const focusedTop = focusedIndex * height;
          if (focusedTop < top) top = focusedTop;
          else if (focusedTop + height > top + viewport) top = focusedTop + height - viewport;
        }
        resizedScrollTop.current = top;
        setScrollTop(top);
        setRowHeight(height);
        setViewportHeight(viewport);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tree);
    if (row) observer.observe(row);
    return () => observer.disconnect();
  }, [root, density, rowHeight, viewportHeight]);
  useLayoutEffect(() => {
    const tree = treeRef.current;
    if (tree && resizedScrollTop.current !== null) {
      // Apply after the canvas grows so the browser does not clamp to its old height.
      tree.scrollTop = resizedScrollTop.current;
      setScrollTop(tree.scrollTop);
      resizedScrollTop.current = null;
    }
  }, [rowHeight, viewportHeight]);
  useLayoutEffect(() => {
    if (treeRef.current) treeRef.current.scrollTop = 0;
    resizedScrollTop.current = null;
    setScrollTop(0);
  }, [root, density]);
  function revealIndex(index: number) {
    const tree = treeRef.current;
    if (!tree) return;
    const top = index * rowHeight;
    if (top < tree.scrollTop || top + rowHeight > tree.scrollTop + tree.clientHeight) {
      tree.scrollTop = top;
      setScrollTop(top);
    }
  }
  function range(length: number): [number, number] {
    if (length <= 500) return [0, length];
    const start = Math.max(0, Math.min(length - 1, Math.floor(scrollTop / rowHeight) - 5));
    return [start, Math.min(length, start + Math.ceil(viewportHeight / rowHeight) + 10)];
  }
  return { treeRef, setScrollTop, revealIndex, range, rowHeight };
}
