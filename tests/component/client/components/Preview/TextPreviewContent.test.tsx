import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useTextPreview } from "../../../../../client/src/hooks/useTextPreview";
import { TextPreviewContent } from "../../../../../client/src/components/Preview/TextPreviewContent";
import type { TextPreviewState } from "../../../../../client/src/hooks/useTextPreview";

const base = {
  formatBytes: (value: number) => `${value} B`,
  formatDate: () => "Today",
  selectedNode: {
    name: "notes.json",
    path: "notes.json",
    type: "file" as const,
    extension: "json",
  },
};
function preview(text: string, totalBytes = text.length): TextPreviewState {
  return {
    chunk: {
      text,
      offset: 0,
      nextOffset: text.length,
      totalBytes,
      encoding: "utf-8",
      binary: false,
      replacementCharacters: false,
    },
    loading: false,
    error: "",
    loadOffset: vi.fn(),
  };
}

it("escapes content and clearly scopes search to the loaded chunk", () => {
  const { container } = render(
    <TextPreviewContent
      {...base}
      textPreview={preview('<script>alert("x")</script>\nhello', 209715200)}
    />,
  );
  expect(container.querySelector("script")).toBeNull();
  expect(screen.getByText(/Truncated preview$/i)).toBeInTheDocument();
  expect(screen.getByText(/total lines unknown/i)).toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "hello" } });
  expect(screen.getByText(/the whole file has not been searched/i)).toBeInTheDocument();
  expect(screen.getByText(/1 matching/i)).toBeInTheDocument();
});

it("virtualizes huge line counts and bounds a single displayed row", () => {
  const { container, rerender } = render(
    <TextPreviewContent {...base} textPreview={preview("line\n".repeat(25000))} />,
  );
  expect(container.querySelectorAll(".text-line").length).toBeLessThan(100);
  rerender(<TextPreviewContent {...base} textPreview={preview("x".repeat(131072))} />);
  expect(
    [...container.querySelectorAll(".text-line-code")].every(
      (node) => node.textContent.length <= 4096,
    ),
  ).toBe(true);
  expect(screen.getByText(/continuation rows/i)).toBeInTheDocument();
});

it("formats JSON safely and keeps malformed JSON readable", () => {
  const { rerender } = render(<TextPreviewContent {...base} textPreview={preview('{"a":1}')} />);
  expect(screen.queryByRole("navigation", { name: "Text chunks" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Format JSON" }));
  expect(screen.getByText(/"a": 1/)).toBeInTheDocument();
  rerender(<TextPreviewContent {...base} textPreview={preview('{"a":')} />);
  fireEvent.click(screen.getByRole("button", { name: "Format JSON" }));
  expect(screen.getByRole("status")).toHaveTextContent(/invalid JSON/i);
});

it("reads quoted CSV cells as escaped text", () => {
  const text = 'name,note\r\n"a,b","line one\nline ""two"""\r\n"<img src=x>",safe';
  const { container } = render(
    <TextPreviewContent
      {...base}
      selectedNode={{ ...base.selectedNode, extension: "csv" }}
      textPreview={preview(text)}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Table" }));
  expect(screen.getByRole("cell", { name: "a,b" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: /line one\s+line "two"/ })).toBeInTheDocument();
  expect(container.querySelector("img")).toBeNull();
});

it("finds a literal spanning long-line continuation rows", () => {
  render(
    <TextPreviewContent
      {...base}
      textPreview={preview("a".repeat(4094) + "needle" + "b".repeat(5000))}
    />,
  );
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "needle" } });
  expect(screen.getByText(/1 matching/)).toBeInTheDocument();
});

it("preserves the chunk navigation control during loading", () => {
  const loaded = preview("hello", 300000);
  if (!loaded.chunk) throw new Error("Missing test chunk");
  const { rerender } = render(<TextPreviewContent {...base} textPreview={loaded} />);
  const next = screen.getByRole("button", { name: "Next chunk" });
  next.focus();
  fireEvent.click(next);
  rerender(<TextPreviewContent {...base} textPreview={{ ...loaded, loading: true }} />);
  expect(next).toHaveFocus();
  rerender(
    <TextPreviewContent
      {...base}
      textPreview={{
        ...loaded,
        loading: false,
        chunk: { ...loaded.chunk, offset: 131072, nextOffset: 300000 },
      }}
    />,
  );
  expect(screen.getByRole("button", { name: "Previous chunk" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "First chunk" }));
  rerender(<TextPreviewContent {...base} textPreview={loaded} />);
  expect(screen.getByRole("button", { name: "Next chunk" })).toHaveFocus();
});

it("keeps text, navigation and focus after a failed chunk and retries Next", async () => {
  const first = preview("original text", 300000).chunk;
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(Response.json(first))
      .mockRejectedValueOnce(new Error("Temporary read failure"))
      .mockResolvedValueOnce(
        Response.json({ ...first, text: "recovered text", offset: 13, nextOffset: 27 }),
      ),
  );
  function ConnectedPreview() {
    const { textPreview } = useTextPreview({
      selectedNode: base.selectedNode,
      selectedKind: "text",
      selectedPreviewUrl: "/file?path=notes.json",
      sessionId: "one",
    });
    return <TextPreviewContent {...base} textPreview={textPreview} />;
  }
  try {
    render(<ConnectedPreview />);
    await screen.findByText("original text");
    const next = screen.getByRole("button", { name: "Next chunk" });
    next.focus();
    fireEvent.click(next);
    await screen.findByRole("alert");
    expect(screen.getByText("original text")).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Text chunks" })).toBeVisible();
    expect(next).toHaveFocus();
    fireEvent.click(next);
    await screen.findByText("recovered text");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(next).toHaveFocus();
  } finally {
    vi.unstubAllGlobals();
  }
});
