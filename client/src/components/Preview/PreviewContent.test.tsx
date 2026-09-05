import { fireEvent, render, screen } from "@testing-library/react";
import type { PreviewContentProps } from "./PreviewContent";
import { PreviewContent } from "./PreviewContent";

describe("PreviewContent", () => {
  const props = {
    formatBytes: () => "1 KB",
    formatDate: () => "Today",
    selectedFileUrl: "/notes.txt",
    selectedKind: "text",
    selectedNode: { name: "notes.txt", path: "notes.txt", type: "file" },
    setExplorerModalOpen: vi.fn(),
    setSlideshowOpen: vi.fn(),
    textPreview: "hello",
  } as unknown as PreviewContentProps;

  afterEach(() => {
    delete (HTMLElement.prototype as { requestFullscreen?: () => void })
      .requestFullscreen;
  });

  it("maximizes any previewable file", () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    render(<PreviewContent {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Maximize preview" }));

    expect(requestFullscreen).toHaveBeenCalledOnce();
  });

  it("does not throw when the Fullscreen API is unavailable", () => {
    render(<PreviewContent {...props} />);

    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: "Maximize preview" })),
    ).not.toThrow();
  });
});
