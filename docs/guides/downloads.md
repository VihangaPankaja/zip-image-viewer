# Downloads and archives

## Add a download

1. Open **Add downloads** and paste public HTTP links or magnets, one per line.
2. Leave the input to review the entries and adjust per-download settings.
3. Choose **Add to queue**.

A batch accepts up to 50 entries. The queue shows progress, speed, retries and
available actions. Use the arrows or drag a row to change priority. Confirm a
large download when prompted. Failed downloads offer **Retry**.

Settings controls simultaneous downloads and HTTP threading. Torrent bandwidth
limits apply across active torrents; HTTP thread settings do not affect peers.

HTTP downloads probe a single byte when an origin does not support HEAD. They
validate ranged responses before reusing retained bytes. If ranges, encoding or
source identity change, they discard the partial transfer and restart with one
fresh stream. A fresh GET establishes its own size and validators.

Transient failures use exponential delay with jitter, capped at 30 seconds per
wait and two minutes of waiting per run. HTTP retries stop at the configured
count, with an eight-attempt ceiling including the first request, even for older
unlimited settings. This permits at most seven retries. A valid
Retry-After controls the wait; a value beyond either wait limit stops automatic
retry. Cancel interrupts probing, streaming and retry waits.

Authorization failures, missing files and detected login or error pages stop
without automatic retry. For an expired or private link, add a fresh public
download link. Ordinary HTML documents remain supported.

## Select torrent files

Review the torrent's file list before starting the transfer. Search or filter
by media type, then select the files you want. Folder selection includes matching
files across pages. Hidden selections remain selected.

Use **View files** to check available, downloading and skipped files. File
priority controls which selected files peers supply first. **Download skipped
files** adds files without discarding the existing download.

For early video playback and its limits, see [media playback](playback.md).

## Browse an archive

The server extracts supported archives after download. Encrypted archives are
not supported. Open the completed session in **Explore**, search by filename or
path, and filter by media type. Matching folders keep their surrounding path
visible. Arrow keys move through files; selecting a file opens its preview.

Choose **Compact** or **Comfortable** row density beside the media filter. Touch
targets stay at least 44px in either mode. Long names truncate to one line; hover
for the full path or select a file to read its path in **Details**. File-type
badges appear on hover, keyboard focus or selection, and stay visible on touch.

Drag the desktop sidebar separator, or focus it and use arrow keys, Home or End,
to resize between 260px and 480px. On smaller screens, **Files** opens the
scrollable file drawer. Selecting a file, **Close files** or Escape returns to
**Preview**. **Back to files** reopens it with its filters and selection intact.
The image slideshow supports previous and next controls and keyboard navigation.

When a torrent contains archives, the first selected archive keeps its extracted
paths when you add more files. Added sibling files appear under **Torrent files**.

See [storage and retention](storage.md) before closing or deleting a session.
