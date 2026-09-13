import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { jobSchema, type Job } from "../../../../../shared/contracts";
import { DownloadDialog, DownloadManager } from "./DownloadManager";

function job(overrides: Partial<Job> = {}): Job {
  return jobSchema.parse({
    id: "2bf886fc-65bf-4e2f-b973-b607766b3131",
    url: "https://example.com/photos.zip",
    status: "downloading",
    phase: "downloading",
    percent: 42,
    canPause: true,
    queuePosition: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });
}

describe("DownloadManager", () => {
  it("shows live work and exposes pause and priority controls", async () => {
    const onPause = vi.fn();
    const onReorder = vi.fn();
    const user = userEvent.setup();
    render(
      <DownloadManager
        jobs={[
          job(),
          job({ id: "f86946a1-bcf7-4137-87c6-51502024367a", queuePosition: 1 }),
        ]}
        maxConcurrent={2}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onOpenSession={vi.fn()}
        onPause={onPause}
        onRemove={vi.fn()}
        onReorder={onReorder}
        onResume={vi.fn()}
        onRetry={vi.fn()}
        onSetConcurrency={vi.fn()}
      />,
    );

    expect(screen.getAllByText("42%")).toHaveLength(2);
    await user.click(screen.getAllByRole("button", { name: "Pause" })[0]);
    await user.click(screen.getAllByRole("button", { name: "Move later" })[0]);

    expect(onPause).toHaveBeenCalledOnce();
    expect(onReorder).toHaveBeenCalledWith([
      "f86946a1-bcf7-4137-87c6-51502024367a",
      "2bf886fc-65bf-4e2f-b973-b607766b3131",
    ]);
  });

  it("offers an explicit confirmation action and explains the blocked state", async () => {
    let confirm: (() => void) | undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          confirm = resolve;
        }),
    );
    const user = userEvent.setup();
    render(
      <DownloadManager
        jobs={[
          job({
            url: "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Large%20archive.zip",
            sourceKind: "torrent",
            status: "awaiting_confirmation",
            phase: "confirm",
            canPause: false,
            message: "Torrent is larger than 1 GiB and needs confirmation.",
            requiresConfirmation: true,
          }),
        ]}
        maxConcurrent={2}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        onOpenSession={vi.fn()}
        onPause={vi.fn()}
        onRemove={vi.fn()}
        onReorder={vi.fn()}
        onResume={vi.fn()}
        onRetry={vi.fn()}
        onSetConcurrency={vi.fn()}
      />,
    );

    expect(screen.getByText("Large archive.zip")).toBeVisible();
    expect(screen.getByText(/larger than 1 GiB/)).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Confirm & download" }),
    );
    expect(onConfirm).toHaveBeenCalledWith(
      "2bf886fc-65bf-4e2f-b973-b607766b3131",
    );
    expect(screen.getByRole("button", { name: "Confirming…" })).toBeDisabled();
    confirm?.();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Confirm & download" }),
      ).toBeEnabled(),
    );
  });

  it("reports confirmation failures and keeps the action available", async () => {
    const user = userEvent.setup();
    render(
      <DownloadManager
        jobs={[
          job({
            status: "awaiting_confirmation",
            phase: "confirm",
            canPause: false,
            requiresConfirmation: true,
          }),
        ]}
        maxConcurrent={2}
        onCancel={vi.fn()}
        onConfirm={vi.fn().mockRejectedValue(new Error("Confirmation failed"))}
        onOpenSession={vi.fn()}
        onPause={vi.fn()}
        onRemove={vi.fn()}
        onReorder={vi.fn()}
        onResume={vi.fn()}
        onRetry={vi.fn()}
        onSetConcurrency={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Confirm & download" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Confirmation failed",
    );
    expect(
      screen.getByRole("button", { name: "Confirm & download" }),
    ).toBeEnabled();
  });

  it("uses the pathname for HTTP torrent files", () => {
    render(
      <DownloadManager
        jobs={[
          job({
            url: "https://example.com/releases/archive-file.torrent?token=abc",
            sourceKind: "torrent",
          }),
        ]}
        maxConcurrent={2}
        onCancel={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        onOpenSession={vi.fn()}
        onPause={vi.fn()}
        onRemove={vi.fn()}
        onReorder={vi.fn()}
        onResume={vi.fn()}
        onRetry={vi.fn()}
        onSetConcurrency={vi.fn()}
      />,
    );

    expect(screen.getByText("archive-file.torrent")).toBeVisible();
  });
});

