import { flexRender } from "@tanstack/react-table";
import {
  type LegacyColumnDef,
  useLegacyTable,
} from "@tanstack/react-table/legacy";
import React, { useMemo } from "react";
import { CustomDropdown } from "./Common/CustomDropdown";

type ExplorerNode = {
  children?: ExplorerNode[];
  extension?: string;
  modifiedAt?: number;
  name: string;
  path: string;
  size?: number;
  type: "file" | "directory";
};
function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export type ExplorerTablePanelProps = {
  sortedTree: ExplorerNode | null;
  session: { id?: string } | null;
  explorerRows: readonly ExplorerNode[];
  selectedPath: string;
  setSelectedPath: (value: string) => void;
  sortMode: string;
  setSortMode: (value: string) => void;
  sortOptions: Array<{ value: string; label: string }>;
  explorerColumns: {
    type: boolean;
    size: boolean;
    date: boolean;
    path: boolean;
  };
  formatDate: (value: number) => string;
  formatBytes: (value: number) => string;
};

type ExplorerColumns = ExplorerTablePanelProps["explorerColumns"];

function buildColumns(
  visible: ExplorerColumns,
  formatBytes: (value: number) => string,
  formatDate: (value: number) => string,
): LegacyColumnDef<ExplorerNode>[] {
  const columns: LegacyColumnDef<ExplorerNode>[] = [
    {
      id: "name",
      accessorFn: (row) => row.name,
      header: "Name",
      cell: (context) => textValue(context.getValue()),
    },
  ];
  if (visible.type) {
    columns.push({
      id: "type",
      accessorFn: (row) => row.type,
      header: "Type",
      cell: (context) => textValue(context.getValue()),
    });
  }
  if (visible.size) {
    columns.push({
      id: "size",
      accessorFn: (row) => row.size,
      header: "Size",
      cell: (context) => {
        const value = context.getValue();
        return formatBytes(typeof value === "number" ? value : 0);
      },
    });
  }
  if (visible.date) {
    columns.push({
      id: "modifiedAt",
      accessorFn: (row) => row.modifiedAt,
      header: "Modified",
      cell: (context) => {
        const value = context.getValue();
        return formatDate(typeof value === "number" ? value : 0);
      },
    });
  }
  if (visible.path) {
    columns.push({
      id: "path",
      accessorFn: (row) => row.path,
      header: "Path",
      cell: (context) => textValue(context.getValue()),
    });
  }
  return columns;
}

function ExplorerPanelHeader({
  sortedTree,
  session,
  explorerRows,
  sortMode,
  setSortMode,
  sortOptions,
}: Pick<
  ExplorerTablePanelProps,
  | "sortedTree"
  | "session"
  | "explorerRows"
  | "sortMode"
  | "setSortMode"
  | "sortOptions"
>) {
  return (
    <div className="panel-header panel-header-stackable explorer-header">
      <div className="panel-title-group explorer-title-group">
        <p className="panel-label">Explorer</p>
        <h2 title={sortedTree?.name || "No archive loaded"}>
          {sortedTree?.name || "No archive loaded"}
        </h2>
      </div>
      <div className="sidebar-header-actions">
        {session ? (
          <span className="panel-chip">{explorerRows.length} entries</span>
        ) : null}
      </div>
      <CustomDropdown
        id="sort-mode-explorer"
        label="Sort"
        value={sortMode}
        options={sortOptions}
        onChange={(value) => setSortMode(String(value))}
        className="toolbar-select-shell-wide explorer-sort-shell"
      />
    </div>
  );
}

function ExplorerTable({
  explorerRows,
  columns,
  selectedPath,
  setSelectedPath,
}: Pick<
  ExplorerTablePanelProps,
  "explorerRows" | "selectedPath" | "setSelectedPath"
> & { columns: LegacyColumnDef<ExplorerNode>[] }) {
  const table = useLegacyTable({ data: [...explorerRows], columns });
  return (
    <div className="explorer-table-wrap">
      <table className="explorer-table">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} scope="col">
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className={row.original.path === selectedPath ? "active" : ""}
              onClick={() => {
                if (row.original.type === "file") {
                  setSelectedPath(row.original.path);
                }
              }}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExplorerTablePanel({
  sortedTree,
  session,
  explorerRows,
  selectedPath,
  setSelectedPath,
  sortMode,
  setSortMode,
  sortOptions,
  explorerColumns,
  formatDate,
  formatBytes,
}: ExplorerTablePanelProps) {
  const columns = useMemo(
    () => buildColumns(explorerColumns, formatBytes, formatDate),
    [explorerColumns, formatBytes, formatDate],
  );

  return (
    <section className="explorer-table-panel">
      <ExplorerPanelHeader
        sortedTree={sortedTree}
        session={session}
        explorerRows={explorerRows}
        sortMode={sortMode}
        setSortMode={setSortMode}
        sortOptions={sortOptions}
      />

      {!sortedTree ? (
        <div className="empty-card">
          <strong>Explorer is ready</strong>
          <p>Add a public URL to queue an archive and list its files here.</p>
        </div>
      ) : (
        <ExplorerTable
          explorerRows={explorerRows}
          columns={columns}
          selectedPath={selectedPath}
          setSelectedPath={setSelectedPath}
        />
      )}
    </section>
  );
}
