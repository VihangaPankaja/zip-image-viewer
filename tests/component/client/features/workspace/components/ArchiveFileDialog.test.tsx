import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { ArchiveReviewAction } from "../../../../../../client/src/features/workspace/components/ArchiveFileDialog";
import { jobSchema, type ArchiveManifest } from "../../../../../../shared/contracts";

const api = vi.hoisted(() => ({ get: vi.fn(), select: vi.fn() }));
vi.mock("../../../../../../client/src/services/orpcClient", async () => {
  const { createORPCReactQueryUtils } = await import("@orpc/react-query");
  return { workspaceRpc: createORPCReactQueryUtils({ archives: api }) };
});
const manifest: ArchiveManifest = {
  fingerprint: "a".repeat(64),
  sourceBytes: 40000,
  compressedBytes: 20000,
  expandedBytes: 80000,
  fileCount: 10000,
  extractedCount: 0,
  entries: Array.from({ length: 10000 }, (_, index) => ({
    id: String(index),
    path: `album/file-${index}.txt`,
    type: "file",
    compressedBytes: 2,
    expandedBytes: 8,
    extracted: false,
  })),
};
beforeEach(() => {
  vi.resetAllMocks();
  api.get.mockResolvedValue(manifest);
  api.select.mockResolvedValue({});
});
function setup() {
  const job = jobSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    url: "https://example.com/album.zip",
    status: "awaiting_selection",
    phase: "selecting",
    percent: null,
    createdAt: 1,
    updatedAt: 1,
    archive: manifest,
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ArchiveReviewAction job={job} />
    </QueryClientProvider>,
  );
  return { job, user: userEvent.setup() };
}

it("bounds ten thousand choices, selects folders across pages and submits only the chosen file after filtering", async () => {
  const { user, job } = setup();
  await user.click(screen.getByRole("button", { name: "Review ZIP contents" }));
  await screen.findByRole("checkbox", { name: "album/file-0.txt" });
  expect(screen.getAllByRole("checkbox")).toHaveLength(101);
  await user.click(screen.getByRole("button", { name: "Select none" }));
  expect(screen.getByRole("button", { name: "Extract selected files" })).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /^album$/ }));
  expect(screen.getByRole("status")).toHaveTextContent("10000 files selected");
  await user.click(screen.getByRole("button", { name: "Next files" }));
  expect(screen.getByRole("checkbox", { name: "album/file-100.txt" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Select none" }));
  await user.click(screen.getByRole("searchbox", { name: "Search ZIP files" }));
  await user.paste("file-9999");
  await user.click(screen.getByRole("checkbox", { name: "album/file-9999.txt" }));
  await user.click(screen.getByRole("button", { name: "Extract selected files" }));
  await waitFor(() => expect(api.select).toHaveBeenCalled());
  expect(api.select.mock.calls[0][0]).toEqual({
    id: job.id,
    fingerprint: manifest.fingerprint,
    fileIds: ["9999"],
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("recovers inspection and submission failures without losing choices and restores the opener", async () => {
  api.get.mockRejectedValueOnce(new Error("Source is temporarily unavailable."));
  api.select.mockRejectedValueOnce(new Error("Insufficient storage."));
  const { user } = setup();
  const opener = screen.getByRole("button", { name: "Review ZIP contents" });
  await user.click(opener);
  expect(await screen.findByRole("alert")).toHaveTextContent("Source is temporarily unavailable.");
  await user.click(screen.getByRole("button", { name: "Retry inspection" }));
  await screen.findByRole("checkbox", { name: "album/file-0.txt" });
  await user.click(screen.getByRole("button", { name: "Select none" }));
  await user.click(screen.getByRole("checkbox", { name: "album/file-0.txt" }));
  await user.click(screen.getByRole("button", { name: "Extract selected files" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Insufficient storage.");
  expect(screen.getByRole("checkbox", { name: "album/file-0.txt" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: /^Close$/ }));
  await waitFor(() => expect(opener).toHaveFocus());
});

it("selects a folder's matching descendants across nested groups", async () => {
  const entries = manifest.entries.slice(0, 3).map((entry, index) => ({
    ...entry,
    path: ["album/one.txt", "album/sub/two.txt", "other/three.txt"][index],
  }));
  api.get.mockResolvedValue({ ...manifest, entries, fileCount: 3 });
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "Review ZIP contents" }));
  await screen.findByRole("checkbox", { name: "album/one.txt" });
  await user.click(screen.getByRole("button", { name: "Select none" }));
  await user.click(screen.getByRole("checkbox", { name: /^album$/ }));
  expect(screen.getByRole("checkbox", { name: "album/sub/two.txt" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "other/three.txt" })).not.toBeChecked();
  await user.click(screen.getByRole("button", { name: "Extract selected files" }));
  await waitFor(() => expect(api.select.mock.calls[0][0]).toMatchObject({ fileIds: ["0", "1"] }));
});
