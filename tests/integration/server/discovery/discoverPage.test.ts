import { call } from "@orpc/server";
import { expect, it, vi } from "vite-plus/test";
import { discoverPage } from "../../../../server/application/discovery/discoverPage.js";
import { inspectPage } from "../../../../server/infrastructure/discovery/inspectPage.js";
import {
  createServerRpcRouter,
  type ServerRpcDependencies,
} from "../../../../server/rpc/serverRouter.js";

vi.mock("../../../../server/infrastructure/discovery/inspectPage.js", () => ({
  inspectPage: vi.fn(),
}));

it("bounds concurrent inspections and releases slots on failure and cancellation", async () => {
  const pending: ((_value: { sourcePage: string; items: []; truncated: boolean }) => void)[] = [];
  vi.mocked(inspectPage).mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const first = discoverPage("https://example.com/first");
  const second = discoverPage("https://example.com/second");
  await expect(discoverPage("https://example.com/third")).rejects.toThrow(/Two pages/);
  const empty = { sourcePage: "https://example.com/", items: [] as [], truncated: false };
  pending.forEach((resolve) => resolve(empty));
  await Promise.all([first, second]);
  vi.mocked(inspectPage).mockRejectedValueOnce(new Error("https://host.example/?secret=private"));
  await expect(discoverPage("https://example.com/")).rejects.toThrow(
    /^Could not inspect this public HTML page/,
  );
  const controller = new AbortController();
  controller.abort();
  vi.mocked(inspectPage).mockImplementationOnce((_url, options) => {
    options?.signal?.throwIfAborted();
    return Promise.resolve(empty);
  });
  await expect(discoverPage("https://example.com/", controller.signal)).rejects.toThrow();
  vi.mocked(inspectPage).mockResolvedValue(empty);
  await expect(discoverPage("https://example.com/")).resolves.toEqual(empty);
});

it("validates RPC input and forwards caller cancellation without enqueueing", async () => {
  const discover = vi.fn(() =>
    Promise.resolve({ sourcePage: "https://example.com/", items: [], truncated: false }),
  );
  // Only the discovery router is called; other dependencies remain deliberately unusable.
  const deps = { discoverPage: discover } as unknown as ServerRpcDependencies;
  const router = createServerRpcRouter(deps);
  await expect(call(router.discovery.inspect, { url: "http://127.0.0.1/" })).rejects.toThrow();
  expect(discover).not.toHaveBeenCalled();
  const signal = new AbortController().signal;
  await expect(
    call(router.discovery.inspect, { url: "https://example.com/" }, { signal }),
  ).resolves.toMatchObject({ items: [] });
  expect(discover).toHaveBeenCalledWith("https://example.com/", signal);
});
