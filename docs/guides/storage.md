# Storage and retention

## What stays on disk

| Download type | Retention                                                                      |
| ------------- | ------------------------------------------------------------------------------ |
| HTTP download | Kept across viewer close, expiry and server restarts until explicitly deleted. |
| Torrent       | Kept across viewer close, expiry and server restarts until explicitly deleted. |

Open **Storage** to see original files, previews and thumbnails, and transcodes
and remuxes. Totals count hardlinked files once and exclude symbolic links.

## Clear generated media

**Clear preview & transcode cache** removes generated files and keeps originals.
Previews regenerate when needed. Active media jobs and recently used HLS playback
can block clearing. Stop playback and wait before trying again.

The server also evicts idle generated media when it exceeds the configured
[cache budget](../reference/configuration.md). Active playback can temporarily
exceed that budget.

## Keep or delete a session

Downloads remain available after closing their viewer. Removing a retained item
from the queue deletes its session files as well.

**Delete session files** explains what will be removed before confirmation.
Deletion removes the retained download, its source, derived files and queue
entry. Pause or cancel an active transfer before deleting its files.

## Restart and backup

HTTP downloads and torrents store their metadata and payloads together under
`sessions/`. SQLite commits source metadata, download options, ownership,
confirmation and partial-file checkpoints together.

After restart, unfinished HTTP downloads return paused. Resume rechecks the
original and resolved URLs, size and a strong ETag or valid Last-Modified date
before sending If-Range requests. Weak or missing validators, changed identities
and damaged partial files cause a fresh download. Checkpoint hashes reject
corrupt prefixes; bytes written after the last checkpoint are discarded.

Interrupted segment assembly rebuilds from verified parts. A completed source
is retained while extraction runs, so extraction can restart without fetching
the source again. Ready HTTP sessions rebuild their extracted files from the
verified source before the server becomes ready. Torrents verify existing pieces
before restoring their sessions. Pause and size-confirmation decisions survive
restart; confirmation is still required for an oversized unconfirmed download.

Back up the whole directory while the server is stopped. For Docker volume and
readiness details, see [deployment](../reference/deployment.md).
