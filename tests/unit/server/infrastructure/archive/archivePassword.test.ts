import { expect, test } from "vite-plus/test";
import { checkArchiveFailure } from "../../../../../server/infrastructure/archive/archivePassword.js";

// p7zip 16.02 emits this stdout wrapper instead of a stderr password error.
const splitHeaderFailure = `Enter password (will not be echoed):--
Path = /source.7z.001
Type = Split
Physical Size = 1024
Volumes = 3
Total Physical Size = 2239

----------
Path = source.7z
Size = 2239

----------
Path = source.7z
Open ERROR: Can not open the file as [7z] archive

Errors: 1
`;

test("recognizes the actual split encrypted-header failure reported on Linux stdout", () => {
  expect(() => checkArchiveFailure("", true, "/source.7z.001", splitHeaderFailure)).toThrow(
    /Password was rejected or encrypted data is damaged/,
  );
});

test.each([
  splitHeaderFailure.replace("/source.7z.001", "/other.7z.001"),
  splitHeaderFailure.replace("Enter password (will not be echoed):", ""),
  splitHeaderFailure.replace("Path = source.7z\nOpen ERROR", "Path = member.txt\nOpen ERROR"),
  splitHeaderFailure.replace("\nSize = 2239\n", "\nSize = 2239\n\n--\nType = 7z\n"),
])(
  "does not accept unrelated sources, unencrypted damage or member records as a header failure",
  (listing) => {
    expect(() => checkArchiveFailure("", true, "/source.7z.001", listing)).toThrow(
      /corrupt, incomplete or unsupported/,
    );
  },
);

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
