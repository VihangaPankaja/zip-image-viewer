# API

The client uses oRPC for queue, archive, torrent, settings, storage and video-quality
operations. `shared/contracts.ts` defines validated inputs, results and errors;
`server/rpc/serverRouter.ts` implements them. Use these definitions when adding
client calls rather than duplicating request types.

RPC requests use `/rpc`. Raw files and media use HTTP routes so browsers can
request byte ranges, playlists and segments.

## ZIP selection

`archives.get({ id })` returns the retained job's validated ZIP manifest, stable
entry IDs, compressed/expanded sizes and previously extracted entries.
`archives.select({ id, fingerprint, fileIds })` accepts file IDs from that current
manifest while the job awaits selection or is ready. It keeps previously
published files and queues extraction of the combined selection. Directory
choices expand to their matching file IDs in the client. See
[Downloads and archives](../guides/downloads.md#browse-an-archive) for the user flow.

## HTTP routes

| Route                                               | Purpose                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| `GET /health`                                       | Liveness, readiness and job/session counts.                       |
| `GET /api/session-jobs`                             | Queue snapshot.                                                   |
| `GET /api/session-jobs/:id`                         | One job's state.                                                  |
| `GET /api/session-jobs/:id/events`                  | Server-sent job events.                                           |
| `POST /api/session-jobs/:id/confirm`                | Confirm a large download.                                         |
| `GET /api/session-jobs/:id/video/info?fileId=...`   | Early torrent playback eligibility.                               |
| `GET /api/session-jobs/:id/video/stream?fileId=...` | Verified torrent video byte ranges.                               |
| `GET /api/sessions`                                 | Ready session summaries.                                          |
| `POST /api/sessions`                                | Single-download compatibility endpoint.                           |
| `GET /api/sessions/:id/tree`                        | Session file tree.                                                |
| `GET /api/sessions/:id/file?path=...`               | Original file, including byte ranges.                             |
| `DELETE /api/sessions/:id`                          | Close the viewer session. Retained and pinned files stay on disk. |
| `GET /api/sessions/:id/video/hls/master?path=...`   | Adaptive HLS master playlist.                                     |
| `GET /api/sessions/:id/video/hls/status?path=...`   | Media preparation status.                                         |
| `WS /ws/jobs?jobId=...`                             | Job progress updates.                                             |

Video handlers also serve playlists, initialization files, segments, thumbnails,
storyboard sheets and subtitles. See `server/handlers/videoHlsRoutes.ts` and
`server/handlers/video/` for query schemas and response behavior.

## Validation and streaming

Public URL checks apply to HTTP downloads and redirects. File paths must remain
inside their owning session, including after resolving links. The
[configuration reference](configuration.md#resource-limits) lists resource limits.

During HLS preparation, the app player sends `X-HLS-Preparation-Retry: 1` and
retries HTTP 425 responses. Clients without that header wait for output or
completion. Failed preparation returns HTTP 503. Disconnecting releases the
request's media consumer.

For startup readiness and network access, see [deployment](deployment.md#readiness-and-access).
