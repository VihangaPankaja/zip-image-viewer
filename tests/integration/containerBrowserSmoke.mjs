import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const origin = process.env.CONTAINER_ORIGIN ?? "http://127.0.0.1:8080";
const screenshot = path.resolve(
  process.env.CONTAINER_SCREENSHOT ?? "test-results/container-playback.png",
);
const { items: sessions } = await (
  await globalThis.fetch(`${origin}/api/sessions`)
).json();
assert.equal(sessions.length, 1, "Container fixture session is missing");
const sessionId = sessions[0].id;
const { firstFilePath } = await (
  await globalThis.fetch(`${origin}/api/sessions/${sessionId}/tree`)
).json();
assert.equal(firstFilePath, "direct/source.mp4");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const mediaResponses = new Set();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("response", (item) => {
    const match = item
      .url()
      .match(/\/video\/hls\/(master|playlist|init|segment)/);
    if (match && item.status() === 200) mediaResponses.add(match[1]);
  });
  await page.goto(origin);
  await page.getByRole("tab", { name: "Explore" }).click();
  await page.getByRole("button", { name: `Open ${firstFilePath}` }).click();
  const video = page.getByLabel("Video preview");
  await page.getByText("360p playback", { exact: true }).waitFor({
    timeout: 30_000,
  });
  await video.evaluate((element) => {
    element.muted = true;
    return element.play();
  });
  await page.waitForFunction(
    () => {
      const video = globalThis.document.querySelector(
        'video[aria-label="Video preview"]',
      );
      return video?.videoWidth > 0 && video.currentTime > 0.5;
    },
    null,
    { timeout: 90_000 },
  );
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 60,
    downloadThroughput: 1_000_000,
    uploadThroughput: 1_000_000,
  });
  for (const target of [7.1, 2.3, 9.4]) {
    const frames = await video.evaluate(
      (element) => element.getVideoPlaybackQuality().totalVideoFrames,
    );
    await video.evaluate((element, time) => {
      element.currentTime = time;
      return element.play();
    }, target);
    await page.waitForFunction(
      ({ time, frames }) => {
        const video = globalThis.document.querySelector(
          'video[aria-label="Video preview"]',
        );
        return (
          video?.readyState >= 2 &&
          !video.seeking &&
          video.currentTime > time &&
          video.currentTime < time + 2 &&
          video.getVideoPlaybackQuality().totalVideoFrames > frames
        );
      },
      { time: target, frames },
      { timeout: 45_000 },
    );
  }
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  assert.deepEqual(
    [...mediaResponses].sort(),
    ["init", "master", "playlist", "segment"],
    "Browser did not receive the complete HLS path from the container",
  );
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.deepEqual(browserErrors, []);
  await mkdir(path.dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot });
  process.stdout.write(`Container browser playback passed. ${screenshot}\n`);
} finally {
  await browser.close();
}