describe("DownloadDialog", () => {
  it("submits pasted source with one click while the textarea is focused", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <DownloadDialog
        defaultOptions={{
          transport: {
            mode: "auto",
            threads: 3,
            multithread: true,
            resume: true,
          },
          retry: { maxRetries: 3, timeoutMs: 30_000 },
          media: { videoQuality: "720p" },
          extraction: { enabled: true },
          request: { headers: {} },
        }}
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await user.type(
      screen.getByRole("textbox", { name: "Paste download URLs" }),
      "https://example.com/one-click.zip",
    );
    const submit = screen.getByRole("button", { name: "Add to queue" });
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith([
      expect.objectContaining({ url: "https://example.com/one-click.zip" }),
    ]);
  });

  it("turns pasted lines into editable per-download cards", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <DownloadDialog
        defaultOptions={{
          transport: {
            mode: "auto",
            threads: 3,
            multithread: true,
            resume: true,
          },
          retry: { maxRetries: 3, timeoutMs: 30_000 },
          media: { videoQuality: "720p" },
          extraction: { enabled: true },
          request: { headers: {} },
        }}
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await user.type(
      screen.getByRole("textbox", { name: "Paste download URLs" }),
      "https://example.com/a.zip{enter}https://example.com/b.zip",
    );
    await user.tab();

    expect(screen.getAllByLabelText("Download URL")).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Review links" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add to queue" }));
    expect(onSubmit).toHaveBeenCalledWith([
      expect.objectContaining({ url: "https://example.com/a.zip" }),
      expect.objectContaining({ url: "https://example.com/b.zip" }),
    ]);
  });

  it("keeps duplicate rows visible and blocks submission", async () => {
    const user = userEvent.setup();
    render(
      <DownloadDialog
        defaultOptions={{
          transport: {
            mode: "auto",
            threads: 2,
            multithread: true,
            resume: true,
          },
          retry: { maxRetries: 3, timeoutMs: 30_000 },
          media: { videoQuality: "720p" },
          extraction: { enabled: true },
          request: { headers: {} },
        }}
        open
        onClose={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await user.type(
      screen.getByRole("textbox", { name: "Paste download URLs" }),
      "https://example.com/a.zip{enter}https://example.com/a.zip",
    );
    await user.tab();

    expect(screen.getAllByLabelText("Download URL")).toHaveLength(2);
    expect(screen.getByText(/2 duplicate/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to queue" })).toBeDisabled();
  });

  it("accepts a magnet and exposes its transport override", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <DownloadDialog
        defaultOptions={{
          transport: {
            mode: "auto",
            threads: 2,
            multithread: true,
            resume: true,
          },
          retry: { maxRetries: 3, timeoutMs: 30_000 },
          media: { videoQuality: "720p" },
          extraction: { enabled: true },
          request: { headers: {} },
        }}
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    const magnet =
      "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567";
    await user.type(
      screen.getByRole("textbox", { name: "Paste download URLs" }),
      magnet,
    );
    await user.tab();
    await user.click(screen.getByText("Per-download settings"));
    await user.selectOptions(screen.getByLabelText("Source type"), "torrent");
    await user.click(screen.getByRole("button", { name: "Add to queue" }));

    expect(onSubmit).toHaveBeenCalledWith([
      expect.objectContaining({ url: magnet, sourcePreference: "torrent" }),
    ]);
  });

  it("clears submitted links only after the queue accepts them", async () => {
    let accept: (() => void) | undefined;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          accept = resolve;
        }),
    );
    const user = userEvent.setup();
    const view = render(
      <DownloadDialog
        defaultOptions={{
          transport: {
            mode: "auto",
            threads: 2,
            multithread: true,
            resume: true,
          },
          retry: { maxRetries: 3, timeoutMs: 30_000 },
          media: { videoQuality: "720p" },
          extraction: { enabled: true },
          request: { headers: {} },
        }}
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await user.type(
      screen.getByRole("textbox", { name: "Paste download URLs" }),
      "https://example.com/accepted.zip",
    );
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Add to queue" }));
    expect(
      screen.getByRole("button", { name: "Adding to queue…" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Download URL")).toHaveValue(
      "https://example.com/accepted.zip",
    );

    accept?.();
    await waitFor(() =>
      expect(screen.queryByLabelText("Download URL")).not.toBeInTheDocument(),
    );
    view.rerender(
      <DownloadDialog
        defaultOptions={{
          transport: {
            mode: "auto",
            threads: 2,
            multithread: true,
            resume: true,
          },
          retry: { maxRetries: 3, timeoutMs: 30_000 },
          media: { videoQuality: "720p" },
          extraction: { enabled: true },
          request: { headers: {} },
        }}
        open={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    view.rerender(
      <DownloadDialog
        defaultOptions={{
          transport: {
            mode: "auto",
            threads: 2,
            multithread: true,
            resume: true,
          },
          retry: { maxRetries: 3, timeoutMs: 30_000 },
          media: { videoQuality: "720p" },
          extraction: { enabled: true },
          request: { headers: {} },
        }}
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.queryByLabelText("Download URL")).not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Paste download URLs" }),
    ).toHaveValue("");
  });

  it("keeps the draft and reports a failed enqueue", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("Queue unavailable"));
    const user = userEvent.setup();
    render(
      <DownloadDialog
        defaultOptions={{
          transport: {
            mode: "auto",
            threads: 2,
            multithread: true,
            resume: true,
          },
          retry: { maxRetries: 3, timeoutMs: 30_000 },
          media: { videoQuality: "720p" },
          extraction: { enabled: true },
          request: { headers: {} },
        }}
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    await user.type(
      screen.getByRole("textbox", { name: "Paste download URLs" }),
      "https://example.com/retry.zip",
    );
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Add to queue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Queue unavailable",
    );
    expect(screen.getByLabelText("Download URL")).toHaveValue(
      "https://example.com/retry.zip",
    );
    expect(screen.getByRole("button", { name: "Add to queue" })).toBeEnabled();
  });
});
