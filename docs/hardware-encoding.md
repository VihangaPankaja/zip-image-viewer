# Optional hardware HLS encoding

S03 is complete under the scope approved by the user on 2026-10-17: implement
and verify what existing hardware and free public-repository CI can support.
Successful GPU encoding inside Docker and a GPU-container performance gain are
explicitly outside that scope. No paid runner or extra hardware is required.

## Server configuration

`HLS_ENCODER` accepts the following values. An invalid value fails configuration
validation instead of silently choosing a different encoder.

| Value        | Behavior                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| `cpu`        | Default. Use the existing libx264 veryfast preset without hardware probes.                                |
| `auto`       | Inspect bundled FFmpeg encoders, then test Quick Sync followed by NVENC. Use the first accessible device. |
| `h264_qsv`   | Try Intel Quick Sync; fall back to libx264 if unavailable.                                                |
| `h264_nvenc` | Try NVIDIA NVENC; fall back to libx264 if unavailable.                                                    |

The existing `ffmpeg-static` dependency also honors `FFMPEG_BIN`. Set it to the
absolute path of an existing system or mounted FFmpeg executable to use a custom
build. Some supplied binaries, including the tested Linux container binary, do
not compile Quick Sync or NVENC; a GPU on the host alone will not change that.
The server probes the executable actually selected by this override. It does
not download drivers or install another FFmpeg at runtime.

Detection is lazy and has a shared ten-second deadline. Device checks run inside
the existing two-process media budget. The result is cached for that runtime;
restart the server after changing device availability. A real hardware encode
failure also disables hardware attempts for that runtime and retries on CPU.
Session deletion and seek cancellation drain the child process and do not trigger
a CPU retry. Audio-only renditions do not probe a video encoder.

The bitrate ladder, Main profile and four-second IDR boundaries are shared with
CPU output. Quick Sync uses its veryfast preset and NV12 input; NVENC uses p4.
Both retain the existing bounded-window frame rate and disabled B-frames.

Hardware attempts write into temporary directories. Only successful media is
published, with the playlist last. Failed attempts are removed before CPU retry.
This preserves the existing window publication rules and prevents mixed hardware
and CPU initialization files. For clips up to two minutes, hardware mode waits
for the complete clip before publishing; default CPU mode stays progressive.
Native HLS playlist requests wait for published output or job completion and stop
waiting when the client disconnects. HLS.js advertises preparation-retry support
through `X-HLS-Preparation-Retry: 1`; those requests wait briefly, then return
HTTP 425 while encoding is queued or running. The HLS.js player retries that
preparation status beyond its normal retry budget, so a slow staged encode can
finish without a fatal startup error. Failed jobs return HTTP 503 and retain
the player's normal bounded error retries. No empty playlist is published.

Look for `video.encoder.selected`, `video.encoder.unavailable` and
`video.encoder.fallback` in server logs. Fallback messages distinguish unavailable
hardware from an encode failure. Hardware acceleration is opt-in because driver
startup and output tradeoffs can outweigh its speed advantage.

## Native Windows measurement

The bundled FFmpeg was tested on Windows with an Intel Core i7-8565U, Intel UHD
620 and NVIDIA MX150 on 2026-10-17. Node was 26.8.1 for this measurement; project
validation uses the pinned Node 26.7.0. The source is a locally generated,
lossless FFV1 1280×720, 30 fps, twelve-second test pattern with PCM 48 kHz audio.
Each mode encodes that same source three times. Warm time is the mean of samples
two and three; the cold time includes capability detection.

| Requested mode | Actual encoder   | Cold ms | Warm mean ms | Output bytes |     SSIM |
| -------------- | ---------------- | ------: | -----------: | -----------: | -------: |
| CPU            | libx264          |    2249 |         2324 |    4,403,687 | 0.975278 |
| Quick Sync     | h264_qsv         |    2773 |         1805 |    4,554,859 | 0.973972 |
| NVENC          | libx264 fallback |    2757 |         3096 |    4,408,421 | 0.975290 |

Quick Sync reduced warm elapsed time by about 22% on this fixture, while producing
about 3.4% more bytes and a slightly lower SSIM. Its cold encode was slower than
CPU. The fallback row is another CPU run under different machine load, not an
NVENC performance measurement. These figures are a local baseline, not a general
quality or throughput guarantee.

All outputs contained three complete four-second segments with Main-profile
H.264 and AAC. FFmpeg decoded a frame after seeking to nine seconds and decoded
an independently generated window starting at eight seconds. SSIM compares the
full decoded output with the same lossless source. The browser also played and
sought native Quick Sync output. NVENC was present in FFmpeg but device access
failed and produced playable CPU output. The new screenshot gallery scenes show
real opt-in playback and a committed seek, with the selected/fallback events in
the capture manifest.

## Reproduction and free CI

```sh
pnpm run benchmark:encoding -- --output test-results/video-encoding.json
```

The JSON report records requested and actual modes, three encode timings, byte
size, SSIM, codec identifiers, decoded seek/window assertions and encoder events.
The normal CI browser-check job runs this benchmark and uploads its report. No
speed or hardware-success assertion is imposed on a machine without a GPU.
The production container HLS smoke requests automatic hardware selection, checks
for an explicit selected/fallback event, then decodes a seek from its real output.
The existing production-container browser smoke remains required.

Docker GPU access requires matching host drivers, device passthrough, a suitable
FFmpeg build and permissions for the app user. Setting `HLS_ENCODER` alone does
not provide these. The default image remains CPU-capable and falls back when
they are missing. The local WSL host has Docker, but no usable Quick Sync render
device; its NVENC probe reports an unsupported device. Only CPU fallback can be
verified there. Hardware-backed Docker playback and throughput remain unverified
and are not represented as passing tests.

Encoder option references: [FFmpeg QSV documentation](https://ffmpeg.org/ffmpeg-codecs.html#QSV-Encoders)
and [FFmpeg NVENC options](https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/nvenc_h264.c).
