import express, { type ErrorRequestHandler, type Express } from "express";
import { ApplicationError } from "../domain/models.js";
import { registerHealthRoute } from "../handlers/health.js";
import {
  registerControlPlaneReadRoutes,
  type ControlPlaneReadDependencies,
} from "../handlers/controlPlane.js";
import { registerWebhookRoutes } from "../handlers/webhooks.js";
import { registerRpc } from "../rpc/registerRpc.js";
import type { ServerRpcDependencies } from "../rpc/serverRouter.js";

export type CreateAppDependencies = {
  getSessionCount: () => number;
  getJobCount: () => number;
  distDir?: string;
  rpc?: ServerRpcDependencies;
} & Partial<ControlPlaneReadDependencies>;

export function createApp(deps: CreateAppDependencies): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  if (deps.rpc) registerRpc(app, deps.rpc);
  if (deps.distDir) app.use(express.static(deps.distDir));

  registerHealthRoute(app, deps);
  registerWebhookRoutes(app);
  if (deps.listJobs && deps.listSessions) {
    registerControlPlaneReadRoutes(app, {
      listJobs: deps.listJobs,
      listSessions: deps.listSessions,
    });
  }

  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    _next,
  ) => {
    if (error instanceof SyntaxError) {
      response.status(400).json({
        error: {
          code: "INVALID_JSON",
          message: "Request body is not valid JSON.",
        },
      });
      return;
    }
    if (error instanceof ApplicationError) {
      response.status(error.status).json({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    response.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Unexpected server error." },
    });
  };
  app.use(errorHandler);
  return app;
}
