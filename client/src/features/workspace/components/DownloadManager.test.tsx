import { render, screen } from "@testing-library/react";
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
});

describe("DownloadDialog", () => {
  it("turns pasted lines into editable per-download cards", async () => {
    const onSubmit = vi.fn();
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
    await user.click(screen.getByRole("button", { name: "Review links" }));

    expect(screen.getAllByLabelText("Download URL")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Add 2 downloads" }));
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
        onSubmit={vi.fn()}
      />,
    );

    await user.type(
      screen.getByRole("textbox", { name: "Paste download URLs" }),
      "https://example.com/a.zip{enter}https://example.com/a.zip",
    );
    await user.click(screen.getByRole("button", { name: "Review links" }));

    expect(screen.getAllByLabelText("Download URL")).toHaveLength(2);
    expect(screen.getByText(/2 duplicate/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add 2 downloads" }),
    ).toBeDisabled();
  });
});
