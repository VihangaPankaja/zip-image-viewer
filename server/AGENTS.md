# Server changes

- Keep HTTP handlers thin. Put workflow rules in `application/` and file,
  network and process operations in `infrastructure/`.
- Validate requests through shared contracts. Check resolved paths against
  their session root before reading or writing files.
- Preserve retained torrent data during shutdown, viewer close and expiry.
  Explicit deletion must release readers and media jobs first.
- Cover changes to downloads, archives or media with real fixtures.

Root verification and PR instructions apply.
