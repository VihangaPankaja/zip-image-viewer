import { useModalDialog } from "../../../hooks/useModalDialog";

export function WorkspaceHelp({ onClose }: { onClose: () => void }) {
  const dialog = useModalDialog();
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-labelledby="workspace-help-title"
      onClose={onClose}
    >
      <div className="settings-sheet">
        <header className="panel-header">
          <h2 id="workspace-help-title">Help and shortcuts</h2>
          <button className="ghost-button" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="workspace-help">
          <h3>Navigation</h3>
          <p>
            Browser Back and Forward restore the selected session, file and filters. Archive
            breadcrumbs return to the parent file. Downloads keeps the current preview available.
          </p>
          <h3>Files and images</h3>
          <p>
            Use arrow keys in the file tree. Right expands a folder, Left collapses it, Enter
            selects. Outside controls, Left and Right move between sibling previews. F or Enter
            opens an image slideshow; Escape closes it. Home and End jump within a slideshow.
          </p>
          <h3>Video</h3>
          <p>
            Use the timeline arrow keys to seek. Outside controls, Up and Down adjust volume, [ and
            ] change speed, F toggles fullscreen. In fullscreen, J and L seek by the configured
            jump.
          </p>
          <h3>Recovery</h3>
          <p>
            If a preview fails, retry it or download the original. An unavailable nested archive can
            be reopened from its parent. Close dialogs with Escape; focus returns to the control
            that opened them.
          </p>
        </div>
      </div>
    </dialog>
  );
}
