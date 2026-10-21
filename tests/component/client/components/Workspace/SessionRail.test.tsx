import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionRail } from "../../../../../client/src/components/Workspace/SessionRail";

describe("SessionRail", () => {
  it("links the empty preview rail to Downloads", async () => {
    const onOpenDownloads = vi.fn();
    render(
      <SessionRail
        activeId=""
        sessions={[]}
        onSelect={vi.fn()}
        onOpenDownloads={onOpenDownloads}
      />,
    );
    expect(screen.getByText(/No previews available yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "View downloads" }));
    expect(onOpenDownloads).toHaveBeenCalledOnce();
  });
  it("selects a ready session alongside a playable torrent", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <SessionRail
        activeId="download-1"
        onSelect={onSelect}
        onOpenDownloads={vi.fn()}
        sessions={[
          {
            detail: "68% · 12 MB/s",
            id: "download-1",
            label: "summer.mp4",
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

    await user.click(screen.getByRole("button", { name: /open brand-kit.zip/i }));

    expect(onSelect).toHaveBeenCalledWith("session-2");
    expect(screen.getByText("68% · 12 MB/s")).toBeInTheDocument();
  });
});
