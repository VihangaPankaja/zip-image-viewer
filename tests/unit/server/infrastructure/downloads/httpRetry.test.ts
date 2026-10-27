import { expect, it } from "vite-plus/test";
import { retryDelay } from "../../../../../server/infrastructure/downloads/httpRetry.js";

it("honors Retry-After seconds and dates, with explicit delay and cumulative caps", () => {
  const now = Date.now();
  const budget = { retries: 0, waitedMs: 0 };
  expect(retryDelay({ statusCode: 429, retryAfter: "2" }, 8, budget, now)).toBe(2_000);
  expect(
    retryDelay(
      { statusCode: 503, retryAfter: new Date(Math.ceil(now / 1000) * 1000 + 3000).toUTCString() },
      8,
      budget,
      now,
    ),
  ).toBeGreaterThanOrEqual(3_000);
  expect(retryDelay({ statusCode: 429, retryAfter: "31" }, 8, budget, now)).toBeUndefined();
  expect(
    retryDelay({ statusCode: 429, retryAfter: "9".repeat(400) }, 8, budget, now),
  ).toBeUndefined();
  expect(
    retryDelay({ statusCode: 429, retryAfter: "30" }, 8, { retries: 1, waitedMs: 100_000 }, now),
  ).toBeUndefined();
});

it.each(["bad", "-1", "1.5", "1e2"])(
  "uses bounded jitter for malformed Retry-After %s",
  (retryAfter) => {
    const delay = retryDelay({ statusCode: 429, retryAfter }, 8, { retries: 0, waitedMs: 0 });
    expect(delay).toBeGreaterThanOrEqual(1_200);
    expect(delay).toBeLessThanOrEqual(1_600);
  },
);

it("caps exponential delay before exponentiation and bounds legacy unlimited retries", () => {
  const budget = { retries: 0, waitedMs: 0 };
  const delays = Array.from({ length: 8 }, () =>
    retryDelay({ retryAfter: "0", statusCode: 429 }, -1, budget),
  );
  expect(delays).toEqual([...Array<number>(7).fill(0), undefined]);
  expect(retryDelay(new Error("offline"), -1, { retries: 6, waitedMs: 0 })).toBe(30_000);
});

it.each([
  "DOWNLOAD_FATAL",
  "DOWNLOAD_AUTH",
  "DOWNLOAD_LOGIN",
  "DOWNLOAD_PERMANENT",
  "OVERSIZE_CONFIRM",
  "SOURCE_CHANGED",
  "RANGE_UNSUPPORTED",
])("does not retry %s", (code) => {
  expect(retryDelay({ code }, -1, { retries: 0, waitedMs: 0 })).toBeUndefined();
});
