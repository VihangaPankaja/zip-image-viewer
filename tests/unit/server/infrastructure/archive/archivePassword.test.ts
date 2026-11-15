import { expect, test } from "vite-plus/test";
import { checkArchiveFailure } from "../../../../../server/infrastructure/archive/archivePassword.js";

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
