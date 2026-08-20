import { describe, expect, it } from "vitest";
import {
  downloadOptionsToSettings,
  normalizeDownloadOptions,
  normalizeDownloadSettings,
} from "./downloadOptions.js";

describe("download option normalization", () => {
  it("clamps flat settings and rejects unsupported values", () => {
    expect(
      normalizeDownloadSettings({
        threadMode: "turbo",
        threadCount: 99,
        enableMultithread: 0,
        enableResume: 1,
        maxRetries: 99,
        videoQuality: "8k",
      }),
    ).toEqual({
      threadMode: "auto",
      threadCount: 8,
      enableMultithread: false,
      enableResume: true,
      maxRetries: 8,
      videoQuality: "720p",
    });
  });

  it("normalizes nested options and filters invalid headers", () => {
    const options = normalizeDownloadOptions({
      transport: {
        mode: "single",
        threads: -4,
        multithread: false,
        resume: false,
      },
      retry: { maxRetries: -1, timeoutMs: 999_999 },
      media: { videoQuality: "480P" },
      extraction: { enabled: false },
      request: {
        headers: {
          Authorization: "Bearer fixture",
          Empty: "",
          Object: { unsafe: true },
        },
      },
    });

    expect(options).toEqual({
      transport: {
        mode: "single",
        threads: 1,
        multithread: false,
        resume: false,
      },
      retry: { maxRetries: -1, timeoutMs: 180_000 },
      media: { videoQuality: "480p" },
      extraction: { enabled: false },
      request: { headers: { Authorization: "Bearer fixture" } },
    });
    expect(downloadOptionsToSettings(options)).toMatchObject({
      threadMode: "single",
      threadCount: 1,
      maxRetries: -1,
      videoQuality: "480p",
    });
  });

  it("falls back safely for non-object input", () => {
    const options = normalizeDownloadOptions(null);
    expect(options.transport.threads).toBeGreaterThanOrEqual(1);
    expect(options.retry.timeoutMs).toBe(30_000);
    expect(options.request.headers).toEqual({});
  });
});
