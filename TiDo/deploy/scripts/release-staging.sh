#!/usr/bin/env bash
# Manual, step-by-step staging release:
#   build → push to the local registry → pin digests and the Tailscale hostname in Git →
#   certificate → migrate → roll out.
# Staging is served at https://<this machine's Tailscale name>:8443, for the tailnet only.
# Usage: deploy/scripts/release-staging.sh [--allow-dirty]
source "$(dirname "$0")/lib.sh"
need kubectl; need git; need curl; need python3; need openssl; need tailscale
cd "$TIDO_ROOT"

# Files this script writes; everything else must be committed.
WRITTEN=(kustomization.yaml ingress-patch.yaml config-patch.yaml)
if [[ "${1:-}" != "--allow-dirty" ]] \
  && [[ -n "$(git status --porcelain -- . "${WRITTEN[@]/#/:!deploy/k8s/overlays/staging/}")" ]]; then
  fail "commit your changes first so the images match a Git revision (or pass --allow-dirty)"
fi
RELEASE="$(git rev-parse --short=12 HEAD)"
[[ "${1:-}" == "--allow-dirty" ]] && RELEASE="${RELEASE}-dirty"
curl -fsS "http://${REGISTRY}/v2/" >/dev/null || fail "registry ${REGISTRY} is not running (deploy/scripts/registry.sh up)"
kubectl get crd clusters.postgresql.cnpg.io >/dev/null || fail "CloudNativePG is not installed (deploy/scripts/install-cnpg.sh)"
[[ "$(kubectl -n kube-system get deploy traefik -o jsonpath='{.spec.template.spec.containers[0].ports[?(@.name=="staging")].hostPort}')" == 8443 ]] \
  || fail "Traefik has no staging port 8443 (homelab-platform: scripts/install.sh traefik)"
HOST="$(tailscale_host)"

build_and_push() {
  local name="$1" image="${REGISTRY}/tido/$1:${RELEASE}"
  shift
  step "Building ${image}" >&2
  docker_cmd buildx build --file "apps/${name}/Dockerfile" --tag "$image" \
    --label "org.opencontainers.image.revision=${RELEASE}" "$@" --load . >&2
  docker_cmd push "$image" >&2
  # The registry digest identifies exactly these bytes; tags can be moved, digests cannot.
  docker_cmd inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image" \
    | grep "^${REGISTRY}/tido/${name}@" | head -1 | cut -d@ -f2
}

API_DIGEST="$(build_and_push api)"
WEB_DIGEST="$(build_and_push web --build-arg "TIDO_REVISION=${RELEASE}")"
[[ "$API_DIGEST" == sha256:* && "$WEB_DIGEST" == sha256:* ]] || fail "could not read image digests"

step "Pinning digests and hostname ${HOST} in deploy/k8s/overlays/staging"
python3 - "$OVERLAY" "$API_DIGEST" "$WEB_DIGEST" "$HOST" <<'PY'
import re, sys
overlay, api, web, host = sys.argv[1:]

def rewrite(name, pattern, replacement, expected):
    path = f"{overlay}/{name}"
    text, count = re.subn(pattern, replacement, open(path).read())
    if count != expected:
        sys.exit(f"could not update {name}")
    open(path, "w").write(text)

for app, digest in (("api", api), ("web", web)):
    rewrite("kustomization.yaml", rf"(- name: tido-{app}\n\s+newName: [^\n]+\n\s+digest: )sha256:[0-9a-f]+", rf"\g<1>{digest}", 1)
rewrite("ingress-patch.yaml", r"(value: )\S+", rf"\g<1>{host}", 2)
rewrite("config-patch.yaml", r"(WEB_ORIGIN: )\S+", rf"\g<1>https://{host}:8443", 1)
PY
API_IMAGE="${REGISTRY}/tido/api@${API_DIGEST}"
echo "api: ${API_IMAGE}"
echo "web: ${REGISTRY}/tido/web@${WEB_DIGEST}"

apply_platform "$OVERLAY"
ensure_session_secret "$NAMESPACE"
step "Installing the Tailscale certificate for ${HOST}"
"$TIDO_ROOT/deploy/scripts/tailscale-cert.sh"
migrate_and_roll_out "$OVERLAY" "$NAMESPACE" "$RELEASE" "$API_IMAGE"
echo
echo "Open https://${HOST}:8443 from any device with Tailscale on."
echo "Commit the pinned digests:  git add deploy/k8s/overlays/staging && git commit -m 'Release ${RELEASE} to staging'"
