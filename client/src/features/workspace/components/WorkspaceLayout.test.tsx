import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceLayout } from "./WorkspaceLayout";

describe("WorkspaceLayout", () => {
  it("offers accessible mobile navigation between sessions, files, and preview", async () => {
    const user = userEvent.setup();

    render(
      <WorkspaceLayout
        files={<p>Files pane</p>}
        header={<h1>Media workspace</h1>}
        metadata={<p>Metadata pane</p>}
        preview={<p>Preview pane</p>}
        sessions={<p>Sessions pane</p>}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "Files" }));

    expect(
      screen.getByRole("navigation", { name: "Workspace views" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Media workspace" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Files" })).toBeChecked();
  });
});
