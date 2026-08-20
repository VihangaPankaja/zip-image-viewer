import type { FormEvent } from "react";
import {
  getBatchValidationMessage,
  MAX_BATCH_URLS,
  parseWorkspaceUrls,
} from "../workspaceUrls";

type WorkspaceAppBarProps = {
  isLoading: boolean;
  onOpenSettings: () => void;
  onSubmit: (urls: readonly string[]) => void;
  setUrl: (value: string) => void;
  url: string;
};

export function WorkspaceAppBar({
  isLoading,
  onOpenSettings,
  onSubmit,
  setUrl,
  url,
}: WorkspaceAppBarProps) {
  const urls = parseWorkspaceUrls(url);
  const validationMessage = getBatchValidationMessage(urls);
  const isDisabled = isLoading || Boolean(validationMessage);

  function submitBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validationMessage) {
      onSubmit(urls);
    }
  }

  return (
    <div className="workspace-appbar">
      <div className="workspace-brand">
        <p className="panel-label">ZIP Image Viewer</p>
        <h1>Media workspace</h1>
      </div>
      <form className="workspace-url-action" onSubmit={submitBatch}>
        <label htmlFor="workspace-url">Add public URLs</label>
        <textarea
          id="workspace-url"
          value={url}
          placeholder="Paste public ZIP or media URLs, one per line"
          rows={2}
          onChange={(event) => setUrl(event.currentTarget.value)}
          aria-describedby="workspace-url-status"
        />
        <p
          id="workspace-url-status"
          className="workspace-url-status"
          aria-live="polite"
        >
          {validationMessage ||
            `${urls.length} of ${MAX_BATCH_URLS} URLs ready to queue.`}
        </p>
        <button
          className="primary-button compact-button"
          type="submit"
          disabled={isDisabled}
        >
          {isLoading ? "Adding…" : "Add to queue"}
        </button>
      </form>
      <button
        className="ghost-button compact-button"
        type="button"
        onClick={onOpenSettings}
      >
        Settings
      </button>
    </div>
  );
}
