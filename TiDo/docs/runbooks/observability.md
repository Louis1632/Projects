# Observability: metrics, logs, traces and alerts

A free, self-hosted stack on the staging K3s host, set up by hand one phase at a time so you
learn what each part does. Run every command from the repository root.

```
TiDo API ──/metrics :9464──┐
PostgreSQL (CNPG) :9187 ───┼──► Prometheus ──► Alertmanager
Traefik :9100 ─────────────┤        │
node, kubelet, kube-state ─┘        ▼
                                 Grafana ◄── Loki ◄── Alloy ◄── every pod's stdout
                                    ▲
TiDo API ──OTLP traces :4318──► Tempo
```

| Piece              | Job                                                        | Comparable to       |
| ------------------ | ---------------------------------------------------------- | ------------------- |
| Prometheus         | Pulls ("scrapes") numbers from `/metrics` every 30s        | Datadog metrics     |
| Alertmanager       | Groups and routes alerts that Prometheus rules fire        | PagerDuty front end |
| Grafana            | Dashboards, log search and alert views over all of it      | Kibana              |
| Loki               | Stores logs, indexed only by labels (cheap on one machine) | Elasticsearch       |
| Alloy              | Collects logs from pods and pushes them to Loki            | Filebeat / Logstash |
| Tempo              | Stores traces: each request as a tree of timed steps       | Jaeger / APM        |
| node-exporter      | Host CPU, memory, disk, network                            |                     |
| kube-state-metrics | Kubernetes objects: restarts, replicas, pod phases         |                     |

Files:

| Path                                             | What it is                                         |
| ------------------------------------------------ | -------------------------------------------------- |
| `deploy/monitoring/values/*.yaml`                | Helm values, one file per chart                    |
| `deploy/monitoring/k8s/pod-monitors.yaml`        | What Prometheus scrapes for TiDo, CNPG and Traefik |
| `deploy/monitoring/k8s/tido-alerts.yaml`         | TiDo alert rules                                   |
| `deploy/k8s/base/network-policy-monitoring.yaml` | Lets `monitoring` through TiDo's default-deny      |
| `apps/api/src/plugins/metrics.ts`                | The API's request histogram and `/metrics` server  |
| `apps/api/src/telemetry.ts`                      | The API's tracing: request, handler and SQL spans  |

Expect about 2.5–3 GB of RAM and 32 GB of disk (Prometheus, Loki and Tempo 10 each, Grafana 2)
in total.

## Phase 0: tools and access

```bash
sudo snap install helm --classic
helm version

# K3s's bundled kubectl defaults to /etc/rancher/k3s/k3s.yaml, which only root can read.
# Helm needs the same setting. Make it permanent:
echo 'export KUBECONFIG=$HOME/.kube/config' >> ~/.bashrc && source ~/.bashrc
kubectl get nodes

# Chart repositories. Grafana moved its OSS charts to grafana-community in 2026; Alloy
# is still published from the grafana repository.
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add grafana-community https://grafana-community.github.io/helm-charts
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update

# Grafana is served by Traefik at https://grafana.home.arpa
echo '127.0.0.1 grafana.home.arpa' | sudo tee -a /etc/hosts
kubectl create namespace monitoring
```

**Learn:** a Helm _chart_ is a templated bundle of Kubernetes YAML; a _release_ is one install
of it; _values_ fill in the templates. `helm show values <chart>` lists every setting, and
`helm template ... -f values.yaml` prints the YAML it would apply without touching the cluster.
Versions are pinned below so you get exactly what these files were tested against.

## Phase 1: Prometheus and Grafana

```bash
helm upgrade --install kps prometheus-community/kube-prometheus-stack --version 92.15.0 \
  -n monitoring -f deploy/monitoring/values/kube-prometheus-stack.yaml --wait --timeout 10m
kubectl -n monitoring get pods
```

Read `deploy/monitoring/values/kube-prometheus-stack.yaml` alongside: every setting is
commented with why it is there (the K3s-specific ones especially).

Grafana login is `admin` with this password:

```bash
kubectl -n monitoring get secret kps-grafana -o jsonpath='{.data.admin-password}' | base64 -d; echo
```

Open https://grafana.home.arpa (accept Traefik's self-signed certificate). Change the password
under your profile.

Prometheus itself has a plain UI that is the best place to learn scraping. It is not exposed;
port-forward when you want it:

```bash
kubectl -n monitoring port-forward svc/kps-prometheus 9090    # http://localhost:9090
```

**Explore:**

1. Prometheus → **Status → Targets**: every endpoint being scraped and whether it is up. This
   page is your first stop whenever a panel is empty.
