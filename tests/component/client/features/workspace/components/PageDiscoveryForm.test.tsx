import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PageDiscoveryForm } from "../../../../../../client/src/features/workspace/components/PageDiscoveryForm";
import { workspaceRpc } from "../../../../../../client/src/services/orpcClient";
import { DEFAULT_DOWNLOAD_OPTIONS } from "../../../../../../client/src/lib/appConstants";

vi.mock("../../../../../../client/src/services/orpcClient", () => ({
  workspaceRpc: {
    discovery: { inspect: { call: vi.fn(), mutationOptions: () => ({}) } },
  },
}));

const result = {
  sourcePage: "https://example.com/index",
  truncated: false,
  items: [
    {
      url: "https://example.com/get?id=1",
      name: "Photos.zip",
      type: "Unknown",
      kind: "file" as const,
      confidence: "high" as const,
      sizeBytes: null,
      sourcePage: "https://example.com/index",
    },
    {
      url: "https://example.com/next",
      name: "Next",
      type: "Unknown",
      kind: "page" as const,
      confidence: "low" as const,
      sizeBytes: null,
      sourcePage: "https://example.com/index",
    },
  ],
};

it("requires explicit selection and submission, retains failed choices and clears success", async () => {
  const inspect = vi.mocked(workspaceRpc.discovery.inspect.call).mockResolvedValue(result);
  const submit = vi
    .fn()
    .mockRejectedValueOnce(new Error("Queue unavailable"))
    .mockResolvedValue(undefined);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <PageDiscoveryForm
        defaultOptions={DEFAULT_DOWNLOAD_OPTIONS}
        onSubmit={submit}
        onBack={() => {}}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
  await user.type(screen.getByRole("textbox", { name: "Page URL" }), "https://example.com/index");
  await user.click(screen.getByRole("button", { name: "Inspect page" }));
  const file = await screen.findByRole("checkbox", { name: /Photos.zip/ });
  expect(file).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: /Next/ })).toBeDisabled();
  expect(screen.getAllByText("Size unknown", { exact: false })).toHaveLength(2);
  expect(submit).not.toHaveBeenCalled();
  await user.click(file);
  const add = screen.getByRole("button", { name: "Add selected" });
  await user.click(add);
  expect(await screen.findByRole("alert")).toHaveTextContent("Queue unavailable");
  expect(file).toBeChecked();
  await user.click(add);
  await waitFor(() => expect(screen.queryByRole("checkbox")).not.toBeInTheDocument());
  expect(submit.mock.calls[1][0]).toEqual([
    {
      url: result.items[0].url,
      sourcePreference: "auto",
      downloadOptions: DEFAULT_DOWNLOAD_OPTIONS,
    },
  ]);
  inspect.mockRestore();
});
