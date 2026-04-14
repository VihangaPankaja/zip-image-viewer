# ZIP Image Viewer

Fast web app for opening public archive/file URLs, browsing extracted content, and streaming media with realtime progress.

## Quick Start

Requirements:

- Node.js 20+
- npm

Run locally:

```bash
npm install
npm run dev
```

- frontend: <http://localhost:5173>
- backend: <http://localhost:8080>

Production build:

```bash
npm run build
npm start
```

Docker:

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
docker pull vihangapankaja/zip-image-viewer:1.2.3
docker run -p 8080:8080 vihangapankaja/zip-image-viewer:1.2.3
```

Open `http://localhost:8080`.

## Highlights

- Realtime job updates over WebSocket
- Segmented/resumable downloader with retry and ETA/speed monitoring
- Tabbed UX: Download, Preview, Explorer
- Explorer table with sortable metadata and configurable columns
- Inline image/text/audio/video previews
- Live preview for direct video URLs while bytes are still downloading
- On-demand video quality streaming via ffmpeg (no pre-generated variants)

## Architecture Snapshot

- Frontend page shell:
  - `client/src/pages/AppPage.tsx` is a thin composition shell.
  - `client/src/pages/AppPageContainer.tsx` owns orchestration and state wiring.
- Frontend controller hooks:
  - `client/src/hooks/useSessionLifecycle.ts`
  - `client/src/hooks/usePreviewSelection.ts`
  - `client/src/hooks/useTextPreview.ts`
  - `client/src/hooks/useImagePreviewCache.ts`
  - `client/src/hooks/useVideoPlaybackController.ts`
  - `client/src/hooks/useKeyboardShortcuts.ts`
- Preview UI boundaries:
  - Preview components live under `client/src/components/Preview/`.
  - Page wrappers stay under `client/src/components/Pages/`.
- Backend runtime layering:
  - `server/index.ts` is the bootstrap entrypoint.
  - `server/appRuntime.ts` is a runtime shell.
  - `server/runtimeComposition.ts` contains runtime composition/orchestration.
  - `server/bootstrap/container.ts` provides containerized runtime dependencies.
  - `server/application/jobs/sessionJobQueue.ts` contains session queue application logic.
  - `server/infrastructure/runtime/runtimePrimitives.ts` contains shared runtime primitives.

## Video Quality Behavior

- Videos are stored as original files only.
- Quality variants are NOT generated during download/extract.
- When a user opens a video, quality options are fetched dynamically based on source resolution.
- Quality options include `Original` plus valid levels up to source height:
  - 360p, 480p, 720p, 1080p, 1440p, 2160p
- Default quality:
  - 720p if source is at least 720p
  - Original if source is below 720p
- Reduced qualities are transcoded in realtime through ffmpeg only when selected.

## API (Core)

- `POST /api/sessions` start async load job
- `GET /api/session-jobs/:id` get job snapshot
- `WS /ws/jobs?jobId=...` realtime job updates
- `GET /api/session-jobs/:id/stream` stream currently downloaded bytes for active direct job
- `GET /api/sessions/:id/tree` get ready explorer tree
- `GET /api/sessions/:id/file?path=...` range/raw file serving
- `GET /api/sessions/:id/video/qualities?path=...` get available quality options for selected video
- `GET /api/sessions/:id/video/stream?path=...&quality=...` realtime ffmpeg transcode stream

## Project Structure

See [docs/project-structure.md](docs/project-structure.md).
