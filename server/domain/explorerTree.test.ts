import { describe, expect, it } from "vitest";
import { buildTree } from "./explorerTree.js";

describe("explorer tree", () => {
  it("builds nested directories and file metadata", () => {
    const result = buildTree(
      [
        {
          relativePath: "gallery/cover.JPG",
          type: "file",
          size: 42,
          modifiedAt: 10,
        },
        {
          relativePath: "gallery/pages/001.png",
          type: "file",
          size: 84,
          modifiedAt: 20,
        },
        {
          relativePath: "gallery",
          type: "directory",
          size: 0,
          modifiedAt: 30,
        },
      ],
      "fixture.zip",
    );

    expect(result.firstFilePath).toBe("gallery/cover.JPG");
    expect(result.stats.fileCount).toBe(2);
    expect(result.tree.children?.[0]).toMatchObject({
      name: "gallery",
      path: "gallery",
      type: "directory",
      modifiedAt: 30,
    });
    expect(result.tree.children?.[0]?.children?.[0]).toMatchObject({
      name: "cover.JPG",
      extension: "jpg",
      size: 42,
      parentPath: "gallery",
    });
  });

  it("returns an empty root for an empty archive", () => {
    expect(buildTree([], "empty.zip")).toEqual({
      tree: {
        name: "empty.zip",
        path: ".",
        type: "directory",
        parentPath: "",
        modifiedAt: 0,
        children: [],
      },
      firstFilePath: "",
      stats: { fileCount: 0 },
    });
  });
});
