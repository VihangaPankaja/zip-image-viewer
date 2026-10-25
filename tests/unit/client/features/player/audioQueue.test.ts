import {
  audioTime,
  buildAudioQueue,
  shuffleAudioQueue,
} from "../../../../../client/src/features/player/audioQueue";

it("uses same-folder cover images and keeps other files out of the queue", () => {
  const queue = buildAudioQueue("session", [
    { type: "file", name: "cover.jpg", path: "Other/cover.jpg", extension: "jpg" },
    { type: "file", name: "folder.png", path: "Album/folder.png", extension: "png" },
    { type: "directory", name: "noise.wav", path: "noise.wav", extension: "wav" },
    { type: "file", name: "one.wav", path: "Album/one.wav", extension: "wav" },
    { type: "file", name: "two.mp3", path: "two.mp3", extension: "mp3" },
  ]);
  expect(queue.map(({ name }) => name)).toEqual(["one.wav", "two.mp3"]);
  expect(queue[0].album).toBe("Album");
  expect(queue[0].artwork).toContain("Album%2Ffolder.png");
  expect(queue[1].artwork).toBe("");
  expect(queue[1].url).toContain("path=two.mp3");
});

it("shuffles without duplicates, holds the current track first, and does not mutate the input", () => {
  const queue = buildAudioQueue(
    "session",
    Array.from({ length: 20 }, (_, i) => ({
      type: "file" as const,
      name: `${i}.wav`,
      path: `${i}.wav`,
      extension: "wav",
    })),
  );
  const shuffled = shuffleAudioQueue(queue, "5.wav");
  expect(shuffled[0].path).toBe("5.wav");
  expect(new Set(shuffled.map(({ path }) => path))).toEqual(new Set(queue.map(({ path }) => path)));
  expect(queue[0].path).toBe("0.wav");
  expect(shuffleAudioQueue([], "missing")).toEqual([]);
});

it("formats unknown, negative and long playback positions safely", () => {
  expect([NaN, Infinity, -1, 5, 3670].map(audioTime)).toEqual([
    "0:00",
    "0:00",
    "0:00",
    "0:05",
    "61:10",
  ]);
});
