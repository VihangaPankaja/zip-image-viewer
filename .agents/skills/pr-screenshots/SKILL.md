---
name: pr-screenshots
description: Use when a ZIP Image Viewer PR changes visible UI, including backend changes that alter displayed content, states or interactions.
---

# PR screenshots

Screenshots are local review evidence attached directly to a PR.

1. Read the diff and trace its user-visible effects. Backend changes need
   screenshots when they affect displayed data, loading/error states, controls
   or playback. If nothing visible changes, skip capture and explain why in
   the PR validation section. CI, docs and tooling changes alone need no images.
2. Identify the affected areas and the states needed to show the change.
   Capture those areas only. Use dark mode with the default surface and accent.
   For color/theme changes, include every affected theme, dark surface and
   accent on those same areas. Do not generate a full-app gallery.
3. Run the app in the background with `vpr dev`. Use the available browser
   tools to exercise the actual flow and capture it. Reuse an existing E2E
   fixture if the state needs deterministic data; shared fixtures live in
   `tests/review/fixtures.ts`. Label simulated progress or fixture data.
   Capture desktop and a narrow layout when the affected UI supports both;
   add tablet or ultrawide only when the change affects those layouts.
4. Show the changed interaction and its result where relevant. For a video
   seek change, show loaded video, the seek thumbnail/time, and playback after
   seeking. Check relevant keyboard, pointer and touch behavior, clipping,
   long text, status visibility and error states. Inspect every image selected
   for the PR at readable size. Fix defects and recapture after changes.
5. Keep captures in an ignored directory such as `test-results/pr-screenshots/`.
   They must match the final reviewed code. Use the GitHub PR description
   editor's attachment control to upload only the selected images. Keep its
   generated attachment Markdown and add short captions identifying the area,
   state, viewport and theme. Verify the saved PR displays each image.

If authenticated attachment upload is unavailable, report the blocker and the
local capture paths. Do not claim local paths are embedded PR images. Do not
use release assets, tags, asset branches, committed media or CI artifacts as
an attachment fallback.

Do not add screenshot package scripts, CI capture jobs, gallery manifests,
contact-sheet archives or release publishers. Existing E2E failure evidence
and container playback diagnostics are separate verification artifacts and
remain useful; they do not require a PR screenshot gallery.
