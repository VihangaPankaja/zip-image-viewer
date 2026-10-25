import type { Page } from "@playwright/test";
import { filenames, installReviewFixtures } from "./fixtures";

export const secondAudio = "05-field-recording-with-a-long-name-for-the-responsive-audio-queue.wav";

export async function installAudioReviewFixtures(page: Page, firstAudio = filenames[3]) {
  await installReviewFixtures(page);
  await page.route("**/api/sessions/*/tree", (route) =>
    route.fulfill({
      json: {
        id: new URL(route.request().url()).pathname.split("/")[3],
        firstFilePath: filenames[0],
        tree: {
          name: "Coastal collection",
          path: ".",
          type: "directory",
          children: [
            ...filenames.map((name) => (name === filenames[3] ? firstAudio : name)),
            secondAudio,
            "cover.png",
          ].map((name) => ({
            name,
            path: name,
            parentPath: ".",
            type: "file",
            extension: name.split(".").at(-1),
            size: 2400000,
            modifiedAt: Date.UTC(2026, 0, 15, 12),
          })),
        },
      },
    }),
  );
}
