import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceLayout } from "./WorkspaceLayout";

describe("WorkspaceLayout", () => {
  it("keeps sessions and the file tree together beside preview", async () => {
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
    expect(
      screen.getByRole("region", { name: "Explorer sidebar" }),
    ).toHaveTextContent("Sessions paneFiles pane");
    expect(
      screen.queryByRole("radio", { name: "Sessions" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Back to files")).toHaveAttribute(
      "for",
      "workspace-pane-files",
    );
  });
});
