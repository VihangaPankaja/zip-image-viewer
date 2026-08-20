import { describe, expect, it } from "vitest";
import { parseJobSocketPacket } from "./jobSocket";

describe("parseJobSocketPacket", () => {
  it("returns a typed packet for JSON object messages", () => {
    expect(
      parseJobSocketPacket('{"type":"progress","job":{"id":"job-1"}}'),
    ).toEqual({
      type: "progress",
      job: { id: "job-1" },
    });
  });

  it.each(["not json", "[]", "null", "42"])(
    "rejects malformed packet %s",
    (payload) => {
      expect(() => parseJobSocketPacket(payload)).toThrow(
        "Malformed job update",
      );
    },
  );
});
