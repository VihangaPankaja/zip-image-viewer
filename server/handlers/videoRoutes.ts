import type { Express } from "express";
import { registerVideoHlsRoutes } from "./videoHlsRoutes.js";
import { registerVideoMetadataRoutes } from "./video/metadataRoutes.js";
import { registerVideoPlaybackRoutes } from "./video/playbackRoutes.js";
import { registerVideoStreamRoute } from "./video/streamRoute.js";
import { registerVideoThumbnailRoute } from "./video/thumbnailRoute.js";
import type { VideoRouteDependencies } from "./video/types.js";

export type { VideoRouteDependencies } from "./video/types.js";

export function registerVideoRoutes(
  app: Express,
  deps: VideoRouteDependencies,
): void {
  registerVideoHlsRoutes(app, deps);
  registerVideoPlaybackRoutes(app, deps);
  registerVideoMetadataRoutes(app, deps);
  registerVideoThumbnailRoute(app, deps);
  registerVideoStreamRoute(app, deps);
}
