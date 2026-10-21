import { act, renderHook } from "@testing-library/react";
import { useArchiveCleanup } from "../../../../../client/src/features/workspace/useArchiveCleanup";

afterEach(() => vi.unstubAllGlobals());

it.each([false, true])("resets the viewer with remote cleanup=%s", async (removeRemote) => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  const params = {
    clearImagePreviewCache: vi.fn(),
    clearTextPreviewCache: vi.fn(),
    closeJobEvents: vi.fn(),
    latestJobIdRef: { current: "unrelated-active-download" },
    latestSessionIdRef: { current: "older-session" },
    resetArchiveView: vi.fn(),
    resetHydration: vi.fn(),
    stopJobPolling: vi.fn(),
  };
  const { result, unmount } = renderHook(() => useArchiveCleanup(params));
  await act(() => result.current(removeRemote));
  expect(params.resetArchiveView).toHaveBeenCalledOnce();
  expect(params.latestSessionIdRef.current).toBe("");
  expect(params.latestJobIdRef.current).toBe("");
  if (removeRemote) {
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith("/api/sessions/older-session", {
      method: "DELETE",
    });
    expect(fetch).toHaveBeenCalledWith("/api/session-jobs/unrelated-active-download?release=true", {
      method: "DELETE",
    });
  } else expect(fetch).not.toHaveBeenCalled();
  unmount();
});
