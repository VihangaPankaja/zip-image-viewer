import type { Dispatch, SetStateAction } from "react";
import { CustomDropdown } from "./Common/CustomDropdown";

type DownloadSettings = {
  enableMultithread: boolean;
  enableResume: boolean;
  maxRetries: number;
  threadCount: number;
  threadMode: string;
  videoQuality: string;
};

type KeyboardSettings = {
  jumpSeconds: number;
  rateStep: number;
};

type ExplorerColumns = {
  date: boolean;
  path: boolean;
  size: boolean;
  type: boolean;
};

type DropdownOption = {
  label: string;
  value: number | string;
};

type GlobalSettingsSheetProps = {
  settingsOpen: boolean;
  setSettingsOpen: (value: boolean) => void;
  downloadSettings: DownloadSettings;
  setDownloadSettings: Dispatch<SetStateAction<DownloadSettings>>;
  normalizeDownloadSettings: (value: unknown) => DownloadSettings;
  sortMode: string;
  setSortMode: (value: string) => void;
  sortOptions: DropdownOption[];
  previewQuality: string;
  setPreviewQuality: (value: string) => void;
  previewQualityOptions: DropdownOption[];
  videoTranscodeQuality: string;
  setVideoTranscodeQuality: (value: string) => void;
  videoTranscodeQualityOptions: DropdownOption[];
  keyboardSettings: KeyboardSettings;
  setKeyboardSettings: Dispatch<SetStateAction<KeyboardSettings>>;
  explorerColumns: ExplorerColumns;
  setExplorerColumns: Dispatch<SetStateAction<ExplorerColumns>>;
  downloadThreadModeOptions: DropdownOption[];
  downloadRetryOptions: DropdownOption[];
  clampNumber: (
    value: string,
    min: number,
    max: number,
    fallback: number,
  ) => number;
};

type DownloadUpdateProps = Pick<
  GlobalSettingsSheetProps,
  "normalizeDownloadSettings" | "setDownloadSettings"
>;
type DownloadConfigurationProps = DownloadUpdateProps &
  Pick<
    GlobalSettingsSheetProps,
    "downloadRetryOptions" | "downloadSettings" | "downloadThreadModeOptions"
  >;
type PreviewConfigurationProps = Pick<
  GlobalSettingsSheetProps,
  | "previewQuality"
  | "previewQualityOptions"
  | "setPreviewQuality"
  | "setSortMode"
  | "setVideoTranscodeQuality"
  | "sortMode"
  | "sortOptions"
  | "videoTranscodeQuality"
  | "videoTranscodeQualityOptions"
>;
type KeyboardConfigurationProps = Pick<
  GlobalSettingsSheetProps,
  "clampNumber" | "keyboardSettings" | "setKeyboardSettings"
>;
type ToggleConfigurationProps = DownloadUpdateProps &
  Pick<
    GlobalSettingsSheetProps,
    "downloadSettings" | "explorerColumns" | "setExplorerColumns"
  >;

function updateDownloadSettings(
  props: DownloadUpdateProps,
  patch: Record<string, unknown>,
) {
  props.setDownloadSettings((current) =>
    props.normalizeDownloadSettings({ ...current, ...patch }),
  );
}

function SettingsHeader({
  setSettingsOpen,
}: Pick<GlobalSettingsSheetProps, "setSettingsOpen">) {
  return (
    <div className="panel-header">
      <div className="panel-title-group">
        <p className="panel-label">Global settings</p>
        <h2 id="global-settings-title">Download, explorer, and shortcuts</h2>
      </div>
      <button
        className="ghost-button compact-button"
        type="button"
        onClick={() => setSettingsOpen(false)}
      >
        Close
      </button>
    </div>
  );
}

function DownloadConfiguration(props: DownloadConfigurationProps) {
  const { downloadSettings } = props;
  return (
    <fieldset className="settings-group">
      <legend>Downloads</legend>
      <CustomDropdown
        id="settings-download-thread-mode"
        label="Thread mode"
        value={downloadSettings.threadMode}
        options={props.downloadThreadModeOptions}
        onChange={(value) =>
          updateDownloadSettings(props, { threadMode: value })
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
            updateDownloadSettings(props, {
              threadCount: event.target.value,
            })
          }
        />
      </label>
      <CustomDropdown
        id="settings-download-max-retries"
        label="Max retries"
        value={downloadSettings.maxRetries}
        options={props.downloadRetryOptions}
        onChange={(value) =>
          updateDownloadSettings(props, { maxRetries: value })
        }
      />
    </fieldset>
  );
}

