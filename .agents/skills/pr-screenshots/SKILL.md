---
name: pr-screenshots
description: Capture and publish repeatable ZIP Image Viewer review screenshots, grouped by mobile, tablet, desktop, and ultrawide in a pull request description. Use when creating or updating a PR in this repository.
---

# PR screenshots

Create a review gallery from the actual app using deterministic Playwright fixtures. Keep screenshots out of Git branches. Publish immutable, content-prefixed files to the `pr-review-assets` prerelease and embed their URLs in the PR description. Never create screenshot-only branches. Publishing is part of an authorized PR creation/update request; capture locally without publishing when only a preview was requested.

Run from the repository root. Without a global CLI, use `pnpm exec vp run <script>` after a pinned Node/pnpm install (`pnpm.cmd` on Windows). Use the pinned Node version in `.node-version`.

1. Finish implementation, run required checks in `AGENTS.md`, and commit the code. For an authorized PR publish, push the source branch before publishing so GitHub can resolve the source commit if the shared asset release must be created. Captures must match the commit being reviewed. A local preview needs no push.
2. Install Chromium if needed: `vp exec playwright install chromium`.
3. Capture: `vpr screenshots:pr`. This starts the Vite app on `127.0.0.1:5174`, generates local media using the installed ffmpeg and sharp, and mocks network progress. No remote download or torrent swarm is required.
4. Inspect images under `test-results/pr-screenshots/`, including every screen and theme at each device size. Fix clipping, missing content, errors, or unusable controls, then commit and recapture. Tests assert overflow and loaded media; screenshots still need visual inspection.
5. Publish: set `PR_SCREENSHOT_FEATURED` to a comma-separated list of gallery screen names showing this PR's changes, then run `vpr screenshots:publish`. Featured screens appear first within each device/theme gallery. Requires authenticated `gh` with release write access. It rejects stale captures, tracked changes or an incomplete gallery. It uploads featured images, contact sheets and a ZIP containing every original and full-resolution gallery to the shared prerelease. Asset names include the source commit and content hash; retries reuse existing assets without overwriting. Each public URL must pass an HTTP check before the PR section is written. If publishing fails, retain local captures and report the failure; do not claim images are attached. The release is media hosting, not a product release, and must never be marked latest.
6. Append generated `test-results/pr-screenshots/pr-section.md` to the substantive PR description. Preserve the four device headings and the light/dark galleries. Use `gh pr create --body-file <file>` or `gh pr edit <number> --body-file <file>` with real newlines. Confirm the saved PR body includes working image URLs, then attach the PR to the current Codex chat.

The gallery covers the complete scene set in both themes at mobile 390×844, tablet 820×1180, desktop 1440×1000, and ultrawide 2560×1080: downloads, torrent file states, settings, explorer, media previews, video interactions, slideshow, and dialogs. Preserve the generated disclosure that progress is simulated. Real transfer integration tests remain separate.

GitHub limits each release to 1,000 assets. If publishing reports the shared release is full, set `PR_SCREENSHOT_RELEASE=pr-review-assets-2` or the next numbered tag and retry. Keep older releases and their assets so existing PR descriptions remain readable.

Capture code lives in `tests/review/`, configured by `playwright.review.config.ts`. Publishing lives in `tooling/publish-pr-screenshots.mjs`. Change fixtures when flows change; do not replace app UI with static mockups or remove failing scenes to get a complete gallery. Keep release assets while PRs reference them. Before removing historical asset branches, retain their exact commits with archival tags or migrate all referenced media and verify the PR URLs. Never delete a referenced commit's last durable ref without preserving the media.
