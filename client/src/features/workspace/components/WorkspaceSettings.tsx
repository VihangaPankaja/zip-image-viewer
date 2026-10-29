import type { ComponentProps } from "react";
import { GlobalSettingsSheet } from "../../../components/GlobalSettingsSheet";
import type { WorkspacePageController } from "../useWorkspacePageController";
import {
  DOWNLOAD_RETRY_OPTIONS,
  DOWNLOAD_THREAD_MODE_OPTIONS,
  PREVIEW_QUALITY_OPTIONS,
  SORT_OPTIONS,
  VIDEO_TRANSCODE_QUALITY_OPTIONS,
} from "../../../lib/appConstants";
import {
  clampNumber,
  downloadOptionsToLegacySettings,
  normalizeDownloadOptions,
  normalizeDownloadSettings,
} from "../../../lib/downloadOptions";
type ViewProps = { controller: WorkspacePageController };
export function WorkspaceSettings({ controller }: ViewProps) {
  const { downloadSettings, queue, settings, state } = controller;
  const updateDownloadSettings: ComponentProps<
    typeof GlobalSettingsSheet
  >["setDownloadSettings"] = (update) => {
    settings.setDownloadOptions((current) =>
      normalizeDownloadOptions(
        typeof update === "function" ? update(downloadOptionsToLegacySettings(current)) : update,
      ),
    );
  };
  return (
    <GlobalSettingsSheet
      {...settings}
      {...state}
      onResetDevicePreferences={() => {
        settings.resetDevicePreferences();
        state.setSortMode("natural-tail");
        state.setPreviewQuality("balanced");
        state.setSearch("");
        state.setMediaType("all");
      }}
      maxConcurrent={queue.maxConcurrent}
      torrentLimits={queue.torrentLimits}
      onSetTorrentLimits={(limits) => queue.setTorrentLimits(limits).then(() => undefined)}
      onSetConcurrency={(value) => queue.setMaxConcurrent(value).then(() => undefined)}
      clampNumber={clampNumber}
      downloadRetryOptions={DOWNLOAD_RETRY_OPTIONS}
      downloadSettings={downloadSettings}
      downloadThreadModeOptions={DOWNLOAD_THREAD_MODE_OPTIONS}
      normalizeDownloadSettings={normalizeDownloadSettings}
      previewQualityOptions={PREVIEW_QUALITY_OPTIONS}
      setDownloadSettings={updateDownloadSettings}
      setVideoTranscodeQuality={(videoQuality) =>
        settings.setDownloadOptions((current) =>
          normalizeDownloadOptions({
            ...current,
            media: { ...current.media, videoQuality },
          }),
        )
      }
      sortOptions={SORT_OPTIONS}
      videoTranscodeQuality={downloadSettings.videoQuality}
      videoTranscodeQualityOptions={VIDEO_TRANSCODE_QUALITY_OPTIONS}
    />
  );
}
