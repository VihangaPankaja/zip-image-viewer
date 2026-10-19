# Media Workspace

A type-safe workspace for downloading public archives and media, browsing their
contents, and previewing files while work continues in the background.

## What changed in 2.0

- A unified desktop workspace replaces the old Download / Preview / Explorer
  tab flow. Sessions, files, preview, and metadata remain visible together.
- Batch enqueue accepts 1–50 newline-separated public URLs. The queue runs at
  most two downloads concurrently and keeps completed sessions available.
- The shared Zod + oRPC contract gives the React client and Express server one
  validated API surface with typed errors.
- Video uses adaptive fMP4 HLS. A source-aware rendition ladder is generated on
  demand, `hls.js` selects quality automatically, and users can choose a level.
- Strict TypeScript, typed Oxlint, Oxfmt, Fallow, Vite+ hooks, Vitest, Playwright,
  Axe, and coverage reporting are part of the normal quality workflow.

## Torrent playback while downloading

In Downloads, choose **View files**, then **Play now** for a selected video.
Early playback supports fast-start MP4/M4V files with a leading movie index and
browser-compatible codecs. Other containers and MP4 files with a tail index offer
**Download first**, which returns to the file list and keeps the download running.

Playback reads only hash-verified pieces. Seeking may wait for peers to supply
missing pieces and resumes when they return. An idle read expires after two minutes;
use **Retry playback** or finish downloading if peers remain unavailable. Closing the
preview keeps the transfer running; pausing or cancelling it stops playback. Playback
keeps its position through indexing and download completion.

## Long-video seeking

Videos longer than two minutes have a full-duration adaptive seek timeline.
Seeking prepares the requested eight-second window without waiting for earlier
minutes to encode. Retained videos prepare their lowest rendition and default
audio in the background after indexing and restart recovery. The existing
original, remux and short-video playback paths remain available.

Adaptive playback prepares the lowest quality at startup. Before serving a
higher-quality window, it prepares every lower quality at that same position,
so an Auto downshift can use cached media. It also warms the next eight-second
window through the current quality on the bounded background encoder lane.
Viewers at different positions share completed windows and keep independent
foreground requests; `hls.js` still makes bandwidth and buffer decisions.

See [long-video seeking and verification](docs/priority-seeking.md) and run
`vpr benchmark:seek` for the isolated cold/prepared seek benchmark.

## Optional hardware encoding

CPU encoding remains the default. Set `HLS_ENCODER=auto`, `h264_qsv` or
`h264_nvenc` on the server to opt into an available Intel Quick Sync or NVIDIA
H.264 encoder. The bundled FFmpeg must support the encoder and have access to
its device and drivers. Detection runs on the first video encode, within the
existing media-work limit. `FFMPEG_BIN` can select an existing custom FFmpeg build.
Unavailable devices and failed hardware attempts
produce a `video.encoder.fallback` log and retry with CPU encoding.

Hardware output is staged until the clip or eight-second seek window completes,
so a failed attempt cannot expose incompatible partial media. This can delay
startup for short clips, which normally publish progressively on CPU. Original
playback, remuxing, audio and thumbnails keep their existing behavior.

Run `vpr benchmark:encoding --output test-results/video-encoding.json`
to compare the same fixture's encode time, SSIM, output size and decoded seeks.
It also runs without a GPU and labels CPU fallback explicitly. See
[hardware encoding verification](docs/hardware-encoding.md) for the measured
Windows result, deployment requirements and the accepted no-cost test scope.

## Audio languages and captions

Videos with multiple audio tracks open in adaptive playback. Choose an audio
language without restarting the video or changing its position and paused state.
Original and remux playback use browser-native audio selection when supported;
otherwise choose **Switch to adaptive playback** to select a language.

Choose an embedded text subtitle language or load a local WebVTT/SRT file.
Captions support on/off, size and a timing offset. Local files stay in the
browser. Embedded text tracks convert to WebVTT on the server, with a 2 MiB
output limit and a 30-second conversion timeout. Bitmap subtitle tracks are
not offered. Failed or malformed captions show an error and can be replaced
without closing the video.

## Requirements

