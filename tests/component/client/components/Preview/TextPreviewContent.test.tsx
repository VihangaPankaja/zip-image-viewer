import { fireEvent, render, screen } from "@testing-library/react";
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
