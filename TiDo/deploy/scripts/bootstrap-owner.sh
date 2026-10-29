#!/usr/bin/env bash
# Creates the first workspace owner on staging and prints a single-use setup link.
# Usage: deploy/scripts/bootstrap-owner.sh owner@example.com "Owner Name"
source "$(dirname "$0")/lib.sh"
need kubectl; need python3
EMAIL="${1:?usage: $0 email \"Display name\"}"
NAME="${2:-Workspace owner}"
cd "$TIDO_ROOT"

API_IMAGE="$(kubectl -n "$NAMESPACE" get deployment tido-api -o jsonpath='{.spec.template.spec.containers[0].image}')"
[[ -n "$API_IMAGE" ]] || fail "release the app first (deploy/scripts/release-staging.sh)"

kubectl -n "$NAMESPACE" delete job tido-bootstrap --ignore-not-found >/dev/null
python3 - "$API_IMAGE" "$EMAIL" "$NAME" <<'PY' | kubectl -n "$NAMESPACE" apply -f -
import json, sys
image, email, name = sys.argv[1:]
text = open("deploy/k8s/jobs/bootstrap-owner-job.yaml").read()
# json.dumps yields a safely quoted YAML scalar.
for key, value in (("__API_IMAGE__", image), ("__OWNER_EMAIL__", json.dumps(email)), ("__OWNER_NAME__", json.dumps(name))):
    text = text.replace(key, value)
print(text)
PY
kubectl -n "$NAMESPACE" wait --for=condition=complete job/tido-bootstrap --timeout=120s || true
echo
kubectl -n "$NAMESPACE" logs job/tido-bootstrap
# The log contains a one-time secret link; do not leave it lying around.
kubectl -n "$NAMESPACE" delete job tido-bootstrap >/dev/null
