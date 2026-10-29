# Shared helpers for TiDo deploy scripts. Source, do not execute.
set -euo pipefail
shopt -s inherit_errexit  # so a failure inside $(...) also stops the script

TIDO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REGISTRY="${TIDO_REGISTRY:-localhost:5000}"
NAMESPACE="${TIDO_NAMESPACE:-tido-staging}"
OVERLAY="${TIDO_ROOT}/deploy/k8s/overlays/staging"
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
