import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { jobSchema, type Job } from "../../shared/contracts";
import type { Page } from "@playwright/test";

const sessionId = "00000000-0000-4000-8000-000000000008";
const timestamp = Date.UTC(2026, 0, 15, 12);
export const filenames = [
  "01-coast.png",
  "02-notes.txt",
  "03-film.mp4",
  "04-audio.wav",
  "05-archive.zip",
];
const mediaDirectory = path.join(tmpdir(), `ziv-review-media-${process.pid}`);
process.on("exit", () =>
  rmSync(mediaDirectory, { recursive: true, force: true }),
);

export async function prepareMedia() {
  await mkdir(mediaDirectory, { recursive: true });
  const ffmpeg = createRequire(import.meta.url)("ffmpeg-static") as string;
  for (const [name, source, options] of [
    [
      "sample.mp4",
      "testsrc2=size=960x540:rate=24",
      ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart"],
    ],
    ["sample.wav", "sine=frequency=440:sample_rate=44100", []],
  ] as const) {
    execFileSync(
      ffmpeg,
      [
        "-y",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        source,
        "-t",
        "8",
        ...options,
        path.join(mediaDirectory, name),
      ],
      { timeout: 30_000 },
    );
  }
  for (const time of [0, 5]) {
    execFileSync(
      ffmpeg,
      [
        "-y",
        "-loglevel",
        "error",
        "-ss",
        String(time),
        "-i",
        path.join(mediaDirectory, "sample.mp4"),
        "-frames:v",
        "1",
        "-vf",
        "scale=320:-1",
        path.join(mediaDirectory, `thumbnail-${time}.jpg`),
      ],
      { timeout: 30_000 },
    );
  }
  await sharp({
    create: { width: 1600, height: 900, channels: 3, background: "#000000" },
  })
    .composite([
      {
        input: await readFile(path.join(mediaDirectory, "thumbnail-0.jpg")),
        left: 0,
        top: 0,
      },
      {
        input: await readFile(path.join(mediaDirectory, "thumbnail-5.jpg")),
        left: 320,
        top: 0,
      },
    ])
    .jpeg()
    .toFile(path.join(mediaDirectory, "storyboard-0.jpg"));
  await sharp(
    Buffer.from(
      `<svg width="1200" height="800" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="800" fill="#e8dfc8"/><path d="M0 310 Q340 80 580 330 T1200 280 V800 H0Z" fill="#286c76"/><path d="M0 450 Q370 210 650 450 T1200 390 V800 H0Z" fill="#163e50"/><circle cx="920" cy="155" r="65" fill="#d89b4e"/><text x="64" y="90" font-family="sans-serif" font-size="24" letter-spacing="6" fill="#19313e">COASTAL STUDY / 01</text><text x="64" y="730" font-family="sans-serif" font-size="18" fill="#e8dfc8">Local review fixture · 1200 × 800</text></svg>`,
    ),
  )
    .png()
    .toFile(path.join(mediaDirectory, "sample.png"));
  return mediaDirectory;
}

