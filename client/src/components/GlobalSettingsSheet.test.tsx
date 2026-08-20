import { render, screen } from "@testing-library/react";
import { GlobalSettingsSheet } from "./GlobalSettingsSheet";

describe("GlobalSettingsSheet", () => {
  it("groups settings in a native dialog", () => {
    render(
      <GlobalSettingsSheet
        settingsOpen
        setSettingsOpen={vi.fn()}
        downloadSettings={{
          enableMultithread: true,
          enableResume: true,
          maxRetries: 3,
          threadCount: 4,
          threadMode: "auto",
          videoQuality: "auto",
        }}
        setDownloadSettings={vi.fn()}
        normalizeDownloadSettings={(value) => value as never}
        sortMode="name"
        setSortMode={vi.fn()}
        sortOptions={[{ value: "name", label: "Name" }]}
        previewQuality="balanced"
        setPreviewQuality={vi.fn()}
        previewQualityOptions={[{ value: "balanced", label: "Balanced" }]}
        videoTranscodeQuality="auto"
        setVideoTranscodeQuality={vi.fn()}
        videoTranscodeQualityOptions={[{ value: "auto", label: "Auto" }]}
        keyboardSettings={{ jumpSeconds: 5, rateStep: 0.25 }}
        setKeyboardSettings={vi.fn()}
        explorerColumns={{ date: true, path: true, size: true, type: true }}
        setExplorerColumns={vi.fn()}
        downloadThreadModeOptions={[{ value: "auto", label: "Auto" }]}
        downloadRetryOptions={[{ value: 3, label: "3" }]}
        clampNumber={(value) => Number(value)}
      />,
    );

    expect(screen.getByRole("dialog")).toHaveProperty("tagName", "DIALOG");
    expect(screen.getByRole("group", { name: "Downloads" })).toBeVisible();
    expect(
      screen.getByRole("group", { name: "Preview and explorer" }),
    ).toBeVisible();
  });
});