2. Grafana → **Dashboards**: the chart ships ~25. Open _Kubernetes / Compute Resources /
   Namespace (Pods)_ and choose `tido-staging`. You already have CPU and memory per TiDo pod,
   from the kubelet's cAdvisor, without changing TiDo.
3. Grafana → **Explore** (Prometheus) and try PromQL, one line at a time:

   ```promql
   up                                                  # 1 = target scraped OK, 0 = failed
   node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes
   kube_pod_container_status_restarts_total{namespace="tido-staging"}
   rate(container_cpu_usage_seconds_total{namespace="tido-staging", container!=""}[5m])
   ```

   `rate()` turns an ever-increasing counter into a per-second rate. Most counters are useless
   without it.

## Phase 2: scrape TiDo, PostgreSQL and Traefik

```bash
kubectl apply -k deploy/monitoring/k8s
```

In Prometheus → Targets, after a minute:

- `podMonitor/monitoring/traefik` is **UP**.
- `podMonitor/monitoring/tido-db` is **DOWN** with `connection refused` for any namespace
  that does not yet have the `tido-db-metrics` NetworkPolicy.
- `tido-api` is missing entirely: the running pod has no port named `metrics` yet, so the
  PodMonitor matches nothing.

The database one is TiDo's default-deny NetworkPolicy blocking Prometheus, exactly what you
would see in a real incident. K3s's policy engine actively rejects the connection, so it shows
as `connection refused`; with network plugins that silently drop instead, the same problem
shows as `context deadline exceeded`. Confirm it (use whichever namespace is down):

```bash
kubectl -n tido-production get networkpolicy        # no tido-db-metrics
kubectl -n tido-production describe networkpolicy tido-db-ingress   # no rule for port 9187
```

The fix is `deploy/k8s/base/network-policy-monitoring.yaml`, which ships with the Phase 3
release. (The API target also needs the new image, which adds the metrics port.)

**Explore:** in Explore, type `traefik_` and browse the metric names. Try
`sum by (code) (rate(traefik_service_requests_total[5m]))`, then use TiDo in the browser and
watch it change.

**Import community dashboards:** Dashboards → New → Import, by ID from
grafana.com/grafana/dashboards: **17346** (Traefik) and **1860** (Node Exporter Full). Search
the site for _CloudNativePG_ for the database dashboard. Pick the Prometheus data source when
asked.

## Phase 3: application metrics

The API now has a Prometheus endpoint on a separate port (9464), so it never passes through
the ingress, auth or rate limiting. Read `apps/api/src/plugins/metrics.ts`. It records one
histogram:

```
http_request_duration_seconds_bucket{method="GET", route="/api/v1/tasks", status_code="200", le="0.05"}
```

`route` is the route _pattern_, not the URL. A label per task ID would create a new time series
for every task, which is the classic way to overload Prometheus (high cardinality). Process
metrics come from `collectDefaultMetrics` in `apps/api/src/server.ts`: memory, heap, GC,
event-loop lag.

Release it (this also applies the new NetworkPolicy and `METRICS_PORT` config):

```bash
git status          # the release script refuses to run with uncommitted changes
git add apps/api packages/db/package.json pnpm-lock.yaml deploy/monitoring \
  docs/runbooks/observability.md deploy/k8s/base/api-deployment.yaml \
  deploy/k8s/base/configmap.yaml deploy/k8s/base/kustomization.yaml \
  deploy/k8s/base/network-policy-monitoring.yaml
git commit -m "Add metrics, logs and alerts for TiDo"
deploy/scripts/release-staging.sh
```

Check from your machine (port-forward goes through the kubelet, so NetworkPolicy does not
apply):

```bash
kubectl -n tido-staging port-forward deploy/tido-api 9464 &
curl -s localhost:9464/metrics | grep http_request_duration_seconds_count
kill %1
```

Both TiDo targets should now be UP in Prometheus.

### Build the TiDo dashboard yourself

Grafana → Dashboards → New. Add a variable first: Settings → Variables → Query,
name `namespace`, query `label_values(up{job="tido-api"}, namespace)`. Then add one panel per
query (`$__rate_interval` lets Grafana pick a safe window for the zoom level):

