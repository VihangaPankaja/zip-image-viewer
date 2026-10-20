# Configuration and limits

Set environment variables before starting the server. Invalid port, cache budget
or encoder values fail startup. Defaults live in `server/config/runtimeConstants.ts`.

| Variable                   | Default            | Purpose                                                                    |
| -------------------------- | ------------------ | -------------------------------------------------------------------------- |
| `PORT`                     | `8080`             | HTTP and WebSocket listening port.                                         |
| `MEDIA_CACHE_BUDGET_BYTES` | `1073741824`       | Budget for generated media across sessions, in bytes.                      |
| `HLS_ENCODER`              | `cpu`              | Video encoder preference. See below.                                       |
| `FFMPEG_BIN`               | Bundled executable | Absolute path to a custom FFmpeg executable, supported by `ffmpeg-static`. |
| `NODE_ENV`                 | Unset              | Use `production` for a deployed server.                                    |

Download concurrency, HTTP transport options and torrent bandwidth limits are
available in Settings. Appearance, sorting, visible columns and keyboard
preferences are stored in the browser. The server listens on all interfaces.

## Hardware encoding

CPU encoding is the default. Set `HLS_ENCODER` to opt into hardware:

| Value        | Behavior                                           |
| ------------ | -------------------------------------------------- |
| `cpu`        | Use libx264 without probing hardware.              |
| `auto`       | Try Intel Quick Sync, then NVIDIA NVENC, then CPU. |
| `h264_qsv`   | Try Quick Sync, then CPU.                          |
| `h264_nvenc` | Try NVENC, then CPU.                               |

FFmpeg must include the encoder, and the app user needs device access and matching
drivers. A GPU alone is insufficient. Use `FFMPEG_BIN` if the bundled executable
lacks the encoder. Docker also needs device passthrough and permissions.

Detection runs on the first video encode and is cached until restart. Failed
hardware encodes retry on CPU. Logs use `video.encoder.selected`,
`video.encoder.unavailable` and `video.encoder.fallback` to show the outcome.
Hardware output publishes only after a clip or seek window finishes, so short
clips may start later than progressive CPU output. Hardware does not affect
original playback, remuxing, audio-only work or thumbnails.

Use the [encoder benchmark](../development/testing.md#media-benchmarks) to check
output on your machine. Confirm the actual encoder before interpreting timings.

## Resource limits

| Resource                      | Limit                                   |
| ----------------------------- | --------------------------------------- |
| Batch                         | 50 download entries.                    |
| Download or extracted content | 10 GiB and 10,000 entries.              |
| Free disk headroom            | 64 MiB beyond active reservations.      |
| Temporary session inactivity  | 30 minutes, checked every five minutes. |
| Inline text preview           | 2 MiB.                                  |
| Embedded subtitle conversion  | 2 MiB output and 30 seconds.            |

Unknown-length downloads reserve available capacity up to the size limit.
Archive expansion and streamed bytes must fit the admitted disk budget.
Unsafe archive paths and links are rejected. Non-ZIP archives extract each entry
separately, so solid archives can take longer.

Only public HTTP/HTTPS URLs pass download validation. Redirects use the same
policy. Torrent HTTP web seeds and magnet `xs` metadata fallbacks are disabled;
direct `.torrent` links still use the guarded downloader. Magnets cannot contain
direct peer hints. Peer and DHT traffic still need appropriate network controls.
