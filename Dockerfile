FROM ghcr.io/voidzero-dev/vite-plus:1.4.0 AS base
WORKDIR /app
ENV VP_GIT_HOOKS=0
COPY --chown=vp:vp package.json pnpm-lock.yaml pnpm-workspace.yaml .node-version ./
COPY --chown=vp:vp patches ./patches

FROM base AS build
RUN vp install --frozen-lockfile
COPY --chown=vp:vp . .
RUN vp run build
RUN cp "$(vp env which node | head -1)" /tmp/node

FROM base AS production-dependencies
RUN vp install --prod --frozen-lockfile \
  && rm -rf node_modules/7zip-bin/linux node_modules/7zip-bin/mac node_modules/7zip-bin/win \
  && rm node_modules/ffmpeg-static/ffmpeg

FROM debian:trixie-slim AS archive-tool
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates curl xz-utils \
  && case "$(dpkg --print-architecture)" in \
       amd64) archive=x64; checksum=22cf82fcc6eb7474f1d5bb4f02c0f8ebd573a718089d6833dc30f8350a3b232e ;; \
       arm64) archive=arm64; checksum=0b71f6cfc34669b3bf69f2347efd3429f77020665003a13b9cdc53b784270421 ;; \
       *) exit 1 ;; \
     esac \
  && curl --fail --location "https://github.com/ip7z/7zip/releases/download/26.05/7z2605-linux-$archive.tar.xz" --output /tmp/7zip.tar.xz \
  && echo "$checksum  /tmp/7zip.tar.xz" | sha256sum --check \
  && mkdir /tmp/7zip \
  && tar -xJf /tmp/7zip.tar.xz -C /tmp/7zip \
  && install -Dm755 /tmp/7zip/7zz /usr/local/bin/7za \
  && install -Dm644 /tmp/7zip/License.txt /usr/local/share/doc/7zip/License.txt

FROM debian:trixie-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production FFMPEG_BIN=/usr/bin/ffmpeg USE_SYSTEM_7ZA=true
RUN apt-get update \
  && apt-get install --yes --no-install-recommends tini ca-certificates libstdc++6 libatomic1 ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system app \
  && useradd --system --gid app --home-dir /app app
COPY --from=archive-tool /usr/local/bin/7za /usr/local/bin/7za
COPY --from=archive-tool /usr/local/share/doc/7zip /usr/local/share/doc/7zip
COPY tooling/7zip.cdx.json /usr/local/share/doc/7zip/7zip.cdx.json
COPY --from=build /tmp/node /usr/local/bin/node
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY --from=build /app/build ./build
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/sessions && chown -R app:app /app
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "build/server/index.js"]
