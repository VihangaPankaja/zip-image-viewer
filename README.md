# ZIP Image Viewer

Browse a public ZIP file through a modern web UI running from a single Docker container on port `8080`.

## What It Does

- paste a public ZIP URL into the app
- backend downloads it into a temporary session workspace
- ZIP contents are extracted safely and shown as a sidebar file tree
- images open in the preview panel with left and right arrow navigation for sibling images in the same folder
- text-style files such as `txt`, `md`, `json`, `csv`, `js`, `ts`, `html`, and `css` open in a text preview
- sessions are cleaned up automatically after inactivity

## Tech Stack

- `Express` server for the API and static asset hosting
- `React + Vite` frontend for the browsing UI
- `unzipper` for ZIP extraction
- single Docker image for portable deployment

## Local Development

Requirements:

- Node.js `20+` recommended
- npm

Install and run:

```bash
npm install
npm run dev
```

- frontend dev server runs on `5173`
- backend runs on `8080`
- Vite proxies `/api` requests to the backend

## Production Run With Docker

Build and run locally:

```bash
docker build -t zip-image-viewer .
docker run -p 8080:8080 zip-image-viewer
```

Use the published Docker Hub image:

```bash
docker pull vihangapankaja/zip-image-viewer:latest
docker run -p 8080:8080 vihangapankaja/zip-image-viewer:latest
```

Versioned image example:

```bash
docker pull vihangapankaja/zip-image-viewer:1.0.4
docker run -p 8080:8080 vihangapankaja/zip-image-viewer:1.0.4
```

Open `http://localhost:8080`.

## Behavior Notes

- public `http` and `https` ZIP URLs are supported
- if the ZIP is larger than `1 GB`, the app asks whether to continue
- extracted files are stored only in temporary server session folders
- unsupported binary files can still be opened as raw files

## Sample Public ZIP URLs

You can test with any direct public ZIP URL. A few examples that are often useful:

- `https://github.com/jquery/jquery/archive/refs/heads/main.zip`
- `https://github.com/twbs/icons/archive/refs/heads/main.zip`
- `https://github.com/google/fonts/archive/refs/heads/main.zip`

Note: some large repositories may take longer to download and unpack, and some ZIPs may not contain images.

## API Endpoints

- `POST /api/sessions` create a browsing session from a ZIP URL
- `GET /api/sessions/:id/tree` fetch the extracted tree for a session
- `GET /api/sessions/:id/file?path=...` stream a file
- `DELETE /api/sessions/:id` remove a session manually
- `GET /health` basic server health response
