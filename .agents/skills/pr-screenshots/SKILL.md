---
name: pr-screenshots
description: Capture, inspect and publish the ZIP Image Viewer gallery when creating or updating a PR.
---

# PR screenshots

Run from the repository root after setup. Capture uses local media and simulated
HTTP/torrent progress at `127.0.0.1:5174`. It needs no public torrent swarm.

1. Finish checks and commit. Captures must match the reviewed commit.
2. Install Chromium if needed with `vp exec playwright install chromium`.
   Run `vpr screenshots:pr`.
3. Inspect every screen in `test-results/pr-screenshots/`, in both themes at
   Mobile, Tablet, Desktop and Ultrawide sizes. Fix clipping, missing content
   and unusable controls, then commit and recapture.
4. Add interaction and result scenes for changed UI. Video seek changes must
   show loaded video, the seek thumbnail/time, and playback after the seek.
   Keep populated file/download/torrent scenes and the simulated-progress label.
5. Push the source commit before publishing. Set `PR_SCREENSHOT_FEATURED` to
   comma-separated relevant scene names, then run `vpr screenshots:publish`.
   Requires authenticated `gh` with release write access. For a local preview,
   stop after inspection.
6. Append `test-results/pr-screenshots/pr-section.md` to the PR description with
   `gh pr create --body-file` or `gh pr edit --body-file`. Keep all four device
   sections, both themes and the disclosure. Verify saved image URLs and link
   the PR to the current thread.

The publisher rejects dirty, stale or incomplete captures. It uploads featured
images, contact sheets and an archive of every original to the
`pr-review-assets` prerelease, verifies URLs, and writes the PR section.
Do not create screenshot branches or commit media.

If the release reaches 1,000 assets, set `PR_SCREENSHOT_RELEASE` to the next
`pr-review-assets-N` tag and retry. Keep assets and durable refs used by older
PRs. Report publishing failures without claiming the gallery is attached.

Fixtures live in `tests/review/`, configuration in `playwright.review.config.ts`,
and publishing in `tooling/publish-pr-screenshots.mjs`. Update fixtures with app
flows; do not replace app UI with mockups or remove failing scenes.
