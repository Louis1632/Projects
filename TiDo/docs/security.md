# TiDo security log

Every security finding, fix and accepted risk for TiDo, with what it taught. The platform side
(Traefik, monitoring, Portainer, the host) has its own log in
`Louis1632/homelab-platform`, `docs/security.md` (`HOMELAB-SEC-…` IDs).

## How to use this log

- **One entry per security change**, newest first. IDs are `TIDO-SEC-NNN` and are never reused,
  even if an entry turns out wrong (mark it _Withdrawn_ instead).
- **Add the entry in the same commit as the fix**, so `git log -p docs/security.md` is the history.
- Every entry answers the same questions: what was wrong, why it mattered (the attack, in plain
  words), the fix, how it was verified, and the **lesson**: the general rule to carry into the
  next project.
- Findings not fixed yet go under **Open items**. Things we decided not to fix go under
  **Accepted risks**, with the condition that should make us look again.
- Severity: **High** means someone on the network could get in or read data. **Medium** weakens
  a defence or leaks secrets to places that shouldn't hold them. **Low** is hardening and defence
  in depth.

## Open items

None.

## Accepted risks

| Risk                                                                                                                                                       | Why it's accepted                                                                                                                                                                                                                | Revisit when                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Failed sign-ins are counted per email, so ten wrong passwords in 15 minutes lock that account out for everyone, including its owner.                       | It stops password guessing from many addresses. Since TIDO-SEC-002 the per-IP limit is real again, so a lock-out needs a deliberate attacker on the tailnet.                                                                     | TiDo is ever reachable outside the tailnet.                                                                                       |
| The invite/reset token stays in the browser's address bar and history at `/invite/<token>`.                                                                | Links are single-use and expire (7 days for invites, 24 hours for resets). `Referrer-Policy: same-origin` keeps the token from leaking to other sites. Rewriting the URL would break refresh.                                    | Links become reusable or long-lived.                                                                                              |
| Login throttling lives in the API process, so it resets on restart and wouldn't be shared across replicas.                                                 | TiDo runs one API replica (noted in `deploy/k8s/base/api-deployment.yaml`).                                                                                                                                                      | The API is scaled out.                                                                                                            |
| The development database uses the password `tido`, published in this public repo.                                                                          | It's local test data, bound to loopback since TIDO-SEC-001.                                                                                                                                                                      | Never: don't put real data in the dev database.                                                                                   |
| Staging and production share one host name (ports 8443 and 443), and browsers don't separate cookies by port, so each receives the other's session cookie. | Both run only code from this repo, built by the same person. Cookies are `HttpOnly`, logs redact the `Cookie` header, and each environment has its own HMAC key, so one's session cookie is useless to the other (TIDO-SEC-011). | Staging runs code nobody has reviewed (someone else's branch, PR previews), or staging can get its own name (Tailscale Services). |

## What's already done well

The baseline, recorded on 2026-10-29 by the first review, so later changes don't quietly undo it:

- **Passwords:** Argon2id at OWASP's minimum cost. A dummy hash is checked when the account
  doesn't exist, so response time doesn't reveal which emails have accounts. One generic error
  message.
- **Tokens:** session cookies and sign-in links are 256-bit random values. The database stores
  only an HMAC of each, so a database leak alone yields no usable session or link. Links are
  single-use, expire, and are revoked when a new one is issued.
- **Sessions:** `__Host-` cookie, `HttpOnly`, `Secure`, `SameSite=Lax`. 7 days idle, 30 days
  absolute. A new session at sign-in and on password change (other devices are signed out).
- **CSRF:** every state-changing request must carry `X-CSRF-Request: 1` and, when the browser
  sends one, a matching `Origin`.
- **Authorization:** every API route needs a session unless it opts out (`public: true`).
  Owner-only routes are declared on the route. Every query is scoped to the caller's workspace,
  including referenced IDs (assignees, labels, sections). The last active owner can't be removed.
- **Input:** Zod schemas on every body, query and parameter, with length limits. 256 KB body
  limit. Search escapes `LIKE` wildcards. No raw SQL built from strings.
- **Browser:** strict CSP (`script-src 'self'`, no inline scripts), `frame-ancestors 'none'`, no
  `dangerouslySetInnerHTML`.
- **Containers:** non-root, read-only root filesystem, all capabilities dropped, no privilege
  escalation, seccomp `RuntimeDefault`, no service-account token, namespaces enforce Pod
  Security `restricted`. Images are deployed by digest.
