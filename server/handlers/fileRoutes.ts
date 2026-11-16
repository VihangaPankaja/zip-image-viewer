import type { Express } from "express";
import { createFileRouteHandler, type FileRouteDependencies } from "./file/fileRouteHandler.js";
import { registerSelectionExportRoutes } from "./selectionExport.js";

export type { FileRouteDependencies } from "./file/fileRouteHandler.js";

export function registerFileRoutes(app: Express, deps: FileRouteDependencies): void {
  app.get("/api/sessions/:id/file", createFileRouteHandler(deps));
  registerSelectionExportRoutes(app, deps);
}
