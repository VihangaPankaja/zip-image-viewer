import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createORPCReactQueryUtils } from "@orpc/react-query";
import { serverContract } from "../../../shared/contracts";

type WorkspaceRpcClient = ContractRouterClient<typeof serverContract>;

const rpcLink = new RPCLink({
  url: new URL("/rpc", window.location.origin).toString(),
});

const workspaceRpcClient = createORPCClient<WorkspaceRpcClient>(rpcLink);
export const workspaceRpc = createORPCReactQueryUtils(workspaceRpcClient);
