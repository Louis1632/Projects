# Local development

```bash
cp .env.example .env
docker compose -f deploy/compose/docker-compose.yml up -d   # PostgreSQL 17 on :5432
pnpm install
pnpm db:migrate
pnpm db:bootstrap-owner
pnpm dev
```

- Open the printed setup link, choose a password, then create a list from the sidebar.
- Invite others from **People**; copy the link and send it yourself.

## Changing the database schema

1. Edit `packages/db/src/schema.ts`.
2. `pnpm db:generate` writes a new SQL migration in `packages/db/drizzle/`. Review it.
3. `pnpm db:migrate`, then commit the schema and migration together. CI fails when they disagree.

For SQL Drizzle cannot express (triggers, functions), use
`pnpm --filter @tido/db exec drizzle-kit generate --custom --name <name>`.

## Resetting local data

```bash
docker compose -f deploy/compose/docker-compose.yml down -v
```
