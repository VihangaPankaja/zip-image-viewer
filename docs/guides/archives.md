# Archive formats and volumes

## Import files from your device

In **Downloads**, use **Choose local files** or drop files onto **Import local
files**. The picker works with touch and the keyboard. Files upload immediately,
one at a time, and appear in the queue. ZIPs offer **Review ZIP contents** before
extraction; image, text and audio files open through the same previews as downloads.
Other supported archive formats use the existing archive validation and password
flow described below. Uploaded files are copied to the server.

The upload bar reports bytes sent by the browser. After transfer, the server
checks the source, then the queue shows archive inspection and extraction progress
separately. **Cancel upload** stops the transfer and removes its partial file.
**Retry upload** sends the same file again using its existing import ID. Keep the
tab open for that retry; after reloading, choose the file again. Successful uploads
keep their source for extraction retries and **Extract more**, without another upload.

Each file is limited to 10 GiB. The server admits disk space before writing,
keeps 64 MiB free and allows two simultaneous uploads across browser tabs. It
checks actual bytes even when the client omits Content-Length. Uploads have a
15-minute deadline. A tab can queue up to 50 files, and the server allows 50
unfinished imports. Remove old cancelled imports from Downloads to free those
slots. A disconnected or expired upload removes partial payloads; the queue entry
remains available for retry or deletion. A server restart discards incomplete
uploads and verifies completed sources before restoring them.

The browser sends each File directly, without reading the whole file into page
memory. Browser and reverse-proxy limits can be lower than the app limit. Folder
pickers and directory drops are not supported; make a ZIP to preserve a folder's
structure. Selecting several files creates independent imports, including files
with the same name. For multipart sets, use the URL, torrent or nested-archive
flows described in [Open a multipart set](#open-a-multipart-set).

## Supported formats

The production image uses the full system 7zip binary. Its archive smoke test
checks listing and extraction through the application's built readers. The
matrix describes those tested capabilities, within the app's 10 GiB expanded
size and 10,000 entry limits.

| Format | Read contents | Extract        | Tested compression and source forms                                                       |
| ------ | ------------- | -------------- | ----------------------------------------------------------------------------------------- |
| ZIP    | Yes           | Selected files | Store and Deflate; UTF-8 names; password-protected ZIP through 7zip                       |
| ZIP64  | Yes           | Selected files | 64-bit sizes, offsets and central directory records, including a small real ZIP64 fixture |
| 7z     | Yes           | Yes            | LZMA, LZMA2, encrypted headers, and numbered `.7z.001` volumes                            |
| RAR    | Yes           | Yes            | RAR4 stored multipart sources and RAR5 compressed sources; read/extract only              |
| TAR    | Yes           | Yes            | Uncompressed regular files and folders with Unicode names and modification times          |

Root ZIP downloads offer contents selection before extraction. Other root
formats extract the archive's files. Nested archives offer file selection;
solid archives may need to decompress preceding data to reach a selected file.
The production fixtures verify output bytes, not just filename extensions or
the binary's advertised format list. See [testing](../development/testing.md).

The bundled development `7za` is a reduced binary and can lack RAR support.
Use the production image for the matrix above. The upstream
[7zip format list](https://www.7-zip.org/) describes the binary's broader
capabilities; the app applies its own limits and path checks. ZIP methods other
than Store, Deflate and supported encrypted ZIP are rejected with a repack
instruction. Split ZIP (`.z01`/`.zip.001`), legacy RAR (`.r00`) naming and archive
creation in other formats are outside this matrix.

## Download selected files and folders

Open a ready session, choose **Select files**, then select file or folder rows.
Folders include all their contents, including files hidden by search or media
filters. Use the folder arrow to expand or collapse while selecting. Arrow keys
browse the tree; Space or Enter toggles the focused entry. Choose **Done selecting**
to resume previews. Choices stay available in **Open explorer** for that session.

Choose **Download selection** to save `selection.zip`. The ZIP keeps paths relative
to the session root and empty folders. Overlapping choices appear once. Deselecting
a child excludes it from a selected parent. **Clear selection** clears all choices,
including hidden entries. Changing sessions clears the selection.

The export checks ownership and availability before starting. Incomplete torrent
files must finish downloading first. Unsafe paths and case or Unicode filename
collisions fail instead of being renamed. Exporting extracted files from an
encrypted archive produces a **plain, unencrypted ZIP**; archive passwords are
never included. Selected archive files themselves keep their original bytes.

Exports use ZIP64 Store without recompression, including for text files. This keeps
CPU work bounded and avoids recompressing media. The browser streams the download
to its download manager; it does not build a ZIP in page memory. Use the browser's
download controls to track or cancel it. Keep the session open until it finishes.
Deleting the session, disconnecting or stopping the server cancels its export.

Exports are limited to 10 GiB of file contents, 10,000 entries and 8 MiB of metadata.
The selection request has a 1 MiB decoded JSON limit.
The server admits two simultaneous exports and limits each to 15 minutes. An export
of at least 512 MiB or 1,000 entries requires confirmation. If a selected source is
removed or changes during transfer, the download fails rather than publishing a
complete-looking ZIP with truncated entries.

## Open a multipart set

Paste all volume URLs into **Add downloads** together. Matching numbered
`.7z.001`, `.7z.002`, ... or `.part01.rar`, `.part02.rar`, ... sources in the same
URL directory with the same download settings become one job. Keep the original
filenames, spelling and minimum zero padding; numbers can grow beyond 99 or 999. Each request accepts up
to 50 URLs; larger sets can receive additional batches, up to 10,000 parts. The server downloads only supplied URLs, including URLs
added later from another host; it never guesses URLs for missing parts.

Extraction starts from volume one after the set passes inspection. Missing
first, middle or final volumes pause the job before output is published.
Choose **Supply volumes**, paste the missing URLs one per line, then choose
**Check volumes**. Verified downloads are reused across retries and server
restarts. The combined known source size requires confirmation above 1 GiB.
Password entry still applies to one attempt and is requested again after a
restart. See [password-protected archives](downloads.md#password-protected-archives).

In a torrent, selecting any numbered part selects its entire set, including
parts hidden by search or filters. All selected parts must be complete before
extraction; volume files are not copied into the extracted sibling-files folder.
If a part is absent from the torrent, add a complete source. In a nested
archive, first extract all volume files into the parent, then select any part
and choose **Open archive**. Only available files owned by that parent can be
used. Changing any part invalidates the nested contents cache.

## Names, times and errors

Extraction keeps Unicode filenames and recorded modification times. ZIP UTC
timestamp extensions take precedence over its local DOS timestamp, whose
precision is two seconds. The app rejects links, unsafe paths, duplicate names,
file/folder conflicts, Windows reserved names and case or Unicode normalization
collisions, including implicit parent folders. These checks apply on every OS
so a library cannot silently merge or overwrite files when moved to Windows.

Missing parts name the required volumes. Unsupported methods ask you to repack
as ZIP Store/Deflate or 7z LZMA/LZMA2. Path collisions ask you to rename the
conflicting source entries. Corruption and encrypted-password failures retain
their separate recovery messages. Failed extraction removes staging output;
previously published files remain available under the session's retention rules.
