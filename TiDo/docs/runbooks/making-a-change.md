# Making a change: dev → staging → production

How to take a change from your editor to production by hand. The checklist is the short version
to follow each time. The sections after it explain each step, how the pieces fit together, and
what to do when something goes wrong.

Run every command from the `TiDo` folder (`cd ~/"AI Projects/Projects/TiDo"`) unless a step
says otherwise.

## Checklist

```bash
# 1. Start from an up-to-date main, on a new branch
git switch main && git pull
git switch -c <short-name-for-the-change>

# 2. Run dev: in VS Code, Run and Debug → "API" → F5 (or `pnpm dev` without the debugger)
#    Open http://localhost:5173 and sign in as louis@example.test

# 3. Make the change. If people will notice it: bump "version" in the ROOT package.json
#    and add an entry at the top of apps/web/src/features/about/releases.ts

# 4. Check and commit
pnpm format                 # fixes formatting
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
git add -A && git commit -m "What the change does"

# 5. Staging
kubectl -n tido-staging get pods        # a tido-migrate-* job only minutes old = someone else is releasing; wait
deploy/scripts/release-staging.sh
#    run the "git add … && git commit …" line it prints, then check https://synisterpc.tailbe657c.ts.net:8443

# 6. Production (promotes staging's images; builds nothing)
deploy/scripts/release-production.sh
#    run the commit line it prints, then check https://synisterpc.tailbe657c.ts.net

# 7. GitHub
git push -u origin <branch>
gh pr create --base main --fill         # wait for green checks, merge on GitHub
git switch main && git pull
```

## 1. Start a branch

```bash
git status                      # should say "nothing to commit, working tree clean"
git switch main && git pull     # bring main up to date with GitHub
git switch -c learn/second-change
```

- Branch names are lowercase and case-sensitive: `tido/initial-build` and `TiDo/initial-build`
  are different names.
- After a pull request is merged, GitHub deletes its branch there. Always start the next change
  from `main`, not from an old branch.
- Make sure nobody else (another person, or a Claude Code session) is working in this folder or
  releasing at the same time. Switching branches and releasing would collide with their work.

## 2. Run dev

Dev runs straight from the files in your folder. Save a file and the app changes. You don't need
to commit or build anything.

Open the `TiDo` folder itself in VS Code (`code ~/"AI Projects/Projects/TiDo"`). If the Explorer
says `PROJECTS` instead of `TIDO`, the debug settings in `.vscode/` won't load.

Pick one way to run it:

| Way                            | When                    | How                                                                    |
| ------------------------------ | ----------------------- | ---------------------------------------------------------------------- |
| Debugger (API)                 | To step through the API | Run and Debug (`Ctrl+Shift+D`) → **API** → `F5`                        |
| Debugger (API + web in Chrome) | To step through both    | **Full stack (API + Web)** → `F5`. Needs Google Chrome installed       |
| No debugger                    | Just using the app      | `pnpm dev` (API on :3000 and web on :5173; both restart when you save) |

With the **API** configuration and Firefox, also start the web app: **Terminal → Run Task →
Web: Vite dev server**. Then open http://localhost:5173.

Sign in as **`louis@example.test`**. Dev, staging and production each have their own database,
and so their own accounts. Your Gmail account only exists on staging and production.

If the schema changed since you last ran dev, run `pnpm db:migrate`. To start over with empty
local data and a new owner setup link:

```bash
docker compose -f deploy/compose/docker-compose.yml down -v
docker compose -f deploy/compose/docker-compose.yml up -d --wait
pnpm db:migrate
pnpm db:bootstrap-owner         # prints a one-time link to set the password
```

## 3. Step through the code

1. Click left of a line number to set a breakpoint (a red dot).
2. Do the thing in the browser that runs that line. VS Code pauses there.
3. Inspect: the **Variables** panel, hovering over a name, **Watch**, and the **Debug Console**,
   where you can type any expression.
4. Move:

| Key             | Does                                |
| --------------- | ----------------------------------- |
| `F10`           | Step over: run this line            |
| `F11`           | Step into the function on this line |
| `Shift+F11`     | Step out to the caller              |
| `F5`            | Continue to the next breakpoint     |
| `Ctrl+Shift+F5` | Restart: after editing API code     |
| `Shift+F5`      | Stop (this also stops the API)      |

Good places for a breakpoint:

- `apps/api/src/modules/tasks/routes.ts`: the `POST /tasks` handler, which runs when you add a
  task.
- `apps/api/src/plugins/auth.ts`: runs on every request.
- `apps/api/src/modules/recurrence/service.ts`: runs when you create a repeating task.

If you land in `<node_internals>/...`, that's Node.js's own code. Press `F5` to get out.

Web code: with Chrome, set breakpoints in `apps/web/src/...` in VS Code. With Firefox, press `F12`
→ **Debugger** and find the file under `localhost:5173` → `src`. Put breakpoints in event
handlers and mutations (such as `addTask` in `TasksPage.tsx`), because component bodies run on
every re-render.

Tests: open a test file, then run **Unit tests: current file** and pick its app.

## 4. Make the change

- **Web code** (`apps/web/src`) updates in the browser as soon as you save.
- **API code** (`apps/api/src`) needs a restart under the debugger (`Ctrl+Shift+F5`). `pnpm dev`
  restarts it for you.
- **Database schema:** follow "Changing the database schema" in `local-dev.md`. Production has no
  backups yet, so be careful with migrations.

If people will notice the change, give it a version:

1. Bump `version` in the **root** `package.json` (`TiDo/package.json`, line 3). Ignore the
   versions in `apps/*/package.json` and `packages/*/package.json`: they're internal and stay as
   they are. Use the last number for small changes (0.5.1 → 0.5.2) and the middle one for new
   features (0.5.2 → 0.6.0).
