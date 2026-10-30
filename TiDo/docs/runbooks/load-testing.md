# Load testing and autoscaling

A throwaway copy of TiDo, in namespace `tido-loadtest`, that you can hammer with made-up traffic
to see where it bends and to watch the API **autoscale**. It is a learning playground, not a
gate any release has to pass.

- It **never touches staging or production.** Its own namespace, its own database, its own
  owner. It has no ingress, so nothing outside the cluster can reach it; the load generator runs
  inside the namespace.
- It runs the **exact images staging runs** (by digest), so you are testing the real app.
- The API **autoscales from 1 to 4 pods** on CPU. This is deliberately kept out of staging and
  production, because login throttling and rate limiting are counted per pod
  (`docs/security.md`, TIDO-SEC-013).

The load generator is [k6](https://k6.io/): you describe virtual users in JavaScript, and it
runs thousands of them. The scripts live in `loadtest/`; everything is driven by
`deploy/scripts/loadtest.sh`.

## One-time check

```bash
export KUBECONFIG=$HOME/.kube/config
kubectl -n kube-system get deploy metrics-server   # autoscaling reads CPU from this
```

Staging must have been released at least once, because load testing reuses its image digests.

## The four commands

```bash
deploy/scripts/loadtest.sh up      # build the environment and make an owner (a few minutes)
deploy/scripts/loadtest.sh run …   # run one test
deploy/scripts/loadtest.sh watch   # live view of the autoscaler and pods
deploy/scripts/loadtest.sh down    # delete the whole namespace when you're done
```

`up` is safe to run again: it skips anything that already exists.

## Running a test

```bash
deploy/scripts/loadtest.sh run <mode> [KEY=VALUE ...]
```

Pick a **mode** for the shape of load, and pass settings as `KEY=VALUE`:

| Mode       | What the virtual users do                             | Good for                                                            |
| ---------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| `browse`   | Sign in, open the app, read lists, add/edit tasks     | A realistic mix; a gentle ramp                                      |
| `login`    | Sign in, over and over                                | **Driving CPU up to watch autoscaling** (sign-in hashes a password) |
| `register` | Invite + accept an account, over and over             | The account-creation path (also hashes)                             |
| `api`      | Read-heavy API calls (dashboard, calendar, task list) | Throughput of reads                                                 |
| `security` | One pass of the authorization checks                  | Confirming the defences hold under load                             |

Settings (all optional; sensible defaults):

| Setting    | Applies to         | Default | Meaning                                       |
| ---------- | ------------------ | ------- | --------------------------------------------- |
| `DURATION` | all                | `2m`    | How long to hold the load (`30s`, `5m`, …)    |
| `VUS`      | browse             | `50`    | Number of simultaneous people at the peak     |
| `RAMP`     | browse             | `30s`   | Time to climb to `VUS`                        |
| `RATE`     | login/register/api | `30`    | Requests started per second, held steady      |
| `MAX_VUS`  | login/register/api | `200`   | Ceiling on workers k6 uses to keep that rate  |
| `USERS`    | all                | `20`    | Size of the reusable pool of sign-in accounts |

Examples:

```bash
deploy/scripts/loadtest.sh run login RATE=50 DURATION=3m       # 50 sign-ins/second for 3 minutes
deploy/scripts/loadtest.sh run browse VUS=150 RAMP=1m DURATION=5m
deploy/scripts/loadtest.sh run api RATE=300 MAX_VUS=400
deploy/scripts/loadtest.sh run security
```

The command follows k6's output and prints a summary when the run ends: requests per second,
response-time percentiles, and the pass/fail checks. Pressing `Ctrl+C` only stops you watching;
the run keeps going in the cluster. `loadtest.sh status` shows past runs.

## Watching it autoscale

In a second terminal, before or during a run:

```bash
deploy/scripts/loadtest.sh watch
```

It refreshes the autoscaler, the API pods and their CPU every couple of seconds. The clearest
demonstration:

```bash
deploy/scripts/loadtest.sh run login RATE=60 DURATION=5m
```

What you should see, roughly:

1. One API pod, CPU climbing past its request (250m) as sign-ins hash passwords.
2. The HPA's `TARGETS` column rises above `60%`, and `REPLICAS` steps up (2 new pods every 15s,
   to the max of 4).
3. Response times settle as the new pods share the load (the Service spreads requests over every
   ready pod).
4. After the run, CPU drops, and about a minute later the HPA scales back toward one pod.

The same thing in raw `kubectl`:

