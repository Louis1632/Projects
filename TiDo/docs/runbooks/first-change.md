# Your first change: dev → staging → production

A hands-on walkthrough of the whole path a change takes. You make a small change, step through
the code in VS Code's debugger on your own machine (dev), then release the same commit to staging
and promote it to production.

| Environment | Where it runs                          | How a change gets there                                            |
| ----------- | -------------------------------------- | ------------------------------------------------------------------ |
| Dev         | Your PC: Node + Vite + Docker Postgres | Save the file (the API and web reload)                             |
| Staging     | K3s, namespace `tido-staging`          | `deploy/scripts/release-staging.sh` (builds)                       |
| Production  | K3s, namespace `tido-production`       | `deploy/scripts/release-production.sh` (promotes staging's images) |

## 0. One-time setup

1. Open the **TiDo** folder itself in VS Code. The debug settings in `.vscode/` only load when TiDo
   is the top folder, not `Projects`:
   ```bash
   code ~/"AI Projects/Projects/TiDo"
   ```
2. Install the recommended extensions when VS Code offers them (ESLint, Prettier, Vitest).
3. Stepping through the web app inside VS Code needs Chrome or Chromium. VS Code's built-in
   browser debugger can't drive Firefox:
   ```bash
   wget -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
   sudo apt install /tmp/chrome.deb
   ```
   If you'd rather not install Chrome, debug the web app in Firefox instead (step 2b).
4. Make sure no Claude Code session is working on TiDo while you do this. You'll switch branches
   and release, which would collide with their work.

## 1. Make a branch

```bash
git status                           # should be clean
git switch -c learn/first-change
```

## 2. Run dev and step through the code

The **Run and Debug** view (`Ctrl+Shift+D`) has these configurations:

| Configuration            | What it does                                                                 |
| ------------------------ | ---------------------------------------------------------------------------- |
| API                      | Starts Postgres (Docker) if needed, then the API on :3000 under the debugger |
| Web (Chrome)             | Starts Vite on :5173 and opens Chrome attached to the debugger               |
| Full stack (API + Web)   | Both at once. Stopping one stops both                                        |
| Unit tests: current file | Runs the open test file under the debugger                                   |

If the schema changed since you last ran dev, migrate first: `pnpm db:migrate`. The local owner
is `louis@example.test`. If you've forgotten that password, reset the local data
(`local-dev.md`) and run `pnpm db:bootstrap-owner` again.

### 2a. Debug the API

1. Open `apps/api/src/modules/tasks/routes.ts` and click left of the line number on
   `const auth = requireAuth(request.auth);` in the `POST /tasks` handler. A red dot appears.
2. Pick **Full stack (API + Web)** and press `F5`.
3. In the browser that opens, sign in and add a task. VS Code stops on your line.
4. Look around:
   - **Variables** panel: expand `request` → `body` to see what the browser sent.
   - Hover over any variable to see its value.
   - **Debug Console**: type `request.headers` and press Enter to evaluate it live.
   - Right-click a variable → **Add to Watch** to keep an eye on it.
5. Step:
   - `F10` (step over) runs the current line.
   - `F11` (step into) on the `createTask(...)` line goes into `tasks/service.ts`.
   - `Shift+F11` (step out) returns to the caller.
   - `F5` continues to the next breakpoint.
6. Saving a file restarts the API (`--watch`), and the debugger reattaches by itself.

Other useful places to break: `plugins/auth.ts` (runs for every request), and
`modules/recurrence/service.ts` (create a repeating task).

### 2b. Debug the web app

- **In VS Code (Chrome):** put a breakpoint in `apps/web/src/features/tasks/TasksPage.tsx` on
  `api.createTask(input),` inside `addTask`, then add a task in the Chrome window. Step into it to
  reach `lib/api.ts`, where the request is sent. React re-renders a lot, so a breakpoint in a
  component body fires often. Put breakpoints in event handlers and mutations instead.
- **In Firefox:** run the **API** configuration in VS Code, and start Vite with
  **Terminal → Run Task → Web: Vite dev server**. Open http://localhost:5173 and press `F12` →
  **Debugger**. Find the file under `localhost:5173` → `src/...`, and click a line number. It's
  the same TypeScript source, thanks to Vite's source maps.

### 2c. Debug a unit test

Open a test, for example `apps/api/test/unit/dates.test.ts`, and set a breakpoint inside a test.
Run **Unit tests: current file** and choose `apps/api` when it asks. With the Vitest extension
installed, you can also click the debug icon next to any test in the **Testing** view.

## 3. Make the change

Any small change works. If you don't have one in mind, this one is visible in every
environment, so you can tell which environments have it:

1. In `apps/web/src/features/tasks/TasksPage.tsx`, change `'No tasks yet.'` to your own wording.
   Vite updates the browser as soon as you save.
2. People will notice the change, so give it a version:
   - Bump `version` in the root `package.json` to `0.5.1`.
   - Add an entry at the top of `apps/web/src/features/about/releases.ts`:
     ```ts
     {
       version: '0.5.1',
       date: '2026-10-30',
       summary: 'A friendlier empty list.',
       changes: [{ kind: 'improved', text: 'Empty sections now say …' }],
     },
     ```
     A unit test fails if the version and the release notes disagree. Try that on purpose to
     see it.

## 4. Check it like CI does

Run **Terminal → Run Task → Checks: format, lint, typecheck, unit tests**, or:

```bash
pnpm format         # fixes formatting
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
pnpm test:integration   # optional: the API against a real Postgres
```

Then commit. The release scripts refuse to run with uncommitted changes, so every image matches a
commit:

```bash
git add -A && git commit -m "Friendlier empty-section message"
```

## 5. Release to staging

First check that nobody else released in the last few minutes. If a `tido-migrate-*` job is only
minutes old, someone just released, and your release would replace theirs:

```bash
kubectl -n tido-staging get pods
deploy/scripts/release-staging.sh
```

Follow what it prints. `staging-release.md` explains each step. The last line it prints is
the command that commits the image digests it pinned. Run that command.

Check staging at https://synisterpc.tailbe657c.ts.net:8443. Test from your **phone** with
Tailscale on, not only from the PC (TIDO-SEC-012). Then check:

- Your new wording shows up in an empty section.
- **What's new** lists 0.5.1.
- `https://synisterpc.tailbe657c.ts.net:8443/version.json` shows your commit.
- In Grafana → Explore → Loki, `{app="tido-api"}` shows your requests as they arrive.

## 6. Promote to production

Production doesn't build anything. It runs the exact images that staging runs, so whatever is
on staging right now goes to production. That includes 0.5.0 (the blue theme) if production
hasn't had it yet.

```bash
deploy/scripts/release-production.sh
```

As with staging, finish by running the commit command it prints. Check https://synisterpc.tailbe657c.ts.net in the same way.
Production has **no backups**, so be careful with any change that includes a migration.

## 7. Share it through GitHub

```bash
git push -u origin learn/first-change
gh pr create --base main --fill
```

Merge the PR on GitHub once CI is green. Then bring your change into `tido/initial-build`,
the branch the other sessions work on, so the two branches don't drift apart:

```bash
git switch tido/initial-build && git merge learn/first-change
```

## If something goes wrong

- **Release failed during migration:** the running app is untouched. Fix the problem, commit,
  and release again.
- **The release works but is wrong:** roll back with the previous release commit's overlay
  (`staging-release.md` / `production-release.md`, "Rolling back").
- **Breakpoint shows as a hollow grey circle:** the file hasn't loaded yet, or you opened
  `Projects` instead of `TiDo` in VS Code.
- **Port 3000 or 5173 already in use:** another `pnpm dev` is running. Find it with
  `ss -ltnp | grep -E ':(3000|5173)'`, and stop it or close its terminal.
