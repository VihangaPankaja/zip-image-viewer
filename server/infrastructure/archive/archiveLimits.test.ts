import { expect, it } from "vite-plus/test";
import { validateArchiveEntries } from "./archiveLimits.js";

it.each([900, 910])("counts implicit parent directories before extracting %i entries", (count) => {
  const entries = Array.from({ length: count }, (_, index) => ({
    path: `root${index}/a/b/c/d/e/f/g/h/i/file.txt`,
    size: 0,
  }));
  if (count === 900) expect(validateArchiveEntries(entries)).toBe(0);
  else expect(() => validateArchiveEntries(entries)).toThrow("10000 entry limit");
});
