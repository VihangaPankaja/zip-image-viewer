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
- Strict TypeScript, type-aware ESLint, Fallow, Lefthook, Vitest, Playwright,
  Axe, and coverage reporting are part of the normal quality workflow.

## Requirements

- Node.js 26.7.0
- pnpm 12.1.0
- FFmpeg and 7-Zip are supplied by project dependencies for supported platforms.

```bash
nvm install
nvm use
npm install --global pnpm@12.1.0
pnpm install --frozen-lockfile
pnpm run dev
```

On nvm-windows, run `nvm install 26.7.0` followed by `nvm use 26.7.0`;
nvm-windows does not read `.nvmrc` automatically.

- Client: <http://localhost:5173>
- API: <http://localhost:8080>

## Quality commands

```bash
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test:unit
pnpm run test:integration
pnpm run test:component
pnpm run test:ui
pnpm run test:coverage
pnpm exec playwright install chromium
pnpm run test:e2e
pnpm run fallow:health
pnpm run fallow:dead
pnpm run fallow:duplicates
pnpm run fallow:coverage-gaps
pnpm run fallow:targets
pnpm run fallow:audit
pnpm run build
```

`pnpm run quality` runs the non-browser pull-request gate. Playwright covers the
desktop workspace, mobile pane navigation, and automated Axe accessibility
checks. Coverage output is written to `coverage/`.

The application compiles with TypeScript 7. ESLint's TypeScript parser runs in
the isolated `tooling/eslint` workspace on TypeScript 5.9, the newest compiler
version its current peer range supports.

## Production

```bash
pnpm run build
pnpm start
```

Or use the hardened multi-stage image:

```bash
docker build -t media-workspace .
docker run --init -p 8080:8080 media-workspace
```

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
- `GET /api/sessions` - ready session summaries
- `POST /api/sessions` - legacy-compatible single enqueue
- `GET /api/sessions/:id/tree` - extracted file tree
- `GET /api/sessions/:id/file?path=...` - range/raw file serving
- `GET /api/sessions/:id/video/hls/master.m3u8?path=...` - adaptive HLS master
- `WS /ws/jobs?jobId=...` - realtime job progress

Only public HTTP(S) URLs and safe relative paths pass contract validation.
