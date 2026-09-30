import express from "express";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { expect, test } from "@playwright/test";
import type {
  Session,
  VideoTranscodeEntry,
} from "../../server/domain/models.js";
import { registerVideoPlaybackRoutes } from "../../server/handlers/video/playbackRoutes.js";
import {
  getVideoQualities,
  registerVideoMetadataRoutes,
} from "../../server/handlers/video/metadataRoutes.js";
import { registerVideoHlsRoutes } from "../../server/handlers/videoHlsRoutes.js";
import type { VideoRouteDependencies } from "../../server/handlers/video/types.js";
import { createVideoRuntime } from "../../server/infrastructure/media/videoRuntime.js";
import {
  parseRangeHeader,
  sanitizeEntryPath,
} from "../../server/infrastructure/runtime/runtimePrimitives.js";
import { runCommand } from "../../server/infrastructure/process/commandRunner.js";

test("plays real direct, remux and unsupported inputs and explicitly falls back to transcode", async ({
  page,
  browserName,
  baseURL,
}, testInfo) => {
  test.skip(browserName !== "chromium");
  test.setTimeout(120_000);
  if (!ffmpegPath || !baseURL)
    throw new Error("FFmpeg and app URL are required.");
  const directory = await mkdtemp(path.join(tmpdir(), "ziv-modes-e2e-"));
  const session = {
    id: "00000000-0000-4000-8000-000000000027",
    extractDir: directory,
    workspaceDir: directory,
  } as Session;
  const transcodes = new Map<string, VideoTranscodeEntry>();
  const runtime = createVideoRuntime({
    ffmpegPath,
    transcodes,
    logEvent: () => undefined,
  });
  const deps = {
    getVideoMetadata: runtime.getVideoMetadata,
    buildVideoQualityOptions: runtime.buildVideoQualityOptions,
    getSessionQualityOutputPath: runtime.getSessionQualityOutputPath,
    prepareVideoRemux: runtime.prepareVideoRemux,
    ensureVideoTranscodeEntry: runtime.ensureVideoTranscodeEntry,
    getRenditionState: runtime.getRenditionState,
    startRenditionTranscode: runtime.startRenditionTranscode,
    refreshRenditionAvailability: runtime.refreshRenditionAvailability,
    getVideoTranscodeKey: runtime.getVideoTranscodeKey,
    ffmpegPath,
    videoTranscodeStore: transcodes,
    touchSession: () => session,
    sanitizeEntryPath,
    parseRangeHeader,
    VIDEO_EXTENSIONS: new Set(["mp4", "mkv"]),
  } as unknown as VideoRouteDependencies;
  const app = express();
  const requests: string[] = [];
  app.use((req, _res, next) => {
    requests.push(req.originalUrl);
    next();
  });
  registerVideoPlaybackRoutes(app, deps);
  registerVideoMetadataRoutes(app, deps);
  registerVideoHlsRoutes(app, deps);
  app.use((req, res) => {
    const upstream = request(
      new URL(req.originalUrl, baseURL),
      {
        method: req.method,
        headers: { ...req.headers, host: new URL(baseURL).host },
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.status(502);
      res.end();
    });
    req.pipe(upstream);
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await runCommand(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=24:duration=8",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=8",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      path.join(directory, "direct.mp4"),
    ]);
    await runCommand(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      path.join(directory, "direct.mp4"),
      "-c",
      "copy",
      path.join(directory, "remux.mkv"),
    ]);
    await runCommand(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      path.join(directory, "direct.mp4"),
      "-c:v",
      "mpeg4",
      "-c:a",
      "copy",
      path.join(directory, "unsupported.mp4"),
    ]);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Media server did not bind.");
    const origin = `http://127.0.0.1:${address.port}`;
    let currentFile = "direct.mp4";
    await page.route("**/rpc/sessions/list", (route) =>
      route.fulfill({
        json: {
          json: {
            items: [
              {
                id: session.id,
                firstFilePath: currentFile,
                fileCount: 1,
                lastAccessedAt: Date.now(),
              },
            ],
          },
        },
      }),
    );
    await page.route(`**/api/sessions/${session.id}/tree`, (route) =>
      route.fulfill({
        json: {
          id: session.id,
          firstFilePath: currentFile,
          tree: {
            name: currentFile,
            path: currentFile,
            extension: path.extname(currentFile).slice(1),
            type: "file",
            size: 1,
          },
        },
      }),
    );
    await page.route("**/rpc/video/qualities", async (route) =>
      route.fulfill({
        json: {
          json: await getVideoQualities(
            { sessionId: session.id, path: currentFile },
            deps,
          ),
        },
      }),
    );
    for (const [file, mode] of [
      ["direct.mp4", "Direct play"],
      ["remux.mkv", "Remux"],
      ["unsupported.mp4", "Transcode"],
    ]) {
      currentFile = file;
      requests.length = 0;
      await page.goto(origin);
      await page.getByRole("tab", { name: "Explore" }).click();
      await page.getByRole("button", { name: `Open ${file}` }).click();
      await expect(
        page.getByText(`Mode: ${mode}`, { exact: true }),
      ).toBeVisible();
      const video = page.getByLabel("Video preview");
      await expect
        .poll(() =>
          video.evaluate((element: HTMLVideoElement) => element.readyState),
        )
        .toBeGreaterThanOrEqual(2);
      await video.evaluate((element: HTMLVideoElement) => {
        void element.play();
      });
      await expect
        .poll(() =>
          video.evaluate((element: HTMLVideoElement) => element.currentTime),
        )
        .toBeGreaterThan(0.25);
      await video.evaluate((element: HTMLVideoElement) => element.pause());
      await page.screenshot({
        path: testInfo.outputPath(`${file}-selected-mode.png`),
        animations: "disabled",
      });
      if (mode !== "Transcode") {
        expect(
          transcodes.has(runtime.getVideoTranscodeKey(session.id, file)),
        ).toBe(false);
        expect(requests.some((url) => url.includes("/hls/master"))).toBe(false);
        const before = await video.evaluate(
          (element: HTMLVideoElement) => element.currentTime,
        );
        await page.getByRole("button", { name: "Transcode instead" }).click();
        await expect(
          page.getByText("Mode: Transcode", { exact: true }),
        ).toBeVisible();
        await expect
          .poll(() =>
            transcodes.has(runtime.getVideoTranscodeKey(session.id, file)),
          )
          .toBe(true);
        await expect
          .poll(() =>
            video.evaluate((element: HTMLVideoElement) => element.readyState),
          )
          .toBeGreaterThanOrEqual(2);
        expect(
          await video.evaluate(
            (element: HTMLVideoElement) => element.currentTime,
          ),
        ).toBeCloseTo(before, 0);
        await video.evaluate((element: HTMLVideoElement) => {
          void element.play();
        });
        await expect
          .poll(() =>
            video.evaluate((element: HTMLVideoElement) => element.currentTime),
          )
          .toBeGreaterThan(before + 0.25);
        await video.evaluate((element: HTMLVideoElement) => element.pause());
      } else {
        expect(requests.some((url) => url.includes("/video/play"))).toBe(false);
      }
      expect(
        transcodes.has(runtime.getVideoTranscodeKey(session.id, file)),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`${file}-transcode.png`),
        animations: "disabled",
      });
    }
    await page.setViewportSize({ width: 360, height: 800 });
    await page.locator('label[for="workspace-pane-preview"]').click();
    await expect(
      page.getByText("Mode: Transcode", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await runtime.cleanupVideoSession(session);
    await rm(directory, { recursive: true, force: true });
  }
});
