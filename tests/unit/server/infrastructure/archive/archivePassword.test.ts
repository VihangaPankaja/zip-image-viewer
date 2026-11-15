import { expect, test } from "vite-plus/test";
import { checkArchiveFailure } from "../../../../../server/infrastructure/archive/archivePassword.js";

test("reports unsupported native compression as a public input error with a recovery action", () => {
  let failure: unknown;
  try {
    checkArchiveFailure("ERROR: Unsupported Method : note.txt", false, "/source.7z");
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({ code: "INVALID_INPUT", status: 400 });
  if (!(failure instanceof Error)) throw new Error("Expected a public archive error");
  expect(failure.message).toContain("Repack");
});

test("a corrupt member named like a header diagnostic cannot become a password prompt", () => {
  expect(() =>
    checkArchiveFailure(
      "ERROR: CRC Failed : Cannot open encrypted archive. Wrong password?\n",
      true,
      "/source.7z",
    ),
  ).toThrow(/corrupt, incomplete or unsupported/);
});

test.each(["Cannot", "Can not"])(
  "recognizes the %s encrypted-header diagnostic for the actual source",
  (prefix) => {
    expect(() =>
      checkArchiveFailure(
        `ERROR: /source.7z : ${prefix} open encrypted archive. Wrong password?\n`,
        true,
        "/source.7z",
      ),
    ).toThrow(/Password was rejected/);
  },
);
