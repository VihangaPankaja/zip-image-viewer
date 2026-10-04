import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { tapVisibleTarget } from "./touch";
import {
  installReviewFixtures,
  reviewActiveTorrentJob,
} from "../review/fixtures";

test.use({ hasTouch: true, viewport: { width: 360, height: 844 } });

test("changes selected torrent file priorities and saves global bandwidth limits", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const state = await installReviewFixtures(page);
  const job = reviewActiveTorrentJob();
  state.jobs = [job];
  await page.goto("/");
  const open = page.getByRole("button", { name: "View files", exact: true });
  await open.waitFor();
  await tapVisibleTarget(open);
  const dialog = page.getByRole("dialog", { name: "Torrent files" });
  const priority = dialog.getByRole("combobox", {
    name: `Priority for ${job.torrentFiles[0].path}`,
  });
  await priority.selectOption("high");
  await expect(priority).toHaveValue("high");
  expect(state.jobs[0].torrentFiles[0].priority).toBe("high");
  await priority.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(priority).toHaveValue("low");
  expect(state.jobs[0].torrentFiles[0].priority).toBe("low");
  await expect(
    dialog.getByRole("combobox", { name: /^Priority for/ }),
  ).toHaveCount(3);
  await expect(
    dialog.getByText(/cannot make unavailable pieces appear/),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
  ).toEqual([]);
  await tapVisibleTarget(
    dialog.getByRole("button", { name: "Close", exact: true }),
  );
  await expect(dialog).toHaveCount(0);
  await tapVisibleTarget(
    page.getByRole("button", { name: "Settings", exact: true }),
  );
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings.getByText(/HTTP downloads only/)).toBeVisible();
  const download = settings.getByRole("spinbutton", {
    name: "Torrent download limit (KiB/s)",
  });
  const upload = settings.getByRole("spinbutton", {
    name: "Torrent upload limit (KiB/s)",
  });
  await download.fill("256");
  await upload.fill("64");
  await tapVisibleTarget(
    settings.getByRole("button", { name: "Save torrent limits" }),
  );
  await expect
    .poll(() => state.torrentLimits)
    .toEqual({ downloadBytesPerSec: 262144, uploadBytesPerSec: 65536 });
  await expect(
    settings.getByRole("button", { name: "Save torrent limits" }),
  ).toBeEnabled();
  expect(
    (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await tapVisibleTarget(
    settings.getByRole("button", { name: "Close", exact: true }),
  );
  await tapVisibleTarget(
    page.getByRole("button", { name: "Settings", exact: true }),
  );
  await expect(download).toHaveValue("256");
  await expect(upload).toHaveValue("64");
  await download.fill("0");
  await upload.fill("0");
  await tapVisibleTarget(
    settings.getByRole("button", { name: "Save torrent limits" }),
  );
  await expect
    .poll(() => state.torrentLimits)
    .toEqual({ downloadBytesPerSec: 0, uploadBytesPerSec: 0 });
});
