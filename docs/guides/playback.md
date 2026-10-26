# Media playback

Choose a file in **Explore** to open an image, text, audio or video preview.
**Open raw** opens the original file. Files without an inline preview can still
be opened or downloaded. Images support a slideshow and preview-quality choices.

## Text, code and tables

Text previews load at most 128 KiB at a time. Use First, Previous, Next and Last
chunk to navigate large files. The byte range and encoding stay visible. Line
numbers restart in each chunk; the viewer does not scan the file to count lines.
UTF-8 and UTF-16 byte orders support BOM detection, with a UTF-16 heuristic for
ASCII-heavy files without a BOM. Malformed characters use the replacement symbol.
Binary content has an explicit label and keeps the original-file actions.

Wrap lines splits long lines into continuation rows. Only the visible rows are
rendered. Copy loaded text copies the current raw or formatted text, including
rows outside the viewport. Browser clipboard permission may be required.
Search is case-insensitive and states whether it covers the loaded chunk or a
complete file. Find next scrolls to a matching display row. It does not search
unloaded bytes.

Format JSON works on complete files up to 64 Ki characters, with at most 64
nesting levels and 128 Ki characters of formatted output. Invalid or oversized
JSON stays readable as raw text. Formatting preserves numeric literals.
CSV and TSV offer Table mode in the first chunk. Quoted separators, doubled
quotes and embedded newlines remain text. Tables show at most 200 rows including
the header, 32 columns and 2,048 characters per cell. Limits and incomplete or
malformed records are labelled; Raw text retains the loaded source.

The text cache evicts the least recently used chunks above 2 MiB of retained
string and metadata bytes. Changing selection cancels the previous request;
closing or resetting the session clears its text cache.

## Audio playback and queues

Opening audio loads its metadata without starting playback. Use Play/Pause, the
timeline, ten-second skips, previous/next, mute, volume and Speed. An unknown
duration disables seeking. Device volume may use the hardware buttons.

The Queue starts with the session's audio files in explorer order. Open it to
choose, move or remove tracks. Repeat can loop one track or the queue; Shuffle
changes the queue order without repeating a track early. These choices and volume
and speed survive track changes within the open session. Removing every track
offers **Load session audio** to start a fresh queue. Queues are not saved across reloads.

A compact player remains available while browsing files or visiting Downloads.
Select its filename to return to audio. Automatic track changes leave an image,
slideshow or text preview open. Starting a video pauses audio, and starting audio
pauses video. Closing or deleting the owning session releases its audio source.
The paused audio player hides while the video pane is open. Browsing files or
returning to Downloads restores it with the same track and position.

The player shows the filename and folder. A same-folder `cover`, `folder` or
`front` JPEG, PNG or WebP supplies artwork; missing or failed artwork uses an icon.
Embedded audio tags and embedded artwork are not read. Supported browsers expose
play, pause, track changes and seeking through OS media controls after playback starts.

**Use browser audio controls** replaces the custom timeline and transport with
the browser's player, exiting preview fullscreen to keep that player visible.
Switch back to custom controls before maximizing the audio preview.
Failed loads or unsupported codecs offer Retry and
**Download original audio**. A failed track does not silently skip to another.

## Video quality and seeking

Compatible videos play directly. Other videos can use a remux or adaptive
playback. Open **Video settings** for **Quality**, audio languages, captions,
playback speed and diagnostics. Quality offers automatic selection and the available resolutions.
Changing quality keeps the current playback position.

The player has one thumbnail timeline with Play/Pause, Mute, Volume and
Fullscreen controls. Fullscreen keeps the same controls beside the video.
Closing Video settings keeps captions active; Escape closes it and returns focus
to its heading. **Use browser controls** switches to the browser's player and
removes the custom bar. Failed custom play/fullscreen requests also offer that
fallback. On iOS, native video fullscreen uses the browser controls and restores
the custom timeline when it closes. Device volume may use hardware controls.

Dragging the seek bar shows a thumbnail and time. Playback moves when you release
it. Focus the timeline to seek with arrow keys. In fullscreen, J and L seek by
the interval in Settings. The bracket keys change playback speed by the configured
step. Visiting Downloads keeps the player's position and state.

When a saved position is available, **Continue** resumes it and **Start over**
clears it. Resume positions are stored in the browser for the session and file.

Videos longer than two minutes use a full timeline. The server prepares the
requested part without encoding all earlier minutes first. A cold seek may show
preparation progress. Retained videos prepare a low-quality copy and default
audio in the background.

## Play a torrent before it finishes

In Downloads, choose **View files**, then **Play now** for a selected video.
In Explore, the Sessions rail also offers selected videos once the server has
verified their early playback capability. Queued, paused, failed and extracting
downloads stay in Downloads until files are ready. **Manage downloads** opens
their transfer controls.

Early playback requires a fast-start MP4 or M4V with browser-compatible codecs.
Other files offer **Download first**, which keeps the transfer running.

Only verified torrent pieces play. Seeking may wait for peers. After an idle
read expires, use **Retry playback** or finish the download. Closing the preview
keeps the transfer running. Pausing or cancelling the transfer stops playback.
Playback keeps its position when the completed file becomes available.

If a rail preview becomes unavailable, **View downloads** opens recovery controls.
When its session is ready, **Open ready files** switches to the full file player.
The rail groups a transfer and its ready session into one card.

## Audio languages and captions

In Video settings, use **Audio language** for videos with multiple tracks. Adaptive playback changes
language without resetting position or play state. Original and remux playback
depend on browser support; use **Switch to adaptive playback** when offered.

Choose an embedded text subtitle track or load a local WebVTT or SRT file.
Local captions stay in the browser. Caption controls include on/off, size and
timing offset. Bitmap subtitles are not offered. Replace failed or malformed
captions without closing the video.

## Playback problems

- Check the displayed preparation, buffering or peer status before retrying.
- Try adaptive playback if the browser cannot decode the original file.
- Open Video settings, then playback diagnostics to inspect the active rendition and buffer.
  A copied diagnostic report omits source URLs and local paths.

Server-side encoder options are in [configuration](../reference/configuration.md#hardware-encoding).
