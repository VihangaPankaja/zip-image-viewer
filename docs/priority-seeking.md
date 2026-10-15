# Long-video seeking

V03 adds a complete HLS seek timeline for videos longer than two minutes. The server encodes only the requested eight-second window, instead of encoding every earlier minute first. Short clips retain their existing sequential HLS path.

Windows publish only after FFmpeg exits and the playlist contains the expected complete, positive-duration segments. Each window has an initialization map and an explicit discontinuity boundary. The encoder normalizes window video to 30 fps; audio uses the same window boundaries. Compatible initialization files share a hard link. First-frame and tail probes exclude container-only AAC padding from the video timeline. When audio outlasts the picture, the tail probe searches progressively earlier until it finds the final video frame. Short audio tracks are padded with silence within each bounded window.

Requests for the same window share one job. Cancelling a request releases its consumer; the encoder stops only when the last consumer leaves. A foreground viewer promotes a queued background job without rejecting its other consumers. All probes and encoders use the existing shared two-process limit. Session cleanup drains media work, and derived output remains subject to the existing cache budget.

Retained torrents begin preparing their lowest video rendition and default audio after indexing and restart restoration. Long videos prepare one background window at a time; short clips use the existing sequential encoder. Both leave capacity for interactive work. Other audio languages in long videos remain available on demand. Temporary long videos generate windows on demand.

## Verification

Run `pnpm run benchmark:seek` for the isolated Chromium benchmark. It creates an actual 60-minute 640×360 H.264 source with two AAC languages, then checks a cold seek to 48:00, switching audio across a window boundary, and 30 prepared seeks outside the browser buffer on each network profile. The controlled 10 Mbps pass disables the HTTP cache. Measurements use `requestVideoFrameCallback`, from seek assignment to a displayed target frame. The JSON report is written to `test-results/priority-seek-metrics.json` and attached to the Playwright result.

The enforced targets are under three seconds for the cold seek, prepared p95 under 500 ms on loopback, and p95 under 1.5 seconds at 10 Mbps. CI runs this benchmark separately from other browser tests so competing encoders do not invalidate the measurement.

Measured on Windows 10.0.26300 with an Intel Core i7-8565U, using the full-length 640×360 fixture on 2026-10-15:

| Scenario                            | Samples | Displayed-frame latency |
| ----------------------------------- | ------: | ----------------------: |
| Cold seek to 48:00                  |       1 |                 2813 ms |
| Prepared, loopback                  |      30 |  p50 240 ms, p95 319 ms |
| Prepared, 10 Mbps and 10 ms latency |      30 |  p50 559 ms, p95 638 ms |

The ordinary E2E suite separately exercises two viewers at different playheads, pointer seeking, 360 px touch seeking and keyboard commits. Runtime tests cover exact and fractional video endings, AAC padding, window coalescing, promotion, cancellation, cached replay and retained preparation through the final window. The PR gallery includes the loaded hour-long timeline, a seek thumbnail and time preview, and decoded playback after committing the seek, in both themes at all four review sizes.

The fixture repeats a locally generated 16-second seed using stream copy. It is a full-length indexed media file, not a shortened clip with fake duration metadata. The timings characterize this fixture and machine; they do not establish a 4K, HDR or hardware-encoding performance claim.