- **Network:** default-deny ingress, and PostgreSQL accepts only TiDo's own pods.
- **Secrets:** generated in the cluster (`openssl rand`), never in git. Logs redact cookies and
  `Authorization` headers. Traces record SQL text but never parameter values.
- **Audit log:** sign-ins (failed too), sign-outs, password changes, invites, role changes and
  deactivations, each with the actor and IP.

## Entries

### TIDO-SEC-012: The tailnet allow-list refused every device except the PC itself

_2026-10-30 · Medium · Fixed (with HOMELAB-SEC-009)_

**What was wrong:** opening staging on a phone with Tailscale on gave 403 Forbidden, and so did
production. Tailscale on the PC had source NAT on (its default, `NoSNAT: false`). Traffic from
other tailnet devices that it forwards into a pod, which includes Traefik's hostPorts, left with
the PC's pod-network address instead of the device's. The `tailnet-only` allow-list
(TIDO-SEC-003) saw no Tailscale address and refused it. Requests from the PC itself aren't
forwarded, so every check run on the PC passed.

**Why it mattered:** the control failed closed, so nothing was exposed, but TiDo was unusable from
every device except the PC. Production had been unreachable from phones since Traefik moved to
hostPorts (HOMELAB-SEC-002). The API's logs confirm it: in the 24 hours before the fix, the only
client address production saw was the PC's own (`100.85.196.89`). Had the allow-list been
written the other way round (block a few ranges, allow the rest), the same rewrite would have
let everything through.

**Fix:** `tailscale set --snat-subnet-routes=false`. That NAT only matters for advertised subnet
routes, which this PC doesn't have. `deploy/scripts/prod-host-setup.sh` now runs it, so a rebuilt
PC gets it too.

**How it was verified (2026-10-30):** `tailscale debug prefs` shows `NoSNAT: true`. The phone
(`100.73.90.7`) loads staging and production, and both APIs log requests from that address.
Wi-Fi requests to both ports still get 403 (TIDO-SEC-011).

**Lesson:** test an allow-list from a device that should be allowed, not just from the host
itself. Every hop that can rewrite addresses (NAT, proxies, load balancers) sits between the
client and the check. And a check that only ever says "no" passes every security test.

### TIDO-SEC-011: Staging is reachable only over Tailscale, with a trusted certificate

_2026-10-30 · Low · Fixed (with HOMELAB-SEC-008)_

**What was wrong:** staging was served at `https://tido-staging.home.arpa` on Traefik's port 443,
with a self-signed certificate and no allow-list. The name resolved only on the PC (through
`/etc/hosts`), but as TIDO-SEC-003 showed, a name hides nothing: anyone on the Wi-Fi who sent
`Host: tido-staging.home.arpa` to `192.168.101.112` reached staging's sign-in page. It also
couldn't be tested from a phone.

**Why it mattered:** staging runs the newest, least-tested code, and its owner account uses the
same email as production's. A guest on the Wi-Fi could try passwords there. The self-signed
certificate also trained us to click through browser warnings.

**Fix:** staging moved to `https://synisterpc.tailbe657c.ts.net:8443`, which is production's
Tailscale name and certificate on Traefik's new `staging` entry point (HOMELAB-SEC-008):

- The `tailnet-only` middleware moved from the production overlay to `deploy/k8s/base`, and both
  overlays attach it. Anything outside Tailscale's ranges gets 403 on either port.
- `deploy/scripts/tailscale-cert.sh` writes the certificate into both namespaces, so the weekly
  cron job renews both. `release-staging.sh` runs it instead of making a self-signed certificate.
- Staging's session cookie is `__Host-tido_staging_session`. Cookies are scoped by host, not
  port, so with one name, signing in to one environment would replace the other's session in the
  same browser. Each environment still receives the other's cookie; see **Accepted risks**.
- `host-setup.sh` no longer adds `tido-staging.home.arpa` to `/etc/hosts`.

**How it was verified:** `kubectl kustomize` of the production overlay renders the same
resources as before, apart from one added `app.kubernetes.io/part-of` label on the middleware.
The staging overlay renders the new host, port, cookie name and middleware. Against release
86c21fe2b9db on staging (2026-10-30), sending the host name to each of the PC's addresses gave:

- Tailscale address, port 8443: 200 (page) and 401 (API, signed out), with the Let's Encrypt
  certificate verified (no `-k`).
