import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";
import { chromium } from "@playwright/test";

const origin = process.env.CONTAINER_ORIGIN ?? "http://127.0.0.1:8080";
const screenshot = path.resolve(
  process.env.CONTAINER_SCREENSHOT ?? "test-results/container-playback.png",
);
const { items: sessions } = await (
  await globalThis.fetch(origin + "/api/sessions")
).json();
assert.equal(sessions.length, 1, "Container fixture session is missing");
const sessionId = sessions[0].id;
const { firstFilePath } = await (
  await globalThis.fetch(origin + "/api/sessions/" + sessionId + "/tree")
).json();
assert.equal(firstFilePath, "direct/long-gop.mp4");

async function readMedia(url) {
  const response = await globalThis.fetch(new URL(url, origin));
  assert.equal(response.status, 200, "Media request failed: " + url);
  return Buffer.from(await response.arrayBuffer());
}

function assertBoxes(bytes, required) {
  const names = [];
  for (let offset = 0; offset < bytes.length;) {
    assert.ok(offset + 8 <= bytes.length, "Truncated MP4 box header");
    const size = bytes.readUInt32BE(offset);
    assert.ok(size >= 8 && offset + size <= bytes.length, "Truncated MP4 box");
    names.push(bytes.toString("ascii", offset + 4, offset + 8));
    offset += size;
  }
  for (const name of required) {
    assert.ok(names.includes(name), "Missing MP4 box: " + name);
  }
}

function assertCodecs(master, init, hasAudio) {
  const match = master.match(/CODECS="([^"]+)"/);
  assert.ok(match, "Master playlist has no codec declaration");
  const box = init.indexOf("avcC");
  assert.ok(box >= 0 && box + 8 <= init.length, "Missing AVC codec data");
  const actual =
    "avc1." +
    init.subarray(box + 5, box + 8).toString("hex") +
    (hasAudio ? ",mp4a.40.2" : "");
  assert.equal(match[1], actual, "Master codec does not match init segment");
}

