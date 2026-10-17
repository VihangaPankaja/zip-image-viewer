import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import {
  startTorrentPlaybackFixture,
  waitForPlayback,
} from "../fixtures/torrentPlayback.js";

it("streams only verified selected pieces with precise ranges and resumes missing seeks after peer loss", async () => {
  const fixture = await startTorrentPlaybackFixture();
  const { client, origin, files, requests } = fixture;
  const controllers: AbortController[] = [];
  try {
    const id = await fixture.enqueue();
    const url = (fileId = "0", route = "stream") =>
      `${origin}/api/session-jobs/${id}/video/${route}?fileId=${fileId}`;
    const get = (range: string, fileId = "0") =>
      fetch(url(fileId), {
        headers: { Range: range },
        signal: AbortSignal.timeout(20_000),
      });
    expect(requests).toEqual([]);
    expect((await get("bytes=0-0")).status).toBe(409);
    expect(requests).toEqual([]);
    await client.jobs.selectFiles({ id, fileIds: ["0", "1", "2"] });
    await waitForPlayback(
      async () => (await client.jobs.list()).items[0].phase,
      (phase) => phase === "downloading",
    );
    const info = await fetch(url("0", "info"), {
      signal: AbortSignal.timeout(25_000),
    });
    expect(info.status).toBe(200);
    expect(await info.json()).toMatchObject({ state: "ready" });
    for (const fileId of ["1", "2"]) {
      const fallback = await fetch(url(fileId, "info"), {
        signal: AbortSignal.timeout(25_000),
      });
      expect(fallback.status).toBe(200);
      expect(await fallback.json()).toMatchObject({ state: "download-first" });
    }
    expect((await get("bytes=0-0", "999")).status).toBe(404);
    expect((await get("bytes=0-0", "../0")).status).toBe(404);
    const total = files[0].bytes.length;
    for (const range of [
      "bytes=8-2",
      `bytes=${total}-`,
      "bytes=0-1,4-5",
      "bytes=oops",
    ])
      expect((await get(range)).status).toBe(416);
    for (const [start, end] of [
      [0, 0],
      [15_999, 34_337],
    ]) {
      const response = await get(`bytes=${start}-${end}`);
      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe(
        `bytes ${start}-${end}/${total}`,
      );
      expect(response.headers.get("content-length")).toBe(
        String(end - start + 1),
      );
      const received = Buffer.from(await response.arrayBuffer());
      expect(createHash("sha256").update(received).digest("hex")).toBe(
        createHash("sha256")
          .update(files[0].bytes.subarray(start, end + 1))
          .digest("hex"),
      );
    }
    const job = (await client.jobs.list()).items[0];
    expect(job.torrentFiles[0].complete).toBe(false);
    await fixture.disconnect();
    await waitForPlayback(
      async () => (await client.jobs.list()).items[0].peerCount,
      (peers) => peers === 0,
    );
    const seekStart = Math.floor(total * 0.85);
    const seekEnd = seekStart + 32_767;
    const controller = new AbortController();
    controllers.push(controller);
    let receivedBytes = 0;
    const pending = fetch(url(), {
      headers: { Range: `bytes=${seekStart}-${seekEnd}` },
      signal: controller.signal,
    }).then(async (response) => {
      expect(response.status).toBe(206);
      const chunks: Buffer[] = [];
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Missing torrent response body");
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        receivedBytes += value.byteLength;
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks);
    });
    await delay(500);
    expect(receivedBytes).toBe(0);
    await fixture.reconnect();
    const resumed = await pending;
    expect(
      resumed.equals(files[0].bytes.subarray(seekStart, seekEnd + 1)),
    ).toBe(true);
    expect(resumed.some((byte) => byte !== 0)).toBe(true);
    const suffix = await get("bytes=-17");
    expect(suffix.status).toBe(206);
    expect(
      Buffer.from(await suffix.arrayBuffer()).equals(
        files[0].bytes.subarray(-17),
      ),
    ).toBe(true);

    // Aborted, paused, and canceled readers must release their live torrent leases.
    await fixture.disconnect();
    const leases = Array.from({ length: 8 }, () => new AbortController());
    controllers.push(...leases);
    const heldRequests = leases.map((lease) =>
      fetch(url(), {
        headers: {
          Range: `bytes=${Math.floor(total * 0.65)}-${Math.floor(total * 0.65) + 65_535}`,
        },
        signal: lease.signal,
      })
        .then((response) => response.arrayBuffer())
        .catch(() => undefined),
    );
    await waitForPlayback(
      async () =>
        (
          await fetch(url("0", "info"), {
            signal: AbortSignal.timeout(5_000),
          })
        ).status,
      (status) => status === 409,
    );
    for (const lease of leases) lease.abort();
    await Promise.all(heldRequests);
    await waitForPlayback(
      async () =>
        (
          await fetch(url("0", "info"), {
            signal: AbortSignal.timeout(5_000),
          })
        ).status,
      (status) => status === 200,
    );
    for (const action of ["abort", "pause", "cancel"] as const) {
      const abort = new AbortController();
      controllers.push(abort);
      let payload = 0;
      const request = fetch(url(), {
        headers: {
          Range: `bytes=${Math.floor(total * 0.65)}-${Math.floor(total * 0.65) + 65_535}`,
        },
        signal: abort.signal,
      })
        .then(async (response) => {
          if (!response.ok) return;
          const reader = response.body?.getReader();
          if (!reader) return;
          for (;;) {
            const result = await reader.read();
            if (result.done) return;
            payload += result.value.byteLength;
          }
        })
        .catch(() => undefined);
      await delay(100);
      if (action === "abort") abort.abort();
      else await client.jobs[action]({ id });
      await Promise.race([
        request,
        delay(5_000).then(() => {
          throw new Error(`${action} did not close the missing-piece reader`);
        }),
      ]);
      expect(payload).toBe(0);
      if (action === "pause") {
        await client.jobs.resume({ id });
        await waitForPlayback(
          async () => (await client.jobs.list()).items[0].phase,
          (phase) => phase === "downloading",
        );
      }
    }
    expect((await fetch(`${origin}/health`)).ok).toBe(true);
  } finally {
    for (const controller of controllers) controller.abort();
    await fixture.close();
  }
}, 120_000);

