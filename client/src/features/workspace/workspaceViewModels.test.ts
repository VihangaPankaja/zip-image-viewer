import { describe, expect, it } from "vitest";
import { getImageNavigationTarget } from "./imageNavigation";
import { buildWorkspaceProgress } from "./workspaceProgress";

describe("workspace progress view model", () => {
  it("derives transcoding progress when the server has not supplied a percent", () => {
    expect(
      buildWorkspaceProgress({
        phase: "transcoding",
        transcodedEntries: 3,
        totalTranscodeEntries: 4,
      }),
    ).toEqual({ transfer: "3 / 4 files", visualPercent: "75%" });
  });

  it("formats byte progress and falls back to a live label", () => {
    expect(
      buildWorkspaceProgress({
        downloadedBytes: 512,
        phase: "downloading",
        reportedSize: 1_024,
      }),
    ).toEqual({ transfer: "512 B / 1.0 KB", visualPercent: "Live" });
  });
});

describe("image keyboard navigation", () => {
  const images = ["one.jpg", "two.jpg", "three.jpg"];

  it("selects neighbor and boundary targets", () => {
    expect(
      getImageNavigationTarget(
        "ArrowRight",
        images,
        1,
        "next.jpg",
        "previous.jpg",
      ),
    ).toBe("next.jpg");
    expect(
      getImageNavigationTarget(
        "ArrowLeft",
        images,
        1,
        "next.jpg",
        "previous.jpg",
      ),
    ).toBe("previous.jpg");
    expect(
      getImageNavigationTarget("Home", images, 1, "next.jpg", "previous.jpg"),
    ).toBe("one.jpg");
    expect(
      getImageNavigationTarget("End", images, 1, "next.jpg", "previous.jpg"),
    ).toBe("three.jpg");
  });

  it("returns an empty target when no image is selected", () => {
    expect(
      getImageNavigationTarget(
        "ArrowRight",
        images,
        -1,
        "next.jpg",
        "previous.jpg",
      ),
    ).toBe("");
  });
});
