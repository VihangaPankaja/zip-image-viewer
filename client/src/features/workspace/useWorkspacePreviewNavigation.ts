import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { workspaceRpc } from "../../services/orpcClient";
import { flattenTree } from "../../lib/treeUtils";
import type { SessionSummary } from "../../../../shared/contracts";
import { sessionPayloadSchema, type SessionTree } from "./sessionSchemas";
import type { WorkspacePageState } from "./useWorkspacePageState";
import type { SessionRailItem } from "../../components/Workspace/SessionRail";
import type { LivePreview } from "./workspaceRail";

export function useWorkspacePreviewNavigation(state: WorkspacePageState, items: SessionRailItem[]) {
  const queryClient = useQueryClient();
  const [livePreview, setLivePreview] = useState<LivePreview | null>(null);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const openSession = useCallback(
    async (sessionId: string) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setError("");
      try {
        const response = await fetch(`/api/sessions/${sessionId}/tree`, {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(
            "This preview is no longer available. Check Downloads or choose another session.",
          );
        const parsed = sessionPayloadSchema.safeParse(await response.json());
        if (!parsed.success || parsed.data.id !== sessionId || !parsed.data.tree)
          throw new Error("This session returned invalid data. Check Downloads or try again.");
        controller.signal.throwIfAborted();
        const queryKey = workspaceRpc.sessions.list.queryOptions().queryKey;
        // An older list response must not hide a tree we just successfully loaded.
        await queryClient.cancelQueries({ queryKey });
        if (controller.signal.aborted) return;
        const tree = parsed.data.tree;
        queryClient.setQueryData<{ items: SessionSummary[] }>(queryKey, (current) => ({
          items: withOpenedSession(
            current?.items ?? [],
            sessionId,
            parsed.data.firstFilePath ?? "",
            tree,
          ),
        }));
        state.setActiveJob(null);
        state.setSession(parsed.data);
        state.setSelectedPath(parsed.data.firstFilePath || parsed.data.tree.path);
        state.setError("");
        setLivePreview(null);
        state.setActiveView("explore");
      } catch (cause) {
        if (!controller.signal.aborted) {
          state.setActiveJob(null);
          state.setSession(null);
          state.setSelectedPath("");
          setLivePreview(null);
          setError(
            cause instanceof Error ? cause.message : "Could not open this preview. Try again.",
          );
          state.setActiveView("explore");
          state.setMobilePane("preview");
        }
      }
    },
    [state, queryClient],
  );
  const selectPreview = (id: string) => {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return;
    if (!item.livePreview) {
      void openSession(id);
      return;
    }
    request.current?.abort();
    setError("");
    state.setActiveJob(null);
    state.setSession(null);
    state.setSelectedPath("");
    setLivePreview(item.livePreview);
    state.setMobilePane("preview");
  };
  const closeLivePreview = () => {
    setLivePreview(null);
    state.setActiveView("downloads");
  };
  return { openSession, selectPreview, closeLivePreview, livePreview, error };
}

function withOpenedSession(
  items: SessionSummary[],
  sessionId: string,
  firstFilePath: string,
  tree: SessionTree,
): SessionSummary[] {
  const existing = items.find(({ id }) => id === sessionId);
  return [
    ...items.filter(({ id }) => id !== sessionId),
    {
      ...existing,
      id: sessionId,
      firstFilePath: existing?.firstFilePath ?? firstFilePath,
      fileCount: [...flattenTree(tree).nodesByPath.values()].filter((node) => node.type === "file")
        .length,
      lastAccessedAt: Date.now(),
    },
  ];
}