async function verifyMedia(file, hasAudio, negativeProbes = false) {
  const masterUrl = new URL(
    "/api/sessions/" +
      sessionId +
      "/video/hls/master?path=" +
      encodeURIComponent(file),
    origin,
  );
  const master = (await readMedia(masterUrl)).toString();
  const variant = master.match(/^#EXT-X-STREAM-INF:[^\n]*\n([^\n]+)/m)?.[1];
  assert.ok(variant, "Master playlist has no rendition");
  const playlist = (await readMedia(variant)).toString();
  const initUrl = playlist.match(/^#EXT-X-MAP:URI="([^"]+)"/m)?.[1];
  const segmentUrls = [
    ...playlist.matchAll(/^(.+\/video\/hls\/segment\?[^\n]+)$/gm),
  ].map((match) => match[1]);
  assert.ok(initUrl, "Variant playlist has no init segment");
  assert.ok(segmentUrls.length >= 1, "Variant playlist has no segments");
  const init = await readMedia(initUrl);
  assertBoxes(init, ["ftyp", "moov"]);
  assertCodecs(master, init, hasAudio);
  let firstSegment;
  for (const url of segmentUrls) {
    const bytes = await readMedia(url);
    assertBoxes(bytes, ["moof", "mdat"]);
    firstSegment ??= bytes;
  }
  if (negativeProbes) {
    assert.throws(
      () => assertBoxes(Buffer.alloc(0), ["ftyp", "moov"]),
      /Missing MP4 box/,
    );
    assert.throws(
      () =>
        assertBoxes(firstSegment.subarray(0, firstSegment.length - 1), [
          "moof",
          "mdat",
        ]),
      /Truncated MP4 box/,
    );
    assert.throws(
      () =>
        assertCodecs(
          master.replace(/CODECS="[^"]+"/, 'CODECS="avc1.000000"'),
          init,
          hasAudio,
        ),
      /codec does not match/,
    );
  }
}

async function prepare(file) {
  const base = "/api/sessions/" + sessionId + "/video/hls/";
  const query = "?path=" + encodeURIComponent(file);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const playlist = (
      await readMedia(base + "playlist" + query + "&quality=360p")
    ).toString();
    const master = (await readMedia(base + "master" + query)).toString();
    if (master.includes('CODECS="') && playlist.includes("#EXT-X-ENDLIST"))
      return;
    await delay(500);
  }
  assert.fail("Container did not prepare HLS for " + file);
}

for (const file of [
  "direct/long-gop.mp4",
  "direct/vfr-silent.mp4",
  "direct/unsupported-mpeg4.mp4",
])
  await prepare(file);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const browserErrors = [];
  const mediaResponses = new Set();
  let activeFile = "";
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("response", (response) => {
    const match = response
      .url()
      .match(/\/video\/hls\/(master|playlist|init|segment)/);
    if (
      match &&
      response.status() === 200 &&
      response.url().includes(encodeURIComponent(activeFile))
    )
      mediaResponses.add(match[1]);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");

  async function open(file) {
    activeFile = file;
    mediaResponses.clear();
    await page.goto(origin);
    await page.getByRole("tab", { name: "Explore" }).click();
    await page.getByRole("button", { name: "Open " + firstFilePath }).click();
    if (file !== firstFilePath) {
      const folder = page.getByRole("treeitem", {
        name: path.dirname(file),
        exact: true,
      });
      if ((await folder.getAttribute("aria-expanded")) === "false")
        await folder.click();
      await page
        .getByRole("treeitem", { name: path.basename(file), exact: true })
        .click();
    }
    for (
      let attempt = 0;
      attempt < 180 && !mediaResponses.has("segment");
      attempt += 1
    ) {
      await page.waitForTimeout(500);
    }
    assert.ok(
      mediaResponses.has("segment"),
      "Browser did not request HLS segment for " + file,
    );
    await page
      .getByText("360p playback", { exact: true })
      .waitFor({ timeout: 30_000 });
    const video = page.getByLabel("Video preview");
    await page.waitForFunction(
      () => {
        const video = globalThis.document.querySelector(
          'video[aria-label="Video preview"]',
        );
        return video?.currentSrc.startsWith("blob:") && video.readyState >= 2;
      },
      null,
      { timeout: 90_000 },
    );
    await video.evaluate((element) => {
      element.muted = true;
      return element.play();
    });
    await page.waitForFunction(
      () => {
        const video = globalThis.document.querySelector(
          'video[aria-label="Video preview"]',
        );
        return (
          video?.videoWidth > 0 &&
          video.currentTime > 0.5 &&
          video.getVideoPlaybackQuality().totalVideoFrames > 0
        );
      },
      null,
      { timeout: 90_000 },
    );
    return video;
  }

  async function seek(video, target) {
    process.stdout.write("Seeking to " + target + "s\n");
    const frames = await video.evaluate(
      (element) => element.getVideoPlaybackQuality().totalVideoFrames,
    );
    await video.evaluate((element, time) => {
      element.currentTime = time;
      void element.play().catch(() => {});
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
    process.stdout.write("Seek passed\n");
  }

  let seed = 42;
  for (const profile of [
    { latency: 40, throughput: 1_250_000 },
    { latency: 180, throughput: 250_000 },
  ]) {
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: profile.latency,
      downloadThroughput: profile.throughput,
      uploadThroughput: profile.throughput,
    });
    const video = await open("direct/long-gop.mp4");
    for (let index = 0; index < 4; index += 1) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      const target = (index % 2 === 0 ? 7 : 1) + (seed % 50) / 10;
      await seek(video, target);
    }
    assert.equal(await page.getByRole("alert").count(), 0);
    assert.deepEqual(
      [...mediaResponses].sort(),
      ["init", "master", "playlist", "segment"],
      "Browser did not decode complete HLS for this fixture",
    );
  }
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  for (const file of [
    "direct/vfr-silent.mp4",
    "direct/unsupported-mpeg4.mp4",
  ]) {
    const video = await open(file);
    await seek(video, 2.1);
    assert.equal(await page.getByRole("alert").count(), 0);
    assert.deepEqual(
      [...mediaResponses].sort(),
      ["init", "master", "playlist", "segment"],
      "Browser did not decode complete HLS for this fixture",
    );
  }
  await verifyMedia("direct/long-gop.mp4", true, true);
  await verifyMedia("direct/vfr-silent.mp4", false);
  await verifyMedia("direct/unsupported-mpeg4.mp4", false);
  assert.deepEqual(browserErrors, []);
  await mkdir(path.dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot });
  process.stdout.write(
    "Container browser playback passed. " + screenshot + "\n",
  );
} finally {
  await browser.close();
}
