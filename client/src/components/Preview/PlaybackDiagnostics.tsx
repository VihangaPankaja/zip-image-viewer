import { useEffect, useState, type RefObject } from "react";
import type Hls from "hls.js";

type HlsStatus = {
  status: string;
  renditions: {
    quality: string;
    status: string;
    encoderWaitMs?: number | null;
  }[];
} | null;

type Props = {
  hlsRef: RefObject<Hls | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  selectedVideoQuality: string;
  videoHeight: number | null;
  videoPlaybackError: string;
  videoHlsStatus: HlsStatus;
};

function readPlayback(props: Props) {
  const video = props.videoRef.current;
  const hls = props.hlsRef.current;
  const level = hls?.levels[hls.currentLevel]?.height ?? props.videoHeight;
  let bufferedSeconds = 0;
  if (video) {
    for (let index = 0; index < video.buffered.length; index++) {
      if (
        video.buffered.start(index) <= video.currentTime &&
        video.currentTime <= video.buffered.end(index)
      ) {
        bufferedSeconds = video.buffered.end(index) - video.currentTime;
        break;
      }
    }
  }
  const rendition =
    props.videoHlsStatus?.renditions.find(
      ({ quality }) =>
        quality === `${level}p` || quality === props.selectedVideoQuality,
    ) ??
    props.videoHlsStatus?.renditions.find(
      ({ status }) => status === "queued" || status === "running",
    );
  return {
    mode:
      props.selectedVideoQuality === "source"
        ? "Original"
        : hls
          ? "HLS.js"
          : "Native or fallback",
    activeLevel: level ? `${level}p` : "Unknown",
    bandwidthMbps: hls?.bandwidthEstimate
      ? Number((hls.bandwidthEstimate / 1_000_000).toFixed(1))
      : null,
    bufferSeconds: Number(bufferedSeconds.toFixed(1)),
    droppedFrames: video?.getVideoPlaybackQuality().droppedVideoFrames ?? null,
    encoderWaitMs: rendition?.encoderWaitMs ?? null,
    encoderStatus:
      rendition?.status ?? props.videoHlsStatus?.status ?? "Unavailable",
    playbackError: Boolean(props.videoPlaybackError),
  };
}

export function PlaybackDiagnostics(props: Props) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(() => readPlayback(props));
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    if (!open) return;
    const refresh = () => setSnapshot(readPlayback(props));
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [open, props]);

  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Playback diagnostics</summary>
      <dl className="playback-diagnostics">
        <div>
          <dt>Mode</dt>
          <dd>{snapshot.mode}</dd>
        </div>
        <div>
          <dt>Active level</dt>
          <dd>{snapshot.activeLevel}</dd>
        </div>
        <div>
          <dt>Bandwidth</dt>
          <dd>
            {snapshot.bandwidthMbps == null
              ? "Unavailable"
              : `${snapshot.bandwidthMbps} Mbps`}
          </dd>
        </div>
        <div>
          <dt>Buffer</dt>
          <dd>{snapshot.bufferSeconds} s</dd>
        </div>
        <div>
          <dt>Dropped frames</dt>
          <dd>{snapshot.droppedFrames ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt>Encoder wait</dt>
          <dd>
            {snapshot.encoderWaitMs == null
              ? "Unavailable"
              : `${snapshot.encoderWaitMs} ms`}
          </dd>
        </div>
        <div>
          <dt>Encoder status</dt>
          <dd>{snapshot.encoderStatus}</dd>
        </div>
      </dl>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard
            .writeText(JSON.stringify(snapshot, null, 2))
            .then(() => setCopyStatus("Report copied"))
            .catch(() => setCopyStatus("Could not copy report"));
        }}
      >
        Copy diagnostic report
      </button>
      <span role="status">{copyStatus}</span>
    </details>
  );
}
