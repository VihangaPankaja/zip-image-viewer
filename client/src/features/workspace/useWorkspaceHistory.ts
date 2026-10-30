import { useEffect, useRef } from "react";
import type { WorkspaceLocation } from "../../../../shared/contracts";
import type { WorkspacePageState } from "./useWorkspacePageState";
import { readWorkspaceLocation, workspaceHash } from "./workspaceLocation";

type Navigation = {
  openSession: (id: string, options?: { location?: WorkspaceLocation }) => Promise<void>;
  abortNavigation: () => void;
  isOpening: boolean;
  setError: (message: string) => void;
};

export function useWorkspaceHistory(state: WorkspacePageState, navigation: Navigation): void {
  const latest = useRef({ state, navigation });
  useEffect(() => {
    latest.current = { state, navigation };
  });
  const restoring = useRef(true);
  const revision = useRef(0);
  const restoredHash = useRef<string | null>(null);
  useEffect(() => {
    restoredHash.current = null;
    const restore = () => {
      if (restoredHash.current === window.location.hash) return;
      restoredHash.current = window.location.hash;
      const location = readWorkspaceLocation(window.location.hash);
      const current = latest.current;
      const version = ++revision.current;
      restoring.current = true;
      current.navigation.abortNavigation();
      current.navigation.setError("");
      current.state.setLivePreview(location.live ?? null);
      current.state.setActiveView(location.view);
      current.state.setSelectedPath(location.path);
      current.state.setSearch(location.search);
      current.state.setMediaType(location.media);
      if (new URLSearchParams(window.location.hash.slice(1)).has("workspace"))
        current.state.setSortMode(location.sort);
      current.state.setParents(location.parents);
      current.state.setNavigationSessionId(location.sessionId);
      current.state.setSlideshowOpen(false);
      current.state.setExplorerModalOpen(false);
      if (location.sessionId && location.sessionId !== current.state.session?.id) {
        void current.navigation.openSession(location.sessionId, { location }).finally(() => {
          if (revision.current === version) restoring.current = false;
        });
      } else {
        if (!location.sessionId) current.state.setSession(null);
        restoring.current = false;
      }
    };
    restore();
    window.addEventListener("popstate", restore);
    window.addEventListener("hashchange", restore);
    return () => {
      window.removeEventListener("popstate", restore);
      window.removeEventListener("hashchange", restore);
    };
  }, []);
  useEffect(() => {
    if (restoring.current || navigation.isOpening) return;
    const location: WorkspaceLocation = {
      view: state.activeView,
      sessionId: state.session?.id ?? state.navigationSessionId,
      path: state.selectedPath,
      search: state.search,
      media: state.mediaType,
      sort: state.sortMode,
      parents: state.parents,
      live: state.livePreview ?? undefined,
    };
    const hash = workspaceHash(location);
    if (hash !== window.location.hash) {
      const previous = readWorkspaceLocation(window.location.hash);
      const sameSelection =
        previous.sessionId === location.sessionId &&
        previous.path === location.path &&
        previous.view === location.view &&
        JSON.stringify(previous.live) === JSON.stringify(location.live) &&
        JSON.stringify(previous.parents) === JSON.stringify(location.parents);
      window.history[sameSelection ? "replaceState" : "pushState"](null, "", hash);
      restoredHash.current = hash;
    }
  }, [state, navigation.isOpening]);
}