Install [Vite+](https://viteplus.dev/guide/), then open a new terminal:

```powershell
# Windows
irm https://vite.plus/ps1 | iex
```

```sh
# macOS / Linux
curl -fsSL https://vite.plus | bash
```

```sh
vp install --frozen-lockfile
vpr dev
```

Vite+ selects Node 26.7.0 from `.node-version` and pnpm 12.1.0 from
`package.json#packageManager`. FFmpeg and 7-Zip come from project dependencies.
Installation enables staged formatting/lint and pre-push type/test/Fallow checks.

[VS Code integration](https://viteplus.dev/guide/ide-integration) recommends
the Vite+ extension pack and uses Oxc for formatting and
fixes on save. Its Scripts panel uses `vp`; the CLI commands below also work
from a terminal.

A global CLI is optional. With those Node/pnpm versions already available,
run `pnpm install --frozen-lockfile`, then `pnpm exec vp run dev`.
Use `pnpm exec vp run <script>` for the commands below (`pnpm.cmd` on Windows).
See the [toolchain record](docs/toolchain-baseline.md) for exact pins, lint
parity, measurements and rollback.

- Client: <http://localhost:5173>
- API: <http://localhost:8080>

## Quality commands

```bash
vpr format:check
vpr lint
vpr typecheck
vpr test:unit
vpr test:integration
vpr test:component
vpr test:ui
vpr test:coverage
vp exec playwright install
vpr test:e2e
vpr fallow:health
vpr fallow:dead
vpr fallow:duplicates
vpr fallow:coverage-gaps
vpr fallow:targets
vpr fallow:audit
vpr build
```

`vpr quality` runs the non-browser pull-request gate. Playwright covers the
desktop workspace, mobile pane navigation, and automated Axe accessibility
checks. Coverage output is written to `coverage/`.

Vite+ owns formatting, typed lint, tests and client builds in `vite.config.ts`.
TypeScript 7 checks the client, server and test projects. `vpr build` emits
both client and server; `vp build` alone emits only the client.

## Production

```bash
vpr build
vpr start
```

Or use the hardened multi-stage image:

```bash
docker build -t media-workspace .
docker run --init -p 8080:8080 -v media-workspace-downloads:/app/sessions media-workspace
```

Torrent downloads are retained in `sessions/`, alongside transactional SQLite metadata.
During restart verification, `/health` returns HTTP 200 with `ready: false` so large
retained downloads do not cause liveness restarts. Application routes return HTTP 503
until verification finishes and `/health` reports `ready: true`.
Mount `/app/sessions` as a persistent volume when running in Docker. Keep the database
and torrent payloads together when backing up or moving storage. On startup, the
server hashes existing torrent pieces before rebuilding sessions. Interrupted or
damaged downloads return paused and can be resumed. In View files, use Download
skipped files to add selections. Close session releases the viewer; Delete files
permanently removes the torrent and its payloads after confirmation. HTTP downloads
continue to use temporary sessions and the existing expiry policy.

Open a session and choose **Storage** to see original files, previews/thumbnails,
and transcodes/remuxes separately. Totals count hardlinked files once and exclude
symbolic links. **Clear preview & transcode cache** keeps originals and regenerates
derived media when needed. Cleanup refuses active media work and HLS playback used
within the last 30 seconds. HTTP sessions can use **Keep until the server stops** to
survive viewer close and expiry; these pins do not survive server shutdown. Retained
torrents survive restarts until explicitly deleted. **Delete session files** explains
the deletion scope before removing files and their queue entry. Removing a completed
HTTP item from the queue leaves its session files subject to that retention policy.

For torrents containing archives, the first selected archive stays extracted at the
same paths when more files are added. Added siblings appear under `Torrent files`
(with a suffix if the archive already uses that name). Original payloads stay retained.

Downloads and extracted archives are limited to 10 GiB and 10,000 entries. The
server checks free disk space before work starts, reserves space across active
downloads on the same volume, and keeps 64 MiB of headroom. Unknown-length and
encoded HTTP responses reserve the unclaimed capacity up to 10 GiB until the
transfer finishes; streaming checks enforce that admitted disk budget. Segmented downloads also reserve space
for merging their parts. Gzip extraction also reserves unclaimed capacity because
its size hint can omit earlier members. Non-ZIP entries stream through the size
and storage checks before bytes reach the filesystem. Each entry is extracted
separately, so solid archives may take longer. Archive expansion is checked before extraction; unsafe
paths and links are rejected. Resource-limit failures stop the affected job and
leave other retained downloads available.

Retries remove unusable owned partials before admission and credit reusable
regular files toward the remaining footprint. Unrelated retained files are preserved.

Captured archive metadata and extraction diagnostics are limited to 10 MiB.

Torrent HTTP web seeds and magnet `xs` metadata fallbacks are disabled because
they bypass the guarded HTTP downloader. Direct `.torrent` URLs still use the
bounded metadata request; torrent transfers continue through peers and DHT.

## Architecture

The React application is organized by workspace and player features. TanStack
Query owns remote queue/session state, TanStack Table renders the file view,
TanStack Virtual keeps large session lists responsive, and resizable panels form
the desktop layout.

The server separates contracts, application services, HTTP/RPC adapters,
infrastructure, and domain models. Downloads and transcodes have independent
concurrency limits. HLS renditions are lazy and source-bounded rather than being
pre-generated during download.

See [docs/architecture.md](docs/architecture.md) for boundaries and request
flows, and [docs/project-structure.md](docs/project-structure.md) for the source
map.

## Core API

- `POST /rpc/*` - typed oRPC list, batch enqueue, cancel, and retry procedures
- `GET /api/session-jobs` - queue snapshots
- `GET /api/session-jobs/:id/video/info?fileId=...` - selected-video early-playback eligibility
- `GET /api/session-jobs/:id/video/stream?fileId=...` - verified MP4 byte ranges, waiting for missing pieces
- `GET /api/sessions` - ready session summaries
- `POST /api/sessions` - legacy-compatible single enqueue
- `GET /api/sessions/:id/tree` - extracted file tree
- `GET /api/sessions/:id/file?path=...` - range/raw file serving
- `GET /api/sessions/:id/video/hls/master.m3u8?path=...` - adaptive HLS master
- `WS /ws/jobs?jobId=...` - realtime job progress

Only public HTTP(S) URLs and safe relative paths pass contract validation.
Submitted magnets cannot contain direct peer hints (`x.pe`). Tracker and DHT
discovery still work; this restriction does not isolate BitTorrent network traffic.
