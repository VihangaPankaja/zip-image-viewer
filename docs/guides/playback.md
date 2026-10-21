# Media playback

Choose a file in **Explore** to open an image, text, audio or video preview.
**Open raw** opens the original file. Files without an inline preview can still
be opened or downloaded. Images support a slideshow and preview-quality choices.

## Video quality and seeking

Compatible videos play directly. Other videos can use a remux or adaptive
playback. **Quality** offers automatic selection and the available resolutions.
Changing quality keeps the current playback position.

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

Use **Audio language** for videos with multiple tracks. Adaptive playback changes
language without resetting position or play state. Original and remux playback
depend on browser support; use **Switch to adaptive playback** when offered.

Choose an embedded text subtitle track or load a local WebVTT or SRT file.
Local captions stay in the browser. Caption controls include on/off, size and
timing offset. Bitmap subtitles are not offered. Replace failed or malformed
captions without closing the video.

## Playback problems

- Check the displayed preparation, buffering or peer status before retrying.
- Try adaptive playback if the browser cannot decode the original file.
- Open playback diagnostics to inspect the active rendition and buffer.
  A copied diagnostic report omits source URLs and local paths.

Server-side encoder options are in [configuration](../reference/configuration.md#hardware-encoding).
