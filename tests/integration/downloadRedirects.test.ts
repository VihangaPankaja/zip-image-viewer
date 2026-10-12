import { fetchTorrentMetadata } from "../../server/application/torrents/torrentDownloader.js";
import { fetchRemoteMetadata } from "../../server/infrastructure/downloads/remoteMetadata.js";

it("does not use compressed HEAD length as a decoded payload or range size", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        headers: {
          "content-encoding": "gzip",
          "content-length": "46",
          "accept-ranges": "bytes",
        },
      }),
    ),
  );
  try {
    await expect(
      fetchRemoteMetadata(
        "https://example.com/a.zip",
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ size: 0, acceptRanges: false });
  } finally {
    vi.unstubAllGlobals();
  }
});

it("treats malformed redirect destinations as permanent validation failures", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "http://[" } }),
    );
  await expect(
    fetchTorrentMetadata(
      "https://example.com/a.torrent",
      new AbortController().signal,
      fetcher,
    ),
  ).rejects.toMatchObject({ code: "DOWNLOAD_FATAL" });
});

it("rejects a torrent metadata redirect to private storage before requesting it", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    }),
  );
  await expect(
    fetchTorrentMetadata(
      "https://example.com/a.torrent",
      new AbortController().signal,
      fetcher,
    ),
  ).rejects.toThrow(/public HTTP/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("follows relative public redirects for torrent metadata", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(null, { status: 307, headers: { location: "/b.torrent" } }),
    )
    .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
  await expect(
    fetchTorrentMetadata(
      "https://example.com/a.torrent",
      new AbortController().signal,
      fetcher,
    ),
  ).resolves.toEqual(new Uint8Array([1, 2, 3]));
  expect(fetcher.mock.calls[1]?.[0]).toBe("https://example.com/b.torrent");
});

it("bounds redirect loops and refuses private HEAD redirects", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "/again" } }),
    );
  await expect(
    fetchTorrentMetadata(
      "https://example.com/a.torrent",
      new AbortController().signal,
      fetcher,
    ),
  ).rejects.toThrow(/redirect/);
  expect(fetcher.mock.calls.length).toBeLessThanOrEqual(11);
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://localhost/private" },
      }),
    ),
  );
  try {
    await expect(
      fetchRemoteMetadata(
        "https://example.com/a.zip",
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ size: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});
import { expect, it, vi } from "vitest";
