# Retained torrents implementation plan

> Use the executing-plans workflow and test each change before claiming completion.

Goal: Complete roadmap S01, T03 and Q02 for retained torrent downloads.

Architecture: Store torrent job snapshots, metadata and session ownership transactionally in Node SQLite under `sessions/`. Torrent workspaces persist until explicit deletion; HTTP sessions keep their existing temporary lifecycle. Restore transfers paused, reverify pieces with WebTorrent and rebuild available file trees. Extend the existing selection endpoint and picker for additive downloads.

- [x] Add SQLite round-trip and recovery tests, then persistence hooks in job management and runtime startup/shutdown. Keep metadata and payloads together in the persisted storage directory; document container volumes.
- [x] Test additive selection, completed-file preservation and same-session indexing. Extend queue, processor and picker without a new API or dependency.
- [x] Add deterministic local-seed tests for restart, reuse, changed/missing storage, pause and peer loss. Add browser interaction coverage and gallery scenes.
- [x] Consolidate `agent.md` into `AGENTS.md`, bump version, update roadmap status and evidence after verification.
- Release checklist: Run all repository gates and configured browsers, request an independent review, resolve valid findings, capture/inspect/publish screenshots, create/link PR and monitor CI and review feedback.

Review focus: Never delete completed originals on a later transfer failure; do not trust stored completion flags; retain shared boundary pieces; keep session identity and metadata stable; reject unknown IDs and workspaces outside the owned storage root.
