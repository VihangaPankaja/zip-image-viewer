import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceAppBar } from "./WorkspaceAppBar";

describe("WorkspaceAppBar", () => {
  it("submits a newline-separated batch and reports its parsed count", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <WorkspaceAppBar
        isLoading={false}
        onOpenSettings={vi.fn()}
        onSubmit={onSubmit}
        setUrl={vi.fn()}
        url={"https://example.com/a.zip\nhttps://example.com/b.zip"}
      />,
    );

    expect(
      screen.getByText("2 of 50 URLs ready to queue."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add to queue" }));
    expect(onSubmit).toHaveBeenCalledWith([
      "https://example.com/a.zip",
      "https://example.com/b.zip",
    ]);
  });
});
