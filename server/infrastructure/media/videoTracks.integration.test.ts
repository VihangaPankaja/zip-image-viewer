import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { expect, it } from "vite-plus/test";
import { startMultilingualFixture } from "../../../tests/fixtures/multilingual.js";
import { runCommand, runCommandCapture } from "../process/commandRunner.js";

it("probes real multilingual streams, converts subtitles and encodes distinct synchronized audio renditions", async () => {
  if (!ffmpegPath) throw new Error("FFmpeg is required for track integration.");
  const fixture = await startMultilingualFixture("http://127.0.0.1:1");
  try {
    const metadata = await fixture.runtime.getVideoMetadata(
      path.join(fixture.directory, "multilingual.mkv"),
      fixture.session,
    );
    expect(metadata.audioTracks).toMatchObject([
      { id: "audio-1", language: "eng", label: "English", isDefault: true },
      { id: "audio-2", language: "spa", label: "Spanish", isDefault: false },
    ]);
    expect(metadata.subtitleTracks).toMatchObject([
      { id: "subtitle-3", language: "eng" },
      { id: "subtitle-4", language: "spa" },
    ]);
    const resource = `${fixture.origin}/api/sessions/${fixture.session.id}/video`;
    const master = await fetch(
      `${resource}/hls/master?path=multilingual.mkv`,
    ).then((response) => response.text());
    expect(master).toContain('AUDIO="audio"');
    for (const [id, text] of [
      ["subtitle-3", "English coastal captions"],
      ["subtitle-4", "Subtítulos de la costa"],
    ]) {
      const response = await fetch(
        `${resource}/subtitles?path=multilingual.mkv&track=${id}`,
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(text);
    }
    const entry = await fixture.runtime.ensureVideoTranscodeEntry(
      fixture.session,
      "multilingual.mkv",
      path.join(fixture.directory, "multilingual.mkv"),
    );
    const renditions = ["360p", "audio-1", "audio-2"].map((id) =>
      fixture.runtime.getRenditionState(entry, fixture.session, id),
    );
    for (const rendition of renditions)
      await fixture.runtime.startRenditionTranscode(
        entry,
        fixture.session,
        rendition,
      );
    await expect
      .poll(() => renditions.map(({ status }) => status), { timeout: 30_000 })
      .toEqual(["done", "done", "done"]);
    const hashes: string[] = [];
    const timestamps: number[] = [];
    for (const rendition of renditions) {
      const audio = rendition.qualityId.startsWith("audio-");
      const init = await readFile(path.join(rendition.dir, "init.mp4"));
      expect(init.includes("avcC")).toBe(!audio);
      expect(init.includes("mp4a")).toBe(audio);
      // Read a later complete fragment to verify switching uses the common media timeline.
      const sample = path.join(fixture.directory, `${rendition.qualityId}.mp4`);
      await writeFile(
        sample,
        Buffer.concat([
          init,
          await readFile(path.join(rendition.dir, "segment_000002.m4s")),
        ]),
      );
      const { stderr } = await runCommandCapture(ffmpegPath, [
        "-hide_banner",
        "-copyts",
        "-i",
        sample,
        audio ? "-af" : "-vf",
        audio ? "ashowinfo" : "showinfo",
        audio ? "-frames:a" : "-frames:v",
        "1",
        "-f",
        "null",
        "-",
      ]);
      const timestamp = Number(/pts_time:([\d.]+)/.exec(stderr)?.[1]);
      expect(timestamp).toBeGreaterThanOrEqual(7.9);
      expect(timestamp).toBeLessThan(8.1);
      timestamps.push(timestamp);
      if (audio) {
        const pcm = path.join(fixture.directory, `${rendition.qualityId}.pcm`);
        await runCommand(ffmpegPath, [
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          sample,
          "-t",
          "1",
          "-f",
          "s16le",
          pcm,
        ]);
        const decoded = await readFile(pcm);
        expect(decoded.length).toBeGreaterThan(10_000);
        hashes.push(createHash("sha256").update(decoded).digest("hex"));
      }
    }
    expect(new Set(hashes).size).toBe(2);
    expect(Math.max(...timestamps) - Math.min(...timestamps)).toBeLessThan(0.1);
  } finally {
    await fixture.close();
  }
}, 60_000);

it("publishes both audio languages before a long video finishes and drains the shared job on cleanup", async () => {
  const fixture = await startMultilingualFixture("http://127.0.0.1:1", 0, 120);
  try {
    const entry = await fixture.runtime.ensureVideoTranscodeEntry(
      fixture.session,
      "multilingual.mkv",
      path.join(fixture.directory, "multilingual.mkv"),
    );
    const video = fixture.runtime.getRenditionState(
      entry,
      fixture.session,
      "360p",
    );
    const audio = ["audio-1", "audio-2"].map((id) =>
      fixture.runtime.getRenditionState(entry, fixture.session, id),
    );
    await fixture.runtime.startRenditionTranscode(
      entry,
      fixture.session,
      video,
    );
    for (const rendition of audio)
      await fixture.runtime.startRenditionTranscode(
        entry,
        fixture.session,
        rendition,
      );
    await expect
      .poll(
        async () =>
          Promise.all(
            audio.map(
              async (rendition) =>
                (await fixture.runtime.refreshRenditionAvailability(
                  rendition,
                )) > 0,
            ),
          ),
        { timeout: 20_000, interval: 100 },
      )
      .toEqual([true, true]);
    expect(video.status).toBe("running");
    await fixture.runtime.cleanupVideoSession(fixture.session);
    await expect
      .poll(() => [video, ...audio].map(({ status }) => status))
      .toEqual(["error", "error", "error"]);
  } finally {
    await fixture.close();
  }
}, 60_000);
