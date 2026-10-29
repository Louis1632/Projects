# syntax=docker/dockerfile:1.7
# Build from the TiDo directory:  docker build -f apps/api/Dockerfile -t tido-api .
FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS base
RUN npm install --global --no-fund --no-audit pnpm@12.16.1
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@tido/api..."
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @tido/api build \
 && pnpm --filter @tido/api deploy --prod /out \
 && rm -rf /out/src /out/test /out/build.mjs /out/vitest.config.ts /out/tsconfig.json \
 && cp -r apps/api/dist /out/dist \
 && cp -r packages/db/drizzle /out/drizzle

FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS runtime
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3000
WORKDIR /app
# Files stay root-owned and read-only to the unprivileged runtime user.
COPY --from=build /out /app
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
CMD ["node", "--enable-source-maps", "dist/server.js"]
