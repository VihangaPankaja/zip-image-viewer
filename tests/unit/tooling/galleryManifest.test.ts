import { expect, it } from "vite-plus/test";
import { mergeGalleryManifests } from "../../review/galleryManifest";

const fragment = (file: string, sourceCommit = "commit") => ({
  sourceCommit,
  fixtures: "local fixtures",
  captures: [{ device: "Mobile", width: 390, height: 844, theme: "light", screen: file, file }],
  encoderVerification: [{ event: "video.encoder.selected" }],
});

it("combines worker captures and encoder evidence in stable filename order", () => {
  const result = mergeGalleryManifests([fragment("b.png"), fragment("a.png")]);
  expect(result.captures.map(({ file }) => file)).toEqual(["a.png", "b.png"]);
  expect(result.encoderVerification).toHaveLength(2);
  expect(result.sourceCommit).toBe("commit");
});

it("rejects missing, stale or duplicate worker results", () => {
  expect(() => mergeGalleryManifests([])).toThrow("No gallery captures");
  expect(() => mergeGalleryManifests([fragment("a.png"), fragment("b.png", "old")])).toThrow(
    "different commits",
  );
  expect(() => mergeGalleryManifests([fragment("a.png"), fragment("a.png")])).toThrow(
    "Duplicate gallery capture",
  );
});
