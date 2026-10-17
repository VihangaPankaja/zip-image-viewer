import type { TorrentVideoInfo } from "../../../shared/contracts.js";

export type TorrentVideoSource = {
  path: string;
  size: number;
  read: (_start: number, _end: number, _signal: AbortSignal) => Promise<Buffer>;
};

const downloadFirst: TorrentVideoInfo = {
  state: "download-first",
  message:
    "Download first. Early playback requires an MP4 with its movie index at the start. Open the completed file in Explore for other formats or codecs.",
};

export async function inspectTorrentVideo(
  source: TorrentVideoSource,
  signal: AbortSignal,
): Promise<TorrentVideoInfo> {
  signal.throwIfAborted();
  if (!/\.(mp4|m4v)$/i.test(source.path)) return downloadFirst;
  const limit = Math.min(source.size, 2 * 1024 * 1024);
  let offset = 0;
  let hasFileType = false;
  for (let box = 0; box < 256 && offset + 8 <= limit; box += 1) {
    const header = await source.read(offset, offset + 7, signal);
    if (header.length !== 8) return downloadFirst;
    let size = header.readUInt32BE(0);
    const type = header.toString("ascii", 4, 8);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > limit) return downloadFirst;
      const extended = await source.read(offset + 8, offset + 15, signal);
      if (extended.length !== 8) return downloadFirst;
      const largeSize = extended.readBigUInt64BE();
      if (largeSize > BigInt(limit)) return downloadFirst;
      size = Number(largeSize);
      headerSize = 16;
    }
    if (size < headerSize || offset + size > source.size) return downloadFirst;
    if (!offset && type !== "ftyp") return downloadFirst;
    if (type === "ftyp") hasFileType = true;
    if (type === "mdat") return downloadFirst;
    if (type === "moov") {
      if (!hasFileType || offset + size > limit) return downloadFirst;
      const index = await source.read(offset, offset + size - 1, signal);
      if (index.length !== size) return downloadFirst;
      return {
        state: "ready",
        message:
          "Playing verified pieces while downloading. Seeking waits for peers to provide the requested pieces. Browser codec support is required.",
      };
    }
    offset += size;
  }
  return downloadFirst;
}
