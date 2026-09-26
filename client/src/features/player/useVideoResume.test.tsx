import { useRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { useVideoResume } from "./useVideoResume";

const key = (session = "one", path = "a/clip.mp4") =>
  `video-resume:${JSON.stringify([session, path])}`;
function Harness({ session = "one", path = "a/clip.mp4" }) {
  const ref = useRef<HTMLVideoElement>(null);
  const resume = useVideoResume(ref, session, path);
  return (
    <>
      <video ref={ref} aria-label="player" />
      {resume.position !== null && (
        <>
          <button onClick={resume.continuePlayback}>
            Continue {resume.position}
          </button>
          <button onClick={resume.startOver}>Start over</button>
        </>
      )}
    </>
  );
}
function media() {
  const player = screen.getByLabelText<HTMLVideoElement>("player");
  Object.defineProperties(player, {
    readyState: { configurable: true, value: 1 },
    duration: { configurable: true, value: 120 },
  });
  fireEvent.loadedMetadata(player);
  return player;
}
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());

it("throttles progress and flushes pause, pagehide and unmount without recording source resets", () => {
  const write = vi.spyOn(localStorage, "setItem");
  const { unmount } = render(<Harness />);
  const player = media();
  player.currentTime = 20;
  fireEvent.timeUpdate(player);
  player.currentTime = 21;
  fireEvent.timeUpdate(player);
  expect(write).toHaveBeenCalledTimes(1);
  fireEvent.pause(player);
  expect(localStorage.getItem(key())).toBe("21");
  player.currentTime = 22;
  fireEvent(window, new Event("pagehide"));
  expect(localStorage.getItem(key())).toBe("22");
  fireEvent.emptied(player);
  player.currentTime = 0;
  fireEvent.timeUpdate(player);
  unmount();
  expect(localStorage.getItem(key())).toBe("22");
});

it("offers stored progress and defers Continue until metadata, then supports Start over", () => {
  localStorage.setItem(key(), "32");
  const first = render(<Harness />);
  fireEvent.click(screen.getByText("Continue 32"));
  const player = media();
  expect(player.currentTime).toBe(32);
  first.unmount();
  render(<Harness />);
  const reopened = media();
  fireEvent.click(screen.getByText("Start over"));
  expect(reopened.currentTime).toBe(0);
  expect(localStorage.getItem(key())).toBeNull();
});

it("separates equal basenames and sessions and ignores the previous file's DOM position", () => {
  const { rerender } = render(<Harness />);
  const player = media();
  player.currentTime = 30;
  fireEvent.pause(player);
  rerender(<Harness path="b/clip.mp4" />);
  fireEvent.pause(player);
  expect(localStorage.getItem(key("one", "b/clip.mp4"))).toBeNull();
  player.currentTime = 0;
  fireEvent.loadedMetadata(player);
  player.currentTime = 50;
  fireEvent.pause(player);
  rerender(<Harness session="two" />);
  expect(localStorage.getItem(key())).toBe("30");
  expect(localStorage.getItem(key("one", "b/clip.mp4"))).toBe("50");
  expect(screen.queryByText(/Continue/)).not.toBeInTheDocument();
});

it("clears completed and near-end progress", () => {
  const { unmount } = render(<Harness />);
  const player = media();
  player.currentTime = 111;
  fireEvent.pause(player);
  expect(localStorage.getItem(key())).toBeNull();
  player.currentTime = 40;
  fireEvent.pause(player);
  fireEvent.ended(player);
  expect(localStorage.getItem(key())).toBeNull();
  player.currentTime = 120;
  unmount();
  localStorage.setItem(key(), "115");
  render(<Harness />);
  media();
  expect(screen.queryByText(/Continue/)).not.toBeInTheDocument();
  expect(localStorage.getItem(key())).toBeNull();
});

it("clears saved progress when native controls seek back to zero", () => {
  const { unmount } = render(<Harness />);
  const player = media();
  player.currentTime = 40;
  fireEvent.pause(player);
  expect(localStorage.getItem(key())).toBe("40");
  player.currentTime = 0;
  fireEvent.pause(player);
  expect(localStorage.getItem(key())).toBeNull();
  unmount();
  render(<Harness />);
  expect(screen.queryByText(/Continue/)).not.toBeInTheDocument();
});

it("tolerates corrupt and unavailable storage", () => {
  localStorage.setItem(key(), "{bad");
  const view = render(<Harness />);
  expect(screen.queryByText(/Continue/)).not.toBeInTheDocument();
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("disabled");
  });
  const player = media();
  player.currentTime = 20;
  fireEvent.pause(player);
  view.unmount();
  vi.spyOn(localStorage, "getItem").mockImplementation(() => {
    throw new Error("disabled");
  });
  render(<Harness />);
  expect(screen.queryByText(/Continue/)).not.toBeInTheDocument();
});