```bash
kubectl -n tido-loadtest get hpa tido-api -w
kubectl -n tido-loadtest get pods -l app.kubernetes.io/name=tido-api -w
kubectl -n tido-loadtest top pods
```

## Watching it in Grafana

The load-test namespace is wired into the same monitoring stack as staging and production, so you
can watch the effect of a run on every signal:

- **Dashboard:** open **TiDo Overview** and set the `namespace` variable to `tido-loadtest` (it
  appears there on its own while the namespace exists). Requests per second, error rate, p95
  latency by route, CPU and memory — all for the load-test pods.
- **Logs:** Explore → Loki, `{app="tido-api", namespace="tido-loadtest"}`. Add `| json` and, say,
  `responseTime > 300` to watch slow requests pile up under load.
- **Traces:** Explore → Tempo, service `tido-api`, namespace `tido-loadtest`, to see a slow
  request broken down.
- **Autoscaling vs. the request rate:** put the dashboard's requests-per-second panel next to
  `loadtest.sh watch` and you can see pods being added as the rate climbs.

Metrics come from the two PodMonitors in `deploy/observability/pod-monitors.yaml`, which now
include `tido-loadtest`. Logs and traces need nothing extra: Alloy already reads every pod's
logs, and the load-test API sends traces to the same collector as the other environments.

The TiDo **alerts are deliberately not applied to `tido-loadtest`** — a load test is supposed to
be slow and error-prone, and the namespace is usually gone, so alerting on it would only cry
wolf (`deploy/observability/tido-alerts.yaml`). Staging and production still alert as before.

## Finding the limits

Push until something gives, and read what gave:

- Raise `RATE` (or `VUS`) run by run. When p95 latency climbs or `http_req_failed` rises, you've
  found the ceiling at the current pod count.
- Lower `maxReplicas` in `deploy/k8s/overlays/loadtest/autoscaling.yaml` to 1 and compare: this
  shows what autoscaling buys you.
- The database is a single instance with a 100-connection limit and modest CPU/memory
  (`deploy/k8s/base/database.yaml`), so at high read rates it, not the API, often becomes the
  limit. Watch `tido-db` in `top pods`.
- The API pods are capped at one CPU core each (the loadtest overlay), which is what makes adding
  pods the only way to serve more — exactly the point of the exercise.

## Tidy up

```bash
deploy/scripts/loadtest.sh down
```

This deletes the namespace and everything in it: the database, its data, the owner, every test
account, and all the tasks the tests created. Nothing to restore, by design.

## How it's built

| Piece                                           | What it is                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------- |
| `deploy/k8s/overlays/loadtest/`                 | The Kustomize overlay: namespace, config, autoscaler, no ingress      |
| `deploy/k8s/overlays/loadtest/autoscaling.yaml` | The HorizontalPodAutoscaler (CPU, 1→4 pods)                           |
| `deploy/k8s/jobs/loadgen-job.yaml`              | The k6 run, as a one-off Job inside the namespace                     |
| `loadtest/tido.js`                              | The test: the modes above                                             |
| `loadtest/api.js`                               | A small TiDo client for k6 (session cookie, CSRF header, per-user IP) |
| `loadtest/security.js`                          | The authorization checks                                              |
| `deploy/scripts/loadtest.sh`                    | Ties it together: `up`, `run`, `watch`, `status`, `down`              |

Each simulated person sends an `X-Forwarded-For`, so the per-IP rate limit treats them as
separate clients (the API trusts one proxy hop; here the load generator is that hop). The run
uses the same images, config and rate limits as production, except the invite-link address.

## Trying it against local dev instead

You don't need the cluster to play with the scripts. Point k6 at your running `pnpm dev` and a
local owner (see `local-dev.md` for the local owner's email):

```bash
docker run --rm --network host -v "$PWD/loadtest:/scripts:ro" \
  -e API_URL=http://127.0.0.1:3000 -e WEB_URL=http://127.0.0.1:5173 \
  -e SESSION_COOKIE=tido_session \
  -e OWNER_EMAIL=you@example.test -e OWNER_PASSWORD='your-dev-password' \
  -e MODE=browse -e VUS=10 -e DURATION=30s \
  grafana/k6:2.3.0 run /scripts/tido.js
```

There's no autoscaling locally (it's a single Node process), but every mode runs, and it's a
quick way to see the output. Note the dev rate limit is 300 requests/minute per client, so a high
`RATE` will show `429`s — which is the limit working.
