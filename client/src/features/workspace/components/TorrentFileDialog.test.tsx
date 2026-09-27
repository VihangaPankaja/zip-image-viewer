import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { jobSchema } from "../../../../../shared/contracts";
import { TorrentFileDialog } from "./TorrentFileDialog";

const job = () =>
  jobSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    url: "https://example.com/sample.torrent",
    status: "awaiting_selection",
    phase: "selecting",
    percent: null,
    createdAt: 1,
    updatedAt: 1,
    torrentFiles: [
      {
        id: "0",
        path: "film/movie.mp4",
        size: 1000,
        selected: false,
        downloadedBytes: 0,
        complete: false,
      },
      {
        id: "1",
        path: "film/subtitles.srt",
        size: 100,
        selected: false,
        downloadedBytes: 0,
        complete: false,
      },
      {
        id: "2",
        path: "notes.txt",
        size: 20,
        selected: false,
        downloadedBytes: 0,
        complete: false,
      },
    ],
  });

describe("TorrentFileDialog", () => {
  it("filters without losing choices, toggles folders and submits only known selected IDs", async () => {
    const user = userEvent.setup();
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error("Please retry"))
      .mockResolvedValueOnce(undefined);
    const close = vi.fn();
    render(<TorrentFileDialog job={job()} onClose={close} onSubmit={submit} />);
    await user.click(screen.getByRole("button", { name: "Select none" }));
    expect(
      screen.getByRole("button", { name: "Start selected download" }),
    ).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "0 of 3 files selected",
    );
    await user.click(screen.getByRole("checkbox", { name: "film" }));
    await user.click(
      screen.getByRole("checkbox", { name: "film/subtitles.srt" }),
    );
    expect(
      screen.getByRole("checkbox", { name: "film" }),
    ).toBePartiallyChecked();
    await user.type(screen.getByRole("searchbox"), "notes");
    expect(
      screen.queryByRole("checkbox", { name: "film/movie.mp4" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "notes.txt" }));
    await user.click(
      screen.getByRole("button", { name: "Start selected download" }),
    );
    expect(submit).toHaveBeenLastCalledWith(job().id, ["0", "2"]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Please retry");
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "2 of 3 files selected",
    );
    await user.click(
      screen.getByRole("button", { name: "Start selected download" }),
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
