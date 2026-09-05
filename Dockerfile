FROM node:26.7.0-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@12.1.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tooling/eslint/package.json tooling/eslint/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:26.7.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install --yes --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global pnpm@12.1.0 \
  && groupadd --system app \
  && useradd --system --gid app --home-dir /app app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tooling/eslint/package.json tooling/eslint/package.json
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/build ./build
COPY --from=build /app/dist ./dist
RUN chown -R app:app /app
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "build/server/index.js"]
