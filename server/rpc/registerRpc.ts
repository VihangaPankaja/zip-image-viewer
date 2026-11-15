import { RPCHandler } from "@orpc/server/node";
import type { Express, NextFunction, Request, Response } from "express";
import { createServerRpcRouter, type ServerRpcDependencies } from "./serverRouter.js";

export function registerRpc(app: Express, dependencies: ServerRpcDependencies): void {
  const handler = new RPCHandler(createServerRpcRouter(dependencies));
  app.use("/rpc", (request: Request, response: Response, next: NextFunction) => {
    if (
      ["/jobs/password", "/nestedArchives/inspect", "/nestedArchives/open"].includes(
        request.path,
      ) &&
      request.method !== "POST"
    ) {
      response.set("Allow", "POST").status(405).end();
      return;
    }
    void handler
      .handle(request, response, { prefix: "/rpc" })
      .then(({ matched }) => {
        if (!matched) next();
      })
      .catch(next);
  });
}
