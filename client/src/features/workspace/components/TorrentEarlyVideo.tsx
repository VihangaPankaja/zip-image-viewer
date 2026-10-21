import { useEffect, useId, useRef, useState, type RefObject } from "react";
import {
  torrentVideoInfoSchema,
  type Job,
  type TorrentFile,
} from "../../../../../shared/contracts";

import type { Selection } from "./TorrentFileDialog";
import { FileTools } from "./TorrentFileContents";
import { FileList } from "./TorrentFileList";

export function useTorrentPlayback(dialogRef: RefObject<HTMLDialogElement | null>) {
  const [playingFile, setPlayingFile] = useState<TorrentFile | null>(null);
  const playTrigger = useRef<HTMLButtonElement | null>(null);
  return {
    playingFile,
    play: (file: TorrentFile, trigger: HTMLButtonElement) => {
      playTrigger.current = trigger;
      setPlayingFile(file);
    },
    stopPlaying: () => {
      setPlayingFile(null);
      requestAnimationFrame(() => {
        if (playTrigger.current?.isConnected) playTrigger.current.focus();
        else dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      });
    },
  };
}

function stoppedMessage(job: Job) {
  if (job.status === "ready")
    return "Playback stopped: download complete. Open the session to use the full video player.";
  if (job.status === "paused")
    return "Playback stopped: download paused. Resume the download to play again.";
  if (job.status === "cancelled") return "Playback stopped: download cancelled.";
  if (job.status === "error")
    return "Playback stopped: the download failed. Retry the download to play again.";
  return "Playback stopped: the download is preparing files.";
}

function StreamVideo({ src, onError }: { src: string; onError: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [waiting, setWaiting] = useState(true);
  useEffect(() => {
    const video = ref.current;
    video?.setAttribute("src", src);
    return () => {
      if (!video) return;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [src]);
  return (
    <>
      <video
        ref={ref}
        src={src}
        controls
        playsInline
        preload="metadata"
        aria-label="Early video preview"
        onWaiting={() => setWaiting(true)}
        onStalled={() => setWaiting(true)}
        onCanPlay={() => setWaiting(false)}
        onPlaying={() => setWaiting(false)}
        onError={onError}
      />
      <p role="status">
        {waiting
          ? "Waiting for verified pieces or peers…"
          : "Ready to play. Seeking may wait for verified pieces."}
      </p>
    </>
  );
}

export function TorrentEarlyVideo({
  job,
  file,
  onBack,
  backLabel = "Back to files",
}: {
  job: Job;
  file: TorrentFile;
  onBack: () => void;
  backLabel?: string;
}) {
  const titleId = useId();
  const { active, attempt, state, message, retry, fail } = useTorrentVideo(job, file);
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    backRef.current?.focus();
  }, []);
  return (
    <section className="torrent-early-video" aria-labelledby={titleId}>
      <button ref={backRef} type="button" className="ghost-button" onClick={onBack}>
        {backLabel}
      </button>
      <h3 id={titleId}>{file.path}</h3>
      <p>
        Play while downloading. Only verified pieces are served; playback and seeking may wait for
        peers. Early playback supports fast-start MP4 with browser-compatible codecs.
      </p>
      {!active ? (
        <p role="status">{stoppedMessage(job)}</p>
      ) : state === "loading" ? (
        <p role="status">Checking video… Waiting for verified pieces or peers.</p>
      ) : state === "ready" ? (
        <StreamVideo
          key={attempt}
          src={`/api/session-jobs/${encodeURIComponent(job.id)}/video/stream?${new URLSearchParams({ fileId: file.id })}&attempt=${attempt}`}
          onError={fail}
        />
      ) : (
        <p role={state === "error" ? "alert" : "status"}>{message}</p>
      )}
      <div className="torrent-early-video-actions">
        {active && state === "error" ? (
          <button type="button" onClick={retry}>
            Retry playback
          </button>
        ) : null}
        <button type="button" className="primary-button" onClick={onBack}>
          Download first
        </button>
      </div>
      <p className="text-muted">
        Return to the file list to manage this download. Closing the player does not cancel it.
      </p>
    </section>
  );
}

export function TorrentFileArea({ job, selection }: { job: Job; selection: Selection }) {
  const file =
    job.torrentFiles.find(({ id }) => id === selection.playingFile?.id) ?? selection.playingFile;
  return (
    <>
      {file ? (
        <TorrentEarlyVideo
          key={`${file.id}:${canContinuePlayback(job, file)}`}
          job={job}
          file={file}
          onBack={selection.stopPlaying}
        />
      ) : null}
      <div className="torrent-file-browser" hidden={Boolean(selection.playingFile)}>
        <FileTools job={selection.displayJob} selection={selection} />
        <FileList job={selection.displayJob} selection={selection} />
      </div>
    </>
  );
}

function canContinuePlayback(job: Job, file: TorrentFile) {
  return (
    file.selected &&
    ((job.status === "downloading" && job.phase === "downloading") ||
      (file.complete &&
        (job.status === "ready" || (job.status === "downloading" && job.phase === "indexing"))))
  );
}

function useTorrentVideo(job: Job, file: TorrentFile) {
  const active = canContinuePlayback(job, file);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "download-first" | "error">("loading");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const query = new URLSearchParams({ fileId: file.id });
        const response = await fetch(
          `/api/session-jobs/${encodeURIComponent(job.id)}/video/info?${query}`,
          { signal: controller.signal },
        );
        const body: unknown = await response.json();
        if (!response.ok) {
          const detail =
            body &&
            typeof body === "object" &&
            (("message" in body && typeof body.message === "string") ||
              ("error" in body && typeof body.error === "string"))
              ? "error" in body
                ? String(body.error)
                : String(body.message)
              : "Could not prepare early playback. Try again.";
          throw new Error(detail);
        }
        const result = torrentVideoInfoSchema.safeParse(body);
        if (!result.success) throw new Error("Could not prepare early playback. Try again.");
        const info = result.data;
        if (!controller.signal.aborted) {
          setMessage(info.message);
          setState(info.state);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setMessage(
            error instanceof Error ? error.message : "Could not prepare early playback. Try again.",
          );
          setState("error");
        }
      }
    })();
    return () => controller.abort();
  }, [active, job.id, file.id, attempt]);
  return {
    active,
    attempt,
    state,
    message,
    retry: () => {
      setState("loading");
      setMessage("");
      setAttempt((value) => value + 1);
    },
    fail: () => {
      setMessage("Playback could not continue. Retry, or download first to use the full player.");
      setState("error");
    },
  };
}
