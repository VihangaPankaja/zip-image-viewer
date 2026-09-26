---
name: pr-screenshots
description: Capture and publish repeatable ZIP Image Viewer review screenshots, grouped by mobile, tablet, desktop, and ultrawide in a pull request description. Use when creating or updating a PR in this repository.
---

# PR screenshots

Create a review gallery from the actual app using deterministic Playwright fixtures. Keep screenshots out of the feature branch: publish them on an immutable `pr-assets/<source-sha>-<image-hash>` branch and reference its commit in Markdown. Publishing is part of an authorized PR creation/update request; capture locally without publishing when only a preview was requested.

Run from the repository root. On Windows use `pnpm.cmd` if the PowerShell shim does not execute. Use the pinned Node version in `.nvmrc`.

1. Finish implementation, run required checks in `agent.md`, and commit the code. Captures must match the commit being reviewed.
2. Install Chromium if needed: `pnpm exec playwright install chromium`.
3. Capture: `pnpm run screenshots:pr`. This starts the Vite app on `127.0.0.1:5174`, generates local media using the installed ffmpeg and sharp, and mocks network progress. No remote download or torrent swarm is required.
4. Inspect images under `test-results/pr-screenshots/`, including every screen and theme at each device size. Fix clipping, missing content, errors, or unusable controls, then commit and recapture. Tests assert overflow and loaded media; screenshots still need visual inspection.
5. Publish: `pnpm run screenshots:publish`. Requires authenticated `gh` and Git push access to `origin`. It rejects a stale source commit, tracked changes, or an incomplete gallery. It creates a new asset branch without force-pushing or changing the feature checkout. Repeated identical captures reuse their branch. If publishing fails, retain local captures and report the failure; do not claim images are attached.
6. Append generated `test-results/pr-screenshots/pr-section.md` to the substantive PR description. Preserve the four device headings and the light/dark galleries. Use `gh pr create --body-file <file>` or `gh pr edit <number> --body-file <file>` with real newlines. Confirm the saved PR body includes working image URLs, then attach the PR to the current Codex chat.

The gallery covers 13 screens in both themes at mobile 390×844, tablet 820×1180, desktop 1440×1000, and ultrawide 2560×1080: empty downloads, HTTP/torrent progress, settings top/bottom, add downloads, explorer, image/text/video/audio/archive previews, slideshow, and the explorer dialog. Preserve the generated disclosure that progress is simulated. Real transfer integration tests remain separate.

Capture code lives in `tests/review/`, configured by `playwright.review.config.ts`. Publishing lives in `tooling/publish-pr-screenshots.mjs`. Change fixtures when flows change; do not replace app UI with static mockups or remove failing scenes to get a complete gallery. Keep asset branches while PR descriptions reference them. Temporary publisher checkouts are printed for later cleanup.
