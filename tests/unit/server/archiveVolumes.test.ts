import { expect, test } from "vite-plus/test";
import {
  archiveVolume,
  groupArchiveVolumes,
  isArchiveName,
} from "../../../shared/archiveVolumes.js";

test("keeps one set when volume numbers grow beyond the initial padding width", () => {
  expect(
    groupArchiveVolumes([
      "book.part100.rar",
      "book.part01.rar",
      "book.part99.rar",
      "book.7z.1000",
      "book.7z.001",
      "book.7z.999",
    ]),
  ).toEqual([
    ["book.part01.rar", "book.part99.rar", "book.part100.rar"],
    ["book.7z.001", "book.7z.999", "book.7z.1000"],
  ]);
  expect(archiveVolume("book.part100.rar")?.first).toBe("book.part01.rar");
});

test("groups numbered 7z and RAR volumes by their full path and orders volume one first", () => {
  const groups = groupArchiveVolumes([
    "日本語/book.7z.003",
    "other/book.7z.001",
    "日本語/book.7z.001",
    "日本語/book.7z.002",
    "a.part02.rar",
    "a.part01.rar",
    "normal.zip",
  ]);
  expect(groups).toEqual([
    ["日本語/book.7z.001", "日本語/book.7z.002", "日本語/book.7z.003"],
    ["other/book.7z.001"],
    ["a.part01.rar", "a.part02.rar"],
    ["normal.zip"],
  ]);
  expect(archiveVolume("book.7z.003")?.first).toBe("book.7z.001");
  expect(archiveVolume("book.part02.rar")?.first).toBe("book.part01.rar");
  expect(isArchiveName("book.7z.002")).toBe(true);
  expect(isArchiveName("book.part01.rar")).toBe(true);
  expect(isArchiveName("photo.001")).toBe(false);
});

test("does not combine case aliases or differently padded sets", () => {
  expect(groupArchiveVolumes(["A.7z.001", "a.7z.002", "a.part1.rar", "a.part02.rar"])).toHaveLength(
    4,
  );
});
