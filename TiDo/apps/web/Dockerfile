# syntax=docker/dockerfile:1.7
# Build from the TiDo directory:  docker build -f apps/web/Dockerfile -t tido-web .
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
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
FROM nginxinc/nginx-unprivileged:1.31-alpine@sha256:b5047b9b76845eac124358373c6852377c52e4b05834a47647e955dd91cb8f1e AS runtime
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
