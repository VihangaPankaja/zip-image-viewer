import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { workspaceRpc } from "../../services/orpcClient";
import { flattenTree } from "../../lib/treeUtils";
import type { SessionSummary, WorkspaceLocation } from "../../../../shared/contracts";
import { sessionPayloadSchema, type SessionTree } from "./sessionSchemas";
import type { WorkspacePageState } from "./useWorkspacePageState";
import type { SessionRailItem } from "../../components/Workspace/SessionRail";
import type { LivePreview } from "./workspaceRail";

async function fetchSession(sessionId: string, signal: AbortSignal) {
  const response = await fetch(`/api/sessions/${sessionId}/tree`, { signal });
  if (!response.ok)
    throw new Error(
      "This preview is no longer available. Check Downloads or choose another session.",
    );
  const parsed = sessionPayloadSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.id !== sessionId || !parsed.data.tree)
    throw new Error("This session returned invalid data. Check Downloads or try again.");
  signal.throwIfAborted();
  return { ...parsed.data, tree: parsed.data.tree };
}

function useSessionOpener(
  state: WorkspacePageState,
  setLivePreview: (value: LivePreview | null) => void,
) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [isOpening, setIsOpening] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const openSession = useCallback(
    async (sessionId: string, options?: { location?: WorkspaceLocation; nested?: boolean }) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setError("");
      setIsOpening(true);
      state.setNavigationSessionId(sessionId);
      if (state.session?.id !== sessionId) state.setSession(null);
      try {
        const session = await fetchSession(sessionId, controller.signal);
        const queryKey = workspaceRpc.sessions.list.queryOptions().queryKey;
        // An older list response must not hide a tree we just successfully loaded.
        await queryClient.cancelQueries({ queryKey });
        if (controller.signal.aborted) return;
        const tree = session.tree;
        if (!options?.nested && !options?.location?.parents.length)
          queryClient.setQueryData<{ items: SessionSummary[] }>(queryKey, (current) => ({
            items: withOpenedSession(
              current?.items ?? [],
              sessionId,
              session.firstFilePath ?? "",
              tree,
            ),
          }));
        state.setActiveJob(null);
        state.setSession(session);
        state.setSelectedPath(
          options?.location?.path || session.firstFilePath || session.tree.path,
        );
        if (!options?.nested && !options?.location) {
          state.setParents([]);
          state.setSearch("");
          state.setMediaType("all");
        }
        state.setError("");
        setLivePreview(null);
        state.setActiveView(options?.location?.view ?? "explore");
        if (options?.location || options?.nested) state.setMobilePane("preview");
      } catch (cause) {
        if (!controller.signal.aborted) {
          state.setActiveJob(null);
          state.setSession(null);
          setLivePreview(null);
          setError(
            cause instanceof Error ? cause.message : "Could not open this preview. Try again.",
          );
          state.setActiveView(options?.location?.view ?? "explore");
          state.setMobilePane("preview");
        }
      } finally {
        if (request.current === controller) setIsOpening(false);
      }
    },
    [state, queryClient, setLivePreview],
  );
  const abortNavigation = () => request.current?.abort();
  return { openSession, error, setError, abortNavigation, isOpening };
}
export function useWorkspacePreviewNavigation(state: WorkspacePageState, items: SessionRailItem[]) {
  const { livePreview, setLivePreview } = state;
  const opener = useSessionOpener(state, setLivePreview);
  const selectPreview = (id: string) => {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return;
    if (!item.livePreview) {
      void opener.openSession(id);
      return;
    }
    opener.abortNavigation();
    opener.setError("");
    state.setActiveJob(null);
    state.setSession(null);
    state.setSelectedPath("");
    state.setNavigationSessionId(undefined);
    state.setParents([]);
    state.setActiveView("explore");
    setLivePreview(item.livePreview);
    state.setMobilePane("preview");
  };
  const closeLivePreview = () => {
    setLivePreview(null);
    state.setActiveView("downloads");
  };
  return { ...opener, selectPreview, closeLivePreview, livePreview };
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
