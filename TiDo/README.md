# TiDo

TiDo is a shared, self-hosted task workspace for a household or small team: lists, sections,
tasks with one level of subtasks, labels, assignment, a month calendar with an upcoming agenda,
and fully custom recurring tasks.

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
see `docs/runbooks/staging-release.md`. Production manifests exist but are **blocked** until the
gates in `docs/runbooks/production-gates.md` are met.
