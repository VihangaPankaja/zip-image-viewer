# Storage and retention

## What stays on disk

| Download type       | Retention                                                                      |
| ------------------- | ------------------------------------------------------------------------------ |
| HTTP session        | Temporary. Expires after inactivity or closes with the viewer.                 |
| Pinned HTTP session | Kept through viewer close and expiry until the server stops.                   |
| Torrent             | Kept across viewer close, expiry and server restarts until explicitly deleted. |

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

For a temporary HTTP session, **Keep until the server stops** prevents viewer
close and expiry from removing it. This choice does not survive shutdown.
Removing a completed HTTP item from the queue does not delete its session files.

**Delete session files** explains what will be removed before confirmation.
For a retained torrent, deletion removes the torrent, its payloads and queue
entry. Pause or cancel an active transfer before deleting its files.

## Restart and backup

Retained torrents store their metadata and payloads together under `sessions/`.
On restart, the server verifies existing pieces before restoring sessions.
Incomplete or damaged downloads return paused and can be resumed.

Back up the whole directory while the server is stopped. For Docker volume and
readiness details, see [deployment](../reference/deployment.md).
