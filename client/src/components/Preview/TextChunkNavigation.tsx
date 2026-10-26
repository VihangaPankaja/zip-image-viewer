import { useLayoutEffect, useRef } from "react";
import { TEXT_PREVIEW_BYTES, type TextPreviewChunk } from "../../../../shared/contracts";

export function TextChunkNavigation({
  chunk,
  loading,
  loadOffset,
}: {
  chunk: TextPreviewChunk;
  loading: boolean;
  loadOffset: (offset: number) => void;
}) {
  const navigation = useRef<HTMLElement>(null);
  const pending = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (loading || !pending.current) return;
    const target = pending.current;
    const previous = navigation.current?.querySelector<HTMLButtonElement>(
      'button[data-chunk="Previous chunk"]',
    );
    (target.disabled ? previous : target)?.focus({ preventScroll: true });
    pending.current = null;
  }, [chunk, loading]);
  const first = chunk.offset === 0;
  const last = chunk.nextOffset >= chunk.totalBytes;
  const actions = [
    { label: "First chunk", offset: 0, disabled: first },
    {
      label: "Previous chunk",
      offset: Math.max(0, chunk.offset - TEXT_PREVIEW_BYTES),
      disabled: first,
    },
    { label: "Next chunk", offset: chunk.nextOffset, disabled: last },
    {
      label: "Last chunk",
      offset: Math.max(0, chunk.totalBytes - TEXT_PREVIEW_BYTES),
      disabled: last,
    },
  ];
  return (
    <nav ref={navigation} className="text-preview-actions" aria-label="Text chunks">
      {actions.map(({ label, offset, disabled }) => (
        <button
          type="button"
          className="ghost-button"
          key={label}
          data-chunk={label}
          disabled={disabled}
          aria-disabled={loading || disabled}
          onClick={(event) => {
            if (loading) return;
            pending.current = event.currentTarget;
            loadOffset(offset);
          }}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
