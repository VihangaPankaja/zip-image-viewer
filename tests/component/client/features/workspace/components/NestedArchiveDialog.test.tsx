import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NestedArchiveDialog } from "../../../../../../client/src/features/workspace/components/NestedArchiveDialog";

const rpc = vi.hoisted(() => ({ open: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../../../../client/src/services/orpcClient", () => ({
  workspaceRpc: {
    nestedArchives: {
      inspect: {
        queryOptions: () => ({
          queryKey: ["archive"],
          queryFn: () =>
            Promise.resolve({
              fingerprint: "a".repeat(64),
              sourceBytes: 10,
              compressedBytes: 5,
              expandedBytes: 5,
              fileCount: 1,
              extractedCount: 0,
              entries: [
                {
                  id: "0",
                  path: "notes.txt",
                  type: "file",
                  compressedBytes: 5,
                  expandedBytes: 5,
                  extracted: false,
                },
              ],
            }),
        }),
      },
      open: { mutationOptions: (options: object) => ({ mutationFn: rpc.open, ...options }) },
      cancel: { mutationOptions: () => ({ mutationFn: rpc.cancel }) },
    },
  },
}));

it("does not navigate when an archive finishes after its review was unmounted", async () => {
  let finish = (_result: { id: string }) => {};
  rpc.open.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const onOpen = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <NestedArchiveDialog id="parent" path="inside.7z" onOpen={onOpen} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("checkbox", { name: "notes.txt" }));
  fireEvent.click(screen.getByRole("button", { name: "Open selected files" }));
  await screen.findByRole("button", { name: "Opening selected files…" });
  view.unmount();
  await act(async () => {
    finish({ id: "child" });
    await Promise.resolve();
  });
  expect(onOpen).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(rpc.cancel).toHaveBeenCalledWith({ id: "parent", path: "inside.7z" }, expect.anything()),
  );
});
