import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { jobSchema } from "../../../../../shared/contracts";
import { TorrentFileDialog, TorrentReviewAction } from "./TorrentFileDialog";

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

it("combines media and path filters for folder selection without losing hidden choices or totals", async () => {
  const user = userEvent.setup();
  const submit = vi.fn().mockResolvedValue(undefined);
  const episodeJob = job();
  episodeJob.torrentFiles.push({
    ...episodeJob.torrentFiles[0],
    id: "3",
    path: "film/episode-2.MKV",
    size: 2000,
  });
  render(
    <TorrentFileDialog job={episodeJob} onClose={vi.fn()} onSubmit={submit} />,
  );
  await user.click(screen.getByRole("button", { name: "Select none" }));
  await user.click(screen.getByRole("checkbox", { name: "notes.txt" }));
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Media type" }),
    "video",
  );
  expect(screen.getByText("2 of 4 files shown")).toBeVisible();
  expect(
    screen.queryByRole("checkbox", { name: "film/subtitles.srt" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: "film" }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "3 of 4 files selected · 2.9 KB",
  );
  await user.type(screen.getByRole("searchbox"), "episode");
  expect(screen.getByText("1 of 4 files shown")).toBeVisible();
  await user.click(screen.getByRole("checkbox", { name: "film" }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "2 of 4 files selected · 1020 B",
  );
  await user.clear(screen.getByRole("searchbox"));
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Media type" }),
    "all",
  );
  expect(screen.getByRole("checkbox", { name: "film" })).toBePartiallyChecked();
  expect(screen.getByRole("checkbox", { name: "notes.txt" })).toBeChecked();
  await user.click(
    screen.getByRole("button", { name: "Start selected download" }),
  );
  expect(submit).toHaveBeenCalledWith(episodeJob.id, ["0", "2"]);
});

it("treats dotfiles as extensionless when filtering torrent media", async () => {
  const user = userEvent.setup();
  const dotfiles = job();
  dotfiles.torrentFiles = [".mp4", "folder/.txt", "folder/.notes.txt"].map(
    (path, index) => ({ ...dotfiles.torrentFiles[0], id: String(index), path }),
  );
  render(
    <TorrentFileDialog job={dotfiles} onClose={vi.fn()} onSubmit={vi.fn()} />,
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Media type" }),
    "binary",
  );
  expect(screen.getByRole("checkbox", { name: ".mp4" })).toBeVisible();
  expect(screen.getByRole("checkbox", { name: "folder/.txt" })).toBeVisible();
  expect(
    screen.queryByRole("checkbox", { name: "folder/.notes.txt" }),
  ).not.toBeInTheDocument();
});

it("shows live file states without changing selection and combines status, media and path filters", async () => {
  const user = userEvent.setup();
  const active = job();
  active.status = "downloading";
  active.phase = "downloading";
  active.torrentFiles[0] = {
    ...active.torrentFiles[0],
    selected: true,
    complete: true,
    downloadedBytes: 1000,
  };
  active.torrentFiles[1].selected = true;
  const submit = vi.fn();
  const { rerender } = render(
    <TorrentReviewAction job={active} onSubmit={submit} />,
  );
  await user.click(screen.getByRole("button", { name: "View files" }));
  const dialog = screen.getByRole("dialog", { name: "Torrent files" });
  const list = within(dialog).getByRole("region", { name: "Torrent files" });
  list.focus();
  await user.tab();
  expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();
  await user.tab({ shift: true });
  expect(list).toHaveFocus();
  expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
  expect(
    within(dialog).queryByRole("button", { name: /Start/ }),
  ).not.toBeInTheDocument();
  expect(
    within(dialog).getByText("Downloaded · preparing", {
      selector: ".torrent-file-state",
    }),
  ).toBeVisible();
  expect(within(dialog).getByRole("status")).toHaveTextContent(
    "2 of 3 files selected · 1.1 KB",
  );
  const status = within(dialog).getByRole("combobox", { name: "File status" });
  await user.selectOptions(status, "downloading");
  expect(within(dialog).getByText("subtitles.srt")).toBeVisible();
  expect(within(dialog).getByRole("group", { name: "film" })).toBeVisible();
  expect(within(dialog).getByText("1 of 3 files shown")).toBeVisible();
  await user.selectOptions(
    within(dialog).getByRole("combobox", { name: "Media type" }),
    "video",
  );
  expect(
    within(dialog).getByText("No files match your filters."),
  ).toBeVisible();
  await user.selectOptions(status, "all");
  expect(within(dialog).getByText("movie.mp4")).toBeVisible();
  await user.type(within(dialog).getByRole("searchbox"), "notes");
  await user.selectOptions(
    within(dialog).getByRole("combobox", { name: "Media type" }),
    "all",
  );
  await user.selectOptions(status, "skipped");
  expect(within(dialog).getByText("notes.txt")).toBeVisible();
  expect(
    within(dialog).getByText("Skipped", { selector: "span" }),
  ).toBeVisible();
  const form = dialog.querySelector("form");
  expect(form).not.toBeNull();
  if (form) fireEvent.submit(form);
  expect(submit).not.toHaveBeenCalled();
  await user.clear(within(dialog).getByRole("searchbox"));
  await user.selectOptions(status, "available");
  expect(
    within(dialog).getByText("No files match your filters."),
  ).toBeVisible();
  rerender(
    <TorrentReviewAction
      job={{ ...active, status: "ready", phase: "ready" }}
      onSubmit={submit}
    />,
  );
  expect(within(dialog).getByText("movie.mp4")).toBeVisible();
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it.each([
  ["queued", "queued", "Queued"],
  ["paused", "paused", "Paused"],
  ["awaiting_confirmation", "confirm", "Needs confirmation"],
  ["downloading", "resolving", "Checking existing data"],
  ["error", "error", "Failed"],
  ["cancelled", "cancelled", "Cancelled"],
] as const)(
  "reports %s honestly even when completion metadata is stale",
  (status, phase, label) => {
    const active = job();
    active.status = status;
    active.phase = phase;
    active.torrentFiles[0] = {
      ...active.torrentFiles[0],
      selected: true,
      complete: true,
    };
    render(
      <TorrentFileDialog job={active} onSubmit={vi.fn()} onClose={vi.fn()} />,
    );
    expect(
      screen.getByText(label, { selector: ".torrent-file-state" }),
    ).toBeVisible();
    expect(
      screen.queryByText("Available", { selector: ".torrent-file-state" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByText("Skipped", { selector: ".torrent-file-state" }),
    ).toHaveLength(2);
  },
);
