import { describe, expect, it } from "vitest";
import { jobPayloadSchema, sessionPayloadSchema } from "./sessionSchemas";

describe("workspace session schemas", () => {
  it("accepts valid session and job payloads", () => {
    expect(
      sessionPayloadSchema.parse({
        id: "session-1",
        tree: {
          name: "photos",
          path: "photos",
          type: "directory",
          children: [
            {
              extension: ".jpg",
              name: "cover.jpg",
              path: "photos/cover.jpg",
              type: "file",
            },
          ],
        },
      }),
    ).toMatchObject({ id: "session-1", tree: { name: "photos" } });
    expect(
      jobPayloadSchema.parse({ id: "job-1", threadMode: "segmented" }),
    ).toMatchObject({ id: "job-1", threadMode: "segmented" });
  });

  it("rejects malformed session and job payloads", () => {
    expect(
      sessionPayloadSchema.safeParse({
        tree: { name: "cover.jpg", path: "cover.jpg", type: "unknown" },
      }).success,
    ).toBe(false);
    expect(jobPayloadSchema.safeParse({ threadMode: "parallel" }).success).toBe(
      false,
    );
  });
});