- Wi-Fi address `192.168.101.112`, port 8443: 403 on both. `127.0.0.1`: 403.
- Production on 443 is unchanged: 200 over Tailscale, 403 from the Wi-Fi, still release
  18faf73ce798.
- `tido-staging.home.arpa` now gets 404 on every address: no route is left on that name.
- A sign-in POST carrying the old origin (`https://tido-staging.home.arpa`) gets 403 from the
  CSRF check, and the new origin gets past it (400, for the empty body).

From a phone with Tailscale on, staging first answered 403. That turned out to be Tailscale's
source NAT (TIDO-SEC-012). After that fix, the phone loads staging. Still to confirm by hand:
signing in to staging leaves production signed in in the same browser.

**Lesson:** "only this machine can reach it" was true of the name, not of the service. Give every
environment the same access control as production, even a test one. And sharing a host name
across ports shares cookies: ports separate servers, not browser storage.

### TIDO-SEC-010: Dependencies and base images are kept current automatically

_2026-10-29 · Low · Fixed_

**What was wrong:** nothing told us when a dependency, base image or CI action had a security
fix. The Dockerfiles used floating tags (`node:22-alpine`), so two builds of the same commit
could get different base images.

**Why it mattered:** most real-world compromises of small apps go through a known
vulnerability in a dependency that nobody updated.

**Fix:** `.github/dependabot.yml` (at the root of `Louis1632/Projects`) opens weekly PRs for npm
packages, Docker base images and GitHub Actions. Base images are pinned by digest
(`node:22-alpine@sha256:…`), and Dependabot bumps the digest.

**How it was verified:** the images build from the pinned digests, and the full test suite passes.

**Lesson:** pin everything you build from (lockfile, image digest, action SHA), then let a bot
move the pins. Pinning without updating only freezes old bugs in place.

### TIDO-SEC-009: CI actions are pinned to commit SHAs, and CI fails on known vulnerabilities

_2026-10-29 · Low · Fixed_

**What was wrong:** the workflow used `actions/checkout@v7` and similar tags. A tag can be moved
to different code by whoever controls that action's repository.

**Why it mattered:** a hijacked action runs with access to the checkout and the CI token. This
repo is public, so it's a visible target.

**Fix:** `.github/workflows/tido-ci.yml` pins every action to a full commit SHA, with the version
in a comment. A new step runs `pnpm audit --prod --audit-level high`. The container job now
checks every security header on `/`, `/tasks` and an asset (see TIDO-SEC-006).

**How it was verified:** `pnpm audit --prod` reports no known vulnerabilities, and the header
check passes against the built image.

**Lesson:** a tag is a pointer someone else controls; a SHA isn't. Pin third-party CI code by SHA.

### TIDO-SEC-008: Sessions and sign-in links get separate keys

_2026-10-29 · Low · Fixed_

**What was wrong:** `SESSION_SECRET` was the HMAC key for both session cookies and sign-in
links.

**Why it mattered:** nothing exploitable today, since the two are stored in different tables.
But with one key, a value made for one purpose is a valid HMAC for the other. That's the kind of
gap a future change could turn into a bug.

