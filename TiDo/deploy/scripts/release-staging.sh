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
  step "Building ${image}" >&2
  docker_cmd buildx build --file "apps/${name}/Dockerfile" --tag "$image" \
    --label "org.opencontainers.image.revision=${RELEASE}" --load . >&2
  docker_cmd push "$image" >&2
  # The registry digest identifies exactly these bytes; tags can be moved, digests cannot.
  docker_cmd inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image" \
    | grep "^${REGISTRY}/tido/${name}@" | head -1 | cut -d@ -f2
}

API_DIGEST="$(build_and_push api)"
WEB_DIGEST="$(build_and_push web)"
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

step "Applying platform resources (namespace, config, database, network policies, ingress)"
kubectl apply -k "$OVERLAY" -l tido.io/phase=platform

if ! kubectl -n "$NAMESPACE" get secret tido-api-secrets >/dev/null 2>&1; then
  step "Creating the session secret (stored only in the cluster)"
  kubectl -n "$NAMESPACE" create secret generic tido-api-secrets \
    --from-literal=session-secret="$(openssl rand -base64 48)"
fi
if ! kubectl -n "$NAMESPACE" get secret tido-tls >/dev/null 2>&1; then
  step "Creating a self-signed TLS certificate for tido-staging.home.arpa (staging only)"
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=tido-staging.home.arpa" \
    -addext "subjectAltName=DNS:tido-staging.home.arpa" -keyout "$tmp/tls.key" -out "$tmp/tls.crt" 2>/dev/null
  kubectl -n "$NAMESPACE" create secret tls tido-tls --cert="$tmp/tls.crt" --key="$tmp/tls.key"
fi

step "Waiting for PostgreSQL (CloudNativePG cluster tido-db)"
for _ in $(seq 1 60); do
  kubectl -n "$NAMESPACE" get secret tido-db-app >/dev/null 2>&1 && break
  sleep 5
done
kubectl -n "$NAMESPACE" wait --for=condition=Ready cluster/tido-db --timeout=600s

step "Running database migrations (job tido-migrate-${RELEASE})"
kubectl -n "$NAMESPACE" delete job "tido-migrate-${RELEASE}" --ignore-not-found >/dev/null
sed -e "s|__RELEASE__|${RELEASE}|g" -e "s|__API_IMAGE__|${API_IMAGE}|g" deploy/k8s/jobs/migrate-job.yaml \
  | kubectl -n "$NAMESPACE" apply -f -
if ! kubectl -n "$NAMESPACE" wait --for=condition=complete "job/tido-migrate-${RELEASE}" --timeout=300s; then
  kubectl -n "$NAMESPACE" logs "job/tido-migrate-${RELEASE}" || true
  fail "migrations failed; the running app was not changed"
fi
kubectl -n "$NAMESPACE" logs "job/tido-migrate-${RELEASE}"

step "Rolling out the API and web app"
kubectl apply -k "$OVERLAY"
kubectl -n "$NAMESPACE" rollout status deployment/tido-api --timeout=300s
kubectl -n "$NAMESPACE" rollout status deployment/tido-web --timeout=300s

step "Released ${RELEASE} to ${NAMESPACE}"
kubectl -n "$NAMESPACE" get pods -o wide
echo
echo "Open https://tido-staging.home.arpa (self-signed certificate)."
echo "Commit the pinned digests:  git add deploy/k8s/overlays/staging/kustomization.yaml && git commit -m 'Release ${RELEASE} to staging'"
