import type { Response } from "express";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { VideoRendition } from "../../domain/models.js";
import { waitForPublishedSegment } from "./hlsAvailability.js";

const read = vi.hoisted(() =>
  vi.fn<(..._args: unknown[]) => Promise<string>>(),
);
vi.mock("node:fs/promises", () => ({ readFile: read }));

afterEach(() => {
  vi.useRealTimers();
  read.mockReset();
});

it("keeps a stale running read retryable when publication finishes at the deadline", async () => {
  vi.useFakeTimers();
  const rendition = {
    status: "running",
    playlistPath: "unused",
  } as VideoRendition;
  const response = { destroyed: false } as Response;
  read.mockImplementationOnce(() => {
    rendition.status = "done";
    return Promise.resolve("");
  });
  const pending = waitForPublishedSegment(rendition, 0, response, 1);
  await vi.advanceTimersByTimeAsync(160);
  expect(await pending).toBe("preparing");
  read.mockResolvedValue("#EXTM3U\n#EXTINF:4,\nsegment_000000.m4s\n");
  expect(await waitForPublishedSegment(rendition, 0, response)).toBe("ready");
});

it("reports completed jobs with missing media as failed", async () => {
  read.mockResolvedValue("");
  const rendition = {
    status: "done",
    playlistPath: "unused",
  } as VideoRendition;
  expect(
    await waitForPublishedSegment(rendition, 0, {
      destroyed: false,
    } as Response),
  ).toBe("failed");
});

it("stops an unbounded native wait after the client disconnects", async () => {
  vi.useFakeTimers();
  read.mockResolvedValue("");
  const response = { destroyed: false } as Response;
  const rendition = {
    status: "running",
    playlistPath: "unused",
  } as VideoRendition;
  const pending = waitForPublishedSegment(rendition, 0, response, Infinity);
  await vi.advanceTimersByTimeAsync(0);
  response.destroyed = true;
  await vi.advanceTimersByTimeAsync(160);
  expect(await pending).toBe("cancelled");
  expect(read).toHaveBeenCalledTimes(1);
});
