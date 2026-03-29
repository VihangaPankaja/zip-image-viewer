/* eslint-disable no-unused-vars, @typescript-eslint/no-explicit-any */

type GlobalSettingsSheetProps = {
  settingsOpen: boolean;
  setSettingsOpen: (value: boolean) => void;
  downloadSettings: any;
  setDownloadSettings: (updater: any) => void;
  normalizeDownloadSettings: (value: any) => any;
  sortMode: string;
  setSortMode: (value: string) => void;
  sortOptions: Array<{ value: string; label: string }>;
  previewQuality: string;
  setPreviewQuality: (value: string) => void;
  previewQualityOptions: Array<{ value: string; label: string }>;
  videoTranscodeQuality: string;
  setVideoTranscodeQuality: (value: string) => void;
  videoTranscodeQualityOptions: Array<{ value: string; label: string }>;
  keyboardSettings: { jumpSeconds: number; rateStep: number };
  setKeyboardSettings: (updater: any) => void;
  explorerColumns: {
    type: boolean;
    size: boolean;
    date: boolean;
    path: boolean;
  };
  setExplorerColumns: (updater: any) => void;
  downloadThreadModeOptions: Array<{ value: string; label: string }>;
  downloadRetryOptions: Array<{ value: number; label: string }>;
  clampNumber: (
    value: string,
    min: number,
    max: number,
    fallback: number,
  ) => number;
  DropdownComponent: any;
};

export function GlobalSettingsSheet(props: GlobalSettingsSheetProps) {
  const {
    settingsOpen,
    setSettingsOpen,
    downloadSettings,
    setDownloadSettings,
    normalizeDownloadSettings,
    sortMode,
    setSortMode,
    sortOptions,
    previewQuality,
    setPreviewQuality,
    previewQualityOptions,
    videoTranscodeQuality,
    setVideoTranscodeQuality,
    videoTranscodeQualityOptions,
    keyboardSettings,
    setKeyboardSettings,
    explorerColumns,
    setExplorerColumns,
    downloadThreadModeOptions,
    downloadRetryOptions,
    clampNumber,
    DropdownComponent,
  } = props;

  if (!settingsOpen) {
    return null;
  }

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true">
      <div className="settings-sheet">
        <div className="panel-header">
          <div className="panel-title-group">
            <p className="panel-label">Global settings</p>
            <h2>Download, explorer, and shortcuts</h2>
          </div>
          <button
            className="ghost-button compact-button"
            type="button"
            onClick={() => setSettingsOpen(false)}
          >
            Close
          </button>
        </div>

        <div className="download-settings-grid">
          <DropdownComponent
            id="settings-download-thread-mode"
            label="Thread mode"
            value={downloadSettings.threadMode}
            options={downloadThreadModeOptions}
            onChange={(value: string) =>
              setDownloadSettings((current: any) =>
                normalizeDownloadSettings({
                  ...current,
                  threadMode: value,
                }),
              )
            }
          />

          <label className="input-shell">
            <span className="input-label">Thread count</span>
            <input
              type="number"
              min="1"
              max="8"
              value={downloadSettings.threadCount}
              disabled={
                !downloadSettings.enableMultithread ||
                downloadSettings.threadMode === "single"
              }
              onChange={(event) =>
                setDownloadSettings((current: any) =>
                  normalizeDownloadSettings({
                    ...current,
                    threadCount: event.target.value,
                  }),
                )
              }
            />
          </label>

          <DropdownComponent
            id="settings-download-max-retries"
            label="Max retries"
            value={downloadSettings.maxRetries}
            options={downloadRetryOptions}
            onChange={(value: number) =>
              setDownloadSettings((current: any) =>
                normalizeDownloadSettings({
                  ...current,
                  maxRetries: value,
                }),
              )
            }
          />

          <DropdownComponent
            id="settings-sort-mode"
            label="Default sort"
            value={sortMode}
            options={sortOptions}
            onChange={setSortMode}
          />

          <DropdownComponent
            id="settings-preview-quality"
            label="Default preview quality"
            value={previewQuality}
            options={previewQualityOptions}
            onChange={setPreviewQuality}
          />

          <DropdownComponent
            id="settings-video-transcode-quality"
            label="Video transcode quality"
            value={videoTranscodeQuality}
            options={videoTranscodeQualityOptions}
            onChange={setVideoTranscodeQuality}
          />

          <label className="input-shell">
            <span className="input-label">Seek jump seconds</span>
            <input
              type="number"
              min="1"
              max="30"
              value={keyboardSettings.jumpSeconds}
              onChange={(event) =>
                setKeyboardSettings((current: any) => ({
                  ...current,
                  jumpSeconds: clampNumber(event.target.value, 1, 30, 5),
                }))
              }
            />
          </label>

          <label className="input-shell">
            <span className="input-label">Speed step</span>
            <input
              type="number"
              min="0.05"
              max="1"
              step="0.05"
              value={keyboardSettings.rateStep}
              onChange={(event) =>
                setKeyboardSettings((current: any) => ({
                  ...current,
                  rateStep: Math.max(0.05, Number(event.target.value) || 0.25),
                }))
              }
            />
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={downloadSettings.enableMultithread}
              onChange={(event) =>
                setDownloadSettings((current: any) =>
                  normalizeDownloadSettings({
                    ...current,
                    enableMultithread: event.target.checked,
                  }),
                )
              }
            />
            <span>Enable multithread</span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={downloadSettings.enableResume}
              onChange={(event) =>
                setDownloadSettings((current: any) =>
                  normalizeDownloadSettings({
                    ...current,
                    enableResume: event.target.checked,
                  }),
                )
              }
            />
            <span>Enable resume</span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={explorerColumns.type}
              onChange={(event) =>
                setExplorerColumns((current: any) => ({
                  ...current,
                  type: event.target.checked,
                }))
              }
            />
            <span>Show Type column</span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={explorerColumns.size}
              onChange={(event) =>
                setExplorerColumns((current: any) => ({
                  ...current,
                  size: event.target.checked,
                }))
              }
            />
            <span>Show Size column</span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={explorerColumns.date}
              onChange={(event) =>
                setExplorerColumns((current: any) => ({
                  ...current,
                  date: event.target.checked,
                }))
              }
            />
            <span>Show Date column</span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={explorerColumns.path}
              onChange={(event) =>
                setExplorerColumns((current: any) => ({
                  ...current,
                  path: event.target.checked,
                }))
              }
            />
            <span>Show Path column</span>
          </label>
        </div>
      </div>
    </div>
  );
}