| Panel (visualisation)       | Query                                                                                                                                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requests/s by route (time)  | `sum by (route) (rate(http_request_duration_seconds_count{job="tido-api", namespace="$namespace"}[$__rate_interval]))`                                                                                                                          |
| Error % (stat)              | `100 * sum(rate(http_request_duration_seconds_count{job="tido-api", namespace="$namespace", status_code=~"5.."}[$__rate_interval])) / sum(rate(http_request_duration_seconds_count{job="tido-api", namespace="$namespace"}[$__rate_interval]))` |
| p95 latency by route (time) | `histogram_quantile(0.95, sum by (route, le) (rate(http_request_duration_seconds_bucket{job="tido-api", namespace="$namespace"}[$__rate_interval])))`                                                                                           |
| Status codes (bar)          | `sum by (status_code) (increase(http_request_duration_seconds_count{job="tido-api", namespace="$namespace"}[$__range]))`                                                                                                                        |
| API memory (time)           | `process_resident_memory_bytes{job="tido-api", namespace="$namespace"}` (unit: bytes)                                                                                                                                                           |
| Event-loop lag p99 (time)   | `nodejs_eventloop_lag_p99_seconds{job="tido-api", namespace="$namespace"}` (unit: seconds)                                                                                                                                                      |
| DB connections (time)       | `cnpg_backends_total{job="tido-db", namespace="$namespace"}`                                                                                                                                                                                    |
| DB commits/s (time)         | `rate(cnpg_pg_stat_database_xact_commit{job="tido-db", namespace="$namespace", datname="tido"}[$__rate_interval])`                                                                                                                              |
| DB size (stat)              | `cnpg_pg_database_size_bytes{job="tido-db", namespace="$namespace", datname="tido"}`                                                                                                                                                            |

If a CNPG metric name differs in your version, type `cnpg_` in the query editor and pick the
nearest one. Save the dashboard. These are the RED signals (rate, errors, duration) plus
saturation (memory, event loop, connections): the first things to check in any incident.

**Exercise: business metrics.** Add a counter such as `tido_tasks_completed_total` in
`apps/api/src/modules/tasks/service.ts` (register it on the same registry), release, and graph
`increase(tido_tasks_completed_total[1d])`. This is how you measure what users actually do.

## Phase 4: logs with Loki and Alloy

```bash
helm upgrade --install loki grafana-community/loki --version 20.0.3 \
  -n monitoring -f deploy/monitoring/values/loki.yaml --wait --timeout 10m
helm upgrade --install alloy grafana/alloy --version 1.14.4 \
  -n monitoring -f deploy/monitoring/values/alloy.yaml --wait
kubectl -n monitoring get pods
```

Read the pipeline in `deploy/monitoring/values/alloy.yaml`: discover pods → turn metadata into
labels → tail logs → parse the API's JSON level → push to Loki. Alloy has its own UI showing
that pipeline live, with each component's health:

```bash
kubectl -n monitoring port-forward deploy/alloy 12345    # http://localhost:12345
```

Grafana already has the Loki data source. Grafana → Explore → Loki, and try LogQL:

```logql
{namespace="tido-staging", app="tido-api"}                         # all API logs
{app="tido-api", level="error"}                                    # errors only
{app="tido-api"} | json | res_statusCode >= 400                    # parse fields, filter
{app="tido-api"} | json | responseTime > 300                       # slow requests (ms)
{app="tido-api"} |= "<reqId from a log line>"                      # follow one request
{namespace="tido-staging", container="postgres"}                   # database logs
sum by (level) (count_over_time({app="tido-api"}[5m]))             # logs as a metric
```

A `{...}` selector picks streams by label (fast, uses the index); everything after `|` scans the
text of those streams. Narrow with labels first.

Add two panels to the TiDo dashboard: a **Logs** panel with
`{namespace="$namespace", app="tido-api", level=~"warn|error"}`, and a time series of
`sum by (level) (count_over_time({namespace="$namespace", app="tido-api"}[$__auto]))`. Now a
latency spike and the errors that caused it sit on the same screen and the same time axis.

## Phase 5: alerts and fault finding

The rules in `deploy/monitoring/k8s/tido-alerts.yaml` were applied in Phase 2. See them in
Prometheus → **Alerts**, or Grafana → Alerting → Alert rules. Alertmanager only collects them
for now; sending to email, Telegram, Slack or similar is set in the chart's
`alertmanager.config` when you want it.

Break things on purpose and find the cause using only the dashboards and Explore:

1. **API down:** `kubectl -n tido-staging scale deploy/tido-api --replicas=0`. Watch the target
   go down, then `TidoApiDown` go pending and then firing after 2 minutes. Scale back to 1.
2. **Errors:** stop the database with
   `kubectl -n tido-staging annotate cluster tido-db --overwrite cnpg.io/hibernation=on` and
   use TiDo for a few minutes. Find the 5xx in the error panel, the matching `level="error"`
   lines in Loki, and `TidoDatabaseDown`. Bring it back with `cnpg.io/hibernation=off`.
3. **Memory:** watch _API memory_ while clicking through the calendar months, then compare
   with the container limit (512Mi) in _Kubernetes / Compute Resources / Pod_.

For each one, write down which panel told you first. That becomes your troubleshooting order.

