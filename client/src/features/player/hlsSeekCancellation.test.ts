import Hls, { Fragment, PlaylistLevelType } from "hls.js";
import { expect, it, vi } from "vitest";

type Controller = {
  state: string;
  fragCurrent: Fragment | null;
  fragmentLoader: { abort: () => void };
  _loadInitSegment: (_fragment: Fragment) => Promise<void>;
  loadInitSegmentIfNeeded: (_fragment: Fragment) => Promise<void>;
};

it.each([true, false])(
  "handles init cancellation after the fragment changes: %s",
  async (changed) => {
    const player = new Hls({ enableWorker: false });
    const controller = (player as unknown as { streamController: Controller })
      .streamController;
    const previous = new Fragment(PlaylistLevelType.MAIN, "http://localhost/");
    previous.sn = 4;
    previous.initSegment = new Fragment(
      PlaylistLevelType.MAIN,
      "http://localhost/",
    );
    previous.initSegment.sn = "initSegment";
    const current = new Fragment(PlaylistLevelType.MAIN, "http://localhost/");
    current.sn = 16;
    let cancel!: (_error: Error) => void;
    const initialization = new Promise<void>((_resolve, reject) => {
      cancel = reject;
    });
    const abort = vi.spyOn(controller.fragmentLoader, "abort");
    vi.spyOn(controller, "_loadInitSegment").mockReturnValue(initialization);
    controller.state = "FRAG_LOADING";
    controller.fragCurrent = previous;
    try {
      const pending = controller.loadInitSegmentIfNeeded(previous);
      controller.fragCurrent = changed ? current : previous;
      const cancelled = Object.assign(new Error("Previous init cancelled"), {
        data: { frag: previous.initSegment },
      });
      cancel(cancelled);
      await expect(pending).rejects.toBe(cancelled);
      expect(abort).toHaveBeenCalledTimes(changed ? 0 : 1);
      expect(controller.fragCurrent).toBe(changed ? current : previous);
      expect(controller.state).toBe(changed ? "FRAG_LOADING" : "IDLE");
    } finally {
      vi.restoreAllMocks();
      player.destroy();
    }
  },
);
