# Shared helpers for TiDo deploy scripts. Source, do not execute.
set -euo pipefail
shopt -s inherit_errexit  # so a failure inside $(...) also stops the script

TIDO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REGISTRY="${TIDO_REGISTRY:-localhost:5000}"
NAMESPACE="${TIDO_NAMESPACE:-tido-staging}"
OVERLAY="${TIDO_ROOT}/deploy/k8s/overlays/staging"
PROD_NAMESPACE=tido-production
PROD_OVERLAY="${TIDO_ROOT}/deploy/k8s/overlays/production"
BACKUP_DIR=/srv/tido-backups/production
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config}"

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required"; }

# Runs docker, explaining the fix when the docker group (added by host-setup.sh)
# has not reached this login session yet.
docker_cmd() {
  if ! docker info >/dev/null 2>&1; then
    fail "cannot reach Docker. If host-setup.sh just added you to the docker group, log out and back in (or reboot) first."
  fi
  docker "$@"
}

# This machine's Tailscale name, e.g. synisterpc.tail1234.ts.net (production's hostname).
tailscale_host() {
  local host
  host="$(tailscale status --json 2>/dev/null | python3 -c 'import json, sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' 2>/dev/null || true)"
  [[ "$host" == *.ts.net ]] || fail "no Tailscale name for this machine: is Tailscale logged in, with MagicDNS on?"
  echo "$host"
}

# Release steps shared by staging and production. Each takes the overlay directory and
# namespace explicitly so the two environments cannot be mixed up.

# Namespace, config, database, network policies, services and ingress.
apply_platform() {
  local overlay="$1"
  step "Applying platform resources (namespace, config, database, network policies, ingress)"
  kubectl apply -k "$overlay" -l tido.io/phase=platform
}

# Random session secret, created once and stored only in the cluster.
ensure_session_secret() {
  local ns="$1"
  if ! kubectl -n "$ns" get secret tido-api-secrets >/dev/null 2>&1; then
    step "Creating the session secret (stored only in the cluster)"
    kubectl -n "$ns" create secret generic tido-api-secrets \
      --from-literal=session-secret="$(openssl rand -base64 48)"
  fi
}

# Waits for PostgreSQL, runs the one-off migration job, then rolls out the API and web app.
# If migrations fail, the running app is left untouched.
migrate_and_roll_out() {
  local overlay="$1" ns="$2" release="$3" api_image="$4"

  step "Waiting for PostgreSQL (CloudNativePG cluster tido-db)"
  for _ in $(seq 1 60); do
    kubectl -n "$ns" get secret tido-db-app >/dev/null 2>&1 && break
    sleep 5
  done
  kubectl -n "$ns" wait --for=condition=Ready cluster/tido-db --timeout=600s

  step "Running database migrations (job tido-migrate-${release})"
  kubectl -n "$ns" delete job "tido-migrate-${release}" --ignore-not-found >/dev/null
  sed -e "s|__RELEASE__|${release}|g" -e "s|__API_IMAGE__|${api_image}|g" \
    "${TIDO_ROOT}/deploy/k8s/jobs/migrate-job.yaml" | kubectl -n "$ns" apply -f -
  if ! kubectl -n "$ns" wait --for=condition=complete "job/tido-migrate-${release}" --timeout=300s; then
    kubectl -n "$ns" logs "job/tido-migrate-${release}" || true
    fail "migrations failed; the running app was not changed"
  fi
  kubectl -n "$ns" logs "job/tido-migrate-${release}"

  step "Rolling out the API and web app"
  kubectl apply -k "$overlay"
  kubectl -n "$ns" rollout status deployment/tido-api --timeout=300s
  kubectl -n "$ns" rollout status deployment/tido-web --timeout=300s

  step "Released ${release} to ${ns}"
  kubectl -n "$ns" get pods -o wide
}
