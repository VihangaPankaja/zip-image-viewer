import type { WorkspacePageController } from "../useWorkspacePageController";

export function WorkspaceBreadcrumbs({ controller }: { controller: WorkspacePageController }) {
  const { state, actions } = controller;
  return (
    <nav className="workspace-breadcrumbs" aria-label="Archive navigation">
      <button
        className="ghost-button"
        type="button"
        onClick={() => state.setActiveView("downloads")}
      >
        Downloads
      </button>
      {state.parents.map((parent, index) => (
        <button
          className="ghost-button"
          type="button"
          key={parent.sessionId}
          title={parent.name}
          onClick={() => {
            const location = {
              ...parent,
              view: "explore" as const,
              parents: state.parents.slice(0, index),
            };
            state.setParents(location.parents);
            state.setSearch(parent.search);
            state.setMediaType(parent.media);
            state.setSortMode(parent.sort);
            void actions.openSession(parent.sessionId, { location });
          }}
        >
          {parent.name}
        </button>
      ))}
      <span aria-current="location" title={state.session?.tree?.name}>
        {state.session?.tree?.name || "Preview"}
      </span>
    </nav>
  );
}
