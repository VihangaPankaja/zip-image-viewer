import { useLayoutEffect, useRef, useState, type FocusEvent } from "react";
import type { ExplorerNode } from "./TreeExplorer";

export function useTreeWindow(root: ExplorerNode | null, density: string) {
  const treeRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);
  const [rowHeight, setRowHeight] = useState(44);
  const resizedScrollTop = useRef<number | null>(null);
  const resizedFocusIndex = useRef<number | null>(null);
  const focusedRow = useRef<number | null>(null);
  useLayoutEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    const row = tree.querySelector<HTMLElement>(".tree-item");
    const measure = () => {
      const viewport =
        Math.floor(Math.min(tree.clientHeight, tree.getBoundingClientRect().height)) || 400;
      const height = tree.querySelector<HTMLElement>(".tree-item")?.offsetHeight || 44;
      if (height !== rowHeight || viewport !== viewportHeight) {
        let top = (tree.scrollTop / rowHeight) * height;
        if (document.activeElement !== document.body && !tree.contains(document.activeElement))
          focusedRow.current = null;
        resizedFocusIndex.current = focusedRow.current;
        if (resizedFocusIndex.current !== null) {
          const focusedTop = resizedFocusIndex.current * height;
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
    if (tree && resizedFocusIndex.current !== null) {
      const row = tree.querySelector<HTMLElement>(
        `[data-row-index="${resizedFocusIndex.current}"]`,
      );
      row?.focus({ preventScroll: true });
      if (row) resizedFocusIndex.current = null;
    }
  }, [rowHeight, viewportHeight, scrollTop]);
  useLayoutEffect(() => {
    if (treeRef.current) treeRef.current.scrollTop = 0;
    resizedScrollTop.current = null;
    resizedFocusIndex.current = null;
    focusedRow.current = null;
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
  function onFocusCapture(event: FocusEvent<HTMLDivElement>) {
    const index = Number((event.target as HTMLElement).dataset.rowIndex);
    focusedRow.current = Number.isFinite(index) ? index : null;
  }
  return { treeRef, setScrollTop, revealIndex, range, rowHeight, onFocusCapture };
}
