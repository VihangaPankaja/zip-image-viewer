import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { SessionStorageDialog } from "./SessionStorageDialog";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  clear: vi.fn(),
  pin: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../../../services/orpcClient", async () => {
  const { createORPCReactQueryUtils } = await import("@orpc/react-query");
  return {
    workspaceRpc: createORPCReactQueryUtils({
      storage: { get: api.get, clear: api.clear, pin: api.pin },
      sessions: { remove: api.remove },
    }),
  };
});
const initial = {
  originalsBytes: 52428800,
  previewsBytes: 2097152,
  transcodesBytes: 12582912,
  retained: false,
  pinned: false,
};
beforeEach(() => {
  vi.resetAllMocks();
  api.get.mockResolvedValue({ ...initial });
  api.clear.mockResolvedValue(undefined);
  api.pin.mockResolvedValue(undefined);
  api.remove.mockResolvedValue(undefined);
});
function setup() {
  const onClose = vi.fn();
  const onDeleted = vi.fn(() => Promise.resolve());
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SessionStorageDialog
        id="00000000-0000-4000-8000-000000000001"
        onClose={onClose}
        onDeleted={onDeleted}
      />
    </QueryClientProvider>,
  );
  return { onClose, onDeleted, user: userEvent.setup() };
}

it("shows separate byte totals and refreshes after pinning and clearing only cache", async () => {
  const { user } = setup();
  await screen.findByText("50 MB");
  expect(screen.getByText("2.0 MB")).toBeVisible();
  expect(screen.getByText("12 MB")).toBeVisible();
  api.get.mockResolvedValue({ ...initial, pinned: true });
  await user.click(
    screen.getByRole("checkbox", { name: "Keep until the server stops" }),
  );
  await screen.findByText("Session kept until the server stops.");
  expect(api.pin.mock.calls[0][0]).toMatchObject({ pinned: true });
  api.get.mockResolvedValue({
    ...initial,
    pinned: true,
    previewsBytes: 0,
    transcodesBytes: 0,
  });
  await user.click(
    screen.getByRole("button", { name: "Clear preview & transcode cache" }),
  );
  await screen.findByText("Cache cleared. Original files kept.");
  expect(screen.getByText("50 MB")).toBeVisible();
  expect(screen.getAllByText("0 B")).toHaveLength(2);
  expect(api.remove).not.toHaveBeenCalled();
});

it("warns about retained torrent files and requires a separate destructive action", async () => {
  api.get.mockResolvedValue({ ...initial, retained: true });
  const { user, onDeleted } = setup();
  await screen.findByText(/Retained torrent/);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Delete session files…" }),
  );
  expect(
    screen.getByText(/files needed to download skipped items later/),
  ).toBeVisible();
  expect(api.remove).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Keep files" }));
  expect(
    screen.queryByRole("button", { name: "Delete permanently" }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Delete session files…" }),
  );
  await user.click(screen.getByRole("button", { name: "Delete permanently" }));
  await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
  expect(api.remove).toHaveBeenCalledOnce();
});

it("keeps failed deletion and active-media cleanup errors recoverable", async () => {
  api.clear.mockRejectedValue(new Error("Media is active."));
  api.remove.mockRejectedValue(new Error("Download is running."));
  const { user, onDeleted } = setup();
  await screen.findByText("50 MB");
  await user.click(
    screen.getByRole("button", { name: "Clear preview & transcode cache" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Media is active.",
  );
  await user.click(
    screen.getByRole("button", { name: "Delete session files…" }),
  );
  await user.click(screen.getByRole("button", { name: "Delete permanently" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Download is running."),
  );
  expect(onDeleted).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Keep files" })).toBeEnabled();
});

it("shows a failed measurement without offering file actions", async () => {
  api.get.mockRejectedValue(new Error("Session not found."));
  setup();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Session not found.",
  );
  expect(
    screen.queryByRole("button", { name: "Delete session files…" }),
  ).not.toBeInTheDocument();
});

it("reflects the pending pin immediately and restores the saved value on failure", async () => {
  let reject = (_error: Error) => {};
  api.pin.mockReturnValue(
    new Promise<void>((_resolve, fail) => {
      reject = fail;
    }),
  );
  const { user } = setup();
  const checkbox = await screen.findByRole("checkbox", {
    name: "Keep until the server stops",
  });
  await user.click(checkbox);
  expect(checkbox).toBeChecked();
  expect(checkbox).toBeDisabled();
  reject(new Error("Could not save pin."));
  await screen.findByText("Could not save pin.");
  await waitFor(() => expect(checkbox).not.toBeChecked());
  expect(checkbox).toBeEnabled();
});
