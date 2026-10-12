import { StrictMode, useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DownloadDialog } from "./DownloadDialog";
import { DEFAULT_DOWNLOAD_OPTIONS } from "../../../lib/appConstants";

function DownloadFlow() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Add downloads</button>
      <button>Review files</button>
      <DownloadDialog
        defaultOptions={DEFAULT_DOWNLOAD_OPTIONS}
        open={open}
        onClose={() => setOpen(false)}
        onSubmit={() => Promise.resolve()}
      />
    </>
  );
}

it("returns focus to the opener after closing and announces batch totals", async () => {
  const user = userEvent.setup();
  render(
    <StrictMode>
      <DownloadFlow />
    </StrictMode>,
  );
  const opener = screen.getByRole("button", { name: "Add downloads" });
  await user.click(opener);
  await user.type(
    screen.getByRole("textbox", { name: "Paste download URLs" }),
    "https://example.com/film.zip",
  );
  expect(screen.getByRole("status")).toHaveTextContent("1 of 50 ready");
  await user.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(opener).toHaveFocus());
});

it("preserves focus moved to another control before delayed dialog cleanup", async () => {
  const frames: FrameRequestCallback[] = [];
  const animationFrame = vi
    .spyOn(globalThis, "requestAnimationFrame")
    .mockImplementation((callback) => frames.push(callback));
  try {
    const user = userEvent.setup();
    render(<DownloadFlow />);
    await user.click(screen.getByRole("button", { name: "Add downloads" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    const review = screen.getByRole("button", { name: "Review files" });
    review.focus();
    expect(frames).toHaveLength(1);
    act(() => frames[0](performance.now()));
    expect(review).toHaveFocus();
  } finally {
    animationFrame.mockRestore();
  }
});
