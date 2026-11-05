# syntax=docker/dockerfile:1.7
# Build from the TiDo directory:  docker build -f apps/web/Dockerfile -t tido-web .
FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS build
RUN npm install --global --no-fund --no-audit pnpm@12.16.1
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@tido/web..."
COPY packages ./packages
COPY apps/web ./apps/web
# Shown on the What's new page and in version.json; .git is not in the build context.
ARG TIDO_REVISION=unknown
RUN TIDO_REVISION="$TIDO_REVISION" pnpm --filter @tido/web build

# Runs as uid 101 on port 8080; needs only /tmp writable.
FROM nginxinc/nginx-unprivileged:1.30-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03 AS runtime
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
