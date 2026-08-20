import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExplorerTablePanel } from "./ExplorerTablePanel";

describe("ExplorerTablePanel", () => {
  it("opens a file from a keyboard-accessible name button", async () => {
    const user = userEvent.setup();
    const setSelectedPath = vi.fn();
    const file = {
      extension: "jpg",
      modifiedAt: 1,
      name: "example.jpg",
      path: "photos/example.jpg",
      size: 1024,
      type: "file" as const,
    };

    render(
      <ExplorerTablePanel
        sortedTree={{ name: "archive.zip", path: "", type: "directory" }}
        session={{ id: "session-1" }}
        explorerRows={[file]}
        selectedPath=""
        setSelectedPath={setSelectedPath}
        sortMode="name"
        setSortMode={vi.fn()}
        sortOptions={[{ value: "name", label: "Name" }]}
        explorerColumns={{ type: true, size: true, date: true, path: true }}
        formatDate={() => "Jan 1"}
        formatBytes={() => "1 KB"}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open example.jpg" }));

    expect(setSelectedPath).toHaveBeenCalledWith("photos/example.jpg");
    expect(screen.getByRole("table", { name: "Archive files" })).toBeVisible();
  });
});
