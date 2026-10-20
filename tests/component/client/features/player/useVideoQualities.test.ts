import { renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { workspaceRpc } from "../../../../../client/src/services/orpcClient";
import { useVideoQualities } from "../../../../../client/src/features/player/useVideoQualities";

vi.mock("../../../../../client/src/services/orpcClient", () => ({
  workspaceRpc: { video: { qualities: { call: vi.fn() } } },
}));

it("loads typed qualities and falls back to Original when metadata fails", async () => {
  const load = vi.mocked(workspaceRpc.video.qualities.call);
  load
    .mockResolvedValueOnce({
      path: "clip.mp4",
      source: { width: 1280, height: 720, durationSeconds: 10 },
      options: [
        { id: "source", label: "Original", height: null },
        { id: "720p", label: "720p", height: 720 },
      ],
      defaultQuality: "720p",
    })
    .mockRejectedValueOnce(new Error("Session expired"));
  const params = {
    sessionId: "2bf886fc-65bf-4e2f-b973-b607766b3131",
    path: "clip.mp4",
    selectedKind: "video",
    isFile: true,
    setOptions: vi.fn(),
    setSelectedQuality: vi.fn(),
  };
  const { rerender } = renderHook(useVideoQualities, { initialProps: params });
  await waitFor(() => expect(params.setSelectedQuality).toHaveBeenLastCalledWith("720p"));
  expect(load).toHaveBeenCalledWith({
    sessionId: params.sessionId,
    path: "clip.mp4",
  });
  rerender({ ...params, path: "next.mp4" });
  await waitFor(() =>
    expect(params.setOptions).toHaveBeenLastCalledWith([{ id: "source", label: "Original" }]),
  );
  expect(params.setSelectedQuality).toHaveBeenLastCalledWith("source");
  rerender({ ...params, selectedKind: "image" });
  expect(params.setOptions).toHaveBeenLastCalledWith([]);
  expect(load).toHaveBeenCalledTimes(2);
});

it("exposes audio and subtitle metadata from the same qualities request and resets it on file changes", async () => {
  const load = vi.mocked(workspaceRpc.video.qualities.call);
  load.mockClear();
  const audioTracks = [
    {
      id: "audio-1",
      index: 1,
      language: "eng",
      label: "English",
      isDefault: true,
    },
  ];
  const subtitleTracks = [
    {
      id: "subtitle-3",
      index: 3,
      language: "spa",
      label: "Spanish",
      isDefault: false,
    },
  ];
  load.mockResolvedValueOnce({
    path: "languages.mkv",
    source: { width: 320, height: 180, durationSeconds: 10 },
    options: [{ id: "auto", label: "Auto", height: null }],
    defaultQuality: "auto",
    audioTracks,
    subtitleTracks,
  });
  const params = {
    sessionId: "session",
    path: "languages.mkv",
    selectedKind: "video",
    isFile: true,
    setOptions: vi.fn(),
    setSelectedQuality: vi.fn(),
  };
  const { result, rerender } = renderHook(useVideoQualities, {
    initialProps: params,
  });
  await waitFor(() =>
    expect(result.current).toMatchObject({
      ready: true,
      audioTracks,
      subtitleTracks,
    }),
  );
  expect(load).toHaveBeenCalledTimes(1);
  rerender({ ...params, selectedKind: "image" });
  expect(result.current).toMatchObject({
    ready: false,
    audioTracks: [],
    subtitleTracks: [],
  });
});
