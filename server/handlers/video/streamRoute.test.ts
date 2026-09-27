import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import type { Express, Request, RequestHandler, Response } from "express";
import { expect, it, vi } from "vitest";
import type { Session } from "../../domain/models.js";
import { registerVideoStreamRoute } from "./streamRoute.js";
import type { VideoRouteDependencies } from "./types.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("./routeContext.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./routeContext.js")>()),
  resolveVideoContext: () =>
    Promise.resolve({
      session: { id: "session" },
      targetPath: "clip.mp4",
      normalizedPath: "clip.mp4",
    }),
}));

it("aborts the queued stream on disconnect and never spawns an encoder after it", async () => {
  let handler: RequestHandler | undefined;
  let release: (() => void) | undefined;
  let signal: AbortSignal | undefined;
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    setHeader: vi.fn(),
    type: vi.fn(),
  });
  const app = {
    get: (_path: string, callback: RequestHandler) => {
      handler = callback;
    },
  } as unknown as Express;
  registerVideoStreamRoute(app, {
    ffmpegPath: "ffmpeg",
    getVideoDimensions: () => Promise.resolve({ width: 320, height: 180 }),
    buildVideoQualityOptions: () => ({ options: [], defaultQuality: "source" }),
    runVideoTask: <Result>(
      _session: Session,
      task: (_signal?: AbortSignal) => Promise<Result>,
      requestSignal?: AbortSignal,
    ) => {
      signal = requestSignal;
      return new Promise<Result>((resolve, reject) => {
        release = () => {
          void task(signal).then(resolve, reject);
        };
      });
    },
  } as unknown as VideoRouteDependencies);
  if (!handler) throw new Error("Stream route was not registered");
  const running = handler(
    { query: {} } as Request,
    response as unknown as Response,
    vi.fn(),
  );
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  response.destroyed = true;
  response.emit("close");
  expect(signal?.aborted).toBe(true);
  release?.();
  await running;
  expect(spawn).not.toHaveBeenCalled();
  expect(response.listenerCount("close")).toBe(0);
});
