import type { Response } from "express";
import { expect, it } from "vite-plus/test";
import type { VideoTranscodeEntry } from "../../../../../server/domain/models.js";
import type { VideoRouteDependencies } from "../../../../../server/handlers/video/types.js";
import type { VideoContext } from "../../../../../server/handlers/video/routeContext.js";
import { prepareHlsMaster } from "../../../../../server/handlers/video/hlsPreparation.js";

it("does not schedule startup after a client disconnects during metadata resolution", async () => {
  const result = await prepareHlsMaster(
    { destroyed: true } as Response,
    {} as VideoRouteDependencies,
    {} as VideoContext,
    { width: 1280, height: 720, durationSeconds: 130 } as VideoTranscodeEntry,
  );
  expect(result).toBe(false);
});
