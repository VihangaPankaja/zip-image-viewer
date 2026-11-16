# Archive formats and volumes

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
creation are outside this matrix.

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
