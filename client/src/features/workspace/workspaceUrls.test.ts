import { describe, expect, it } from "vitest";
import {
  getBatchValidationMessage,
  MAX_BATCH_URLS,
  parseWorkspaceUrls,
} from "./workspaceUrls";

describe("workspace URL batches", () => {
  it("splits new lines, trims input, and removes duplicate URLs", () => {
    expect(
      parseWorkspaceUrls(
        " https://example.com/a.zip\n\nhttps://example.com/b.zip\nhttps://example.com/a.zip ",
      ),
    ).toEqual(["https://example.com/a.zip", "https://example.com/b.zip"]);
  });

  it("rejects empty and over-limit batches", () => {
    expect(getBatchValidationMessage([])).toMatch(/at least one/i);
    expect(
      getBatchValidationMessage(
        Array.from(
          { length: MAX_BATCH_URLS + 1 },
          () => "https://example.com/a.zip",
        ),
      ),
    ).toMatch(/up to 50/i);
  });
});
