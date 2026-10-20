# Deployment

## Run from source

After the [initial install](../../README.md#get-started), build and start the app:

```sh
vpr build
vpr start
```

The server serves `dist/` and loads server and shared modules from `build/`.
Run from the repository root. Use `NODE_ENV=production` for deployment.

The interactive terminal dashboard appears when input and output are terminals.
Non-interactive processes write plain logs, suitable for containers and services.

## Docker

The [README](../../README.md#run-in-docker) has the build and run commands.
The image includes its runtime and media tools and runs as a non-root user.
It uses Tini for process handling and has a `/health` check.

Mount a persistent volume at `/app/sessions`. Keep retained-torrent SQLite data
and payload files together. Stop the server before copying a backup. Ensure the
app user can write to a bind-mounted directory.

For environment variables and optional GPU access, see
[configuration](configuration.md). The default image supports CPU encoding.

## Readiness and access

`GET /health` returns HTTP 200 while retained downloads are being verified, with
`ready: false`. Other routes return HTTP 503 until restoration finishes. Wait for
`ready: true` before sending application traffic. Large retained downloads may
take time to verify; do not restart the server just because it is not ready yet.

There is no built-in authentication. Restrict access to trusted users through
your network or reverse proxy. Forward WebSocket upgrades and HTTP range
requests for progress and media playback. The public-URL checks on downloads
do not replace access controls or isolate BitTorrent peer traffic.

See [storage and retention](../guides/storage.md) for deletion and restart behavior.
