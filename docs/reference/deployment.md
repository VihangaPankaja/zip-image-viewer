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

Mount a persistent volume at `/app/sessions`. Keep retained-download SQLite data
and payload files together. Stop the server before copying a backup. Ensure the
app user can write to a bind-mounted directory.

For environment variables and optional GPU access, see
[configuration](configuration.md). The default image supports CPU encoding.

## Image versions and rollback

CI publishes verified master builds as
`vihangapankaja/zip-image-viewer:<app-version>-build.<run-number>.<run-attempt>`.
The app version in `package.json` is a stable numeric `major.minor.patch` prefix.
PRs may leave it unchanged or increase it, including Dependabot updates. The
workflow run number distinguishes builds and the attempt number distinguishes
retries. These are Docker build versions; they do not create plain SemVer
releases or require version-bump commits on master.

The container job writes the generated version into its disposable build context
before building. The image's package version and OCI version label therefore
match its build-version tag. It verifies and publishes the same candidate,
checks the published digest against the build output, and records its version,
source commit and digest reference in the Actions job summary. It does not
overwrite plain app-version tags. Only a run for the current master commit
promotes `latest`; queued older commits and their retries publish their unique
build-version tags without replacing the current release.

Use the recorded `vihangapankaja/zip-image-viewer@sha256:...` reference for
deployment and rollback. Docker tags can move; a digest identifies the exact
image. Keep its digest and persistent data backups with deployment records.
To roll back, stop the container and recreate it with the earlier digest and
the same sessions volume. The [Docker digest guide](https://docs.docker.com/dhi/explore/security-concepts/digests/)
explains digest references.

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
