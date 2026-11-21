import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vite-plus/test";
import { useLocalImports } from "../../../../../client/src/features/workspace/useLocalImports";
import type { Job } from "../../../../../shared/contracts";

const api = vi.hoisted(() => ({
  initialize: vi.fn(),
  upload: vi.fn(),
  cancel: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("../../../../../client/src/services/localImports", () => ({
  initializeLocalImport: api.initialize,
  uploadLocalFile: api.upload,
}));
vi.mock("../../../../../client/src/services/orpcClient", () => ({
  workspaceRpcClient: { jobs: { cancel: api.cancel, retry: api.retry } },
}));

it.each(["cancelled", "error"] as const)(
  "retries a completed %s source after a lost upload acknowledgement, without resending it",
  async (status) => {
    const job = {
      id: "",
      status: "uploading",
      localFile: { name: "notes.txt", size: 5, complete: false },
    } as Job;
    api.initialize.mockImplementation(({ id }: { id: string }) => Promise.resolve({ ...job, id }));
    api.cancel.mockImplementation(() => {
      job.status = status;
      return Promise.resolve(job);
    });
    api.retry.mockImplementation(() => {
      job.status = "queued";
      return Promise.resolve(job);
    });
    api.upload.mockImplementation((_id: string, _file: File, signal: AbortSignal) => {
      job.localFile = { name: "notes.txt", size: 5, complete: true };
      return new Promise<void>((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Upload cancelled", "AbortError")),
          { once: true },
        ),
      );
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result, unmount } = renderHook(useLocalImports, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    try {
      act(() => result.current.add([new File(["hello"], "notes.txt")]));
      await waitFor(() => expect(job.localFile?.complete).toBe(true));
      const id = result.current.items[0].id;
      act(() => {
        result.current.cancel(id);
      });
      await waitFor(() => expect(result.current.items[0].status).toBe("cancelled"));
      act(() => result.current.retry(id));
      await waitFor(() => expect(result.current.items).toEqual([]));
      expect(job.status).toBe("queued");
      expect(api.upload).toHaveBeenCalledTimes(1);
      expect(api.retry).toHaveBeenCalledWith({ id });
    } finally {
      unmount();
      client.clear();
      vi.clearAllMocks();
    }
  },
);

it("cancels the registered job when cancellation happens before initialization is acknowledged", async () => {
  const job = {
    id: "",
    status: "uploading",
    localFile: { name: "notes.txt", size: 5, complete: false },
  } as Job;
  let registered = false;
  let acknowledge = () => {};
  api.initialize.mockImplementation(({ id }: { id: string }, signal: AbortSignal) => {
    job.id = id;
    registered = true;
    return new Promise<Job>((resolve, reject) => {
      acknowledge = () => resolve(job);
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
        once: true,
      });
    });
  });
  api.cancel.mockImplementation(() => {
    job.status = "cancelled";
    return Promise.resolve(job);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result, unmount } = renderHook(useLocalImports, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  try {
    act(() => result.current.add([new File(["hello"], "notes.txt")]));
    await waitFor(() => expect(registered).toBe(true));
    act(() => {
      result.current.cancel(result.current.items[0].id);
    });
    await act(async () => {
      acknowledge();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.items[0].status).toBe("cancelled"));
    expect(job.status).toBe("cancelled");
    expect(api.upload).not.toHaveBeenCalled();
  } finally {
    unmount();
    client.clear();
    vi.clearAllMocks();
  }
});
