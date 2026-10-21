import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceLivePreviews } from "../../../../../client/src/features/workspace/useWorkspaceLivePreviews";
import { jobSchema } from "../../../../../shared/contracts";

function reviewActiveTorrentJob() {
  return jobSchema.parse({
    id: "00000000-0000-4000-8000-000000000009",
    url: "https://example.com/media.torrent",
    sourceKind: "torrent",
    status: "downloading",
    phase: "downloading",
    percent: 10,
    createdAt: 0,
    updatedAt: 0,
    torrentFiles: [
      {
        id: "0",
        path: "movie.mp4",
        size: 100,
        downloadedBytes: 10,
        selected: true,
        complete: false,
      },
    ],
  });
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, client };
}

afterEach(() => vi.unstubAllGlobals());

it("finds a validated second video after an invalid first response and revokes failed capability", async () => {
  const first = reviewActiveTorrentJob();
  const job = {
    ...first,
    torrentFiles: [first.torrentFiles[0], { ...first.torrentFiles[0], id: "second" }],
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response("invalid json"))
    .mockResolvedValueOnce(Response.json({ state: "ready", message: "Verified" }));
  vi.stubGlobal("fetch", fetchMock);
  const { wrapper, client } = setup();
  const { result, unmount } = renderHook(() => useWorkspaceLivePreviews([job], []), { wrapper });
  await waitFor(() => expect(result.current).toEqual([{ jobId: job.id, fileId: "second" }]));
  fetchMock.mockResolvedValue(Response.json({ state: "download-first", message: "Unavailable" }));
  await client.invalidateQueries();
  await waitFor(() => expect(result.current).toEqual([]));
  unmount();
  client.clear();
});

it("aborts capability reads when a torrent pauses and requires fresh validation after resume", async () => {
  const job = reviewActiveTorrentJob();
  let signal: AbortSignal | undefined;
  const fetchMock = vi.fn((_url: string, options: RequestInit) => {
    signal = options.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) =>
      signal?.addEventListener("abort", () => reject(new Error("aborted"))),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  const { wrapper, client } = setup();
  const { result, rerender, unmount } = renderHook(
    ({ paused }) =>
      useWorkspaceLivePreviews([{ ...job, status: paused ? "paused" : "downloading" }], []),
    { wrapper, initialProps: { paused: false } },
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  const original = signal;
  rerender({ paused: true });
  await waitFor(() => expect(original?.aborted).toBe(true));
  expect(result.current).toEqual([]);
  rerender({ paused: false });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(result.current).toEqual([]);
  unmount();
  client.clear();
});

it("does not probe video for a job already represented by ready session files", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const session = {
    id: "00000000-0000-4000-8000-000000000008",
    fileCount: 1,
    firstFilePath: "movie.mp4",
    jobId: reviewActiveTorrentJob().id,
    lastAccessedAt: 0,
  };
  const job = reviewActiveTorrentJob();
  const { wrapper, client } = setup();
  const { result, unmount } = renderHook(() => useWorkspaceLivePreviews([job], [session]), {
    wrapper,
  });
  expect(result.current).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
  unmount();
  client.clear();
});