## Phase 6: traces with Tempo

A trace is one request drawn as a tree of timed steps, called spans:

```
POST /api/v1/tasks                       ██████████████████████  48 ms
├─ handler - …                            ████████████████████   44 ms
│  ├─ SELECT  (load the project)           ██                      3 ms
│  ├─ INSERT  (the task)                      ███                  5 ms
│  └─ INSERT  (audit event)                       ██               2 ms
```

Metrics say _that_ p95 latency rose; a trace says _which step_ was slow. The API code is in
`apps/api/src/telemetry.ts`:

- `@fastify/otel` makes the root span per request, named by route pattern like the metrics'
  `route` label, plus a child span for the handler. The health probes are skipped.
- Every SQL query gets a span with its parameterised text (`… where "email" = $1`). Parameter
  values are never recorded, since they can contain password hashes and tokens. drizzle-orm
  0.45 contains span code of its own, but it never loads OpenTelemetry, so TiDo wraps Drizzle's
  query methods itself.
- Each log line written during a request gets `trace_id` and `span_id` (the pino `mixin`).
- The API exports only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (the cluster ConfigMap sets
  it), so local development and tests run without tracing.

Install Tempo:

```bash
helm upgrade --install tempo grafana-community/tempo --version 3.2.1 \
  -n monitoring -f deploy/monitoring/values/tempo.yaml --wait
```

The Grafana values define the Tempo data source and the links between Loki and Tempo; apply
them with the Phase 1 `helm upgrade --install kps …` command. Then release TiDo (staging, then
production) so the API starts sending traces.

**Explore:**

1. Grafana → Explore → **Tempo** → Query type **Search**: Service name `tido-api`. Each row is a
   request; click one to open its waterfall. Click a span to see its attributes (route, status,
   SQL text).
2. **Traces → logs:** on any span, click the logs icon. Grafana runs
   `{app="tido-api"} |= "<trace id>"` in Loki: the `incoming request` and `request completed`
   lines for exactly that request.
3. **Logs → traces:** in Explore → Loki, expand any `tido-api` request line. Next to
   `trace_id` there is a **View trace** button.
4. **TraceQL**, Tempo's query language (Query type **TraceQL**):

   ```traceql
   { resource.service.name = "tido-api" && duration > 50ms }
   { span.db.system.name = "postgresql" && duration > 10ms }
   { resource.k8s.namespace.name = "tido-production" && span.http.response.status_code >= 500 }
   ```

   The first finds slow requests, the second slow queries, the third production errors.

5. **Drilldown → Traces** is the click-through view, like Logs Drilldown: rate, errors and
   duration per span name, without writing queries.

**Exercise:** open the calendar for a busy month, find that request in Tempo, and count its SQL
spans. Many small identical queries in a row (an "N+1") is the classic thing traces reveal.

## Troubleshooting

| Symptom                                  | Check                                                                                                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Panel says "No data"                     | Prometheus → Targets: is the job UP? Then run the panel's query in Explore without filters.                                                                     |
| Target DOWN, `connection refused`        | On K3s, a NetworkPolicy (Phase 2). Otherwise the pod is not listening: check `METRICS_PORT`.                                                                    |
| Target DOWN, `context deadline exceeded` | A NetworkPolicy that drops silently, or a pod too busy to answer within the scrape timeout.                                                                     |
| PodMonitor has no target at all          | Its `selector` labels or port _name_ do not match the pod: `kubectl get pod --show-labels`.                                                                     |
| No logs in Loki                          | Alloy UI (port 12345): is `loki.write` healthy? `kubectl -n monitoring logs deploy/alloy`.                                                                      |
| Alloy change has no effect               | Helm templates the config: compare `kubectl -n monitoring get cm alloy -o yaml` with the values file. A changed ConfigMap reaches the pod after up to a minute. |
| Loki "too many outstanding requests"     | Shorten the time range or narrow the label selector before any filters.                                                                                         |
| No traces in Tempo                       | `kubectl -n tido-staging exec deploy/tido-api -- env \| grep OTEL`, then `kubectl -n monitoring logs tempo-0`.                                                  |
| `helm` cannot reach the cluster          | `echo $KUBECONFIG` should print `~/.kube/config` (Phase 0).                                                                                                     |

## Upgrading or removing

Bump the `--version` in the commands above after reading the chart's release notes, then rerun
the same `helm upgrade --install`. kube-prometheus-stack major versions may need CRD updates
first; its README lists the steps.

```bash
kubectl delete -k deploy/monitoring/k8s
helm -n monitoring uninstall tempo alloy loki kps
kubectl delete namespace monitoring     # also deletes stored metrics, logs and dashboards
```
