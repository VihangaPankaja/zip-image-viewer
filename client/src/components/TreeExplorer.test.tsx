import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TreeExplorer, type ExplorerNode } from "./TreeExplorer";

const root: ExplorerNode = {
  name: "Archive",
  path: ".",
  type: "directory",
  children: [
    {
      name: "Photos",
      path: "photos",
      type: "directory",
      children: [
        {
          name: "Cover",
          path: "photos/cover.jpg",
          type: "file",
          extension: "jpg",
        },
      ],
    },
    ...["mp4", "mp3", "txt", "zip", "bin"].map((extension) => ({
      name: `sample.${extension}`,
      path: `sample.${extension}`,
      type: "file" as const,
      extension,
    })),
  ],
};

it("navigates folders and selects files with the keyboard", () => {
  const onSelect = vi.fn();
  render(
    <TreeExplorer
      rootNode={root}
      selectedPath="photos/cover.jpg"
      onSelect={onSelect}
    />,
  );
  const tree = screen.getByRole("tree");
  fireEvent.keyDown(tree, { key: "Home" });
  expect(screen.getByRole("treeitem", { name: "Archive" })).toHaveFocus();
  fireEvent.keyDown(tree, { key: "ArrowRight" });
  const photos = screen.getByRole("treeitem", { name: "Photos" });
  expect(photos).toHaveFocus();
  fireEvent.keyDown(tree, { key: "ArrowRight" });
  expect(photos).toHaveAttribute("aria-expanded", "true");
  fireEvent.keyDown(tree, { key: "ArrowDown" });
  const cover = screen.getByRole("treeitem", { name: "Cover" });
  expect(cover).toHaveFocus();
  expect(cover).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(tree, { key: "Enter" });
  expect(onSelect).toHaveBeenCalledWith(
    expect.objectContaining({ path: "photos/cover.jpg" }),
  );
  fireEvent.keyDown(tree, { key: "ArrowLeft" });
  expect(photos).toHaveFocus();
  fireEvent.keyDown(tree, { key: "ArrowLeft" });
  expect(photos).toHaveAttribute("aria-expanded", "false");
  fireEvent.keyDown(tree, { key: "End" });
  expect(screen.getByRole("treeitem", { name: "sample.bin" })).toHaveFocus();
  fireEvent.keyDown(tree, { key: "ArrowUp" });
  expect(screen.getByRole("treeitem", { name: "sample.zip" })).toHaveFocus();
  fireEvent.keyDown(tree, { key: " " });
  expect(onSelect).toHaveBeenLastCalledWith(
    expect.objectContaining({ path: "sample.zip" }),
  );
});

it("supports pointer activation and resets navigation when the archive changes", () => {
  const onSelect = vi.fn();
  const { rerender } = render(
    <TreeExplorer
      rootNode={root}
      selectedPath=""
      onSelect={onSelect}
      compact
    />,
  );
  fireEvent.click(screen.getByRole("treeitem", { name: "Photos" }));
  fireEvent.click(screen.getByRole("treeitem", { name: "Cover" }));
  expect(onSelect).toHaveBeenCalledWith(
    expect.objectContaining({ path: "photos/cover.jpg" }),
  );
  rerender(
    <TreeExplorer
      rootNode={{ name: "Empty", path: "empty", type: "directory" }}
      selectedPath=""
      onSelect={onSelect}
    />,
  );
  expect(screen.getAllByRole("treeitem")).toHaveLength(1);
  expect(screen.getByRole("treeitem")).toHaveAttribute("tabindex", "0");
  rerender(
    <TreeExplorer rootNode={null} selectedPath="" onSelect={onSelect} />,
  );
  expect(screen.queryByRole("tree")).not.toBeInTheDocument();
});
