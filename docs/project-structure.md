# Project structure

## Client

- `client/src/pages/` - thin application composition.
- `client/src/features/workspace/` - queue data, workspace view models, pane
  layout, session rail, batch URL parsing, overlays, and presentation adapters.
- `client/src/features/player/` - adaptive-quality policy, player controls,
  timeline preview, and HLS integration.
- `client/src/components/Workspace/` - reusable workspace surfaces.
- `client/src/components/Preview/` - typed media-specific preview views.
- `client/src/hooks/` - focused controllers for selection, session hydration,
  keyboard behavior, caches, and playback.
- `client/src/services/` - validated REST compatibility and typed oRPC clients.
- `client/src/styles/` - tokens, foundation, workspace, explorer, preview,
  player, and responsive styles. `styles.css` is only the import entrypoint.

TanStack Query owns server state, Table owns the file grid, Virtual handles large
session lists, and resizable panels compose the desktop workspace.

## Shared contracts

- `shared/contracts.ts` - Zod request/response schemas, inferred transport
  types, typed errors, URL/path safety, and the oRPC contract.

Both client and server compile against this module. Network JSON remains
`unknown` until a schema validates it.

## Server

- `server/index.ts` and `server/appRuntime.ts` - process bootstrap.
- `server/runtimeComposition.ts` - dependency composition only.
- `server/bootstrap/` - side-effect-free Express creation, runtime lifecycle,
  route registration, and dependency container.
- `server/domain/` - job, session, explorer, and application error models.
- `server/application/jobs/` - batch queue, job manager, source download /
  extraction, and job processing.
- `server/application/sessions/` - session lifecycle policy.
- `server/application/downloads/` - validated download option normalization.
- `server/rpc/` - executable oRPC implementation and Express adapter.
- `server/handlers/` - thin REST/binary route adapters.
- `server/media/` - pure rendition, playlist, FFmpeg argument, and process
  limiting primitives.
- `server/infrastructure/` - archive, download, file, media, process, and
  runtime adapters.
- `server/realtime/` - typed WebSocket progress transport.
- `server/repositories/` - in-memory ephemeral stores.
- `server/services/` - segmented download and progress monitoring.

## Tests

- Co-located `*.test.ts(x)` - unit, component, contract, and application tests.
- `tests/integration/` - real ZIP and FFmpeg fixture tests.
- `tests/e2e/` - Playwright desktop/mobile workflow and Axe accessibility.
- `coverage/` - generated LCOV, JSON, text, and HTML reports.

## Delivery

- `.nvmrc` / `packageManager` - Node 26 and pnpm pinning.
- `.fallowrc.json` - dead code, dependency, duplicate, and boundary analysis.
- `lefthook.yml` - local commit/push checks.
- `.github/workflows/quality.yml` - CI quality and cross-browser E2E.
- `Dockerfile` - Node 26 multi-stage, non-root runtime with Tini and healthcheck.
