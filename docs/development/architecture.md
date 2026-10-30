# Architecture and source map

The React client sends validated requests to an Express server. Downloads,
extraction and media preparation run in the background while users browse ready
sessions. HTTP downloads and torrents keep metadata and payloads across restarts. See [storage](../guides/storage.md) for lifecycle rules.

## Request flow

```mermaid
flowchart LR
  UI[React workspace] --> Contract[Shared contracts]
  Contract --> RPC[RPC and HTTP handlers]
  RPC --> App[Application workflows]
  App --> Domain[Domain models]
  App --> IO[Files, downloads and media processes]
  UI --> Media[HTTP media routes]
  Media --> IO
```

`shared/contracts.ts` owns Zod schemas and the oRPC contract. Treat external
data as `unknown` until validation succeeds. Infer transport types from the
schemas rather than maintaining separate client and server definitions.

## Client

| Path under `client/src/`                       | Responsibility                                                  |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `pages/`                                       | App composition.                                                |
| `features/workspace/`                          | Queue state, layout, sessions and dialogs.                      |
| `features/player/`                             | Audio queues, video quality, seeking and HLS playback.          |
| `components/Workspace/`, `components/Preview/` | Workspace and media views.                                      |
| `hooks/`                                       | Selection, keyboard behavior, caching and playback controllers. |
| `services/`                                    | Validated HTTP and typed RPC clients.                           |
| `styles/`                                      | Theme tokens and shared styles. `styles.css` imports them.      |

TanStack Query owns server state. The file tree renders a window of rows for
large collections. Resizable panels compose the desktop workspace.

`workspaceLocation.ts` validates the address fragment through shared contracts.
History records session, file and nested-parent transitions; edits to search,
media filters and sort replace the current entry. Downloads preserves the
current preview, and parent breadcrumbs restore its selected archive and filters.
Early torrent previews record their job and file identity. Route restoration
only reads existing content and never enqueues downloads. There is no discovery
view yet; a future discovery view must preserve its return location when opening
a preview, using the same history boundary.

## Server

| Path under `server/`                | Responsibility                                        |
| ----------------------------------- | ----------------------------------------------------- |
| `index.ts`, `runtimeComposition.ts` | Process entry and dependency wiring.                  |
| `bootstrap/`                        | Express setup, startup restoration and shutdown.      |
| `domain/`                           | Job, session, file-tree and error models.             |
| `application/`                      | Download, torrent, extraction and session workflows.  |
| `handlers/`, `rpc/`                 | HTTP media routes and RPC adapters.                   |
| `infrastructure/`                   | File, archive, network and media operations.          |
| `media/`                            | Rendition, playlist and process-limiting helpers.     |
| `repositories/`                     | In-memory state and SQLite retained-download storage. |
| `services/`, `realtime/`            | Segmented transfers and progress delivery.            |
| `tui/`                              | Interactive terminal dashboard.                       |

Domain code has no HTTP or filesystem dependencies. Application workflows use
typed dependencies; adapters handle I/O. Fallow checks these import boundaries.

## Media and storage

Direct playback serves the original file. Remuxing changes its container;
transcoding creates HLS renditions. Long videos use eight-second windows with
four-second segments. Requests for the same window share work, and obsolete
requests release their consumers without stopping other viewers.

Media work shares a bounded process pool. Retained videos prepare in the
background while interactive requests receive priority. Generated media has a
cross-session cache budget; cleanup protects active readers and drains jobs.
File routes validate paths against their owning session, including real paths.

## Tests and delivery

`tests/` contains unit, component, integration, UI, E2E and benchmark
suites plus fixtures, with client/server paths mirrored inside each suite. The [testing guide](testing.md)
lists commands. Production output is `dist/` for the client and `build/` for
server and shared modules. Neither output belongs in Git.
