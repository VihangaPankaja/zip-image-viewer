export function DownloadDialogFooter({
  readyCount,
  invalidCount,
  duplicateCount,
  isSubmitting,
}: {
  readyCount: number;
  invalidCount: number;
  duplicateCount: number;
  isSubmitting: boolean;
}) {
  return (
    <footer>
      <span role="status" aria-atomic="true">
        {readyCount} of 50 ready
        {invalidCount ? ` · ${invalidCount} invalid` : ""}
        {duplicateCount ? ` · ${duplicateCount} duplicates` : ""}
      </span>
      <button
        className="primary-button"
        type="submit"
        disabled={isSubmitting || !readyCount || invalidCount > 0 || duplicateCount > 0}
      >
        {isSubmitting ? "Adding to queue…" : "Add to queue"}
      </button>
    </footer>
  );
}