it("keeps an open full-file response alive through last-piece completion", async () => {
  const fixture = await startTorrentPlaybackFixture();
  try {
    fixture.setUploadLimit(64 * 1024);
    const id = await fixture.enqueue();
    await fixture.client.jobs.selectFiles({ id, fileIds: ["0"] });
    await waitForPlayback(
      async () => (await fixture.client.jobs.list()).items[0].phase,
      (phase) => phase === "downloading",
    );
    expect(
      (
        await fetch(
          `${fixture.origin}/api/session-jobs/${id}/video/stream?fileId=1`,
        )
      ).status,
    ).toBe(409);
    const response = await fetch(
      `${fixture.origin}/api/session-jobs/${id}/video/stream?fileId=0`,
      {
        signal: AbortSignal.timeout(30_000),
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(
      String(fixture.files[0].bytes.length),
    );
    fixture.setUploadLimit(-1);
    const received = Buffer.from(await response.arrayBuffer());
    expect(createHash("sha256").update(received).digest("hex")).toBe(
      createHash("sha256").update(fixture.files[0].bytes).digest("hex"),
    );
    await waitForPlayback(
      async () => (await fixture.client.jobs.list()).items[0].status,
      (status) => status === "ready",
    );
    const seek = await fetch(
      `${fixture.origin}/api/session-jobs/${id}/video/stream?fileId=0`,
      {
        headers: { Range: "bytes=-31" },
        signal: AbortSignal.timeout(5_000),
      },
    );
    expect(seek.status).toBe(206);
    expect(
      Buffer.from(await seek.arrayBuffer()).equals(
        fixture.files[0].bytes.subarray(-31),
      ),
    ).toBe(true);
  } finally {
    await fixture.close();
  }
}, 120_000);