function PreviewConfiguration(props: PreviewConfigurationProps) {
  return (
    <fieldset className="settings-group">
      <legend>Preview and explorer</legend>
      <CustomDropdown
        id="settings-sort-mode"
        label="Default sort"
        value={props.sortMode}
        options={props.sortOptions}
        onChange={(value) => props.setSortMode(String(value))}
      />
      <CustomDropdown
        id="settings-preview-quality"
        label="Default preview quality"
        value={props.previewQuality}
        options={props.previewQualityOptions}
        onChange={(value) => props.setPreviewQuality(String(value))}
      />
      <CustomDropdown
        id="settings-video-transcode-quality"
        label="Video transcode quality"
        value={props.videoTranscodeQuality}
        options={props.videoTranscodeQualityOptions}
        onChange={(value) => props.setVideoTranscodeQuality(String(value))}
      />
    </fieldset>
  );
}

function KeyboardConfiguration(props: KeyboardConfigurationProps) {
  const { keyboardSettings, setKeyboardSettings } = props;
  return (
    <fieldset className="settings-group">
      <legend>Keyboard</legend>
      <label className="input-shell">
        <span className="input-label">Seek jump seconds</span>
        <input
          type="number"
          min="1"
          max="30"
          value={keyboardSettings.jumpSeconds}
          onChange={(event) =>
            setKeyboardSettings((current) => ({
              ...current,
              jumpSeconds: props.clampNumber(event.target.value, 1, 30, 5),
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
            setKeyboardSettings((current) => ({
              ...current,
              rateStep: Math.max(0.05, Number(event.target.value) || 0.25),
            }))
          }
        />
      </label>
    </fieldset>
  );
}

const EXPLORER_COLUMN_OPTIONS: Array<{
  key: keyof ExplorerColumns;
  label: string;
}> = [
  { key: "type", label: "Show Type column" },
  { key: "size", label: "Show Size column" },
  { key: "date", label: "Show Date column" },
  { key: "path", label: "Show Path column" },
];

function ToggleConfiguration(props: ToggleConfigurationProps) {
  return (
    <fieldset className="settings-group">
      <legend>Behavior and columns</legend>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={props.downloadSettings.enableMultithread}
          onChange={(event) =>
            updateDownloadSettings(props, {
              enableMultithread: event.target.checked,
            })
          }
        />
        <span>Enable multithread</span>
      </label>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={props.downloadSettings.enableResume}
          onChange={(event) =>
            updateDownloadSettings(props, {
              enableResume: event.target.checked,
            })
          }
        />
        <span>Enable resume</span>
      </label>
      {EXPLORER_COLUMN_OPTIONS.map(({ key, label }) => (
        <label className="toggle-row" key={key}>
          <input
            type="checkbox"
            checked={props.explorerColumns[key]}
            onChange={(event) =>
              props.setExplorerColumns((current) => ({
                ...current,
                [key]: event.target.checked,
              }))
            }
          />
          <span>{label}</span>
        </label>
      ))}
    </fieldset>
  );
}

function showModalDialog(dialog: HTMLDialogElement | null): void {
  if (dialog && !dialog.open) dialog.showModal();
}

export function GlobalSettingsSheet(props: GlobalSettingsSheetProps) {
  if (!props.settingsOpen) {
    return null;
  }

  return (
    <dialog
      ref={showModalDialog}
      className="settings-dialog"
      aria-labelledby="global-settings-title"
      onClose={() => props.setSettingsOpen(false)}
    >
      <div className="settings-sheet">
        <SettingsHeader setSettingsOpen={props.setSettingsOpen} />
        <div className="download-settings-grid">
          <DownloadConfiguration {...props} />
          <PreviewConfiguration {...props} />
          <KeyboardConfiguration {...props} />
          <ToggleConfiguration {...props} />
        </div>
      </div>
    </dialog>
  );
}
