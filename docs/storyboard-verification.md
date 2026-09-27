# Storyboard and selected-torrent verification

Run `pnpm run benchmark:storyboard` to generate a real H.264 clip, serve it through the media routes, and drive the delivered React scrubber in Chromium. The report defaults to `test-results/storyboard-performance.json`.

Measured on 2026-09-27 at 04:38 UTC: Windows, Intel Core i7-8565U, unthrottled loopback, a 150-second 640×360 clip, 30 frames across two sheets. Two competing FFmpeg processes occupied the shared media budget during the warm measurements.

| Measurement                        |         Result |
| ---------------------------------- | -------------: |
| Cold storyboard preview            |      1322.6 ms |
| 50 warm sheet responses, p95       |        28.9 ms |
| 238 rendered drag previews, p95    |        20.4 ms |
| Continuous native pointer drag     | 10.050 seconds |
| Playback seeks during drag         |              0 |
| New FFmpeg starts during warm drag |              0 |
| Playback before release            |      4 seconds |
| Playback after release             |  85.75 seconds |

These are local measurements, not a remote-network latency guarantee. CI reruns the same warm-preview acceptance limits. Storyboards contain at most 240 frames per video; long videos use a wider timestamp interval. Cold dragging keeps one fallback frame while the sheet is generated.

The real local-peer torrent tests verify metadata-only review, selecting the middle of three files, exact downloaded bytes, selected-only completion, bounded shared-piece overhead, and isolation from duplicate requests. Skipped partial files are excluded from the resulting explorer tree.

The roadmap marks V06, T01 and T02 complete. U04 remains in progress: browser keyboard, focus and axe checks cover the delivered controls, but actual spoken screen-reader announcements remain unverified because the native automation kernel fails with `helper_unknown_error: setup refresh had errors`. S02 remains in progress because interactive capacity reservation and aggregate disk-budget eviction are not implemented.
