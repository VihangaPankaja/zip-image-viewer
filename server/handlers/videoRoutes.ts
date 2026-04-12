// @ts-nocheck
import { createReadStream } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";
import mime from "mime-types";

export function registerVideoRoutes(app, deps) {
  app.get("/api/sessions/:id/video/play", async (req, res) => {
    const session = deps.touchSession(req.params.id);
    if (!session) {
      return res
        .status(404)
        .json({ error: "Session not found or already cleaned up." });
    }

    const requestedPath = String(req.query.path || "");
    const quality = String(
      req.query.quality || session.selectedVideoQuality || "720p",
    ).toLowerCase();
    if (!requestedPath || requestedPath === ".") {
      return res.status(400).json({ error: "File path is required." });
    }

    let normalizedPath;
    try {
      normalizedPath = deps.sanitizeEntryPath(requestedPath);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const rawPath = path.resolve(path.join(session.extractDir, normalizedPath));
    const rootPath = path.resolve(session.extractDir);
    if (!rawPath.startsWith(`${rootPath}${path.sep}`) && rawPath !== rootPath) {
      return res.status(400).json({ error: "Invalid file path." });
    }

    const rawStats = await stat(rawPath).catch(() => null);
    if (!rawStats || !rawStats.isFile()) {
      return res.status(404).json({ error: "File not found." });
    }

    let targetPath = rawPath;
    let targetStats = rawStats;
    let sourceMode = "raw";
    if (quality !== "source") {
      const qualityPath = deps.getSessionQualityOutputPath(
        session,
        normalizedPath,
        quality,
      );
      const qualityStats = await stat(qualityPath).catch(() => null);
      if (qualityStats?.isFile()) {
        targetPath = qualityPath;
        targetStats = qualityStats;
        sourceMode = quality;
      }
    }

    res.setHeader("cache-control", "no-store");
    res.setHeader("accept-ranges", "bytes");
    res.setHeader("x-video-source", sourceMode);
    res.type(mime.lookup(targetPath) || "video/mp4");

    const range = deps.parseRangeHeader(req.headers.range, targetStats.size);
    if (range === "invalid") {
      res.setHeader("content-range", `bytes */${targetStats.size}`);
      return res.status(416).end();
    }

    if (range) {
      const contentLength = range.end - range.start + 1;
      res.status(206);
      res.setHeader(
        "content-range",
        `bytes ${range.start}-${range.end}/${targetStats.size}`,
      );
      res.setHeader("content-length", String(contentLength));
      return createReadStream(targetPath, {
        start: range.start,
        end: range.end,
      }).pipe(res);
    }

    res.setHeader("content-length", String(targetStats.size));
    return createReadStream(targetPath).pipe(res);
  });

  app.get("/api/sessions/:id/video/transcode-status", (req, res) => {
    const session = deps.touchSession(req.params.id);
    if (!session) {
      return res
        .status(404)
        .json({ error: "Session not found or already cleaned up." });
    }

    return res.json({
      quality: session.selectedVideoQuality || "720p",
      ...(session.transcodeStatus || {
        done: true,
        completed: 0,
        total: 0,
      }),
    });
  });

  app.get("/api/sessions/:id/video/qualities", async (req, res) => {
    const session = deps.touchSession(req.params.id);
    if (!session) {
      return res
        .status(404)
        .json({ error: "Session not found or already cleaned up." });
    }

    const requestedPath = String(req.query.path || "");
    if (!requestedPath || requestedPath === ".") {
      return res.status(400).json({ error: "File path is required." });
    }

    let normalizedPath;
    try {
      normalizedPath = deps.sanitizeEntryPath(requestedPath);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const targetPath = path.resolve(
      path.join(session.extractDir, normalizedPath),
    );
    const rootPath = path.resolve(session.extractDir);
    if (
      !targetPath.startsWith(`${rootPath}${path.sep}`) &&
      targetPath !== rootPath
    ) {
      return res.status(400).json({ error: "Invalid file path." });
    }

    const fileStats = await stat(targetPath).catch(() => null);
    if (!fileStats || !fileStats.isFile()) {
      return res.status(404).json({ error: "File not found." });
    }

    const contentType = mime.lookup(targetPath) || "application/octet-stream";
    const extension = path.extname(targetPath).slice(1).toLowerCase();
    if (
      !String(contentType).startsWith("video/") &&
      !deps.VIDEO_EXTENSIONS.has(extension)
    ) {
      return res.status(400).json({ error: "Selected file is not a video." });
    }

    const source = await deps.getVideoMetadata(targetPath);
    const qualityConfig = deps.buildVideoQualityOptions(source.height);
    const options = qualityConfig.options;
    const preferredQuality =
      session.selectedVideoQuality || qualityConfig.defaultQuality;
    const defaultQuality =
      options.find((option) => option.id === preferredQuality)?.id ||
      qualityConfig.defaultQuality;

    return res.json({
      path: normalizedPath,
      source,
      options,
      defaultQuality,
    });
  });

  app.get("/api/sessions/:id/video/hls/playlist", async (req, res) => {
    const session = deps.touchSession(req.params.id);
    if (!session) {
      return res
        .status(404)
        .json({ error: "Session not found or already cleaned up." });
    }

    if (!deps.ffmpegPath) {
      return res
        .status(503)
        .json({ error: "Video transcoder is unavailable." });
    }

    const requestedPath = String(req.query.path || "");
    const requestedQuality = String(req.query.quality || "720p").toLowerCase();
    const requestedSeekSeconds = deps.parseSeekSeconds(req.query.seekSeconds);
    if (!requestedPath || requestedPath === ".") {
      return res.status(400).json({ error: "File path is required." });
    }

    let normalizedPath;
    try {
      normalizedPath = deps.sanitizeEntryPath(requestedPath);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const targetPath = path.resolve(
      path.join(session.extractDir, normalizedPath),
    );
    const rootPath = path.resolve(session.extractDir);
    if (
      !targetPath.startsWith(`${rootPath}${path.sep}`) &&
      targetPath !== rootPath
    ) {
      return res.status(400).json({ error: "Invalid file path." });
    }

    const fileStats = await stat(targetPath).catch(() => null);
    if (!fileStats || !fileStats.isFile()) {
      return res.status(404).json({ error: "File not found." });
    }

    const entry = await deps.ensureVideoTranscodeEntry(
      session,
      normalizedPath,
      targetPath,
    );
    const selectedQuality =
      entry.qualities.find((option) => option.id === requestedQuality)?.id ||
      entry.defaultQuality ||
      "720p";
    const rendition = deps.getRenditionState(entry, session, selectedQuality);
    await deps.startRenditionTranscode(entry, session, rendition);
    const requestedSegmentIndex = Math.max(
      0,
      Math.floor(requestedSeekSeconds / deps.DEFAULT_VIDEO_SEGMENT_SECONDS),
    );
    if (requestedSegmentIndex > 0) {
      await deps.startPrioritySegmentWindow(
        entry,
        session,
        rendition,
        requestedSegmentIndex,
      );
    }
    await deps.refreshRenditionAvailability(rendition);

    const segmentCount = Math.max(1, rendition.expectedSegments || 1);
    const targetDuration = Math.max(1, deps.DEFAULT_VIDEO_SEGMENT_SECONDS);
    const lines = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      `#EXT-X-TARGETDURATION:${targetDuration}`,
      "#EXT-X-MEDIA-SEQUENCE:0",
      "#EXT-X-PLAYLIST-TYPE:VOD",
    ];

    if (requestedSeekSeconds > 0) {
      lines.push(
        `#EXT-X-START:TIME-OFFSET=${requestedSeekSeconds.toFixed(3)},PRECISE=YES`,
      );
    }

    for (let index = 0; index < segmentCount; index += 1) {
      const remaining =
        entry.durationSeconds - index * deps.DEFAULT_VIDEO_SEGMENT_SECONDS;
      const duration =
        index === segmentCount - 1
          ? Math.max(
              0.2,
              remaining > 0 ? remaining : deps.DEFAULT_VIDEO_SEGMENT_SECONDS,
            )
          : deps.DEFAULT_VIDEO_SEGMENT_SECONDS;
      lines.push(`#EXTINF:${duration.toFixed(3)},`);
      lines.push(
        `/api/sessions/${session.id}/video/hls/segment?${new URLSearchParams({
          path: normalizedPath,
          quality: selectedQuality,
          index: String(index),
        }).toString()}`,
      );
    }

    if (rendition.status === "done") {
      lines.push("#EXT-X-ENDLIST");
    }

    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "application/vnd.apple.mpegurl");
    res.setHeader(
      "x-video-duration-seconds",
      String(entry.durationSeconds || 0),
    );
    res.setHeader(
      "x-video-requested-seek-seconds",
      String(requestedSeekSeconds),
    );
    return res.send(`${lines.join("\n")}\n`);
  });

  app.get("/api/sessions/:id/video/thumbnail", async (req, res) => {
    const session = deps.touchSession(req.params.id);
    if (!session) {
      return res
        .status(404)
        .json({ error: "Session not found or already cleaned up." });
    }

    if (!deps.ffmpegPath) {
      return res
        .status(503)
        .json({ error: "Video transcoder is unavailable." });
    }

    const requestedPath = String(req.query.path || "");
    if (!requestedPath || requestedPath === ".") {
      return res.status(400).json({ error: "File path is required." });
    }

    const seekSeconds = deps.parseSeekSeconds(req.query.time);
    const quality = String(req.query.quality || "720p").toLowerCase();
    const width = Math.max(
      120,
      Math.min(
        640,
        Number.parseInt(String(req.query.width || "240"), 10) || 240,
      ),
    );

    let normalizedPath;
    try {
      normalizedPath = deps.sanitizeEntryPath(requestedPath);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const targetPath = path.resolve(
      path.join(session.extractDir, normalizedPath),
    );
    const rootPath = path.resolve(session.extractDir);
    if (
      !targetPath.startsWith(`${rootPath}${path.sep}`) &&
      targetPath !== rootPath
    ) {
      return res.status(400).json({ error: "Invalid file path." });
    }

    const fileStats = await stat(targetPath).catch(() => null);
    if (!fileStats || !fileStats.isFile()) {
      return res.status(404).json({ error: "File not found." });
    }

    const source = await deps.getVideoMetadata(targetPath);
    const { options } = deps.buildVideoQualityOptions(source.height);
    const selectedQuality =
      options.find((option) => option.id === quality)?.id || "source";
    const selectedHeight =
      selectedQuality === "source"
        ? 0
        : Number.parseInt(selectedQuality.replace("p", ""), 10) || 0;

    const thumbDir = path.join(session.workspaceDir, "video-thumbnails");
    await mkdir(thumbDir, { recursive: true });
    const roundedSeek = Math.max(0, Math.round(seekSeconds * 4) / 4);
    const hash = crypto
      .createHash("sha1")
      .update(`${normalizedPath}:${selectedQuality}:${width}:${roundedSeek}`)
      .digest("hex");
    const thumbPath = path.join(thumbDir, `${hash}.jpg`);
    const existing = await stat(thumbPath).catch(() => null);

    if (!existing) {
      const args = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        String(roundedSeek),
        "-i",
        targetPath,
      ];

      if (selectedHeight > 0) {
        args.push("-vf", `scale=-2:${selectedHeight},scale=${width}:-2`);
      } else {
        args.push("-vf", `scale=${width}:-2`);
      }

      args.push("-frames:v", "1", "-q:v", "4", thumbPath);
      await deps.runCommand(String(deps.ffmpegPath), args);
    }

    res.setHeader("cache-control", "no-store");
    res.type("image/jpeg");
    return res.sendFile(thumbPath);
  });

  app.get("/api/sessions/:id/video/hls/segment", async (req, res) => {
    const session = deps.touchSession(req.params.id);
    if (!session) {
      return res
        .status(404)
        .json({ error: "Session not found or already cleaned up." });
    }

    if (!deps.ffmpegPath) {
      return res
        .status(503)
        .json({ error: "Video transcoder is unavailable." });
    }

    const requestedPath = String(req.query.path || "");
    const requestedQuality = String(req.query.quality || "720p").toLowerCase();
    const segmentIndex = Math.max(
      0,
      Number.parseInt(String(req.query.index || "0"), 10) || 0,
    );
    if (!requestedPath || requestedPath === ".") {
      return res.status(400).json({ error: "File path is required." });
    }

    let normalizedPath;
    try {
      normalizedPath = deps.sanitizeEntryPath(requestedPath);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const targetPath = path.resolve(
      path.join(session.extractDir, normalizedPath),
    );
    const rootPath = path.resolve(session.extractDir);
    if (
      !targetPath.startsWith(`${rootPath}${path.sep}`) &&
      targetPath !== rootPath
    ) {
      return res.status(400).json({ error: "Invalid file path." });
    }

    const fileStats = await stat(targetPath).catch(() => null);
    if (!fileStats || !fileStats.isFile()) {
      return res.status(404).json({ error: "File not found." });
    }

    const entry = await deps.ensureVideoTranscodeEntry(
      session,
      normalizedPath,
      targetPath,
    );
    const selectedQuality =
      entry.qualities.find((option) => option.id === requestedQuality)?.id ||
      entry.defaultQuality ||
      "720p";
    const rendition = deps.getRenditionState(entry, session, selectedQuality);
    await deps.startRenditionTranscode(entry, session, rendition);

    const segmentPath = path.join(
      rendition.dir,
      `segment_${String(segmentIndex).padStart(6, "0")}.ts`,
    );
    let exists = await access(segmentPath)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      await deps.startPrioritySegmentWindow(
        entry,
        session,
        rendition,
        segmentIndex,
      );
      exists = await deps.waitForFile(segmentPath, 14000);
    }

    if (!exists) {
      return res.status(425).json({
        error: "Segment is being prepared.",
        status: rendition.status,
        availableSegments: rendition.availableSegments,
        requestedSegment: segmentIndex,
      });
    }

    await deps.refreshRenditionAvailability(rendition);
    res.setHeader("cache-control", "no-store");
    res.setHeader("accept-ranges", "bytes");
    res.type("video/mp2t");
    return createReadStream(segmentPath).pipe(res);
  });

  app.get("/api/sessions/:id/video/hls/status", async (req, res) => {
    const session = deps.touchSession(req.params.id);
    if (!session) {
      return res
        .status(404)
        .json({ error: "Session not found or already cleaned up." });
    }

    const requestedPath = String(req.query.path || "");
    if (!requestedPath || requestedPath === ".") {
      return res.status(400).json({ error: "File path is required." });
    }

    let normalizedPath;
    try {
      normalizedPath = deps.sanitizeEntryPath(requestedPath);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const key = deps.getVideoTranscodeKey(session.id, normalizedPath);
    const entry = deps.videoTranscodeStore.get(key);
    if (!entry) {
      return res.json({
        path: normalizedPath,
        status: "idle",
        durationSeconds: 0,
        renditions: [],
      });
    }

    const renditions = [];
    for (const [qualityId, rendition] of entry.renditions.entries()) {
      const availableSegments =
        await deps.refreshRenditionAvailability(rendition);
      renditions.push({
        quality: qualityId,
        status: rendition.status,
        availableSegments,
        expectedSegments: rendition.expectedSegments,
      });
    }

    return res.json({
      path: normalizedPath,
      status: renditions.some((item) => item.status === "running")
        ? "running"
        : renditions.some((item) => item.status === "done")
          ? "ready"
          : "idle",
      durationSeconds: entry.durationSeconds,
      renditions,
    });
  });

  app.get("/api/sessions/:id/video/stream", async (req, res) => {
    const session = deps.touchSession(req.params.id);
    if (!session) {
      return res
        .status(404)
        .json({ error: "Session not found or already cleaned up." });
    }

    if (!deps.ffmpegPath) {
      return res
        .status(503)
        .json({ error: "Video transcoder is unavailable." });
    }

    const requestedPath = String(req.query.path || "");
    const quality = String(req.query.quality || "source").toLowerCase();
    if (!requestedPath || requestedPath === ".") {
      return res.status(400).json({ error: "File path is required." });
    }

    let normalizedPath;
    try {
      normalizedPath = deps.sanitizeEntryPath(requestedPath);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const targetPath = path.resolve(
      path.join(session.extractDir, normalizedPath),
    );
    const rootPath = path.resolve(session.extractDir);
    if (
      !targetPath.startsWith(`${rootPath}${path.sep}`) &&
      targetPath !== rootPath
    ) {
      return res.status(400).json({ error: "Invalid file path." });
    }

    const fileStats = await stat(targetPath).catch(() => null);
    if (!fileStats || !fileStats.isFile()) {
      return res.status(404).json({ error: "File not found." });
    }

    const sourceDimensions = await deps.getVideoDimensions(targetPath);
    const { options } = deps.buildVideoQualityOptions(sourceDimensions.height);
    const selectedQuality =
      options.find((option) => option.id === quality)?.id || "source";
    const selectedHeight =
      selectedQuality === "source"
        ? 0
        : Number.parseInt(selectedQuality.replace("p", ""), 10) || 0;

    const ffmpegArgs = ["-hide_banner", "-loglevel", "error", "-i", targetPath];

    if (selectedHeight > 0) {
      ffmpegArgs.push("-vf", `scale=-2:${selectedHeight}`);
    }

    ffmpegArgs.push(
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      selectedHeight >= 1440 ? "27" : selectedHeight >= 1080 ? "26" : "24",
      "-c:a",
      "aac",
      "-movflags",
      "+frag_keyframe+empty_moov+faststart",
      "-f",
      "mp4",
      "pipe:1",
    );

    res.setHeader("cache-control", "no-store");
    res.type("video/mp4");

    const child = spawn(String(deps.ffmpegPath), ffmpegArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    req.on("close", () => {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    });

    child.on("error", () => {
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to start transcoder." });
      }
    });

    child.on("close", (code) => {
      if (code !== 0 && !res.writableEnded) {
        res.end();
        deps.logEvent("warn", "session.video.transcode.failed", {
          sessionId: session.id,
          path: normalizedPath,
          quality: selectedQuality,
          code,
          stderr: stderr.slice(-500),
        });
      }
    });

    return child.stdout.pipe(res);
  });
}
