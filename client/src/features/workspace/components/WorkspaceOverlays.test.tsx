import { render, screen } from "@testing-library/react";
import { WorkspaceOverlays } from "./WorkspaceOverlays";

describe("WorkspaceOverlays", () => {
  it("renders the slideshow in a native dialog", () => {
    render(
      <WorkspaceOverlays
        currentFolderImages={["one.jpg"]}
        currentImageIndex={0}
        explorerModalOpen={false}
        formatBytes={() => "1 KB"}
        formatDate={() => "Today"}
        nextImageName=""
        nextImagePath="one.jpg"
        onCloseExplorer={vi.fn()}
        onCloseSlideshow={vi.fn()}
        onSelectPath={vi.fn()}
        previousImageName=""
        previousImagePath="one.jpg"
        selectedImageUrl="/one.jpg"
        selectedKind="image"
        selectedNode={{ name: "one.jpg" }}
        selectedPath="one.jpg"
        setExplorerModalOpen={vi.fn()}
        setSlideshowChromeHidden={vi.fn()}
        setSlideshowFitMode={vi.fn()}
        slideshowChromeHidden={false}
        slideshowFitMode="best-fit"
        slideshowFitOptions={[{ value: "best-fit", label: "Best fit" }]}
        slideshowOpen
        sortedTree={null}
      />,
    );

    expect(screen.getByRole("dialog")).toHaveProperty("tagName", "DIALOG");
  });
});
