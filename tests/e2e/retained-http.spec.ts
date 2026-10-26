import express from "express";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { startHttpRestartServer, stopHttpRestartServer } from "../fixtures/httpRestartServer";
import { proxyApp } from "../fixtures/proxyApp";
import { tapVisibleTarget } from "./touch";

test.use({ hasTouch: true });
for (const width of [390, 1440]) {
  test(`HTTP pause, restart, resume, retention and deliberate deletion at ${width}px`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    if (!baseURL) throw new Error("Missing frontend URL");
    const directory = await mkdtemp(path.join(tmpdir(), "http-browser-"));
    const payload = Buffer.alloc(3 * 1024 * 1024, 65);
    const source = createServer((request, response) => {
      const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? "");
      const start = match ? Number(match[1]) : 0;
      response.writeHead(match ? 206 : 200, {
        etag: '"browser-v1"',
        "accept-ranges": "bytes",
        "content-length": payload.length - start,
        ...(match
          ? { "content-range": `bytes ${start}-${payload.length - 1}/${payload.length}` }
          : {}),
      });
      if (request.method === "HEAD") return response.end();
      let offset = start;
      const timer = setInterval(() => {
        response.write(payload.subarray(offset, offset + 65536));
        offset += 65536;
        if (offset >= payload.length) {
          clearInterval(timer);
          response.end();
        }
      }, 150);
      response.on("close", () => clearInterval(timer));
    });
    let api: Awaited<ReturnType<typeof startHttpRestartServer>> | undefined;
    const app = express();
    app.use((request, response, next) =>
      proxyApp(
        request.path.startsWith("/api") || request.path.startsWith("/rpc")
          ? (api?.origin ?? baseURL)
          : baseURL,
      )(request, response, next),
    );
    const ui = app.listen(0, "127.0.0.1");
    try {
      await once(ui, "listening");
      source.listen(0, "127.0.0.1");
      await once(source, "listening");
      const sourceAddress = source.address();
      const uiAddress = ui.address();
      if (
        !sourceAddress ||
        typeof sourceAddress === "string" ||
        !uiAddress ||
        typeof uiAddress === "string"
      )
        throw new Error("Missing fixture port");
      api = await startHttpRestartServer(directory);
      const { items } = await api.client.jobs.enqueue({
        items: [
          {
            url: `http://download.example:${sourceAddress.port}/retained-notes.txt`,
            downloadOptions: { transport: { multithread: false }, retry: { maxRetries: 0 } },
          },
        ],
      });
      const id = items[0].id;
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`http://127.0.0.1:${uiAddress.port}`);
      const pause = page.getByRole("button", { name: "Pause", exact: true });
      await pause.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
      await stopHttpRestartServer(api.child, true);
      api = await startHttpRestartServer(directory);
      await page.reload();
      const resume = page.getByRole("button", { name: "Resume", exact: true });
      if (width === 390) await tapVisibleTarget(resume);
      else await resume.click();
      const open = page.getByRole("button", { name: "Open", exact: true });
      await expect(open).toBeVisible({ timeout: 20_000 });
      expect(
        (await readFile(path.join(directory, "sessions", id, "source.txt"))).equals(payload),
      ).toBe(true);
      await open.click();
      const storage = page.getByRole("button", { name: "Storage", exact: true });
      await storage.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Session storage" });
      await expect(dialog).toContainText("Retained download");
      await expect(dialog.getByRole("checkbox")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await page.keyboard.press("Escape");
      await expect(storage).toBeFocused();
      await page.getByRole("tab", { name: "Downloads", exact: true }).click();
      page.once("dialog", (confirmation) => confirmation.dismiss());
      await page.getByRole("button", { name: "Delete files", exact: true }).click();
      await expect(open).toBeVisible();
      page.once("dialog", (confirmation) => confirmation.accept());
      await page.getByRole("button", { name: "Delete files", exact: true }).click();
      await expect(open).toHaveCount(0);
      await expect
        .poll(
          async () => (await stat(path.join(directory, "sessions", id)).catch(() => null)) === null,
        )
        .toBe(true);
    } finally {
      await page.close();
      if (api) await stopHttpRestartServer(api.child, true);
      source.closeAllConnections();
      ui.closeAllConnections();
      await Promise.all([
        new Promise<void>((resolve) => source.close(() => resolve())),
        new Promise<void>((resolve) => ui.close(() => resolve())),
      ]);
      await rm(directory, { recursive: true, force: true });
    }
  });
}
