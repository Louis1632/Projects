#!/usr/bin/env bash
# Promotes the release running on staging to production:
#   check staging → pin its digests and the Tailscale hostname in Git → certificate →
#   back up the current database → migrate → roll out.
# Nothing is rebuilt: production runs the exact image bytes that were tested on staging.
# Usage: deploy/scripts/release-production.sh
source "$(dirname "$0")/lib.sh"
need kubectl; need git; need python3; need openssl; need tailscale
cd "$TIDO_ROOT"

# Files this script writes; everything else must be committed.
WRITTEN=(kustomization.yaml ingress-patch.yaml config-patch.yaml redirect.yaml)
if [[ -n "$(git status --porcelain -- . "${WRITTEN[@]/#/:!deploy/k8s/overlays/production/}")" ]]; then
  fail "commit your changes first so production matches a Git revision"
fi

step "Checking the release running on staging"
read -r API_DIGEST WEB_DIGEST < <(python3 - "$OVERLAY/kustomization.yaml" <<'PY'
import re, sys
text = open(sys.argv[1]).read()
print(*(re.search(rf"- name: tido-{n}\n\s+newName: [^\n]+\n\s+digest: (sha256:[0-9a-f]+)", text).group(1) for n in ("api", "web")))
PY
)
for name in api web; do
  digest="$([[ $name == api ]] && echo "$API_DIGEST" || echo "$WEB_DIGEST")"
  running="$(kubectl -n "$NAMESPACE" get deployment "tido-${name}" -o jsonpath='{.spec.template.spec.containers[0].image}')"
  [[ "$running" == "${REGISTRY}/tido/${name}@${digest}" ]] \
    || fail "staging runs ${running}, not the digest pinned in Git; release to staging first"
  kubectl -n "$NAMESPACE" rollout status "deployment/tido-${name}" --timeout=10s >/dev/null \
    || fail "tido-${name} is not healthy on staging"
done
API_IMAGE="${REGISTRY}/tido/api@${API_DIGEST}"
docker_cmd pull -q "$API_IMAGE" >/dev/null
RELEASE="$(docker_cmd image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$API_IMAGE")"
[[ -n "$RELEASE" ]] || fail "could not read the release revision from ${API_IMAGE}"
echo "Promoting ${RELEASE}"

step "Checking the backup drive"
[[ -f "${BACKUP_DIR}/.tido-backup-drive" ]] \
  || fail "the backup drive is not mounted at ${BACKUP_DIR%/*} (sudo bash deploy/scripts/prod-host-setup.sh /dev/sdXN)"
df -h "${BACKUP_DIR%/*}" | tail -1

HOST="$(tailscale_host)"
step "Pinning digests and hostname ${HOST} in deploy/k8s/overlays/production"
python3 - "$PROD_OVERLAY" "$API_DIGEST" "$WEB_DIGEST" "$HOST" <<'PY'
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
rewrite("config-patch.yaml", r"(WEB_ORIGIN: )\S+", rf"\g<1>https://{host}", 1)
rewrite("redirect.yaml", r"(- host: )\S+", rf"\g<1>{host}", 1)
PY

apply_platform "$PROD_OVERLAY"
ensure_session_secret "$PROD_NAMESPACE"
step "Installing the Tailscale certificate for ${HOST}"
"$TIDO_ROOT/deploy/scripts/tailscale-cert.sh"

# A dump taken just before migrating, so a bad migration can be undone by restoring it.
if kubectl -n "$PROD_NAMESPACE" get cronjob tido-backup >/dev/null 2>&1 \
  && kubectl -n "$PROD_NAMESPACE" get secret tido-db-app >/dev/null 2>&1; then
  step "Backing up the production database before migrating"
  kubectl -n "$PROD_NAMESPACE" delete job "tido-backup-pre-${RELEASE}" --ignore-not-found >/dev/null
  kubectl -n "$PROD_NAMESPACE" create job "tido-backup-pre-${RELEASE}" --from=cronjob/tido-backup
  if ! kubectl -n "$PROD_NAMESPACE" wait --for=condition=complete "job/tido-backup-pre-${RELEASE}" --timeout=600s; then
    kubectl -n "$PROD_NAMESPACE" logs "job/tido-backup-pre-${RELEASE}" || true
    fail "pre-release backup failed; nothing was migrated or rolled out"
  fi
  kubectl -n "$PROD_NAMESPACE" logs "job/tido-backup-pre-${RELEASE}"
fi

migrate_and_roll_out "$PROD_OVERLAY" "$PROD_NAMESPACE" "$RELEASE" "$API_IMAGE"
echo
echo "Open https://${HOST} from any device on your tailnet."
echo "Commit the release:  git add deploy/k8s/overlays/production && git commit -m 'Release ${RELEASE} to production'"
