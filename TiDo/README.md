# TiDo

TiDo is a shared, self-hosted task workspace for a household or small team: lists, sections,
tasks with one level of subtasks, labels, assignment, a month calendar with an upcoming agenda,
and fully custom recurring tasks.

## Quick links

Passwords are never stored in this (public) repository: each one comes with the command that
prints it from the cluster. Commands assume `export KUBECONFIG=$HOME/.kube/config`.

**The app**

| What                    | Link                                  | Notes                                                |
| ----------------------- | ------------------------------------- | ---------------------------------------------------- |
| Production              | https://synisterpc.tailbe657c.ts.net  | Tailscale devices only; trusted certificate          |
| Staging                 | https://tido-staging.home.arpa        | This PC only (`/etc/hosts`); self-signed certificate |
| Local dev web           | http://localhost:5173                 | After `pnpm dev`                                     |
| Local dev API docs      | http://localhost:3000/docs            | OpenAPI; development only                            |
| Version of a deployment | `<app link>/version.json`             | Or **What's new** in the app's sidebar               |
| GitHub                  | https://github.com/Louis1632/Projects | Pull requests, CI runs                               |

Forgotten app password: an owner issues a reset link from **People**. There is no recovery yet
for a workspace whose only owner is locked out, so keep a second owner or a password manager.

**Monitoring** (shared stack, private repo
[Louis1632/homelab-platform](https://github.com/Louis1632/homelab-platform), which has its own
quick links)

| What        | Link                                            |
| ----------- | ----------------------------------------------- |
| Grafana     | https://grafana.home.arpa (user `admin`)        |
| TiDo logs   | Grafana → Explore → Loki: `{app="tido-api"}`    |
| TiDo traces | Grafana → Explore → Tempo: service `tido-api`   |
| TiDo alerts | Grafana → Alerting → Alert rules, filter `Tido` |
| Portainer   | https://localhost:30779                         |

```bash
kubectl -n monitoring get secret kps-grafana -o jsonpath='{.data.admin-password}' | base64 -d; echo
```

**Databases**

| Environment | Host and port                                   | Database | User   | Password                                                                                        |
| ----------- | ----------------------------------------------- | -------- | ------ | ----------------------------------------------------------------------------------------------- |
| Local dev   | `localhost:5432` (Docker Compose)               | `tido`   | `tido` | `tido` (local only)                                                                             |
| Staging     | `localhost:15432` while port-forwarding (below) | `tido`   | `tido` | `kubectl -n tido-staging get secret tido-db-app -o jsonpath='{.data.password}' \| base64 -d`    |
| Production  | `localhost:25432` while port-forwarding (below) | `tido`   | `tido` | `kubectl -n tido-production get secret tido-db-app -o jsonpath='{.data.password}' \| base64 -d` |

The cluster databases aren't exposed outside K3s. Open a tunnel in one terminal, then connect
with any PostgreSQL client (DBeaver, pgAdmin, or `psql` through Docker as below):

```bash
kubectl -n tido-staging port-forward svc/tido-db-rw 15432:5432       # production: tido-production, 25432

PGPASSWORD="$(kubectl -n tido-staging get secret tido-db-app -o jsonpath='{.data.password}' | base64 -d)" \
  docker run --rm -it --network host -e PGPASSWORD postgres:17-alpine psql -h localhost -p 15432 -U tido tido
```

Be careful in production: there are no backups yet (`docs/runbooks/production-gates.md`).

**Infrastructure**

| What           | Where                                                                   |
| -------------- | ----------------------------------------------------------------------- |
| Image registry | http://localhost:5000/v2/_catalog (Docker container `tido-registry`)    |
| Pods           | `kubectl get pods -n tido-staging` / `-n tido-production`, or Portainer |
| Runbooks       | `docs/runbooks/` (releases, production, backups, observability)         |

It is a modular TypeScript monolith:

| Path                 | What it is                                                                |
| -------------------- | ------------------------------------------------------------------------- |
| `apps/web`           | React + Vite single-page app (React Router, TanStack Query)               |
| `apps/api`           | Fastify REST API under `/api/v1`, Zod-validated, OpenAPI docs at `/docs`  |
| `packages/contracts` | Request/response schemas and types shared by the API and web app          |
| `packages/db`        | Drizzle schema, committed SQL migrations, migrate and bootstrap utilities |
| `deploy`             | Dockerfiles' nginx config, Kustomize manifests, release scripts           |
| `docs/runbooks`      | Step-by-step operations guides                                            |

## How it fits together

- **Workspace → list → section → task → subtask.** Every list starts with a "Tasks" section.
- **Roles.** All members co-edit everything. Owners also invite people, issue password-reset
  links, change roles and deactivate accounts. There is no public sign-up and no email: owners
  share expiring, single-use links themselves.
- **Security.** Argon2id password hashes (OWASP parameters), opaque database-backed sessions in
  HTTP-only SameSite cookies (rotated on login and password change, revoked on reset and
  deactivation), CSRF protection (custom header + Origin check), rate-limited and generic
  login failures, Helmet headers, an audit trail, and secure-by-default route authorization.
- **Dates** are calendar days (PostgreSQL `date`). "Today" is computed in the workspace time zone
  (`Africa/Johannesburg` by default).
- **Recurrence** uses RFC 5545 RRULEs. A series stores the template; occurrences are ordinary
  task rows generated on demand up to 90 days ahead (further when the calendar asks). Edits apply
  to one occurrence, this-and-future (which splits the series), or all open occurrences.
  Completed occurrences are never rewritten, and skipped dates are never regenerated.

## Local development

Prerequisites: Node 22, pnpm 12, Docker (see `docs/runbooks/host-setup.md`).

```bash
cp .env.example .env            # then set SESSION_SECRET (openssl rand -base64 32)
docker compose -f deploy/compose/docker-compose.yml up -d
pnpm install
pnpm db:migrate
pnpm db:bootstrap-owner         # prints a one-time setup link for the owner
pnpm dev                        # API on :3000, web on http://localhost:5173
```

API documentation: http://localhost:3000/docs (development only).

## Checks

```bash
pnpm format:check && pnpm lint && pnpm typecheck
pnpm test               # unit tests (API + web)
pnpm test:integration   # API against a real PostgreSQL (creates tido_test)
pnpm test:e2e           # Playwright, starts its own API + web (creates tido_e2e)
```

GitHub Actions (`.github/workflows/tido-ci.yml`) runs all of these plus a migration smoke test
and container builds. CI validates only; it never publishes or deploys.

## Deployment

Staging runs on single-node K3s with CloudNativePG, released manually by exact image digest —
see `docs/runbooks/staging-release.md`. Production is private (reachable only over Tailscale,
with a trusted certificate and nightly backups to a USB drive) and promotes the exact images
tested on staging — see `docs/runbooks/production-release.md` and
`docs/runbooks/production-gates.md`.
