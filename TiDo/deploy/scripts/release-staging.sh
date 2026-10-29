#!/usr/bin/env bash
# Manual, step-by-step staging release:
#   build → push to the local registry → pin digests in Git → migrate → roll out.
# Usage: deploy/scripts/release-staging.sh [--allow-dirty]
source "$(dirname "$0")/lib.sh"
need kubectl; need git; need curl; need python3; need openssl
cd "$TIDO_ROOT"

if [[ "${1:-}" != "--allow-dirty" ]] && [[ -n "$(git status --porcelain -- . ':!deploy/k8s/overlays/staging/kustomization.yaml')" ]]; then
  fail "commit your changes first so the images match a Git revision (or pass --allow-dirty)"
fi
RELEASE="$(git rev-parse --short=12 HEAD)"
[[ "${1:-}" == "--allow-dirty" ]] && RELEASE="${RELEASE}-dirty"
curl -fsS "http://${REGISTRY}/v2/" >/dev/null || fail "registry ${REGISTRY} is not running (deploy/scripts/registry.sh up)"
kubectl get crd clusters.postgresql.cnpg.io >/dev/null || fail "CloudNativePG is not installed (deploy/scripts/install-cnpg.sh)"

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

step "Pinning digests in deploy/k8s/overlays/staging/kustomization.yaml"
python3 - "$OVERLAY/kustomization.yaml" "$API_DIGEST" "$WEB_DIGEST" <<'PY'
import re, sys
path, api, web = sys.argv[1:]
text = open(path).read()
for name, digest in (("api", api), ("web", web)):
    text, count = re.subn(
        rf"(- name: tido-{name}\n\s+newName: [^\n]+\n\s+digest: )sha256:[0-9a-f]+", rf"\g<1>{digest}", text)
    if count != 1:
        sys.exit(f"could not update tido-{name} digest")
open(path, "w").write(text)
PY
API_IMAGE="${REGISTRY}/tido/api@${API_DIGEST}"
echo "api: ${API_IMAGE}"
echo "web: ${REGISTRY}/tido/web@${WEB_DIGEST}"

apply_platform "$OVERLAY"
ensure_session_secret "$NAMESPACE"
if ! kubectl -n "$NAMESPACE" get secret tido-tls >/dev/null 2>&1; then
  step "Creating a self-signed TLS certificate for tido-staging.home.arpa (staging only)"
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=tido-staging.home.arpa" \
    -addext "subjectAltName=DNS:tido-staging.home.arpa" -keyout "$tmp/tls.key" -out "$tmp/tls.crt" 2>/dev/null
  kubectl -n "$NAMESPACE" create secret tls tido-tls --cert="$tmp/tls.crt" --key="$tmp/tls.key"
fi
migrate_and_roll_out "$OVERLAY" "$NAMESPACE" "$RELEASE" "$API_IMAGE"
echo
echo "Open https://tido-staging.home.arpa (self-signed certificate)."
echo "Commit the pinned digests:  git add deploy/k8s/overlays/staging/kustomization.yaml && git commit -m 'Release ${RELEASE} to staging'"
