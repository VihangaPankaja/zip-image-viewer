import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { SelectionExplorer as Explorer } from "../../../../client/src/features/workspace/components/SelectionExplorer";
import { useSelectionExport } from "../../../../client/src/features/workspace/useSelectionExport";
import type { TreeExplorerProps } from "../../../../client/src/components/TreeExplorer";

function SelectionExplorer({ sessionId, ...props }: TreeExplorerProps & { sessionId: string }) {
  const exportSelection = useSelectionExport(sessionId, props.rootNode);
  return <Explorer {...props} sessionId={sessionId} exportSelection={exportSelection} />;
}

const root = {
  name: "Archive",
  path: ".",
  type: "directory" as const,
  children: [
    {
      name: "album",
      path: "album",
      type: "directory" as const,
      children: [
        { name: "日本語.txt", path: "album/日本語.txt", type: "file" as const },
        { name: "second.txt", path: "album/second.txt", type: "file" as const },
      ],
    },
    { name: "other.mp4", path: "other.mp4", type: "file" as const },
  ],
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("selects folders with keyboard and pointer, preserves hidden selection and posts a native download", async () => {
  const onSelect = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ entries: 3, bytes: 12, requiresConfirmation: false })),
      ),
    ),
  );
  const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function (
    this: HTMLFormElement,
  ) {
    expect(this.method).toBe("post");
    expect(this.action).toContain("/api/sessions/owned/export");
    expect(new FormData(this).get("selection")).toBe(
      JSON.stringify({ paths: ["album"], confirmed: false }),
    );
  });
  render(
    <SelectionExplorer sessionId="owned" rootNode={root} selectedPath="" onSelect={onSelect} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Select files" }));
  const folder = screen.getByRole("treeitem", { name: "album Folder" });
  fireEvent.focus(folder);
  fireEvent.keyDown(screen.getByRole("tree"), { key: " " });
  expect(folder).toHaveAttribute("aria-selected", "true");
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search explorer files" }), {
    target: { value: "other.mp4" },
  });
  expect(screen.getByRole("status")).toHaveTextContent("3 entries selected");
  fireEvent.click(screen.getByRole("button", { name: "Download selection" }));
  await waitFor(() => expect(submit).toHaveBeenCalledOnce());
  const responseFrame = document.querySelector("iframe");
  if (!responseFrame?.contentDocument) throw new Error("Missing download response frame");
  responseFrame.contentDocument.body.textContent = JSON.stringify({
    error: "Two exports are already running.",
  });
  fireEvent.load(responseFrame);
  expect(screen.getByRole("alert")).toHaveTextContent("Two exports are already running.");
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(screen.getByRole("button", { name: "Download selection" })).toBeDisabled();
});

it("supports expanding a selected folder and excluding a child, and resets choices for another session", () => {
  const { rerender } = render(
    <SelectionExplorer sessionId="owned" rootNode={root} selectedPath="" onSelect={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Select files" }));
  fireEvent.click(screen.getByRole("treeitem", { name: "album Folder" }));
  fireEvent.click(screen.getByRole("button", { name: "Expand album" }));
  const child = screen.getByRole("treeitem", { name: "日本語.txt file" });
  expect(child).toHaveAttribute("aria-selected", "true");
  fireEvent.click(child);
  expect(child).toHaveAttribute("aria-selected", "false");
  expect(screen.getByRole("status")).toHaveTextContent("1 entries selected");
  rerender(
    <SelectionExplorer sessionId="another" rootNode={root} selectedPath="" onSelect={vi.fn()} />,
  );
  expect(screen.queryByRole("button", { name: "Download selection" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Select files" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

it("requires confirmation for a large export and displays preflight failures without losing selection", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => undefined);
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ entries: 1000, bytes: 600 * 1024 ** 2, requiresConfirmation: true }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "File is not available yet." }), { status: 409 }),
    );
  vi.stubGlobal("fetch", fetch);
  render(
    <SelectionExplorer sessionId="owned" rootNode={root} selectedPath="" onSelect={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Select files" }));
  fireEvent.click(screen.getByRole("treeitem", { name: "other.mp4 file" }));
  fireEvent.click(screen.getByRole("button", { name: "Download selection" }));
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Download selection" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("File is not available yet.");
  expect(screen.getByRole("treeitem", { name: "other.mp4 file" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
