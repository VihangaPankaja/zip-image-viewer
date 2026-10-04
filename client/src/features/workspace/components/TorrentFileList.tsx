import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { Job, TorrentFile } from "../../../../../shared/contracts";
import type { Selection } from "./TorrentFileDialog";
import { FileGroup, FileStatusGroup } from "./TorrentFileGroups";

const filesPerPage = 200;

function groupFiles(files: TorrentFile[]) {
  const groups = new Map<string, TorrentFile[]>();
  for (const file of files) {
    const folder = file.path.includes("/")
      ? file.path.slice(0, file.path.lastIndexOf("/"))
      : "";
    const group = groups.get(folder) ?? [];
    group.push(file);
    groups.set(folder, group);
  }
  return groups;
}

function useFilePages(selection: Selection) {
  const { visible } = selection;
  const filterKey = JSON.stringify([
    selection.search,
    selection.mediaType,
    selection.status,
  ]);
  const [position, setPosition] = useState({ filterKey, page: 0 });
  const pageCount = Math.ceil(visible.length / filesPerPage);
  const page =
    position.filterKey === filterKey
      ? Math.min(position.page, Math.max(0, pageCount - 1))
      : 0;
  const listRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<"first" | "last" | null>(null);
  const matchingGroups = useMemo(() => groupFiles(visible), [visible]);
  const groups = groupFiles(
    visible.slice(page * filesPerPage, (page + 1) * filesPerPage),
  );
  function controls() {
    return [
      ...(listRef.current?.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]:not(:disabled)',
      ) ?? []),
    ];
  }
  function rove(target: HTMLInputElement) {
    for (const control of controls())
      control.tabIndex = control === target ? 0 : -1;
  }
  useLayoutEffect(() => {
    const inputs = controls();
    const focused = inputs.find((input) => input === document.activeElement);
    const target = pendingFocus.current === "last" ? inputs.at(-1) : inputs[0];
    if (pendingFocus.current && target) target.focus();
    const active = pendingFocus.current ? target : (focused ?? target);
    if (active) rove(active);
    pendingFocus.current = null;
  });
  function goToPage(nextPage: number, focus?: "first" | "last") {
    pendingFocus.current = focus ?? null;
    setPosition({ filterKey, page: nextPage });
    if (listRef.current) listRef.current.scrollTop = 0;
  }
  return {
    listRef,
    page,
    pageCount,
    groups,
    matchingGroups,
    goToPage,
    rove,
    controls,
  };
}

function navigateFileChoices(
  event: KeyboardEvent<HTMLDivElement>,
  inputs: HTMLInputElement[],
  page: number,
  pageCount: number,
  goToPage: (page: number, focus?: "first" | "last") => void,
) {
  if (
    !(event.target instanceof HTMLInputElement) ||
    event.target.type !== "checkbox"
  )
    return;
  const index = inputs.indexOf(event.target);
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    const last = event.key === "End";
    const nextPage = last ? pageCount - 1 : 0;
    if (page !== nextPage) goToPage(nextPage, last ? "last" : "first");
    else inputs[last ? inputs.length - 1 : 0]?.focus();
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const target =
      index + direction >= 0 ? inputs.at(index + direction) : undefined;
    if (target) target.focus();
    else if (page + direction >= 0 && page + direction < pageCount)
      goToPage(page + direction, direction > 0 ? "first" : "last");
  }
}

function FilePagination({
  page,
  pageCount,
  total,
  submitting,
  goToPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  submitting: boolean;
  goToPage: (page: number) => void;
}) {
  return pageCount > 1 ? (
    <div className="torrent-file-pagination" aria-label="File pages">
      <button
        type="button"
        className="ghost-button"
        disabled={submitting || page === 0}
        onClick={() => goToPage(page - 1)}
      >
        Previous files
      </button>
      <span>
        Files {page * filesPerPage + 1}–
        {Math.min(total, (page + 1) * filesPerPage)} of {total}
      </span>
      <button
        type="button"
        className="ghost-button"
        disabled={submitting || page === pageCount - 1}
        onClick={() => goToPage(page + 1)}
      >
        Next files
      </button>
    </div>
  ) : null;
}

export function FileList({
  job,
  selection,
}: {
  job: Job;
  selection: Selection;
}) {
  const { selecting, submitting, selected, change, visible } = selection;
  const pages = useFilePages(selection);
  const { listRef, page, pageCount, groups, matchingGroups, goToPage, rove } =
    pages;
  return (
    <div className="torrent-file-results">
      <FilePagination
        page={page}
        pageCount={pageCount}
        total={visible.length}
        submitting={submitting}
        goToPage={goToPage}
      />
      <div
        ref={listRef}
        className="torrent-file-list"
        role="region"
        aria-label="Torrent files"
        aria-busy={submitting}
        aria-describedby={selecting ? "torrent-keyboard-help" : undefined}
        tabIndex={selecting ? undefined : 0}
        onKeyDown={(event) =>
          navigateFileChoices(
            event,
            pages.controls(),
            page,
            pageCount,
            goToPage,
          )
        }
        onFocusCapture={(event) => {
          if (
            event.target instanceof HTMLInputElement &&
            event.target.type === "checkbox"
          )
            rove(event.target);
        }}
      >
        <fieldset disabled={submitting} className="torrent-file-fields">
          {[...groups].map(([folder, files]) =>
            selecting ? (
              <FileGroup
                key={folder}
                folder={folder}
                files={files}
                matchingFiles={matchingGroups.get(folder) ?? files}
                selected={selected}
                onChange={change}
              />
            ) : (
              <FileStatusGroup
                key={folder}
                job={job}
                folder={folder}
                files={files}
                selection={selection}
              />
            ),
          )}
        </fieldset>
        {!visible.length ? <p>No files match your filters.</p> : null}
      </div>
    </div>
  );
}
