import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { expect, test } from "@playwright/test";

const sessionId = "00000000-0000-4000-8000-000000000007";
const filePath = "quality-fixture.mp4";

async function encode(directory: string, height: number) {
  const executable = ffmpegPath;
  if (!executable) throw new Error("ffmpeg-static is unavailable.");
  await mkdir(directory);
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1280x720:rate=24:duration=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=30",
    "-vf",
    `scale=-2:${String(height)}`,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "48",
    "-sc_threshold",
    "0",
    "-c:a",
    "aac",
    "-shortest",
    "-f",
    "hls",
    "-hls_time",
    "2",
    "-hls_playlist_type",
    "vod",
    "-hls_segment_type",
    "fmp4",
    "-hls_fmp4_init_filename",
    "init.mp4",
    "-hls_segment_filename",
    path.join(directory, "segment_%06d.m4s"),
    path.join(directory, "index.m3u8"),
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: directory,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(stderr)),
    );
  });
}

test("switches HLS quality and resumes real playback after reopening", async ({
  page,
  browserName,
  context,
}, testInfo) => {
  test.skip(browserName !== "chromium");
  test.setTimeout(120_000);
  const root = await mkdtemp(path.join(tmpdir(), "ziv-quality-e2e-"));
  try {
    await Promise.all(
      [360, 720].map((height) =>
        encode(path.join(root, `${String(height)}p`), height),
      ),
    );
    await page.route("**/rpc/sessions/list", (route) =>
      route.fulfill({
        json: {
          json: {
            items: [
              {
                id: sessionId,
                firstFilePath: filePath,
                fileCount: 1,
                lastAccessedAt: Date.now(),
              },
            ],
          },
        },
      }),
    );
    await page.route(`**/api/sessions/${sessionId}/tree`, (route) =>
      route.fulfill({
        json: {
          id: sessionId,
          firstFilePath: filePath,
          tree: {
            name: filePath,
            path: filePath,
            extension: "mp4",
            type: "file",
            size: 1,
          },
        },
      }),
    );
    await page.route(
      `**/api/sessions/${sessionId}/video/qualities?*`,
      (route) =>
        route.fulfill({
          json: {
            defaultQuality: "auto",
            options: [
              { id: "source", label: "Original" },
              { id: "auto", label: "Auto" },
              { id: "360p", label: "360p" },
              { id: "720p", label: "720p" },
            ],
          },
        }),
    );
    await page.route(
      `**/api/sessions/${sessionId}/video/hls/**`,
      async (route) => {
        const url = new URL(route.request().url());
        const resource = url.pathname.split("/").at(-1);
        if (resource === "master") {
          await route.fulfill({
            contentType: "application/vnd.apple.mpegurl",
            body:
              "#EXTM3U\n#EXT-X-VERSION:7\n" +
              [360, 720]
                .map(
                  (height) =>
                    `#EXT-X-STREAM-INF:BANDWIDTH=${height === 360 ? 900000 : 2500000},RESOLUTION=${height === 360 ? 640 : 1280}x${String(height)},CODECS="avc1.42c01f,mp4a.40.2"\n/api/sessions/${sessionId}/video/hls/playlist?quality=${String(height)}p\n`,
                )
                .join(""),
          });
          return;
        }
        if (resource === "status") {
          await route.fulfill({
            json: {
              status: "ready",
              renditions: [360, 720].map((height) => ({
                quality: `${String(height)}p`,
                status: "ready",
                availableSegments: 15,
                expectedSegments: 15,
                encoderWaitMs: 120,
              })),
            },
          });
          return;
        }
        const quality = url.searchParams.get("quality");
        if (quality !== "360p" && quality !== "720p")
          throw new Error(`Unexpected quality: ${quality}`);
        const directory = path.join(root, quality);
        if (resource === "playlist") {
          const source = await readFile(
            path.join(directory, "index.m3u8"),
            "utf8",
          );
          const body = source
            .replace(
              /#EXT-X-MAP:URI="[^"]+"/,
              `#EXT-X-MAP:URI="/api/sessions/${sessionId}/video/hls/init?quality=${quality}"`,
            )
            .replace(
              /segment_(\d+)\.m4s/g,
              (_match, index: string) =>
                `/api/sessions/${sessionId}/video/hls/segment?quality=${quality}&index=${index}`,
            );
          await route.fulfill({
            contentType: "application/vnd.apple.mpegurl",
            body,
          });
        } else if (resource === "init") {
          await route.fulfill({
            path: path.join(directory, "init.mp4"),
            contentType: "video/mp4",
          });
        } else if (resource === "segment") {
          const index = url.searchParams.get("index") ?? "";
          await route.fulfill({
            path: path.join(directory, `segment_${index.padStart(6, "0")}.m4s`),
            contentType: "video/iso.segment",
          });
        }
      },
    );

    let masterRequests = 0;
    page.on("request", (request) => {
      if (request.url().includes(`/api/sessions/${sessionId}/video/hls/master`))
        masterRequests++;
    });
    await page.goto("/");
    await page.getByRole("tab", { name: "Explore" }).click();
    await page.getByRole("button", { name: `Open ${filePath}` }).click();
    const video = page.getByLabel("Video preview");
    await expect(page.getByText(/Auto · (360|720)p playback/)).toBeVisible({
      timeout: 20_000,
    });
    await video.evaluate(async (element: HTMLVideoElement) => {
      await element.play();
    });
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeGreaterThan(0.5);
    await video.evaluate((element: HTMLVideoElement) => element.pause());
    const before = await video.evaluate(
      (element: HTMLVideoElement) => element.currentTime,
    );
    await page.getByRole("button", { name: "Quality", exact: true }).click();
    await page.getByRole("option", { name: "720p" }).click();
    await page.getByRole("button", { name: "Quality", exact: true }).click();
    await page.getByRole("option", { name: "Auto" }).click();
    await expect(page.getByText(/Auto · (360|720)p playback/)).toBeVisible({
      timeout: 20_000,
    });
    const after = await video.evaluate((element: HTMLVideoElement) => ({
      time: element.currentTime,
      paused: element.paused,
    }));
    expect(after.paused).toBe(true);
    expect(Math.abs(after.time - before)).toBeLessThan(0.5);
    expect(masterRequests).toBe(1);

    await page.getByText("Playback diagnostics").click();
    const diagnostics = page.locator(".playback-diagnostics");
    await expect(diagnostics).toBeVisible();
    await expect(diagnostics).toContainText("HLS.js");
    await expect(diagnostics).toContainText(/(360|720)p/);
    await expect(diagnostics).toContainText("Buffer");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Copy diagnostic report" }).click();
    await expect(page.getByRole("status")).toHaveText("Report copied");
    const report = await page.evaluate(() => navigator.clipboard.readText());
    expect(JSON.parse(report)).toMatchObject({ mode: "HLS.js" });
    expect(report).not.toContain(filePath);
    expect(report).not.toContain(sessionId);
    expect(report).not.toContain("http");
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath("player-desktop.png"),
    });

    const resumeKey = `video-resume:${JSON.stringify([sessionId, filePath])}`;
    await video.evaluate(async (element: HTMLVideoElement) => {
      element.currentTime = 12;
      await element.play();
    });
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeGreaterThan(12.1);
    await video.evaluate((element: HTMLVideoElement) => element.pause());
    let savedTime = await video.evaluate(
      (element: HTMLVideoElement) => element.currentTime,
    );
    await expect
      .poll(() =>
        page.evaluate((key) => Number(localStorage.getItem(key)), resumeKey),
      )
      .toBeCloseTo(savedTime, 1);

    const continuePlayback = async () => {
      await page.getByRole("button", { name: /^Continue from / }).click();
      await expect
        .poll(() =>
          video.evaluate(
            (element: HTMLVideoElement, position) =>
              !element.paused &&
              element.readyState >= 2 &&
              Math.abs(element.currentTime - position) < 1,
            savedTime,
          ),
        )
        .toBe(true);
      await video.evaluate((element: HTMLVideoElement) => element.pause());
      savedTime = await video.evaluate(
        (element: HTMLVideoElement) => element.currentTime,
      );
    };
    await page.getByRole("tab", { name: "Downloads" }).click();
    await expect(video).toHaveCount(0);
    await page.getByRole("tab", { name: "Explore" }).click();
    await continuePlayback();

    const reopen = async () => {
      await page.reload();
      await page.getByRole("tab", { name: "Explore" }).click();
      await page.getByRole("button", { name: `Open ${filePath}` }).click();
    };
    await reopen();
    await continuePlayback();
    await reopen();
    await page.getByRole("button", { name: "Start over", exact: true }).click();
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), resumeKey))
      .toBeNull();
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeLessThan(1);
    await reopen();
    await expect(
      page.getByRole("button", { name: /^Continue from / }),
    ).toHaveCount(0);

    await page.setViewportSize({ width: 360, height: 800 });
    await page.locator('label[for="workspace-pane-preview"]').click();
    await expect(page.getByLabel("Video preview")).toBeVisible();
    await expect(page.getByText("Playback diagnostics")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: testInfo.outputPath("player-mobile.png"),
    });
    await page.getByText("Playback diagnostics").scrollIntoViewIfNeeded();
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath("player-mobile-diagnostics.png"),
    });
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await rm(root, { recursive: true, force: true });
  }
});
