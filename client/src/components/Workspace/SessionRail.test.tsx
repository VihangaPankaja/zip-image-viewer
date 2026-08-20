import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionRail } from "./SessionRail";

describe("SessionRail", () => {
  it("selects a ready session without hiding active downloads", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <SessionRail
        activeId="download-1"
        onSelect={onSelect}
        sessions={[
          {
            detail: "68% · 12 MB/s",
            id: "download-1",
            label: "summer-assets.zip",
            state: "downloading",
          },
          {
            detail: "42 files",
            id: "session-2",
            label: "brand-kit.zip",
            state: "ready",
          },
        ]}
      />,
    );

    expect(screen.getByRole("list", { name: "Sessions" })).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /open brand-kit.zip/i }),
    );

    expect(onSelect).toHaveBeenCalledWith("session-2");
    expect(screen.getByText("68% · 12 MB/s")).toBeInTheDocument();
  });
});