export function reviewJobs() {
  const common = {
    torrentFiles: [],
    sourcePreference: "auto",
    phase: "download",
    retryCount: 0,
    maxRetries: 3,
    threadMode: "auto",
    threadCount: 3,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return [
    {
      ...common,
      id: "http-review",
      url: "https://downloads.example.com/coastal-photography-collection.zip",
      sourceKind: "http",
      status: "running",
      percent: 62,
      queuePosition: 0,
      canPause: true,
      downloadedBytes: 62000000,
      reportedSize: 100000000,
      downloadSpeedBytesPerSec: 2500000,
      etaSeconds: 15,
      message: "Downloading collection",
    },
    {
      ...common,
      id: "torrent-review",
      url: "magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678&dn=Open%20film%20collection",
      sourceKind: "torrent",
      status: "running",
      percent: 38,
      queuePosition: 1,
      canPause: true,
      downloadedBytes: 380000000,
      reportedSize: 1000000000,
      downloadSpeedBytesPerSec: 6200000,
      etaSeconds: 100,
      peerCount: 12,
      uploadedBytes: 16000000,
      uploadSpeedBytesPerSec: 340000,
      message: "Receiving pieces from 12 peers",
    },
    {
      ...common,
      id: "paused-review",
      url: "https://downloads.example.com/field-recordings.zip",
      sourceKind: "http",
      status: "paused",
      percent: 24,
      queuePosition: 2,
      downloadedBytes: 24000000,
      reportedSize: 100000000,
      message: "Paused. Resume when ready.",
    },
    {
      ...common,
      id: "error-review",
      url: "https://downloads.example.com/a-very-long-archive-title-that-demonstrates-content-overflow-and-safe-action-placement.zip",
      sourceKind: "http",
      status: "error",
      percent: 0,
      queuePosition: 3,
      message: "The server stopped responding. Retry to continue.",
    },
  ];
}

export function reviewTorrentJob(): Job {
  return jobSchema.parse({
    ...reviewJobs()[1],
    id: "00000000-0000-4000-8000-000000000009",
    status: "awaiting_selection",
    phase: "selecting",
    percent: 0,
    downloadedBytes: 0,
    downloadSpeedBytesPerSec: 0,
    canPause: false,
    message: "Torrent metadata ready. Review files before downloading.",
    reportedSize: 14416200,
    etaSeconds: null,
    peerCount: 0,
    uploadedBytes: 0,
    uploadSpeedBytesPerSec: 0,
    torrentFiles: [
      {
        id: "0",
        path: "Coastal collection/03-film.mp4",
        size: 2400000,
        selected: false,
        downloadedBytes: 0,
        complete: false,
      },
      {
        id: "1",
        path: "Coastal collection/subtitles/English.srt",
        size: 4200,
        selected: false,
        downloadedBytes: 0,
        complete: false,
      },
      {
        id: "2",
        path: "Coastal collection/notes/a-long-field-recording-and-location-notes-filename-for-responsive-review.txt",
        size: 12000,
        selected: false,
        downloadedBytes: 0,
        complete: false,
      },
      {
        id: "3",
        path: "Extras/Behind the scenes.mp4",
        size: 12000000,
        selected: false,
        downloadedBytes: 0,
        complete: false,
      },
    ],
  });
}

export function reviewActiveTorrentJob(): Job {
  const job = reviewTorrentJob();
  return {
    ...job,
    status: "downloading",
    phase: "downloading",
    percent: 60,
    canPause: true,
    message: "Downloading selected files. Transfer progress is simulated.",
    torrentFiles: job.torrentFiles.map((file, index) => ({
      ...file,
      selected: index !== 3,
      complete: index === 0,
      downloadedBytes:
        index === 0 ? file.size : index === 3 ? 0 : Math.floor(file.size / 2),
    })),
  };
}

export const reviewSubtitles = {
  name: "Coastal field notes.srt",
  mimeType: "application/x-subrip",
  buffer: Buffer.from(
    "1\n00:00:01,000 --> 00:00:03,000\nMorning light along the coast\n\n2\n00:00:04,000 --> 00:00:07,000\nWaves meet the shore\n",
  ),
};

export async function installReviewFixtures(page: Page) {
  const state = {
    jobs: [] as (ReturnType<typeof reviewJobs>[number] | Job)[],
    selectedFileIds: [] as string[],
  };
  await page.clock.setFixedTime(new Date(timestamp));
  await page.route("**/rpc/**", (route) => {
    const endpoint = new URL(route.request().url()).pathname;
    if (endpoint.endsWith("video/qualities"))
      return route.fulfill({
        json: {
          json: {
            path: filenames[2],
            source: { width: 960, height: 540, durationSeconds: 8 },
            options: [{ id: "source", label: "Original", height: 540 }],
            defaultQuality: "source",
          },
        },
      });
    if (endpoint.endsWith("jobs/enqueue")) {
      state.jobs = [reviewTorrentJob()];
      return route.fulfill({ json: { json: { items: state.jobs } } });
    }
    if (endpoint.endsWith("jobs/selectFiles")) {
      const payload = route.request().postDataJSON() as {
        json: { fileIds: string[] };
      };
      state.selectedFileIds = payload.json.fileIds;
      const job = reviewTorrentJob();
      const files = job.torrentFiles.map((file) => ({
        ...file,
        selected: state.selectedFileIds.includes(file.id),
      }));
      const selectedSize = files
        .filter(({ selected }) => selected)
        .reduce((sum, file) => sum + file.size, 0);
      const started: Job = {
        ...job,
        status: "downloading",
        phase: "downloading",
        percent: 35,
        torrentFiles: files,
        reportedSize: selectedSize,
        downloadedBytes: Math.floor(selectedSize * 0.35),
        canPause: true,
        downloadSpeedBytesPerSec: 180000,
        message: "Downloading selected files. Transfer progress is simulated.",
      };
      state.jobs = [started];
      return route.fulfill({ json: { json: started } });
    }
    const json = endpoint.endsWith("jobs/list")
      ? { items: state.jobs }
      : endpoint.endsWith("sessions/list")
        ? {
            items: [
              {
                id: sessionId,
                firstFilePath: "Coastal collection",
                fileCount: 5,
                lastAccessedAt: timestamp,
              },
            ],
          }
        : { maxConcurrent: 2 };
    return route.fulfill({ json: { json } });
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/tree"))
      return route.fulfill({
        json: {
          id: sessionId,
          firstFilePath: filenames[0],
          tree: {
            name: "Coastal collection",
            path: ".",
            type: "directory",
            children: filenames.map((name) => ({
              name,
              path: name,
              parentPath: ".",
              type: "file",
              extension: name.split(".").at(-1),
              size: 2400000,
              modifiedAt: timestamp,
            })),
          },
        },
      });
    if (url.pathname.endsWith("/video/storyboard"))
      return route.fulfill({
        json: {
          intervalSeconds: 5,
          width: 320,
          height: 180,
          columns: 5,
          rows: 5,
          frames: [
            { time: 0, sheet: 0, x: 0, y: 0 },
            { time: 5, sheet: 0, x: 320, y: 0 },
          ],
        },
      });
    if (url.pathname.endsWith("/video/storyboard/sheet"))
      return route.fulfill({
        body: await readFile(path.join(mediaDirectory, "storyboard-0.jpg")),
        contentType: "image/jpeg",
      });
    if (url.pathname.endsWith("/video/thumbnail")) {
      const time = Number(url.searchParams.get("time"));
      if (time !== 0 && time !== 5)
        return route.fulfill({
          status: 416,
          body: "Thumbnail outside fixture duration",
        });
      return route.fulfill({
        body: await readFile(
          path.join(mediaDirectory, `thumbnail-${time}.jpg`),
        ),
        contentType: "image/jpeg",
      });
    }
    if (
      url.pathname.endsWith("/file") ||
      url.pathname.endsWith("/video/play")
    ) {
      const name = url.searchParams.get("path") ?? "";
      if (name.endsWith(".txt"))
        return route.fulfill({
          contentType: "text/plain",
          body: "COASTAL COLLECTION\n\nField notes · January 2026\n\n01  Morning light along the coast\n02  Text notes and project details\n03  Original video sample\n04  Audio field recording\n\nUse the file tree to browse this collection.\nAll media in this review is generated locally.\n",
        });
      const [file, contentType] = name.endsWith(".png")
        ? ["sample.png", "image/png"]
        : name.endsWith(".wav")
          ? ["sample.wav", "audio/wav"]
          : ["sample.mp4", "video/mp4"];
      const body = await readFile(path.join(mediaDirectory, file));
      const headers = route.request().headers();
      const range =
        "range" in headers ? headers.range.match(/^bytes=(\d+)-(\d*)$/) : null;
      if (range) {
        const start = Number(range[1]);
        const end = range[2]
          ? Math.min(Number(range[2]), body.length - 1)
          : body.length - 1;
        return route.fulfill({
          status: 206,
          headers: {
            "accept-ranges": "bytes",
            "content-length": String(end - start + 1),
            "content-range": `bytes ${start}-${end}/${body.length}`,
          },
          body: body.subarray(start, end + 1),
          contentType,
        });
      }
      return route.fulfill({
        body,
        contentType,
        headers: {
          "accept-ranges": "bytes",
          "content-length": String(body.length),
        },
      });
    }
    return route.fulfill({ json: { renditions: [] } });
  });
  return state;
}
