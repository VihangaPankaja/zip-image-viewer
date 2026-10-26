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
RUN vp install --prod --frozen-lockfile

FROM debian:bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install --yes --no-install-recommends tini ca-certificates libstdc++6 libatomic1 \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system app \
  && useradd --system --gid app --home-dir /app app
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
