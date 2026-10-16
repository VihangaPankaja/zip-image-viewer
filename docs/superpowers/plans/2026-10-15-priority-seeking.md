# V03 priority seeking implementation plan

**Goal:** Complete V03, including a cold seek to 80% of a real 60-minute video, repeat seeking, shared-viewer cancellation, retained low-quality preparation, and review evidence.

**Design:** Preserve sequential HLS for clips of at most two minutes. Longer videos publish a full-duration VOD timeline. Two-segment, eight-second windows encode from the requested time and publish atomically after FFmpeg completes. Each window has its own initialization map and a discontinuity boundary, so independent encode timestamps never masquerade as continuous timestamps. Window video uses constant 30 fps to keep advertised four-second boundaries exact. Alternate audio uses the same window boundaries. Only committed output is served.

**Constraints:** Existing shared two-process budget, original-file preservation, cache protection, and session shutdown apply. Retained videos prepare the lowest rendition sequentially in background windows. Interactive requests coalesce by window, count consumers, and cancel abandoned work without cancelling another viewer. No additional dependencies or unrelated UI redesign.

## Step 1: Window engine and HTTP delivery

- [x] Write failing tests for complete timelines, bounded FFmpeg arguments, atomic publication, coalescing and cancellation.
- [x] Implement window encoding, full manifests, validated index routes, and low-rendition retained preparation.
- [x] Verify focused tests and all existing tests. Run format, lint, typecheck, build, then format immediately before the implementation commit.

## Step 2: Real playback, release and review

- [x] Generate a real 60-minute deterministic source and prove cold seeking, repeated prepared seeks, A/V decode, window crossing, alternate audio, two viewers and cancellation.
- [x] Add desktop/mobile browser flows and feature interaction/result screenshots to the complete existing gallery.
- [x] Update the roadmap and version. Run all required checks, coverage and all browser projects. Commit after required checks and immediate formatting.

Release gates: capture and inspect every gallery image, publish immutable assets, open and link the PR, address valid scope-related bot comments, and monitor all checks on the final commit until successful. The PR gallery, review threads and check results record these gates after the implementation commits.

## Review focus

- Final fractional windows must not extend beyond source duration or request nonexistent segments.
- Aborting one viewer must preserve another viewer's shared window.
- Cancellation, failures and eviction must permit a clean retry and must never serve partial output.
- Window boundaries must preserve A/V alignment and full-duration seek coordinates.
- Retained background preparation must leave interactive encoder capacity available.

The user requested autonomous task selection and completion in one go. Execution proceeds in this existing isolated T3 worktree under that authorization.
