import { render, screen } from "@testing-library/react";
import { ImagePreviewContent } from "./ImagePreviewContent";

describe("ImagePreviewContent", () => {
  it("uses a native disclosure for folder thumbnails", () => {
    render(
      <ImagePreviewContent
        currentFolderImageItems={[
          { name: "one.jpg", path: "one.jpg", thumbnailUrl: "/one" },
          { name: "two.jpg", path: "two.jpg", thumbnailUrl: "/two" },
        ]}
        currentFolderImages={["one.jpg", "two.jpg"]}
        currentImageIndex={0}
        formatBytes={() => "1 KB"}
        formatDate={() => "Today"}
        previewQuality="balanced"
        previewQualityOptions={[{ value: "balanced", label: "Balanced" }]}
        selectedImagePreviewUrl="/one"
        selectedImageSrc=""
        selectedNode={{ name: "one.jpg", path: "one.jpg", type: "file" }}
        selectedPath="one.jpg"
        setPreviewQuality={vi.fn()}
        setSelectedPath={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Folder thumbnails").closest("details"),
    ).toBeInTheDocument();
  });
});
