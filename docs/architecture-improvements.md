# Architecture Improvements Design

## Purpose

This document defines a modular architecture plan for the zip-image-viewer codebase. The goal is to split large orchestration files into smaller reusable units, separate UI components from business logic, and enforce clear architecture layers.

## Current Pain Points

- Frontend orchestration is concentrated in `client/src/pages/AppPage.tsx` (about 1607 lines).
- Backend orchestration is concentrated in `server/appRuntime.ts` (about 2057 lines).
- State transitions, transport logic, preview logic, and rendering concerns are mixed in the same modules.
- Reuse is limited because many utilities and workflow steps are coupled to page-level or runtime-level files.

## Architecture Goals

- Separate concerns by layer, not by file size alone.
- Keep components focused on rendering and interaction only.
- Move domain and workflow logic into reusable hooks and use cases.
- Isolate infrastructure concerns (HTTP, filesystem, ffmpeg, socket, storage) behind interfaces.
- Minimize repeated logic through shared contracts, adapters, and utility modules.

## Layered Architecture

### Frontend Layers

1. Presentation Layer
- Pure UI components and visual composition.
- No data fetching, websocket wiring, or storage reads.
- Inputs and callbacks only.

2. Application Layer
- Feature-level orchestration through hooks and controllers.
- Coordinates user intent, async operations, and state transitions.
- Converts infrastructure data into view models.

3. Domain Layer
- Stateless business rules and pure helpers.
- Tree traversal, path selection, media classification, sort policies, selection rules.

4. Infrastructure Layer
- API clients, websocket adapters, localStorage adapters, and browser APIs.
- No business decisions, only transport and persistence concerns.

### Backend Layers

1. Interface Layer
- Route handlers and transport-specific request/response parsing.
- Maps HTTP details into application commands.

2. Application Layer
- Use cases for session lifecycle, jobs, previews, and streams.
- Orchestrates domain services and repositories.

3. Domain Layer
- Core entities, policies, validation, and state transitions.
- No Express, no filesystem API usage, no ffmpeg process calls.

4. Infrastructure Layer
- Repositories, file IO, downloader, archive extraction, ffmpeg probe/transcode adapters.
- Concrete integrations for external libraries and process execution.

5. Composition Layer
- Dependency injection container and route registration only.
- Builds runtime graph from interfaces + use cases + infrastructure.

## Proposed Frontend Structure

```text
client/src/
  app/
    AppShell.tsx
    routes.tsx
    providers/
  features/
    session/
      components/
      hooks/
      use-cases/
      model/
      infra/
    preview/
      components/
      hooks/
      use-cases/
      model/
      infra/
    explorer/
      components/
      hooks/
      use-cases/
      model/
    download/
      components/
      hooks/
      use-cases/
      model/
  shared/
    components/
    hooks/
    lib/
    infra/
    types/
```

### Preview Folder Consolidation

- Move preview modules from `client/src/components/Pages/preview/` to `client/src/components/Preview/`.
- Remove the separate `client/src/components/VideoPlayer/` folder.
- Keep all preview-specific UI, including video player components, inside `client/src/components/Preview/`.
- Keep page-level wrappers in `client/src/components/Pages/` only; preview implementation should live in `Preview/`.

## AppPage Decomposition Plan

Extract these logic blocks from `client/src/pages/AppPage.tsx` into feature modules:

1. Session Lifecycle Controller
- load session, clear session, hydrate session, active job wiring
- Suggested hook: `features/session/hooks/useSessionLifecycle.ts`

2. Job Stream and Polling Controller
- websocket attach/detach, polling fallback, terminal status handling
- Suggested hook: `features/session/hooks/useJobProgressChannel.ts`

3. Preview Selection Controller
- selectedPath, selectedNode, next/previous navigation, slideshow state
- Suggested hook: `features/preview/hooks/usePreviewSelection.ts`

4. Text and Image Preview Data
- cache, oversize flow, preload logic, object URL lifecycle
- Suggested hooks:
  - `features/preview/hooks/useTextPreview.ts`
  - `features/preview/hooks/useImagePreviewCache.ts`

