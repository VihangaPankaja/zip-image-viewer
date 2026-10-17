import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jobSchema } from "../../../../../shared/contracts";
import { TorrentFileDialog } from "./TorrentFileDialog";

const activeJob = () =>
  jobSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    url: "https://example.com/film.torrent",
    sourceKind: "torrent",
    status: "downloading",
    phase: "downloading",
    percent: 10,
    createdAt: 1,
    updatedAt: 1,
    torrentFiles: [
      {
        id: "0",
        path: "film.mp4",
        size: 1000,
        selected: true,
        downloadedBytes: 100,
        complete: false,
      },
      {
        id: "1",
        path: "extra.mkv",
        size: 1000,
        selected: true,
        downloadedBytes: 100,
        complete: false,
      },
      {
        id: "2",
        path: "skipped.mp4",
        size: 1000,
        selected: false,
        downloadedBytes: 0,
        complete: false,
      },
    ],
  });
const props = () => ({ job: activeJob(), onClose: vi.fn(), onSubmit: vi.fn() });
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("torrent early video", () => {
  it("wraps keyboard focus through visible player controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ state: "ready", message: "Ready" })),
        ),
    );
    const user = userEvent.setup();
    render(<TorrentFileDialog {...props()} />);
    await user.click(
      screen.getByRole("button", { name: "Play now: film.mp4" }),
    );
    await screen.findByLabelText("Early video preview");
    const close = screen.getByRole("button", { name: "Close" });
    close.focus();
    await user.tab({ shift: true });
    expect(
      screen.getByRole("button", { name: "Download first" }),
    ).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
  });

  it("retains the media source after StrictMode replays the stream effect", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockImplementation(() =>
          Promise.resolve(
            new Response(JSON.stringify({ state: "ready", message: "Ready" })),
          ),
        ),
    );
    render(
      <StrictMode>
        <TorrentFileDialog {...props()} />
      </StrictMode>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Play now: film.mp4" }),
    );
    expect(await screen.findByLabelText("Early video preview")).toHaveAttribute(
      "src",
      expect.stringContaining("/video/stream?fileId=0"),
    );
  });
  it("gates the stream on metadata and restores row focus after Download first", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          state: "ready",
          message: "Ready to play verified pieces.",
        }),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(<TorrentFileDialog {...props()} />);
    expect(screen.getAllByRole("button", { name: /Play now:/ })).toHaveLength(
      2,
    );
    const trigger = screen.getByRole("button", { name: "Play now: film.mp4" });
    await user.click(trigger);
    const video = await screen.findByLabelText("Early video preview");
    expect(video).toHaveAttribute(
      "src",
      expect.stringContaining("/video/stream?fileId=0"),
    );
    fireEvent.waiting(video);
    expect(
      screen.getByText(/Waiting for verified pieces or peers/),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Download first" }));
    expect(
      screen.queryByLabelText("Early video preview"),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("shows fallback without opening a stream and retries failed metadata", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("Peers unavailable"))
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            state: "download-first",
            message: "This container needs a complete download.",
          }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(<TorrentFileDialog {...props()} />);
    await user.click(
      screen.getByRole("button", { name: "Play now: extra.mkv" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Peers unavailable",
    );
    const signal = fetcher.mock.calls[0][1]?.signal;
    await user.click(screen.getByRole("button", { name: "Retry playback" }));
    expect(
      await screen.findByText("This container needs a complete download."),
    ).toBeVisible();
    expect(signal?.aborted).toBe(true);
    expect(
      screen.queryByLabelText("Early video preview"),
    ).not.toBeInTheDocument();
  });

  it.each(["paused", "cancelled", "error"] as const)(
    "stops playback when the job becomes %s",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ state: "ready", message: "Ready" })),
          ),
      );
      const user = userEvent.setup();
      const initial = props();
      const { rerender } = render(<TorrentFileDialog {...initial} />);
      await user.click(
        screen.getByRole("button", { name: "Play now: film.mp4" }),
      );
      await screen.findByLabelText("Early video preview");
      rerender(
        <TorrentFileDialog
          {...initial}
          job={{
            ...initial.job,
            status,
            phase: "downloading",
          }}
        />,
      );
      await waitFor(() =>
        expect(
          screen.queryByLabelText("Early video preview"),
        ).not.toBeInTheDocument(),
      );
      expect(screen.getByText(/Playback stopped/)).toBeVisible();
    },
  );

  it("preserves playback position while completed files are indexed and become ready", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ state: "ready", message: "Ready" })),
      );
    vi.stubGlobal("fetch", fetcher);
    const initial = props();
    const { rerender } = render(<TorrentFileDialog {...initial} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Play now: film.mp4" }),
    );
    const video = await screen.findByLabelText("Early video preview");
    (video as HTMLVideoElement).currentTime = 5;
    const completedFiles = initial.job.torrentFiles.map((file) => ({
      ...file,
      complete: file.selected,
    }));
    rerender(
      <TorrentFileDialog
        {...initial}
        job={{
          ...initial.job,
          phase: "indexing",
          torrentFiles: completedFiles,
        }}
      />,
    );
    expect(screen.getByLabelText("Early video preview")).toBe(video);
    expect((video as HTMLVideoElement).currentTime).toBe(5);
    rerender(
      <TorrentFileDialog
        {...initial}
        job={{
          ...initial.job,
          status: "ready",
          phase: "ready",
          torrentFiles: completedFiles,
        }}
      />,
    );
    expect(screen.getByLabelText("Early video preview")).toBe(video);
    expect((video as HTMLVideoElement).currentTime).toBe(5);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("shows server errors and restarts a failed video with a fresh source", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Waiting for a peer" }), {
          status: 503,
        }),
      )
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ state: "ready", message: "Ready" })),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(<TorrentFileDialog {...props()} />);
    await user.click(
      screen.getByRole("button", { name: "Play now: film.mp4" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Waiting for a peer",
    );
    await user.click(screen.getByRole("button", { name: "Retry playback" }));
    const video = await screen.findByLabelText("Early video preview");
    fireEvent.error(video);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Playback could not continue",
    );
    expect(
      screen.queryByLabelText("Early video preview"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry playback" }));
    expect(await screen.findByLabelText("Early video preview")).toHaveAttribute(
      "src",
      expect.stringContaining("attempt=2"),
    );
  });

  it("aborts metadata when the player closes before it is ready", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(<TorrentFileDialog {...props()} />);
    await user.click(
      screen.getByRole("button", { name: "Play now: film.mp4" }),
    );
    expect(
      screen.queryByLabelText("Early video preview"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to files" }));
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});
