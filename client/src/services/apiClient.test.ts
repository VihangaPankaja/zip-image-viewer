import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "./apiClient";

describe("fetchJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns parsed JSON for a successful response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    await expect(fetchJson<{ ok: boolean }>("/api/test")).resolves.toEqual({
      ok: true,
    });
  });

  it("uses a structured API error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "Session expired" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    await expect(fetchJson("/api/test")).rejects.toThrow("Session expired");
  });
});
