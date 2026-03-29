# ZIP Image Viewer

Browse a public file or archive URL through a modern web UI running from a single Docker container on port `8080`.

## What It Does

- paste a public file or archive URL into the app
- backend downloads it into a temporary session workspace with resilient retries/resume
- archive contents (`zip`, `rar`, `7z`, `tar` families) are extracted safely and shown as a sidebar file tree
- images open in the preview panel with left and right arrow navigation for sibling images in the same folder
- videos such as `mp4`, `webm`, `mov`, `m4v`, and `ogv` open in an inline player with range-based streaming support and generated quality variants when available
- audio files such as `mp3`, `wav`, `ogg`, `aac`, and `m4a` open in an inline player
- text-style files such as `txt`, `md`, `json`, `csv`, `js`, `ts`, `html`, and `css` open in a text preview
- dark mode and light mode are both available from the interface toggle
- archive loading shows real-time download and extraction progress in the hero panel over websocket
- download panel shows live speed, ETA, retry state, mode, and thread details
- download settings are configurable from the UI (auto/single/segmented mode, threads, resume, finite retries or unlimited)
- loaded archives can be cleared directly from the app without reloading the page
- sessions are cleaned up automatically after inactivity

## Tech Stack

- `Express` server for the API and static asset hosting
- `React + Vite` frontend for the browsing UI
- `unzipper` and `7zip-bin` for multi-format archive extraction
- `aria2c` runtime binary for resilient segmented downloads
- `ffmpeg` runtime binary for video quality variant generation
- single Docker image for portable deployment

## Local Development

Requirements:

- Node.js `20+` recommended
- npm

Install and run:

```bash
npm install
npm run dev
```

- frontend dev server runs on `5173`
- backend runs on `8080`
- Vite proxies `/api` requests to the backend

## Production Run With Docker

Build and run locally:

```bash
docker build -t zip-image-viewer .
docker run -p 8080:8080 zip-image-viewer
```

Use the published Docker Hub image:

```bash
docker pull vihangapankaja/zip-image-viewer:latest
docker run -p 8080:8080 vihangapankaja/zip-image-viewer:latest
```

Versioned image example:

```bash
docker pull vihangapankaja/zip-image-viewer:1.0.6
docker run -p 8080:8080 vihangapankaja/zip-image-viewer:1.0.6
```

Open `http://localhost:8080`.

## Behavior Notes

- public `http` and `https` file URLs are supported
- if the file is larger than `1 GB`, the app asks whether to continue
- extracted files are stored only in temporary server session folders
- file loading runs as an async background job with live progress updates over websocket
- download progress speed monitoring is decoupled from transfer chunks, so stalled downloads report speed/ETA changes correctly
- auto mode defaults to 3 simultaneous segmented threads when the source supports range requests
- resumable downloads and retry with backoff are supported for transient failures (including unlimited retry mode)
- unsupported binary files can still be opened as raw files

## Sample Public URLs

You can test with any direct public file URL. A few archive examples:

- `https://github.com/jquery/jquery/archive/refs/heads/main.zip`
- `https://github.com/twbs/icons/archive/refs/heads/main.zip`
- `https://github.com/google/fonts/archive/refs/heads/main.zip`

Note: some large repositories may take longer to download and unpack.

## API Endpoints

- `POST /api/sessions` start an async file/archive job from a URL (supports `downloadSettings`)
- `GET /api/session-jobs/:id` fetch current archive job state
- `WS /ws/jobs?jobId=...` subscribe to live archive progress events
- `POST /api/session-jobs/:id/confirm` continue an oversized archive job
- `DELETE /api/session-jobs/:id` cancel an active archive job
- `GET /api/sessions/:id/tree` fetch the extracted tree for a ready session
- `GET /api/sessions/:id/file?path=...` stream a file
- `DELETE /api/sessions/:id` remove a loaded session manually
- `GET /health` basic server health response
