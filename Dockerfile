FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y dumb-init && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
EXPOSE 8080
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "start"]
