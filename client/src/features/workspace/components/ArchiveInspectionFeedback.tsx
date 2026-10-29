export function ArchiveInspectionFeedback({
  pending,
  error,
  onRetry,
  label,
}: {
  pending: boolean;
  error?: string;
  onRetry: () => void;
  label: string;
}) {
  return (
    <>
      {pending ? <p role="status">Reading {label} contents…</p> : null}
      {error ? (
        <div>
          <p role="alert">{error}</p>
          <button className="ghost-button" type="button" onClick={onRetry}>
            Retry inspection
          </button>
        </div>
      ) : null}
    </>
  );
}
