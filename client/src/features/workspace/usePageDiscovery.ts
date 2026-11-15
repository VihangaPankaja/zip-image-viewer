import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { pageDiscoverySchema } from "../../../../shared/contracts";
import { workspaceRpc } from "../../services/orpcClient";

export function usePageDiscovery() {
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const inspection = useMutation({
    ...workspaceRpc.discovery.inspect.mutationOptions(),
    mutationFn: async (input: { url: string }) => {
      controller.current?.abort();
      const request = new AbortController();
      controller.current = request;
      const result = await workspaceRpc.discovery.inspect.call(input, { signal: request.signal });
      request.signal.throwIfAborted();
      return pageDiscoverySchema.parse(result);
    },
  });
  useEffect(() => () => controller.current?.abort(), []);
  const reset = () => {
    inspection.reset();
    setSelected(new Set());
    setPage(0);
  };
  const inspect = () => {
    reset();
    inspection.mutate({ url: url.trim() });
  };
  const toggle = (target: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(target)) next.delete(target);
      else if (next.size < 50) next.add(target);
      return next;
    });
  return {
    url,
    setUrl,
    selected,
    page,
    setPage,
    inspection,
    inspect,
    toggle,
    reset,
    cancel: () => controller.current?.abort(),
  };
}
