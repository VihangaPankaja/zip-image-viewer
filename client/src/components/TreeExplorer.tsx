import { useId, useMemo, useState, type ReactNode } from "react";
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
import { MediaTypeFilter } from "./MediaTypeFilter";
import {
  handleTreeKeyDown,
  useTreeNavigation,
  type FlatTreeItem,
  type TreeNavigation,
} from "./TreeExplorerNavigation";
import { useTreeWindow } from "./useTreeWindow";

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
};

function TreeItem({
  row,
  index,
  selectedPath,
  navigation,
}: {
  row: FlatTreeItem;
  index: number;
  selectedPath: string;
  navigation: Omit<TreeNavigation, "rows">;
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
      data-row-index={index}
      aria-posinset={row.position}
      aria-setsize={row.siblingCount}
      title={row.node.path}
      aria-expanded={row.hasChildren ? isExpanded : undefined}
      aria-selected={isSelected}
      tabIndex={index === navigation.activeIndex ? 0 : -1}
      className={`tree-item ${isSelected ? "selected" : ""}`}
      style={{ paddingInlineStart: `${6 + Math.min(row.depth, 6) * 10}px` }}
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
      <span className="tree-item-label">{row.node.name}</span>{" "}
      <span className="tree-item-meta">
        {row.node.type === "directory" ? "Folder" : row.node.extension || "file"}
      </span>
    </button>
  );
}

function filterMediaTree(
  node: ExplorerNode,
  mediaType: string,
  search: string,
): ExplorerNode | null {
  if (node.type === "file")
    return (mediaType === "all" || classifyNodeKind(node) === mediaType) &&
      node.path.toLowerCase().includes(search)
      ? node
      : null;
  const children = (node.children ?? [])
    .map((child) => filterMediaTree(child, mediaType, search))
    .filter((child): child is ExplorerNode => child !== null);
  return children.length ? { ...node, children } : null;
}

export function TreeExplorer({ rootNode, selectedPath, onSelect }: TreeExplorerProps) {
  const [density, setDensity] = useState("compact");
  const [mediaType, setMediaType] = useState("all");
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const filteredRoot = useMemo(
    () =>
      rootNode && (mediaType !== "all" || query)
        ? filterMediaTree(rootNode, mediaType, query)
        : rootNode,
    [rootNode, mediaType, query],
  );
  const { treeRef, range, revealIndex, setScrollTop, rowHeight, onFocusCapture } = useTreeWindow(
    filteredRoot,
    density,
  );
  const navigation = useTreeNavigation(
    filteredRoot ?? rootNode,
    onSelect,
    revealIndex,
    Boolean(query),
  );
  // Passing every row to each item makes React development prop comparisons quadratic.
  const { rows, ...itemNavigation } = navigation;
  const windowed = rows.length > 500;
  const [start, end] = range(rows.length);
  const items = rows
    .slice(start, end)
    .map((row, offset) => (
      <TreeItem
        key={row.id}
        row={row}
        index={start + offset}
        selectedPath={selectedPath}
        navigation={itemNavigation}
      />
    ));
  if (!rootNode) return null;

  return (
    <div className="tree-browser">
      <ExplorerTools
        search={search}
        onSearch={setSearch}
        mediaType={mediaType}
        onMediaType={setMediaType}
        density={density}
        onDensity={setDensity}
      />
      {!filteredRoot ? (
        <p role="status">
          {query ? "No files match your filters." : "No files match this media type."}
        </p>
      ) : (
        <div
          ref={treeRef}
          className={`tree-shell ${windowed ? "tree-windowed" : ""}`}
          data-density={density}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          onFocusCapture={onFocusCapture}
          tabIndex={
            windowed && (navigation.activeIndex < start || navigation.activeIndex >= end)
              ? 0
              : undefined
          }
          role="tree"
          aria-label="Explorer tree"
          onKeyDown={(event) => handleTreeKeyDown(event, navigation)}
        >
          {windowed ? (
            <TreeWindow start={start} rowCount={rows.length} rowHeight={rowHeight}>
              {items}
            </TreeWindow>
          ) : (
            items
          )}
        </div>
      )}
    </div>
  );
}

function TreeWindow({
  start,
  rowCount,
  rowHeight,
  children,
}: {
  start: number;
  rowCount: number;
  rowHeight: number;
  children: ReactNode;
}) {
  // A rounding pixel lets Firefox scroll the final row fully into view.
  return (
    <div className="tree-window-canvas" style={{ height: rowCount * rowHeight + 1 }}>
      <div className="tree-window-rows" style={{ top: start * rowHeight }}>
        {children}
      </div>
    </div>
  );
}
function ExplorerTools({
  search,
  onSearch,
  mediaType,
  onMediaType,
  density,
  onDensity,
}: {
  search: string;
  onSearch: (search: string) => void;
  mediaType: string;
  onMediaType: (mediaType: string) => void;
  density: string;
  onDensity: (density: string) => void;
}) {
  const densityId = useId();
  return (
    <div className="explorer-tools">
      <label className="explorer-search">
        Search explorer files
        <input
          type="search"
          value={search}
          onChange={(event) => onSearch(event.currentTarget.value)}
        />
      </label>
      <MediaTypeFilter value={mediaType} onChange={onMediaType} />
      <label className="explorer-density" htmlFor={densityId}>
        Row density
        <select
          id={densityId}
          value={density}
          onChange={(event) => onDensity(event.currentTarget.value)}
        >
          <option value="compact">Compact</option>
          <option value="comfortable">Comfortable</option>
        </select>
      </label>
    </div>
  );
}
