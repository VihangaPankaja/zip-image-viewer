# Project Structure

## Root

- client/: React frontend (viewer UI, tabs, explorer, player)
- server/: Express backend (download, extraction, streaming, realtime)
- docs/: project documentation
- build/: compiled server output
- dist/: built client assets

## Frontend (client/src)

- App.tsx: root app bootstrap
- pages/AppPage.tsx: thin page shell
- pages/AppPageContainer.tsx: page orchestration and state composition
- components/: focused UI blocks
  - WorkspaceTabs.tsx: Download/Preview/Explorer tabs
  - ExplorerTablePanel.tsx: file-manager style explorer table
  - GlobalSettingsSheet.tsx: global settings modal
  - Preview/: preview-specific UI components (image/text/audio/video)
- hooks/: application-level controllers
  - useSessionLifecycle.ts
  - usePreviewSelection.ts
  - useTextPreview.ts
  - useImagePreviewCache.ts
  - useVideoPlaybackController.ts
  - useKeyboardShortcuts.ts
- lib/jobSocket.ts: websocket client adapter for job updates
- styles.css: global app styles and player overlay styling

## Backend (server)

- index.ts: explicit runtime bootstrap entrypoint
- appRuntime.ts: runtime shell
- runtimeComposition.ts: runtime composition and orchestration
- bootstrap/container.ts: composition container for runtime dependencies
- application/jobs/sessionJobQueue.ts: application-layer queue orchestration
- infrastructure/runtime/runtimePrimitives.ts: runtime utility primitives (logging, byte formatting, path/range safety)
- realtime/jobSocketServer.ts: websocket server for job updates
- services/segmentedDownloader.ts: segmented/resumable downloader service
- services/jobProgressMonitor.ts: decoupled progress/speed/ETA monitor

## Key API Surface

- POST /api/sessions: start archive/file loading job
- GET /api/session-jobs/:id: fetch current job snapshot
- WS /ws/jobs?jobId=...: realtime job updates
- GET /api/session-jobs/:id/stream: byte stream while direct URL is downloading
- GET /api/sessions/:id/tree: explorer tree for ready session
- GET /api/sessions/:id/file?path=...: raw/range file serving
- GET /api/sessions/:id/video/qualities?path=...: on-demand video quality options for selected file
- GET /api/sessions/:id/video/stream?path=...&quality=...: ffmpeg realtime transcode stream for selected quality

## Video Pipeline (Current)

1. Download/extract stores original video only (no pre-generated variants).
2. Explorer/preview shows original file immediately after session is ready.
3. When user opens a video, frontend fetches available quality options from backend.
4. Backend inspects source resolution and returns only valid options:
   - Original
   - 360p/480p/720p/1080p/1440p/2160p up to source height
5. Default quality selection:
   - 720p if source >= 720p
   - Original if source < 720p
6. Selecting lower quality uses ffmpeg realtime transcode stream endpoint.

## Notes

- Inline video quality selector is rendered on top of player UI.
- Live direct-video preview during download remains separate and unchanged.
- Session folders are temporary and cleaned after inactivity.
