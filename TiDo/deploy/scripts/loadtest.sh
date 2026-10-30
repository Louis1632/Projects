#!/usr/bin/env bash
# Load testing against a throwaway copy of TiDo in namespace tido-loadtest, with the API
# autoscaled. Never touches staging or production. See docs/runbooks/load-testing.md.
#
#   loadtest.sh up                 create the namespace, database, app and autoscaler; make an owner
#   loadtest.sh run [MODE] [K=V…]  run one k6 test (MODE: browse|login|register|api|security)
#   loadtest.sh watch              live view of the autoscaler and pods while a test runs
#   loadtest.sh status             pods, autoscaler and recent test runs
#   loadtest.sh down               delete the whole namespace
#
# Examples:
#   loadtest.sh run login RATE=50 DURATION=3m        50 sign-ins/second for three minutes
#   loadtest.sh run browse VUS=100 DURATION=5m       100 people clicking around
#   loadtest.sh run api RATE=200 MAX_VUS=400         heavy read load
source "$(dirname "$0")/lib.sh"

LT_NS=tido-loadtest
LT_OVERLAY="${TIDO_ROOT}/deploy/k8s/overlays/loadtest"
STAGING_OVERLAY="${TIDO_ROOT}/deploy/k8s/overlays/staging"
OWNER_SECRET=tido-loadtest-owner
OWNER_EMAIL=owner@loadtest.invalid

# The two image digests staging currently runs (committed in its overlay). Load testing reuses
# the exact images that were tested on staging rather than building its own.
read_staging_digests() {
  python3 - "$STAGING_OVERLAY/kustomization.yaml" <<'PY'
import re, sys
text = open(sys.argv[1]).read()
out = {}
for app in ("api", "web"):
    m = re.search(rf"- name: tido-{app}\n\s+newName: (\S+)\n\s+digest: (sha256:[0-9a-f]+)", text)
    if not m:
        sys.exit(f"could not read the {app} image from staging; release staging first")
    out[app] = f"{m.group(1)}@{m.group(2)}"
print(out["api"]); print(out["web"])
PY
}

# The overlay with the two images pinned, as YAML on stdout. The committed overlay leaves the
# image names unresolved (image: tido-api / tido-web); this fills them in without editing Git.
render_lt() {
  kubectl kustomize "$LT_OVERLAY" \
    | sed -e "s#\(image: \)tido-api\$#\1${API_IMAGE}#" \
          -e "s#\(image: \)tido-web\$#\1${WEB_IMAGE}#"
}

load_images() {
  need kubectl; need python3; need sed
  mapfile -t _d < <(read_staging_digests)
  API_IMAGE="${_d[0]}"; WEB_IMAGE="${_d[1]}"
  [[ "$API_IMAGE" == *@sha256:* && "$WEB_IMAGE" == *@sha256:* ]] || fail "could not read staging image digests"
}

cmd_up() {
  load_images; need openssl
  local manifest; manifest="$(render_lt)"

  step "Creating the load-test platform (namespace, config, database, network policies)"
  echo "$manifest" | kubectl apply -l tido.io/phase=platform -f -

  ensure_session_secret "$LT_NS"

  step "Waiting for PostgreSQL"
  for _ in $(seq 1 60); do kubectl -n "$LT_NS" get secret tido-db-app >/dev/null 2>&1 && break; sleep 5; done
  kubectl -n "$LT_NS" wait --for=condition=Ready cluster/tido-db --timeout=600s

  step "Running database migrations"
  kubectl -n "$LT_NS" delete job tido-migrate-loadtest --ignore-not-found >/dev/null
  sed -e "s|__RELEASE__|loadtest|g" -e "s|__API_IMAGE__|${API_IMAGE}|g" \
    "${TIDO_ROOT}/deploy/k8s/jobs/migrate-job.yaml" | kubectl -n "$LT_NS" apply -f -
  if ! kubectl -n "$LT_NS" wait --for=condition=complete job/tido-migrate-loadtest --timeout=300s; then
    kubectl -n "$LT_NS" logs job/tido-migrate-loadtest || true
    fail "migrations failed"
  fi

  step "Rolling out the API (autoscaled), web app and autoscaler"
  echo "$manifest" | kubectl apply -l tido.io/phase=app -f -
  echo "$manifest" | kubectl apply -f -   # the HorizontalPodAutoscaler and anything unlabelled
  kubectl -n "$LT_NS" rollout status deployment/tido-api --timeout=300s
  kubectl -n "$LT_NS" rollout status deployment/tido-web --timeout=300s

  ensure_owner
  step "Ready. Run a test, e.g.:  deploy/scripts/loadtest.sh run login RATE=50 DURATION=3m"
  echo "Watch it scale in another terminal:  deploy/scripts/loadtest.sh watch"
}

