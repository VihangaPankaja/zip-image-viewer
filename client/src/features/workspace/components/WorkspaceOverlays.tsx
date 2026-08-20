import { createPortal } from "react-dom";
import { CustomDropdown } from "../../../components/Common/CustomDropdown";
import {
  TreeExplorer,
  type ExplorerNode,
} from "../../../components/TreeExplorer";
import type { SelectOption } from "../types";

type ImageNode = { modifiedAt?: number; name: string; size?: number };

type WorkspaceOverlaysProps = {
  currentFolderImages: readonly string[];
  currentImageIndex: number;
  explorerModalOpen: boolean;
  formatBytes: (value: number) => string;
  formatDate: (value: number) => string;
  nextImageName: string;
  nextImagePath: string;
  onCloseExplorer: () => void;
  onCloseSlideshow: () => void;
  onSelectPath: (path: string) => void;
  previousImageName: string;
  previousImagePath: string;
  selectedImageUrl: string;
  selectedKind: string;
  selectedNode: ImageNode | null;
  selectedPath: string;
  setExplorerModalOpen: (value: boolean) => void;
  setSlideshowChromeHidden: (
    value: boolean | ((value: boolean) => boolean),
  ) => void;
  setSlideshowFitMode: (value: string) => void;
  slideshowChromeHidden: boolean;
  slideshowFitMode: string;
  slideshowFitOptions: SelectOption[];
  slideshowOpen: boolean;
  sortedTree: ExplorerNode | null;
};

export function WorkspaceOverlays(props: WorkspaceOverlaysProps) {
  const { explorerModalOpen, slideshowOpen, sortedTree } = props;
  return (
    <>
      {slideshowOpen && props.selectedKind === "image" && props.selectedNode ? (
        <SlideshowOverlay {...props} />
      ) : null}
      {explorerModalOpen && sortedTree ? <ExplorerOverlay {...props} /> : null}
    </>
  );
}

function SlideshowOverlay(props: WorkspaceOverlaysProps) {
  const node = props.selectedNode;
  if (!node) return null;
  const lastPath = props.currentFolderImages.at(-1) || "";
  return createPortal(
    <div
      className={`slideshow-overlay ${props.slideshowChromeHidden ? "chrome-hidden" : ""}`}
    >
      <div
        className="slideshow-viewport"
        role="dialog"
        aria-modal="true"
        aria-label={`Slideshow for ${node.name}`}
      >
        <div
          className={`slideshow-stage slideshow-fit-${props.slideshowFitMode}`}
          onDoubleClick={() =>
            props.setSlideshowChromeHidden((value) => !value)
          }
        >
          <img src={props.selectedImageUrl} alt={node.name} />
        </div>
        <SlideshowTools {...props} node={node} lastPath={lastPath} />
        <div
          className="slideshow-floating slideshow-floating-nav"
          aria-hidden={props.slideshowChromeHidden}
        >
          <button
            className="nav-button nav-button-left"
            type="button"
            aria-label="Previous image"
            onClick={() => props.onSelectPath(props.previousImagePath)}
          >
            {"<"}
          </button>
          <button
            className="nav-button nav-button-right"
            type="button"
            aria-label="Next image"
            onClick={() => props.onSelectPath(props.nextImagePath)}
          >
            {">"}
          </button>
        </div>
        <div className="slideshow-floating slideshow-floating-bottom">
          <div className="slideshow-neighbors-card">
            <div className="slideshow-neighbors">
              <span>Prev: {props.previousImageName || "None"}</span>
              <span>Next: {props.nextImageName || "None"}</span>
            </div>
            <div className="navigation-hint">
              Arrow keys move, Home/End jump, F opens slideshow, Escape closes
              it.
            </div>
          </div>
        </div>
        {props.slideshowChromeHidden ? (
          <button
            className="slideshow-reveal-button"
            type="button"
            onClick={() => props.setSlideshowChromeHidden(false)}
          >
            Show UI
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function SlideshowTools({
  node,
  lastPath,
  ...props
}: WorkspaceOverlaysProps & { node: ImageNode; lastPath: string }) {
  return (
    <div className="slideshow-floating slideshow-floating-top">
      <div className="slideshow-info-card">
        <p className="panel-label">Folder slideshow</p>
        <h2 title={node.name}>{node.name}</h2>
        <div className="slideshow-meta">
          <span>
            {props.currentImageIndex + 1} / {props.currentFolderImages.length}
          </span>
          <span>{props.formatBytes(node.size ?? 0)}</span>
          <span>{props.formatDate(node.modifiedAt ?? 0)}</span>
        </div>
      </div>
      <div className="slideshow-controls-card">
        <CustomDropdown
          id="slideshow-fit-mode"
          label="Fit mode"
          value={props.slideshowFitMode}
          options={props.slideshowFitOptions}
          onChange={(value) => props.setSlideshowFitMode(String(value))}
          className="slideshow-fit-shell"
        />
        <div className="slideshow-actions">
          <button
            className="ghost-button"
            type="button"
            onClick={() =>
              props.onSelectPath(props.currentFolderImages[0] || "")
            }
          >
            First
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => props.onSelectPath(lastPath)}
          >
            Last
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => props.setSlideshowChromeHidden(true)}
          >
            Hide UI
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={props.onCloseSlideshow}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ExplorerOverlay(props: WorkspaceOverlaysProps) {
  if (!props.sortedTree) return null;
  return createPortal(
    <div className="settings-overlay" role="dialog" aria-modal="true">
      <div className="settings-sheet explorer-modal-sheet">
        <div className="panel-header">
          <div className="panel-title-group">
            <p className="panel-label">Explorer modal</p>
            <h2 title={props.sortedTree.name}>{props.sortedTree.name}</h2>
          </div>
          <button
            className="ghost-button compact-button"
            type="button"
            onClick={props.onCloseExplorer}
          >
            Close
          </button>
        </div>
        <div className="explorer-modal-body">
          <TreeExplorer
            rootNode={props.sortedTree}
            selectedPath={props.selectedPath}
            onSelect={(node) => {
              if (node.type === "file") {
                props.onSelectPath(node.path);
                props.setExplorerModalOpen(false);
              }
            }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