**Fix:** `packages/db/src/tokens.ts` derives one key per purpose from the secret with HKDF-SHA256
(`tido:session`, `tido:account-link`). `hashToken` now requires the purpose. Changing the key
changes every stored hash, so **everyone is signed out once** and unused links stop working
(release 0.1.1 says so on the What's new page).

**How it was verified:** unit, integration and end-to-end tests (sign-in, invite, reset) all pass.

**Lesson:** one secret, one purpose. Derive subkeys (HKDF) rather than reusing a key for two
jobs.

### TIDO-SEC-007: TiDo's pods can only connect to what they need

_2026-10-29 · Low · Fixed_

**What was wrong:** NetworkPolicies limited who could connect _to_ TiDo, but TiDo's pods could
connect _out_ anywhere: the internet, other namespaces, Portainer, the Kubernetes API.

**Why it mattered:** if the API or web container were ever compromised, the attacker could
download tools, send data out, or attack the rest of the cluster from inside it.

**Fix:** egress policies in `deploy/k8s/base/network-policy.yaml`:

- All of TiDo's pods: DNS only.
- API, migration, bootstrap and backup jobs: also PostgreSQL.
- API: also Alloy's trace port in `monitoring`.

The database pods aren't restricted, because the CloudNativePG operator manages them.

**How it was verified (staging, 2026-10-29):** the migration job and the API reach the database,
and new `tido-api` traces arrive in Tempo. From the API pod, `wget https://example.com` and
`wget http://kps-prometheus.monitoring.svc:9090` both fail.

**Lesson:** default-deny goes in both directions. Egress rules turn "attacker inside a
container" into "attacker stuck inside a container".

### TIDO-SEC-006: Security headers reach every page

_2026-10-29 · Low · Fixed_

**What was wrong:** `deploy/docker/nginx.conf` set `Permissions-Policy` and
`Cross-Origin-Opener-Policy` at the server level, but nginx ignores server-level `add_header`
lines in any `location` with its own `add_header`. Both locations had one, so those headers were
never sent. There was also no HSTS on the HTML.

**Why it mattered:** these are defence-in-depth headers, so nothing broke. But the config looked
safer than it was, which is the dangerous part.

**Fix:** the headers moved to `deploy/docker/security-headers.conf`, which every `location`
includes. HSTS was added (`max-age=31536000`). CI now checks every header on several paths.

**How it was verified:** `nginx -t` passes. On staging, `curl -I` on `/` and `/tasks` shows all five
headers (CSP, Permissions-Policy, COOP, Referrer-Policy, HSTS); before, it showed three. CI checks
an asset path too.

**Lesson:** test the headers you get, not the config you wrote. nginx's `add_header` inheritance
is all-or-nothing per level.

### TIDO-SEC-005: Password changes are throttled

_2026-10-29 · Low · Fixed_

**What was wrong:** `POST /api/v1/auth/password` checks the current password, but only the global
limit of 300 requests a minute applied to it.

**Why it mattered:** someone with a stolen session (an unlocked laptop, a copied cookie) could
guess the account's real password quickly, then keep access after the session is revoked.

**Fix:** the route uses the same `LoginThrottle` as sign-in, keyed by user. After 10 wrong current
passwords in 15 minutes it answers 429 even to the right password, so the guesser learns nothing
more.

**How it was verified:** an integration test (`auth.test.ts`, "stops guessing the current
password…").

**Lesson:** every endpoint that checks a password is a sign-in endpoint and needs the same
brute-force protection.

### TIDO-SEC-004: Sign-in link tokens stay out of logs and traces

_2026-10-29 · Medium · Fixed (with HOMELAB-SEC-004)_

**What was wrong:** the token of an invite or reset link appeared in URLs that get logged:

- The web app looked it up with `GET /api/v1/auth/tokens/<token>`, which the API logs and the
  trace records.
- nginx logs `GET /invite/<token>` when the page loads.
- The bootstrap job prints the owner's setup link, and Alloy ships pod logs to Loki before the
  script deletes the job.

Loki keeps logs for 7 days.

**Why it mattered:** anyone who could read logs (Grafana, or any pod before HOMELAB-SEC-003)
could use a still-unused link to set the account's password and take it over. A setup link
makes them the workspace owner.

**Fix:**

- **API:** the lookup is `POST /api/v1/auth/tokens/lookup` with the token in the JSON body.
  Bodies are never logged.
- **API logs:** the request serializer runs URLs through `redactUrl`
  (`apps/api/src/lib/redact.ts`), which replaces any 40+ character token-like string. UUIDs
  (36 characters) stay readable.
- **Platform:** Alloy redacts `/invite/…`, `/reset/…` and `/auth/tokens/…` tokens in every log
  line before it reaches Loki. This covers nginx and the bootstrap job (HOMELAB-SEC-004).

**How it was verified:** unit test `redact.test.ts` and the updated integration and end-to-end
tests pass. On staging, loading `/invite/<a fake 43-character token>` left the nginx line
`GET /invite/[redacted]` in Loki, and no stored line contains the raw token.

**Lesson:** a secret in a URL is a secret in every log, proxy and browser history it passes
through. Put secrets in bodies or headers, and redact at the log pipeline as a backstop.

### TIDO-SEC-003: Production is reachable only over Tailscale

_2026-10-29 · High · Fixed (with HOMELAB-SEC-002)_

**What was wrong:** production was meant to be private to the tailnet, but only DNS made it
so. Traefik listens on the PC's Wi-Fi address too (192.168.101.112:443), and routes by host
name. Anyone on the Wi-Fi who sent `Host: synisterpc.tailbe657c.ts.net` reached production. The
name isn't secret either: every Let's Encrypt certificate is published in Certificate
Transparency logs.

**Why it mattered:** a guest on the Wi-Fi (or a compromised smart device) could reach the
production sign-in page and try passwords.

**Fix:** `deploy/k8s/overlays/production/tailnet-only.yaml`, a Traefik `ipAllowList` middleware
allowing only Tailscale's ranges (`100.64.0.0/10`, `fd7a:115c:a1e0::/48`). It's attached to the
HTTPS ingress and to the HTTP→HTTPS redirect. For this to work, Traefik must see the real client
IP (HOMELAB-SEC-002).

**How it was verified (release 18faf73ce798, 2026-10-29):** sending the production host name to
each of the PC's addresses gave:

- Tailscale address `100.85.196.89`: 200 (HTTPS), 301 (HTTP to HTTPS), 401 (API, signed out).
- Wi-Fi address `192.168.101.112`: 403 on all three.
- `127.0.0.1`: 403. On the PC itself, use the `ts.net` name, which MagicDNS resolves to the
  Tailscale address.

A check from a phone (Tailscale off: 403; on: TiDo loads) confirms it from outside the PC.

_Correction (2026-10-30):_ the "on: TiDo loads" result can't have come from this release. Since
HOMELAB-SEC-002, Tailscale's source NAT made every other tailnet device look internal, so phones
got 403 until TIDO-SEC-012 fixed it.

**Lesson:** a hostname isn't access control. "Private" has to be enforced where traffic
arrives: firewall, listener address or allow-list.

### TIDO-SEC-002: The API sees each client's real IP

_2026-10-29 · Medium · Fixed (with HOMELAB-SEC-002)_

**What was wrong:** K3s's ServiceLB, the proxy in front of Traefik, rewrites every request's
source address to its own pod address (`10.42.0.x`). The API trusted every proxy hop
(`TRUST_PROXY=true`). So the API saw one "client" IP for everybody.

**Why it mattered:**

- The per-IP sign-in limit (10 a minute) was really one global limit, so anyone could lock
  everyone out of signing in.
- The audit log recorded the same internal IP for every sign-in, so it couldn't show who did
  what.
- Trusting every hop would let a client choose its own IP with a forged `X-Forwarded-For`, if a
  proxy ever passed that header through.

**Fix:**

- `TRUST_PROXY` accepts a hop count (`apps/api/src/config.ts`), and Kubernetes sets `'1'`,
  so only Traefik is trusted and `request.ip` is the address Traefik saw. A forged
  `X-Forwarded-For` can no longer choose the IP.
- Traefik receives the real address: it binds ports 80/443 itself, with no ServiceLB proxy
  in front (HOMELAB-SEC-002).

**How it was verified (staging, 2026-10-29):** unit tests cover the `TRUST_PROXY` forms. Before
the Traefik change, every failed sign-in recorded `10.42.0.125` (the ServiceLB pod). After it, the
same requests recorded `100.85.196.89` over Tailscale and `192.168.101.112` over the LAN.

**Lesson:** per-IP controls (rate limits, audit, allow-lists) are only as good as the IP. Check
what IP the app actually sees, and trust exactly as many proxies as you have.

### TIDO-SEC-001: The development database is no longer exposed to the network

_2026-10-29 · High · Fixed_

**What was wrong:** `deploy/compose/docker-compose.yml` published PostgreSQL as `5432:5432`,
which means every network interface. The PC's firewall (ufw) didn't help: Docker writes its own
iptables rules that skip ufw. The username and password (`tido`/`tido`) are in this public
repo.

**Why it mattered:** anyone on the Wi-Fi could connect to the development database as its owner,
read or change everything, and use PostgreSQL features to run commands inside the container.

**Fix:** the port is published as `127.0.0.1:5432:5432`, loopback only. To apply it on an
existing machine, run
`docker compose -f deploy/compose/docker-compose.yml up -d`, which recreates the container and
keeps the data volume.

**How it was verified (2026-10-29):** found with `ss -tln` (`0.0.0.0:5432`) and `docker ps`
(`0.0.0.0:5432->5432/tcp`). After `docker compose … up -d`, `docker ps` shows
`127.0.0.1:5432->5432/tcp`, `ss -tln` shows `127.0.0.1:5432` only, and the data volume (with
its users) is intact.

**Lesson:** Docker-published ports bypass ufw. Always bind development services to `127.0.0.1`,
and check with `ss -tln` what is actually listening on `0.0.0.0`.
