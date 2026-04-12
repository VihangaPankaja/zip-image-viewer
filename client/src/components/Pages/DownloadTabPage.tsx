import React from "react";
import { formatBytes } from "../../lib/formatterUtils";

export function DownloadTabPage({
  theme,
  setTheme,
  zipUrl,
  setZipUrl,
  handleSubmit,
  isLoading,
  activeJob,
  downloadSettings,
  visualPercent,
  visualPercentLabel,
  visualProgressWidth,
  transferLabel,
  speedLabel,
  etaLabel,
  modeLabel,
  threadLabel,
  retryLabel,
  formatProgressMessage,
  clearArchive,
  session,
  error,
  oversizePrompt,
  setOversizePrompt,
  setIsLoading,
}) {
  return (
    <section className="hero-panel">
      <div className="hero-topbar">
        <div>
          <p className="eyebrow">ZIP image and file explorer</p>
          <h1>Archive Atlas</h1>
          <p className="hero-copy">
            Paste a public ZIP URL, let the server unpack it, then browse the
            folder structure with a fast viewer and image-first navigation.
          </p>
        </div>
        <button
          className="ghost-button theme-toggle"
          type="button"
          onClick={() =>
            setTheme((current: string) =>
              current === "dark" ? "light" : "dark",
            )
          }
        >
          {theme === "dark" ? "Switch to light" : "Switch to dark"}
        </button>
      </div>

      <form className="url-form" onSubmit={handleSubmit}>
        <label className="input-shell" htmlFor="zip-url">
          <span className="input-label">Public ZIP URL</span>
          <input
            id="zip-url"
            type="url"
            placeholder="https://example.com/file-or-archive"
            value={zipUrl}
            onChange={(event) => setZipUrl(event.target.value)}
            autoComplete="off"
          />
        </label>

        <button className="primary-button" type="submit" disabled={isLoading}>
          {activeJob
            ? "Loading file..."
            : isLoading
              ? "Opening file..."
              : "Open file"}
        </button>
      </form>

      <div className="message-card">
        Download tuning, explorer columns, sorting defaults, and keyboard
        shortcuts are now configured from the Global settings sheet.
      </div>

      {activeJob ? (
        <div className="progress-card" aria-live="polite">
          <div className="progress-card-head">
            <strong>
              {activeJob.phase === "transcoding"
                ? `Transcoding (${activeJob.videoQuality || downloadSettings.videoQuality})`
                : activeJob.phase === "extracting"
                  ? "Preparing archive"
                  : "Downloading archive"}
            </strong>
            <span>{visualPercentLabel}</span>
          </div>
          <div
            className={`progress-bar-shell ${visualPercent == null ? "indeterminate" : ""}`}
          >
            <div
              className="progress-bar-fill"
              style={
                visualPercent == null
                  ? undefined
                  : { width: visualProgressWidth }
              }
            />
          </div>
          <div className="progress-stats-grid">
            <div className="progress-stat-cell">
              <span className="progress-stat-label">Transferred</span>
              <strong>{transferLabel}</strong>
            </div>
            <div className="progress-stat-cell">
              <span className="progress-stat-label">Speed</span>
              <strong>{speedLabel}</strong>
            </div>
            <div className="progress-stat-cell">
              <span className="progress-stat-label">ETA</span>
              <strong>{etaLabel}</strong>
            </div>
            <div className="progress-stat-cell">
              <span className="progress-stat-label">Mode</span>
              <strong>{`${modeLabel} (${threadLabel}x)`}</strong>
            </div>
            <div className="progress-stat-cell">
              <span className="progress-stat-label">Retries</span>
              <strong>{retryLabel}</strong>
            </div>
            <div className="progress-stat-cell">
              <span className="progress-stat-label">Status</span>
              <strong>
                {activeJob?.isStalled
                  ? "Stalled"
                  : activeJob?.phase === "transcoding"
                    ? "Transcoding"
                    : activeJob?.phase === "extracting"
                      ? "Extracting"
                      : "Downloading"}
              </strong>
            </div>
          </div>
          <div className="progress-meta-row">
            <span>{formatProgressMessage(activeJob)}</span>
            <button
              className="ghost-button compact-button"
              type="button"
              onClick={() => clearArchive(true)}
            >
              Cancel load
            </button>
          </div>
        </div>
      ) : null}

      <div className="status-row">
        <div className="status-pill">Port 8080 ready</div>
        <div className="status-pill">1 GB prompt threshold</div>
        <div className="status-pill">Auto-cleanup enabled</div>
        {session ? (
          <button
            className="ghost-button compact-button"
            type="button"
            onClick={() => clearArchive(true)}
          >
            Clear opened archive
          </button>
        ) : null}
      </div>

      {error ? <div className="message-card error">{error}</div> : null}
      {oversizePrompt ? (
        <div className="message-card warning">
          <div>
            This archive reports {formatBytes(oversizePrompt.reportedSize)}.
            Continue downloading anyway?
          </div>
          <div className="message-actions">
            <button
              className="ghost-button"
              type="button"
              onClick={() => setOversizePrompt(null)}
            >
              Cancel
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={async () => {
                if (!oversizePrompt?.jobId) {
                  return;
                }
                setIsLoading(true);
                setOversizePrompt(null);
                await fetch(
                  `/api/session-jobs/${oversizePrompt.jobId}/confirm`,
                  {
                    method: "POST",
                  },
                ).catch(() => {});
              }}
            >
              Proceed download
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
