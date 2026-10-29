# Observability: TiDo's metrics, logs, traces and alerts

The monitoring stack itself (Prometheus, Grafana, Alertmanager, Loki, Tempo and the Alloy agent)
is shared by every app and lives in its own repo, **`Louis1632/homelab-platform`**: install,
troubleshooting and upgrades are in its `docs/observability.md`. TiDo follows that repo's
`docs/onboarding-an-app.md` contract. This page covers what TiDo sends and how to use it.

```
TiDo API ──/metrics :9464──────────────► Prometheus ──► alerts (deploy/observability)
TiDo PostgreSQL (CNPG) :9187 ──────────►
TiDo pods' JSON logs ───► Alloy agent ─► Loki
TiDo API OTLP traces ───► Alloy :4318 ─► Tempo          all three in Grafana
```

| Path                                             | What it is                                           |
| ------------------------------------------------ | ---------------------------------------------------- |
| `deploy/observability/pod-monitors.yaml`         | What Prometheus scrapes for TiDo: API and database   |
| `deploy/observability/tido-alerts.yaml`          | TiDo alert rules                                     |
| `deploy/k8s/base/network-policy-monitoring.yaml` | Lets `monitoring` through TiDo's default-deny        |
| `apps/api/src/plugins/metrics.ts`                | The API's request histogram and `/metrics` server    |
| `apps/api/src/telemetry.ts`                      | The API's tracing: request, handler and SQL spans    |
| `OTEL_EXPORTER_OTLP_ENDPOINT` in the ConfigMap   | Where traces go: the Alloy agent, never Tempo itself |

## Setup

With the platform stack installed:

```bash
kubectl apply -k deploy/observability
```

Then release TiDo as usual; the release applies the NetworkPolicy and ConfigMap. In
Prometheus → Targets, `tido-api` and `tido-db` should be UP for both `tido-staging` and
`tido-production`.

If `tido-db` is DOWN with `connection refused`, that namespace is missing the `tido-db-metrics`
NetworkPolicy: TiDo's default-deny is blocking Prometheus, exactly as it would in a real
incident. K3s's policy engine rejects the connection, so it shows as `connection refused`; with
network plugins that silently drop, the same problem shows as `context deadline exceeded`.

```bash
kubectl -n tido-production get networkpolicy        # tido-api-metrics, tido-db-metrics present?
```

## Metrics

The API serves Prometheus metrics on a separate port (9464), so they never pass through the
ingress, auth or rate limiting. `apps/api/src/plugins/metrics.ts` records one histogram:

```
http_request_duration_seconds_bucket{method="GET", route="/api/v1/tasks", status_code="200", le="0.05"}
```

`route` is the route _pattern_, not the URL. A label per task ID would create a new time series
for every task, the classic way to overload Prometheus (high cardinality). Process metrics come
from `collectDefaultMetrics` in `apps/api/src/server.ts`: memory, heap, GC, event-loop lag.

Check from your machine (port-forward goes through the kubelet, so NetworkPolicy doesn't apply):

```bash
kubectl -n tido-staging port-forward deploy/tido-api 9464 &
curl -s localhost:9464/metrics | grep http_request_duration_seconds_count
kill %1
```

### The TiDo dashboard

Grafana → Dashboards → New. Add a variable first: Settings → Variables → Query, name
`namespace`, query `label_values(up{job="tido-api"}, namespace)`. Then one panel per query
(`$__rate_interval` lets Grafana pick a safe window for the zoom level):

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
| Warnings and errors (logs)  | `{namespace="$namespace", app="tido-api", level=~"warn\|error"}` (Loki)                                                                                                                                                                         |
| Log levels (time)           | `sum by (level) (count_over_time({namespace="$namespace", app="tido-api"}[$__auto]))` (Loki)                                                                                                                                                    |

If a CNPG metric name differs in your version, type `cnpg_` in the query editor and pick the
nearest one. These are the RED signals (rate, errors, duration) plus saturation (memory, event
loop, connections), with the matching logs on the same time axis.

**Exercise: business metrics.** Add a counter such as `tido_tasks_completed_total` in
`apps/api/src/modules/tasks/service.ts` (register it on the same registry), release, and graph
`increase(tido_tasks_completed_total[1d])`.

## Logs

The API logs pino JSON. The platform's Alloy agent labels every line with `namespace`, `pod`,
`container`, `app` and `level` (pino's numbers become names):

```logql
{namespace="tido-staging", app="tido-api"}                         # all API logs
{app="tido-api", level="error"}                                    # errors only
{app="tido-api"} | json | res_statusCode >= 400                    # parse fields, filter
{app="tido-api"} | json | responseTime > 300                       # slow requests (ms)
{app="tido-api"} |= "<reqId from a log line>"                      # follow one request
{namespace="tido-staging", container="postgres"}                   # database logs
```

## Traces

`apps/api/src/telemetry.ts`:

- `@fastify/otel` makes the root span per request, named by route pattern like the metrics'
  `route` label, plus a child span for the handler. The health probes are skipped.
- Every SQL query gets a span with its parameterised text (`… where "email" = $1`). Parameter
  values are never recorded, since they can contain password hashes and tokens. drizzle-orm
  0.45 contains span code of its own but never loads OpenTelemetry, so TiDo wraps Drizzle's
  query methods itself. SQL outside a traced request is not traced.
- Each log line written during a request gets `trace_id` and `span_id` (the pino `mixin`), so
  Grafana links logs and traces both ways.
- The service name is `tido-api`, the same as the pod's `app` label (the platform contract).
- The API exports only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (the cluster ConfigMap sets it
  to the Alloy agent), so local development and tests run without tracing.

```traceql
{ resource.service.name = "tido-api" && duration > 50ms }
{ span.db.system.name = "postgresql" && duration > 10ms }
{ resource.k8s.namespace.name = "tido-production" && span.http.response.status_code >= 500 }
```

The first finds slow requests, the second slow queries, the third production errors.

**Exercise:** open the calendar for a busy month, find that request in Tempo, and count its SQL
spans. Many small identical queries in a row (an "N+1") is the classic thing traces reveal.

## Alerts

`deploy/observability/tido-alerts.yaml` adds what only TiDo's own metrics can tell; the
platform's default rules already cover crash loops, full volumes and node pressure.

| Alert              | Fires when                                     |
| ------------------ | ---------------------------------------------- |
| `TidoApiDown`      | The API's `/metrics` is unreachable for 2 min  |
| `TidoApiErrors`    | Over 5% of requests are 5xx for 10 min         |
| `TidoApiSlow`      | p95 latency is above 1s for 10 min             |
| `TidoDatabaseDown` | The database exporter is unreachable for 2 min |

### Fault-finding drills

Break things on staging on purpose and find the cause using only the dashboard and Explore:

1. **API down:** `kubectl -n tido-staging scale deploy/tido-api --replicas=0`. Watch the target
   go down, then `TidoApiDown` go pending and then firing after 2 minutes. Scale back to 1.
2. **Errors:** stop the database with
   `kubectl -n tido-staging annotate cluster tido-db --overwrite cnpg.io/hibernation=on` and
   use TiDo for a few minutes. Find the 5xx in the error panel, the matching `level="error"`
   lines in Loki, and `TidoDatabaseDown`. Bring it back with `cnpg.io/hibernation=off`.
3. **Memory:** watch _API memory_ while clicking through the calendar months, then compare
   with the container limit (512Mi) in _Kubernetes / Compute Resources / Pod_.

For each one, write down which panel told you first. That becomes your troubleshooting order.