5. Video Playback Domain Controller
- HLS/source selection, quality options, timeline sync, fullscreen handling
- Suggested hooks:
  - `features/preview/hooks/useVideoQualityOptions.ts`
  - `features/preview/hooks/useVideoPlaybackController.ts`

6. Keyboard and Interaction Policies
- media shortcuts, focus guards, modal behavior boundaries
- Suggested hook: `shared/hooks/useKeyboardShortcuts.ts`

7. Rendering Composition
- keep `AppPage` as a thin composition container only
- render feature pages with props from controllers

## Proposed Backend Structure

```text
server/
  bootstrap/
    container.ts
    registerRoutes.ts
  interfaces/
    http/
      routes/
      presenters/
      validators/
  application/
    session/
      use-cases/
      dto/
    preview/
      use-cases/
      dto/
    jobs/
      use-cases/
      dto/
    video/
      use-cases/
      dto/
  domain/
    session/
      entities/
      policies/
      services/
    media/
      entities/
      policies/
    jobs/
      entities/
      policies/
  infrastructure/
    repositories/
    downloader/
    archive/
    media/
    storage/
    realtime/
  appRuntime.ts
```

## appRuntime Decomposition Plan

Extract these blocks from `server/appRuntime.ts`:

1. Session Application Use Cases
- `createSession`, `hydrateSession`, `deleteSession`, `cleanupSession`

2. Job Application Use Cases
- `startJob`, `cancelJob`, `emitJobUpdate`, `finalizeJob`

3. Archive and File Services
- archive extraction adapter
- tree build and metadata indexing
- preview byte-range and text reading services

4. Video Services
- probe quality options
- transcode stream orchestration
- segment scheduling and caching policy

5. Infrastructure Adapters
- downloader adapter (segmented/single mode)
- ffmpeg adapter
- repository adapters for sessions/jobs/transcodes

6. Route Interface Modules
- keep each route handler thin and delegate to use cases only
- route modules should not own process orchestration

## Reuse and Anti-Redundancy Rules

- One source of truth for DTOs and API contracts.
- One source of truth for download option normalization.
- Shared error model with error codes and mapper per transport layer.
- Reusable selectors for tree flattening, node lookup, and media grouping.
- Reusable async state primitives for loading/success/error/retry semantics.
- No duplicate localStorage key parsing in feature pages; use adapter modules.
- No direct fetch calls in presentational components.

## Contracts and Boundaries

- Components may depend on hooks and view models, not transport clients.
- Application use cases may depend on domain services and repository interfaces.
- Domain must not import framework modules (React, Express, fs, ws).
- Infrastructure may not contain business policy branches except technical fallback behavior.
- Route handlers must map HTTP to use case inputs and outputs only.

## Testing Strategy by Layer

- Domain: pure unit tests for policies and selectors.
- Application: use case tests with in-memory repository fakes.
- Infrastructure: adapter integration tests (ffmpeg, downloader, file IO).
- Interface: route tests for validation and response mapping.
- UI: component tests for rendering states and feature-hook tests for orchestration.

## Migration Plan

1. Frontend phase 1
- Extract session/job hooks from `AppPage`.
- Keep behavior identical and stabilize tests.

2. Frontend phase 2
- Extract preview controllers and video logic.
- Convert `AppPage` into thin composition shell.

3. Frontend phase 3
- Move `components/Pages/preview/*` to `components/Preview/*`.
- Merge video player UI into `components/Preview/` and remove `components/VideoPlayer/`.
- Update imports to use the consolidated preview module boundaries.

4. Backend phase 1
- Move job/session orchestration to application use cases.
- Keep existing handlers as transport wrappers.

5. Backend phase 2
- Introduce infrastructure adapters and repository interfaces.
- Move ffmpeg and downloader logic behind adapters.

6. Backend phase 3
- Finalize domain policy modules and remove remaining cross-layer imports.

## Definition of Done

- `AppPage` remains under 250 lines and acts as composition shell only.
- `appRuntime` remains under 300 lines and acts as runtime composition only.
- No feature module directly mixes rendering, transport, and orchestration.
- Shared contracts remove repeated parsing/normalization logic.
- Unit and integration tests cover extracted modules before old code paths are removed.
