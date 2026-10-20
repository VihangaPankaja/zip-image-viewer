# ZIP Image Viewer

A self-hosted workspace for downloading public archives and media, browsing files,
and previewing images, text, audio and video.

- Queue HTTP downloads and torrents, select torrent files, and manage transfers.
- Search file trees and preview media without leaving the workspace.
- Play compatible torrent videos while downloading. Use adaptive video quality,
  seek previews, audio languages and captions.
- Keep torrent downloads across restarts and manage session storage.

## Get started

Install [Vite+](https://viteplus.dev/guide/), clone this repository, and run:

```sh
vp install --frozen-lockfile
vpr dev
```

Open <http://localhost:5173>. The API runs on <http://localhost:8080>.
The repository selects Node and the package manager. FFmpeg and 7-Zip are included
in the project dependencies.

## Run in Docker

```sh
docker build -t zip-image-viewer .
docker run -p 8080:8080 -v zip-image-viewer-data:/app/sessions zip-image-viewer
```

Open <http://localhost:8080>. Keep the volume to preserve torrent downloads.
Run the server on a trusted network or behind access controls.

## Documentation

- [Using the app](docs/README.md#using-the-app)
- [Development](docs/development/README.md)
- [Deployment](docs/reference/deployment.md)
- [Configuration](docs/reference/configuration.md)
- [API](docs/reference/api.md)
- [Roadmap](docs/app-roadmap.html)
