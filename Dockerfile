# syntax=docker/dockerfile:1

# ---- build: compile the client (Vite) and bundle the server with its dependencies (esbuild) --------------------------
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.base.json tsconfig.client.json tsconfig.server.json tsconfig.test.json vite.config.ts ./
COPY scripts/build-server.mjs ./scripts/build-server.mjs
COPY src ./src
RUN npm run build

# ---- run: the bundle alone. It carries its own dependencies, so the image holds no node_modules ---------------------
FROM node:24-slim
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]
