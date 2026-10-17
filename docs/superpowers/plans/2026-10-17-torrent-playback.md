# Torrent playback implementation plan

**Goal:** Complete roadmap T05 with verified playback before download completion, missing-piece seeks, peer recovery, and an explicit download-first fallback.

**Design:** Selected fast-start MP4 files can play from the torrent job's file list. A bounded MP4 header probe checks for a complete leading movie index before exposing playback. Other containers and MP4 files with unavailable indexes offer Download first. HTTP range reads use verified torrent pieces and prioritize the requested window. Peer loss leaves reads pending; disconnect, pause, cancel and shutdown release them. The existing completed-session player remains available after downloading.

**Scope:** No new dependencies, no transcoding partial files, no public-swarm tests. Keep the current minimal UI. Work in the existing isolated branch. The user's instruction authorizes task selection and execution through a reviewable PR in one go.

## Implementation

- [ ] Add tested verified torrent reads, bounded MP4 inspection, and validated job/file HTTP endpoints. Prove exact byte ranges, pending missing pieces, recovery, disconnection and completion cleanup with a local seed. Run format, lint, typecheck and build, then commit.
- [ ] Add an accessible responsive player within torrent file review, loading/waiting/error/retry states, and Download first fallback. Add real browser playback and seek checks and feature gallery scenes. Update T05 and app version. Run required checks, then commit.
- [ ] Review the whole change, run the complete tests and coverage, all E2E browsers, roadmap checks and complete light/dark device gallery. Inspect and publish screenshots matching the final commit. Open and link the PR.
- [ ] Inspect existing bot feedback, fix only valid findings related to T05, and watch every latest-commit CI check through T3 until successful.

## Review focus

Reject unknown and unselected file IDs and inactive jobs. Never read sparse filesystem bytes. Bound header inspection and pending request lifetimes. Preserve readers when the last piece completes. Release stream priorities on disconnect and keep existing file priorities intact. Peer loss must neither return zeros nor report false completion.