2. Add an entry at the **top** of `apps/web/src/features/about/releases.ts`, written for the
   people who use TiDo:
   ```ts
     {
       version: '0.5.2',
       date: 'YYYY-MM-DD',
       summary: 'One line about the release.',
       changes: [{ kind: 'improved', text: 'What changed, in plain words.' }],
     },
   ```
   `kind` is `'new'`, `'improved'` or `'fixed'`. A web test fails if this version and the root
   `package.json` disagree.

## 5. Check and commit

```bash
pnpm format                 # rewraps your code the project's way
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
pnpm test:integration       # optional: API tests against a real PostgreSQL
```

`&&` stops at the first command that fails. These are the checks CI runs on the pull request,
so passing them here means CI passes too.

Review, then commit:

```bash
git status                  # which files changed
git diff --stat             # one line per file (or use VS Code's Source Control view, Ctrl+Shift+G)
git add -A
git commit -m "What the change does"
```

The release scripts refuse to run with uncommitted changes, so every image they build matches a
commit.

## 6. Release to staging

```bash
kubectl -n tido-staging get pods
deploy/scripts/release-staging.sh
```

If a `tido-migrate-*` job in that list is only minutes old, someone else just released. Your
release would replace theirs, so check with them first.

The script builds the API and web images from your commit, pushes them to the local registry,
pins their digests in `deploy/k8s/overlays/staging/`, and runs the migration. Then it rolls out
the new pods. `staging-release.md` explains each step.

**Run the commit line it prints at the end.** The production release only promotes digests that
are committed.

Check from your **phone** with Tailscale on, not only from this PC. Use
https://synisterpc.tailbe657c.ts.net:8443 and check that:

- `/version.json` shows your commit as `revision`
- **What's new** shows your version (if you bumped it)
- your change works

## 7. Promote to production

```bash
deploy/scripts/release-production.sh
```

It checks that staging is healthy and runs the committed digests. Then it deploys those exact
images to production, so it builds nothing. Run the commit line it prints. Then check
https://synisterpc.tailbe657c.ts.net the same way, including `/version.json` showing the same
revision as staging. `production-release.md` explains each step.

## 8. Merge on GitHub

```bash
git push -u origin <branch>
gh pr create --base main --fill
```

Open the link it prints and wait for the **Checks** to go green. CI runs everything from step 5,
plus end-to-end tests and image builds. Then click **Merge pull request**, and update your PC:

```bash
git switch main && git pull
```

## How it fits together

```
 ~/AI Projects/Projects/TiDo   your files: a Git working copy
 │
 ├─► DEV         runs these files directly (Node + tsx for the API, Vite for the web)
 │               database: Docker Postgres on localhost:5432
 │
 │   git commit  → a snapshot in .git (still only on this PC)
 │   git push    → copies the snapshots to GitHub
 │
 ├─► STAGING     release-staging.sh builds images from the commit → localhost:5000 registry
 │               → K3s namespace tido-staging. Its own database.
 │
 └─► PRODUCTION  release-production.sh runs the same images as staging
                 → K3s namespace tido-production. Its own database. No backups yet.
```

- Editing files changes dev only. Staging and production change only when you release.
- The overlay files in `deploy/k8s/overlays/` record which images each environment runs. That
  record is how you roll back: see "Rolling back" in `staging-release.md` and
  `production-release.md`.
- **pnpm** installs the libraries (`pnpm install`) and runs the commands listed under `"scripts"`
  in each `package.json`. TiDo is a workspace of several packages, so the folder you're in
  matters. In the root, `pnpm test` runs every test, while in `apps/api` it runs only the API's
  tests. Commands such as `pnpm db:migrate` exist only in the root.

## When something goes wrong

| What you see                                                     | Why, and what to do                                                                                             |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| "TiDo could not reach its server. Check that the API is running" | The API isn't running (stopping the debugger stops it). Press `F5` on **API**, or run `pnpm dev:api`            |
| Sign-in fails in dev                                             | Use `louis@example.test`, not your Gmail address. Forgotten password: reset local data (step 2)                 |
| Debugging fails right away with a browser error                  | **Full stack** and **Web (Chrome)** need Google Chrome. Use **API** with Firefox instead                        |
| `Command "db:migrate" not found`                                 | You're in a subfolder. `cd ~/"AI Projects/Projects/TiDo"`                                                       |
| A test you expected to fail passes                               | You ran `pnpm test` in a subfolder, which runs only that app's tests. Run it from the root                      |
| `fatal: invalid reference`                                       | Branch names are case-sensitive, or the branch was deleted after a merge. Start from `main`                     |
| `git pull` says the upstream is gone                             | The branch was merged and deleted on GitHub. `git switch main && git pull`                                      |
| `format:check` fails                                             | `pnpm format`, then check again                                                                                 |
| Breakpoint is a hollow grey circle                               | That code hasn't loaded yet, or VS Code has `Projects` open instead of `TiDo`                                   |
| No new VS Code window opens from `code …`                        | That folder is already open, so VS Code brought the existing window to the front                                |
| Port 3000 or 5173 already in use                                 | Another dev server is running. `ss -ltnp \| grep -E ':(3000\|5173)'` shows which; stop it or close its terminal |
| Release script: "commit your changes first"                      | Commit, or `git status` to see what's uncommitted (often the previous release's pins)                           |
| Release failed during migration                                  | The running app is untouched. Fix the problem, commit, and release again                                        |
| Staging works from the PC but returns 403 on the phone           | Tailscale is off on the phone, or SNAT is back on (TIDO-SEC-012 in `docs/security.md`)                          |

In `git diff` and `git log`, press `Space` for the next page and `q` to quit.