# Creates the load-test workspace owner once and stores its sign-in in a secret the k6 Job reads.
ensure_owner() {
  if kubectl -n "$LT_NS" get secret "$OWNER_SECRET" >/dev/null 2>&1; then
    step "Load-test owner already exists"
    return
  fi
  step "Creating the load-test owner"
  local out url token password
  out="$(TIDO_NAMESPACE="$LT_NS" "$TIDO_ROOT/deploy/scripts/bootstrap-owner.sh" "$OWNER_EMAIL" "Load Test Owner")"
  url="$(printf '%s\n' "$out" | grep -oE 'https?://[^ ]+/(invite|reset)/[A-Za-z0-9_-]+' | head -1)"
  token="${url##*/}"
  [[ -n "$token" ]] || fail "could not read the setup token from bootstrap-owner output"
  password="Lt-$(openssl rand -hex 12)"   # >= 12 characters, meets the password policy

  # The app isn't exposed outside the cluster, so set the owner's password through a short-lived
  # port-forward, then throw it away.
  kubectl -n "$LT_NS" port-forward svc/tido-api 18099:3000 >/dev/null 2>&1 &
  local pf=$!
  trap 'kill "$pf" 2>/dev/null || true' RETURN
  for _ in $(seq 1 20); do curl -fsS -o /dev/null "http://127.0.0.1:18099/api/v1/auth/me" 2>/dev/null && break; sleep 0.5; done
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:18099/api/v1/auth/tokens/accept" \
    -H 'Content-Type: application/json' -H 'X-CSRF-Request: 1' \
    -d "{\"token\":\"${token}\",\"password\":\"${password}\"}")"
  [[ "$code" == 200 ]] || fail "could not set the owner password (HTTP ${code})"

  kubectl -n "$LT_NS" create secret generic "$OWNER_SECRET" \
    --from-literal=email="$OWNER_EMAIL" --from-literal=password="$password"
}

cmd_run() {
  need kubectl
  kubectl get ns "$LT_NS" >/dev/null 2>&1 || fail "run 'loadtest.sh up' first"
  kubectl -n "$LT_NS" get secret "$OWNER_SECRET" >/dev/null 2>&1 || fail "no load-test owner; run 'loadtest.sh up'"

  local mode="${1:-browse}"; shift || true
  case "$mode" in browse|login|register|api|security) ;; *) fail "unknown MODE '$mode' (browse|login|register|api|security)";; esac

  step "Loading the k6 scripts"
  kubectl -n "$LT_NS" create configmap tido-loadgen-scripts \
    --from-file="${TIDO_ROOT}/loadtest/" --dry-run=client -o yaml | kubectl apply -f -

  step "Settings for this run: MODE=${mode} $*"
  local literals=(--from-literal=MODE="$mode")
  local kv
  for kv in "$@"; do
    [[ "$kv" == *=* ]] || fail "settings look like KEY=VALUE, not '$kv'"
    literals+=(--from-literal="$kv")
  done
  kubectl -n "$LT_NS" create configmap tido-loadgen-settings "${literals[@]}" \
    --dry-run=client -o yaml | kubectl apply -f -

  local run; run="$(date +%Y%m%d-%H%M%S)"
  step "Starting k6 run ${run}"
  sed "s|__RUN__|${run}|g" "${TIDO_ROOT}/deploy/k8s/jobs/loadgen-job.yaml" | kubectl -n "$LT_NS" apply -f -

  echo "Following the k6 output (Ctrl+C just stops watching; the run keeps going):"
  for _ in $(seq 1 30); do
    kubectl -n "$LT_NS" get pod -l job-name="tido-loadgen-${run}" 2>/dev/null | grep -q tido-loadgen && break
    sleep 1
  done
  kubectl -n "$LT_NS" logs -f "job/tido-loadgen-${run}"
}

cmd_watch() {
  need kubectl
  echo "Autoscaler and pods in ${LT_NS} (Ctrl+C to stop). CPU needs metrics-server."
  while true; do
    clear
    date
    echo; echo "== HorizontalPodAutoscaler =="
    kubectl -n "$LT_NS" get hpa tido-api 2>/dev/null
    echo; echo "== API pods =="
    kubectl -n "$LT_NS" get pods -l app.kubernetes.io/name=tido-api -o wide 2>/dev/null
    echo; echo "== CPU / memory =="
    kubectl -n "$LT_NS" top pods -l app.kubernetes.io/name=tido-api 2>/dev/null || echo "(metrics not ready yet)"
    sleep 2
  done
}

cmd_status() {
  need kubectl
  kubectl -n "$LT_NS" get hpa,deploy,pods 2>/dev/null || fail "namespace ${LT_NS} not found (run 'loadtest.sh up')"
  echo; echo "Recent k6 runs:"
  kubectl -n "$LT_NS" get jobs -l app.kubernetes.io/name=tido-loadgen 2>/dev/null
}

cmd_down() {
  need kubectl
  kubectl get ns "$LT_NS" >/dev/null 2>&1 || { echo "Nothing to remove."; return; }
  read -r -p "Delete namespace ${LT_NS} and everything in it? [y/N] " answer
  [[ "$answer" == [yY] ]] || { echo "Left it alone."; return; }
  kubectl delete ns "$LT_NS"
}

case "${1:-}" in
  up) shift; cmd_up "$@" ;;
  run) shift; cmd_run "$@" ;;
  watch) shift; cmd_watch "$@" ;;
  status) shift; cmd_status "$@" ;;
  down) shift; cmd_down "$@" ;;
  *) sed -n '2,20p' "$0"; exit 1 ;;
esac
