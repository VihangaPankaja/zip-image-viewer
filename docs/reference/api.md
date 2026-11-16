# API

The client uses oRPC for queue, archive, torrent, settings, storage and video-quality
operations. `shared/contracts.ts` defines validated inputs, results and errors;
`server/rpc/serverRouter.ts` implements them. Use these definitions when adding
client calls rather than duplicating request types.

RPC requests use `/rpc`. Raw files and media use HTTP routes so browsers can
request byte ranges, playlists and segments.

## Page link discovery

`discovery.inspect({ url })` reads one public HTML page and returns its resolved
`sourcePage`, `items` and a `truncated` flag. Each item has its URL, name, type,
file/page classification, confidence, source page and nullable size. The client
submits reviewed file URLs through the existing `jobs.enqueue` contract.
Inspection never creates jobs. Initial URLs, redirects and socket DNS results
must use public addresses. The bounded request follows the caller's abort signal;
see [page inspection limits](../guides/downloads.md#find-downloads-on-a-page).

## ZIP selection

`archives.get({ id })` returns the retained job's validated ZIP manifest, stable
entry IDs, compressed/expanded sizes and previously extracted entries.
`archives.select({ id, fingerprint, fileIds })` accepts file IDs from that current
manifest while the job awaits selection or is ready. It keeps previously
published files and queues extraction of the combined selection. Directory
choices expand to their matching file IDs in the client. See
[Downloads and archives](../guides/downloads.md#browse-an-archive) for the user flow.

## Archive passwords

`jobs.password({ id, password })` accepts a single-line password of 1-1024
characters only while the job is `awaiting_password`. It queues extraction from
the retained source and returns the public job without its password. Passwords
are transient and must be supplied again after a restart. See
[password-protected archives](../guides/downloads.md#password-protected-archives).

## Archive volumes

`jobs.enqueue` groups compatible numbered HTTP volume URLs into one job.
`jobs.volumes({ id, urls })` accepts 1-50 public HTTP(S) URLs only while that HTTP
job is `awaiting_volumes`. Filenames must match the existing set; supplied parts
replace URLs of the same name or add missing parts. It queues verification and
returns the public job, whose `volumes` field lists supplied and missing names.
Per-volume transfer checkpoints are private retained state. Torrent selection
expands to all matching numbered parts. See [multipart archives](../guides/archives.md#open-a-multipart-set).

## Nested archives

`nestedArchives.inspect({ id, path, password? })` inspects an archive file owned by a parent
session and returns its manifest without extracting it. `nestedArchives.open({
id, path, fingerprint, fileIds, password? })` extracts selected file IDs and returns the
child session ID. Existing child contents are kept when adding selections.
`nestedArchives.cancel({ id, path })` aborts and drains that archive's pending work.

Child sessions use the usual tree, file and media routes. They stay out of the
top-level session list and belong to the parent that owns their archive source.
Their IDs expire on server restart; reopening from a retained parent rebuilds
the child. Nested limits apply across the owning chain, rather than independently
at each level. See [nested archive browsing](../guides/downloads.md#open-an-archive-inside-an-archive).

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

Password-related RPC calls require POST bodies. Nested inspection and extraction
return `PASSWORD_REQUIRED` when entry or retry is needed; encrypted-data damage
can be indistinguishable from a wrong password. Do not put passwords in query
keys, cached mutations or URL parameters.
