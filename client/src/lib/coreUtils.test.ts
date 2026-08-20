import { describe, expect, it } from "vitest";
import {
  formatProgressMessage,
  getImageCacheKey,
  getThumbnailWindow,
  getWrappedPath,
  isTerminalJobStatus,
} from "./archiveUiUtils";
import {
  clampNumber,
  downloadOptionsToLegacySettings,
  normalizeDownloadOptions,
  normalizeDownloadSettings,
} from "./downloadOptions";
import {
  formatBytes,
  formatDate,
  formatEta,
  formatSpeed,
  formatTransferBytes,
} from "./formatterUtils";
import {
  classifyExtension,
  classifyNodeKind,
  getVideoMimeType,
} from "./mimeTypeSystem";
import {
  cloneAndSortTree,
  compareNodes,
  flattenTree,
  getFirstFilePath,
} from "./treeUtils";

describe("download option normalization", () => {
  it("clamps numeric input and falls back for invalid values", () => {
    expect(clampNumber("12", 1, 8, 4)).toBe(8);
    expect(clampNumber("-2", 1, 8, 4)).toBe(1);
    expect(clampNumber("invalid", 1, 8, 4)).toBe(4);
  });

  it("normalizes legacy and nested options", () => {
    expect(
      normalizeDownloadSettings({
        threadMode: "segmented",
        threadCount: 6,
        enableResume: false,
        maxRetries: -1,
        videoQuality: "720P",
      }),
    ).toMatchObject({
      threadMode: "segmented",
      threadCount: 6,
      enableResume: false,
      maxRetries: -1,
      videoQuality: "720p",
    });

    const options = normalizeDownloadOptions({
      transport: { mode: "single", threads: 2, multithread: false },
      retry: { maxRetries: 3, timeoutMs: 9_000 },
      media: { videoQuality: "480p" },
      extraction: { enabled: false },
      request: { headers: { Authorization: "token", Empty: null } },
    });
    expect(options).toEqual({
      transport: {
        mode: "single",
        threads: 2,
        multithread: false,
        resume: true,
      },
      retry: { maxRetries: 3, timeoutMs: 9_000 },
      media: { videoQuality: "480p" },
      extraction: { enabled: false },
      request: { headers: { Authorization: "token" } },
    });
    expect(downloadOptionsToLegacySettings(options)).toMatchObject({
      threadMode: "single",
      threadCount: 2,
      maxRetries: 3,
    });
  });
});

describe("tree and media helpers", () => {
  const tree = {
    type: "directory" as const,
    path: ".",
    name: "Album",
    children: [
      {
        type: "file" as const,
        path: "photo10.jpg",
        name: "photo10.jpg",
        extension: "jpg",
      },
      {
        type: "file" as const,
        path: "photo2.jpg",
        name: "photo2.jpg",
        extension: "jpg",
      },
      {
        type: "directory" as const,
        path: "notes",
        name: "notes",
        children: [
          {
            type: "file" as const,
            path: "notes/readme.md",
            name: "readme.md",
            extension: "md",
          },
        ],
      },
    ],
  };

  it("classifies previews and video MIME types", () => {
    expect(classifyExtension("JPG")).toBe("image");
    expect(classifyExtension("mkv")).toBe("video");
    expect(classifyExtension("flac")).toBe("audio");
    expect(classifyExtension("md")).toBe("text");
    expect(classifyExtension("bin")).toBe("binary");
    expect(classifyNodeKind(null)).toBe("directory");
    expect(classifyNodeKind(tree.children[0])).toBe("image");
    expect(getVideoMimeType("webm")).toBe("video/webm");
    expect(getVideoMimeType("unknown")).toBe("video/mp4");
  });

  it("sorts directories first and image number tails naturally", () => {
    const sorted = cloneAndSortTree(tree, "natural-tail");
    expect(sorted.children?.map((node) => node.name)).toEqual([
      "notes",
      "photo2.jpg",
      "photo10.jpg",
    ]);
    expect(
      compareNodes(tree.children[0], tree.children[1], "name-desc"),
    ).toBeGreaterThan(0);
    expect(
      compareNodes(tree.children[0], tree.children[1], "date-asc"),
    ).not.toBe(0);
  });

  it("flattens image folders and finds the first file recursively", () => {
    const flattened = flattenTree(tree);
    expect(flattened.nodesByPath.get("notes/readme.md")?.name).toBe(
      "readme.md",
    );
    expect(flattened.folderImages.get(".")).toEqual([
      "photo10.jpg",
      "photo2.jpg",
    ]);
    expect(flattened.folderPreview.get(".")).toBe("photo10.jpg");
    expect(getFirstFilePath(tree)).toBe("photo10.jpg");
    expect(getFirstFilePath(null)).toBe("");
  });
});

describe("display formatting helpers", () => {
  it("formats sizes, transfer rates, ETA, and dates", () => {
    expect(formatBytes(0)).toBe("Unknown size");
    expect(formatBytes(1_536)).toBe("1.5 KB");
    expect(formatTransferBytes(-1)).toBe("--");
    expect(formatTransferBytes(0)).toBe("0 B");
    expect(formatSpeed(2_048)).toBe("2.0 KB/s");
    expect(formatSpeed(0)).toBe("--");
    expect(formatEta(5)).toBe("5s");
    expect(formatEta(65)).toBe("1m 05s");
    expect(formatEta(3_661)).toBe("1h 01m 01s");
    expect(formatEta(Number.NaN)).toBe("--");
    expect(formatDate(null)).toBe("Date unknown");
    expect(formatDate("2024-01-02T00:00:00Z")).toContain("2024");
  });

  it("formats queue progress states", () => {
    expect(formatProgressMessage(null)).toBe("");
    expect(formatProgressMessage({ message: "Custom" })).toBe("Custom");
    expect(
      formatProgressMessage({
        phase: "downloading",
        downloadedBytes: 512,
        reportedSize: 1_024,
      }),
    ).toContain("512 B of 1.0 KB");
    expect(
      formatProgressMessage({
        phase: "downloading",
        isStalled: true,
        reportedSize: 1,
      }),
    ).toContain("stalled");
    expect(
      formatProgressMessage({
        phase: "extracting",
        extractedEntries: 2,
        totalEntries: 3,
      }),
    ).toContain("2 of 3");
    expect(formatProgressMessage({ phase: "queued" })).toBe(
      "Working on archive...",
    );
  });

  it("selects wrapped image neighbors and terminal states", () => {
    const items = Array.from({ length: 7 }, (_, index) => ({
      path: `p${index}`,
    }));
    expect(getThumbnailWindow(items, "p0", 1).map((item) => item.path)).toEqual(
      ["p6", "p0", "p1"],
    );
    expect(getThumbnailWindow(items.slice(0, 3), "missing", 1)).toHaveLength(3);
    expect(getWrappedPath(["a", "b"], 0, -1)).toBe("b");
    expect(getWrappedPath([], -1, 1)).toBe("");
    expect(getImageCacheKey("session", "image.jpg", "high")).toBe(
      "session:image.jpg:high",
    );
    expect(["ready", "error", "cancelled"].every(isTerminalJobStatus)).toBe(
      true,
    );
    expect(isTerminalJobStatus("downloading")).toBe(false);
  });
});
