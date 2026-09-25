import express from "express";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type {
  Session,
  VideoRendition,
  VideoTranscodeEntry,
} from "../domain/models.js";
import type { VideoRouteDependencies } from "./videoRoutes.js";
import { registerVideoHlsRoutes } from "./videoHlsRoutes.js";

describe("HLS routes", () => {
  it("serves only published segments and validates completed media caches", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "ziv-hls-route-"));
    const source = path.join(workspace, "source.mp4");
    const dir = path.join(workspace, "rendition");
    const playlistPath = path.join(dir, "index.m3u8");
    await mkdir(dir);
    await writeFile(source, "source");
    await writeFile(path.join(dir, "segment_000000.m4s"), "complete segment");
    const session = { id: "session", extractDir: workspace } as Session;
    const rendition = {
      dir,
      playlistPath,
      status: "done",
    } as VideoRendition;
    const entry = {
      width: 640,
      height: 360,
      qualities: [{ id: "360p", label: "360p", height: 360 }],
      defaultQuality: "360p",
    } as VideoTranscodeEntry;
    const deps = {
      ffmpegPath: "ffmpeg",
      touchSession: () => session,
      sanitizeEntryPath: (value: string) => value,
      ensureVideoTranscodeEntry: () => Promise.resolve(entry),
      getRenditionState: () => rendition,
      startRenditionTranscode: () => Promise.resolve(),
    } as unknown as VideoRouteDependencies;
    const app = express();
    registerVideoHlsRoutes(app, deps);
    const resource = "/api/sessions/session/video/hls";
    const query = "?path=source.mp4&quality=360p";

    try {
      const cold = await request(app)
        .get(`${resource}/master?path=source.mp4`)
        .expect(200);
      expect(cold.text).toContain(
        "#EXT-X-STREAM-INF:BANDWIDTH=1020800,RESOLUTION=640x360",
      );
      expect(cold.text).toContain(
        "/api/sessions/session/video/hls/playlist?path=source.mp4&quality=360p",
      );
      expect(cold.text).not.toContain("CODECS=");

      await writeFile(
        path.join(dir, "init.mp4"),
        Buffer.from("avcC\x01\x4d\x40\x1fmp4a", "latin1"),
      );
      const warm = await request(app)
        .get(`${resource}/master?path=source.mp4`)
        .expect(200);
      expect(warm.text).toContain('CODECS="avc1.4d401f,mp4a.40.2"');
      expect(warm.text).toContain("quality=360p");

      await request(app).get(`${resource}/segment${query}&index=0`).expect(425);
      await writeFile(
        playlistPath,
        '#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4.125,\nsegment_000000.m4s\n#EXT-X-ENDLIST\n',
      );
      const variant = await request(app)
        .get(`${resource}/playlist${query}`)
        .expect(200);
      expect(variant.headers["cache-control"]).toContain("no-store");
      expect(variant.text).toContain("#EXTINF:4.125,");
      expect(variant.text).toContain("index=0");

      const media = await request(app)
        .get(`${resource}/segment${query}&index=0`)
        .expect(200);
      expect(media.headers["cache-control"]).toContain("immutable");
      expect(media.headers.etag).toBeTruthy();
      await request(app)
        .get(`${resource}/segment${query}&index=0`)
        .set("If-None-Match", media.headers.etag)
        .expect(304);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
