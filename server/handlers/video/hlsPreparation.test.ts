import type { Response } from "express";
import { expect, it } from "vite-plus/test";
import type { VideoTranscodeEntry } from "../../domain/models.js";
import type { VideoRouteDependencies } from "./types.js";
import type { VideoContext } from "./routeContext.js";
import { prepareHlsMaster } from "./hlsPreparation.js";

it("does not schedule startup after a client disconnects during metadata resolution", async () => {
  const result = await prepareHlsMaster(
    { destroyed: true } as Response,
    {} as VideoRouteDependencies,
    {} as VideoContext,
    { width: 1280, height: 720, durationSeconds: 130 } as VideoTranscodeEntry,
  );
  expect(result).toBe(false);
});
