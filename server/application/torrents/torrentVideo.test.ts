import { expect, it, vi } from "vite-plus/test";
import { inspectTorrentVideo } from "./torrentVideo.js";

function atom(type: string, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8);
  header.write(type, 4);
  return Buffer.concat([header, payload]);
}

function source(bytes: Buffer, name = "film.mp4") {
  return {
    path: name,
    size: bytes.length,
    read: vi.fn((start: number, end: number, _signal: AbortSignal) =>
      Promise.resolve(bytes.subarray(start, end + 1)),
    ),
  };
}

it("reads the complete leading MP4 index before allowing early playback", async () => {
  const ftyp = atom("ftyp", Buffer.from("isom0000"));
  const moov = atom("moov", Buffer.alloc(80));
  const file = source(Buffer.concat([ftyp, moov, atom("mdat", Buffer.alloc(100))]));
  expect(await inspectTorrentVideo(file, new AbortController().signal)).toMatchObject({
    state: "ready",
  });
  expect(file.read).toHaveBeenCalledWith(
    ftyp.length,
    ftyp.length + moov.length - 1,
    expect.any(AbortSignal),
  );
});

it("offers download first without reading a tail index or unsupported container", async () => {
  const file = source(Buffer.concat([atom("ftyp"), atom("mdat", Buffer.alloc(100)), atom("moov")]));
  expect(await inspectTorrentVideo(file, new AbortController().signal)).toMatchObject({
    state: "download-first",
  });
  const unsupported = source(Buffer.alloc(100), "film.mkv");
  expect(await inspectTorrentVideo(unsupported, new AbortController().signal)).toMatchObject({
    state: "download-first",
  });
  expect(unsupported.read).not.toHaveBeenCalled();
});

it("rejects truncated, overflowing and unbounded MP4 boxes", async () => {
  for (const size of [0, 1, 7, 0xffffffff]) {
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32BE(8);
    bytes.write("ftyp", 4);
    bytes.writeUInt32BE(size, 8);
    bytes.write("moov", 12);
    expect(await inspectTorrentVideo(source(bytes), new AbortController().signal)).toMatchObject({
      state: "download-first",
    });
  }
  expect(
    await inspectTorrentVideo(source(Buffer.alloc(7)), new AbortController().signal),
  ).toMatchObject({ state: "download-first" });
});

it("propagates cancellation while waiting for verified metadata", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(inspectTorrentVideo(source(Buffer.alloc(16)), controller.signal)).rejects.toThrow();
});
