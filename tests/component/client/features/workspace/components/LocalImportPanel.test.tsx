import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vite-plus/test";
import { LocalImportPanel } from "../../../../../../client/src/features/workspace/components/LocalImportPanel";

it("offers a labelled picker, rejects directory drops and passes files without reading them", async () => {
  const add = vi.fn();
  const controller = { items: [], error: "", add, retry: vi.fn(), cancel: vi.fn() };
  render(<LocalImportPanel imports={controller} />);
  const file = new File(["notes"], "日本語.txt", { type: "text/plain" });
  Object.defineProperty(file, "arrayBuffer", {
    value: () => {
      throw new Error("Do not buffer a file");
    },
  });
  const picker = screen.getByLabelText("Choose local files");
  await userEvent.upload(picker, file);
  expect(add).toHaveBeenCalledWith([file]);
  expect(picker).toHaveValue("");
  const target = screen.getByRole("region", { name: "Import local files" });
  fireEvent.drop(target, {
    dataTransfer: {
      files: [file],
      items: [{ kind: "file", webkitGetAsEntry: () => ({ isDirectory: true }) }],
    },
  });
  expect(screen.getByRole("alert")).toHaveTextContent("ZIP");
  expect(add).toHaveBeenCalledTimes(1);
  fireEvent.drop(target, {
    dataTransfer: {
      files: [file],
      items: [{ kind: "file", webkitGetAsEntry: () => ({ isDirectory: false }) }],
    },
  });
  expect(add).toHaveBeenCalledTimes(2);
});

it("keeps cancellation and retry accessible with a long filename and distinct upload progress", async () => {
  const cancel = vi.fn();
  const retry = vi.fn();
  const items = [
    {
      id: "one",
      name: "a".repeat(180) + ".zip",
      size: 1024,
      sent: 512,
      status: "uploading" as const,
      error: "",
    },
    {
      id: "two",
      name: "notes.txt",
      size: 5,
      sent: 0,
      status: "error" as const,
      error: "Upload interrupted",
    },
  ];
  render(<LocalImportPanel imports={{ items, error: "", add: vi.fn(), cancel, retry }} />);
  expect(screen.getByRole("progressbar", { name: `Upload ${items[0].name}` })).toHaveAttribute(
    "value",
    "512",
  );
  await userEvent.click(screen.getByRole("button", { name: `Cancel upload ${items[0].name}` }));
  expect(cancel).toHaveBeenCalledWith("one");
  await userEvent.click(screen.getByRole("button", { name: "Retry upload notes.txt" }));
  expect(retry).toHaveBeenCalledWith("two");
  await userEvent.click(screen.getByRole("button", { name: "Dismiss notes.txt" }));
  expect(cancel).toHaveBeenCalledWith("two");
});
