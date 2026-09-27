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

it("filters media while preserving folder expansion, order and keyboard selection", () => {
  const onSelect = vi.fn();
  render(
    <TreeExplorer
      rootNode={root}
      selectedPath="photos/cover.jpg"
      onSelect={onSelect}
    />,
  );
  fireEvent.click(screen.getByRole("treeitem", { name: "Photos" }));
  const filter = screen.getByRole("combobox", { name: "Media type" });
  fireEvent.change(filter, { target: { value: "image" } });
  expect(
    screen
      .getAllByRole("treeitem")
      .map((item) => item.getAttribute("aria-label")),
  ).toEqual(["Archive", "Photos", "Cover"]);
  expect(screen.getByRole("treeitem", { name: "Cover" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  fireEvent.keyDown(screen.getByRole("tree"), { key: "End" });
  fireEvent.keyDown(screen.getByRole("tree"), { key: "Enter" });
  expect(onSelect).toHaveBeenLastCalledWith(
    expect.objectContaining({ path: "photos/cover.jpg" }),
  );
  fireEvent.change(filter, { target: { value: "video" } });
  expect(
    screen.queryByRole("treeitem", { name: "Photos" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("treeitem", { name: "sample.mp4" })).toBeVisible();
  fireEvent.change(filter, { target: { value: "all" } });
  expect(screen.getByRole("treeitem", { name: "Cover" })).toBeVisible();
});

it("shows an empty filter result without selecting a folder", () => {
  const onSelect = vi.fn();
  render(
    <TreeExplorer
      rootNode={{ ...root, children: root.children?.slice(0, 1) }}
      selectedPath=""
      onSelect={onSelect}
    />,
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Media type" }), {
    target: { value: "video" },
  });
  expect(screen.getByText("No files match this media type.")).toBeVisible();
  expect(screen.queryByRole("tree")).not.toBeInTheDocument();
  expect(onSelect).not.toHaveBeenCalled();
});

it("filters a single-file root and restores it after no matches", () => {
  const onSelect = vi.fn();
  render(
    <TreeExplorer
      rootNode={{
        name: "movie.mp4",
        path: "movie.mp4",
        type: "file",
        extension: "mp4",
      }}
      selectedPath="movie.mp4"
      onSelect={onSelect}
    />,
  );
  const filter = screen.getByRole("combobox", { name: "Media type" });
  fireEvent.change(filter, { target: { value: "video" } });
  fireEvent.click(screen.getByRole("treeitem", { name: "movie.mp4" }));
  expect(onSelect).toHaveBeenCalledWith(
    expect.objectContaining({ path: "movie.mp4" }),
  );
  fireEvent.change(filter, { target: { value: "image" } });
  expect(screen.queryByRole("tree")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "No files match this media type.",
  );
  fireEvent.change(filter, { target: { value: "all" } });
  expect(screen.getByRole("treeitem", { name: "movie.mp4" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
