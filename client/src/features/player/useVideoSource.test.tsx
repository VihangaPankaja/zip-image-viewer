import { useRef, useState } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { useVideoSource } from "./useVideoSource";

const instances: FakeHls[] = [];
class FakeHls {
  static Events = {
    ERROR: "error",
    MANIFEST_PARSED: "manifestParsed",
    LEVEL_SWITCHED: "levelSwitched",
  };
  static ErrorTypes = { MEDIA_ERROR: "mediaError" };
  static isSupported() {
    return true;
  }
  levels = [{ height: 360 }, { height: 720 }];
  loadLevel = -1;
  destroyed = false;
  handlers = new Map<string, (event: string, data: unknown) => void>();
  constructor() {
    instances.push(this);
  }
  on(event: string, handler: (event: string, data: unknown) => void) {
    this.handlers.set(event, handler);
  }
  loadSource(_url: string) {}
  attachMedia(_video: HTMLVideoElement) {}
  destroy() {
    this.destroyed = true;
  }
  emit(event: string, data: unknown = { level: 0 }) {
    this.handlers.get(event)?.(event, data);
  }
}

vi.mock("./adaptiveQuality", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./adaptiveQuality")>()),
  loadHlsModule: () => Promise.resolve({ default: FakeHls }),
}));

function Harness({ quality, file }: { quality: string; file: string }) {
  const hlsRef = useRef<InstanceType<typeof import("hls.js").default> | null>(
    null,
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [, setStatus] = useState<"loading" | "buffering" | "ready">("loading");
  const [, setHeight] = useState<number | null>(null);
  useVideoSource({
    extension: "mp4",
    hlsRef,
    hlsUrl: `/hls/master?path=${file}`,
    originalUrl: `/play?path=${file}`,
    selectedKind: "video",
    selectedQuality: quality,
    setPlaybackError: setError,
    setPlaybackStatus: setStatus,
    setVideoHeight: setHeight,
    videoRef,
  });
  return (
    <>
      <video ref={videoRef} />
      <output>{error}</output>
    </>
  );
}

describe("video quality switching", () => {
  it("changes HLS level without replacing the player or resetting position", async () => {
    instances.length = 0;
    const { rerender, container } = render(
      <Harness quality="auto" file="one.mp4" />,
    );
    await waitFor(() => expect(instances).toHaveLength(1));
    const player = container.querySelector("video");
    if (!player) throw new Error("Video element was not rendered.");
    act(() => instances[0].emit(FakeHls.Events.MANIFEST_PARSED));
    player.currentTime = 12;
    rerender(<Harness quality="720p" file="one.mp4" />);
    expect(instances).toHaveLength(1);
    expect(instances[0].loadLevel).toBe(1);
    expect(player.currentTime).toBe(12);
    expect(instances[0].destroyed).toBe(false);

    rerender(<Harness quality="auto" file="one.mp4" />);
    expect(instances[0].loadLevel).toBe(-1);
    expect(instances).toHaveLength(1);

    const load = vi
      .spyOn(HTMLMediaElement.prototype, "load")
      .mockImplementation(() => {});
    rerender(<Harness quality="source" file="one.mp4" />);
    expect(instances[0].destroyed).toBe(true);
    expect(player.querySelector("source")?.getAttribute("src")).toBe(
      "/play?path=one.mp4",
    );
    load.mockRestore();

    player.currentTime = 0;
    rerender(<Harness quality="720p" file="two.mp4" />);
    await waitFor(() => expect(instances).toHaveLength(2));
    act(() => instances[1].emit(FakeHls.Events.MANIFEST_PARSED));
    expect(player.currentTime).toBe(0);
  });

  it("identifies a missing HLS segment from a fragment 404", async () => {
    instances.length = 0;
    const { container } = render(<Harness quality="auto" file="one.mp4" />);
    await waitFor(() => expect(instances).toHaveLength(1));
    act(() =>
      instances[0].emit(FakeHls.Events.ERROR, {
        fatal: true,
        type: "networkError",
        details: "fragLoadError",
        response: { code: 404 },
      }),
    );
    expect(container.querySelector("output")?.textContent).toBe(
      "Video segment is missing.",
    );
  });
});
