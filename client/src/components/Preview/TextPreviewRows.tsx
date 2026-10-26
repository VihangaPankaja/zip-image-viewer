import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { buildTextRows, findTextRows } from "../../features/workspace/textPreviewFormats";

function SearchText({ text, query }: { text: string; query: string }) {
  const index = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}

function useTextWindow(text: string, wrap: boolean) {
  const viewport = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(80);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(480);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => {
      const fontSize = Number.parseFloat(getComputedStyle(element).fontSize) || 13;
      setWidth(Math.max(8, Math.floor((element.clientWidth - 80) / (fontSize * 0.61))));
      setHeight(element.clientHeight || 480);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const rows = useMemo(() => buildTextRows(text, wrap ? width : 4096), [text, wrap, width]);
  useLayoutEffect(() => {
    if (viewport.current) viewport.current.scrollTop = 0;
    setTop(0);
  }, [text, wrap, width]);
  const start = Math.max(0, Math.min(rows.length - 1, Math.floor(top / 24) - 5));
  const end = Math.min(rows.length, start + Math.ceil(height / 24) + 10);
  function reveal(index: number) {
    const element = viewport.current;
    if (!element) return;
    element.scrollTop = index * 24;
    setTop(element.scrollTop);
    element.focus();
  }
  return { viewport, rows, start, end, setTop, reveal };
}

export function TextPreviewRows({
  text,
  wrap,
  query,
}: {
  text: string;
  wrap: boolean;
  query: string;
}) {
  const { viewport, rows, start, end, setTop, reveal } = useTextWindow(text, wrap);
  const matches = useMemo(() => findTextRows(text, rows, query), [text, rows, query]);
  function findNext() {
    const element = viewport.current;
    if (!element || !matches.length) return;
    const target = matches.find((index) => index * 24 > element.scrollTop + 1) ?? matches[0];
    reveal(target);
  }
  return (
    <>
      {query && (
        <div className="text-search-results">
          <span>{matches.length} matching display rows</span>
          <button
            type="button"
            className="ghost-button"
            disabled={!matches.length}
            onClick={findNext}
          >
            Find next
          </button>
        </div>
      )}
      {/* Keyboard users must be able to scroll the virtual content. */}
      <div
        ref={viewport}
        className="text-lines"
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The text viewport must support keyboard scrolling.
        tabIndex={0}
        role="region"
        aria-label="Text content"
        onScroll={(event) => setTop(event.currentTarget.scrollTop)}
      >
        <div className="text-lines-canvas" style={{ height: rows.length * 24 }}>
          <div className="text-lines-window" style={{ transform: `translateY(${start * 24}px)` }}>
            {rows.slice(start, end).map((row, index) => (
              <div className="text-line" key={start + index}>
                <span
                  className="text-line-number"
                  aria-label={row.continued ? `Line ${row.line} continued` : `Line ${row.line}`}
                >
                  {row.continued ? "↳" : row.line}
                </span>
                <span className="text-line-code">
                  <SearchText text={row.text} query={query} />
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="text-preview-note">
        Line numbers restart in each chunk; total lines unknown for truncated previews. Long lines
        use continuation rows. Copy includes the loaded text.
      </p>
    </>
  );
}
