import { describe, expect, it } from "vitest";
import {
  createSessionInputSchema,
  enqueueSessionsInputSchema,
  jobSchema,
  mediaPathQuerySchema,
  serverContract,
} from "../../shared/contracts.js";

describe("server contracts", () => {
  it("accepts a public HTTP archive URL and normalizes defaults", () => {
    const input = createSessionInputSchema.parse({
      url: "https://example.com/photos.zip",
    });

    expect(input).toEqual({
      url: "https://example.com/photos.zip",
      confirmOversize: false,
    });
  });

  it.each([
    "file:///tmp/archive.zip",
    "ftp://example.com/archive.zip",
    "https://user:secret@example.com/archive.zip",
    "http://localhost/archive.zip",
    "http://media.localhost/archive.zip",
    "http://127.0.0.1/archive.zip",
    "http://0.0.0.0/archive.zip",
    "http://10.1.2.3/archive.zip",
    "http://172.16.0.1/archive.zip",
    "http://172.31.255.255/archive.zip",
    "http://192.168.1.1/archive.zip",
    "http://169.254.169.254/latest/meta-data",
    "http://224.0.0.1/archive.zip",
    "http://[::1]/archive.zip",
    "http://[fc00::1]/archive.zip",
    "http://[fd00::1]/archive.zip",
    "http://[fe80::1]/archive.zip",
    "not a url",
  ])("rejects unsafe download URL %s", (url) => {
    expect(createSessionInputSchema.safeParse({ url }).success).toBe(false);
  });

  it.each(["../secret", "/absolute", "folder/../../secret", "C:\\secret"])(
    "rejects unsafe media path %s",
    (path) => {
      expect(mediaPathQuerySchema.safeParse({ path }).success).toBe(false);
    },
  );

  it("accepts public hosts, public IPv4, and safe relative media paths", () => {
    expect(
      createSessionInputSchema.safeParse({
        url: "http://172.32.0.1/archive.zip",
      }).success,
    ).toBe(true);
    expect(
      createSessionInputSchema.safeParse({
        url: "https://cdn.example.com/archive.zip",
      }).success,
    ).toBe(true);
    expect(
      mediaPathQuerySchema.safeParse({ path: "folder/image.jpg" }).success,
    ).toBe(true);
  });

  it("rejects impossible job progress", () => {
    expect(
      jobSchema.safeParse({
        id: crypto.randomUUID(),
        url: "https://example.com/photos.zip",
        status: "queued",
        phase: "queued",
        percent: 101,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }).success,
    ).toBe(false);
  });

  it("exports oRPC contract procedures backed by the schemas", () => {
    expect(serverContract.sessions.create["~orpc"]).toBeDefined();
  });

  it("accepts batches of one to fifty public URLs", () => {
    const urls = Array.from(
      { length: 50 },
      (_, index) => `https://example.com/archive-${String(index)}.zip`,
    );
    expect(enqueueSessionsInputSchema.parse({ urls }).urls).toHaveLength(50);
  });

  it.each([[], Array.from({ length: 51 }, () => "https://example.com/a.zip")])(
    "rejects a batch outside the supported bounds",
    (urls) => {
      expect(enqueueSessionsInputSchema.safeParse({ urls }).success).toBe(
        false,
      );
    },
  );
});
