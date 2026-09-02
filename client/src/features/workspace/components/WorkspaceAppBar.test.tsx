import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceAppBar } from "./WorkspaceAppBar";

describe("WorkspaceAppBar", () => {
  it("switches workspace views and opens the download composer", async () => {
    const onSelectView = vi.fn();
    const onAddDownloads = vi.fn();
    const user = userEvent.setup();
    render(
      <WorkspaceAppBar
        activeView="downloads"
        onAddDownloads={onAddDownloads}
        onOpenSettings={vi.fn()}
        onSelectView={onSelectView}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Explore" }));
    await user.click(screen.getByRole("button", { name: "Add downloads" }));

    expect(onSelectView).toHaveBeenCalledWith("explore");
    expect(onAddDownloads).toHaveBeenCalledOnce();
  });
});
