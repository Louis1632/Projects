#!/usr/bin/env bash
# Starts (or stops) the temporary staging image registry on 127.0.0.1:5000.
# Staging only: plain HTTP on loopback, no authentication. See docs/runbooks/production-gates.md.
source "$(dirname "$0")/lib.sh"

case "${1:-up}" in
  up)
    if docker_cmd container inspect tido-registry >/dev/null 2>&1; then
      docker_cmd start tido-registry >/dev/null
    else
      docker_cmd run -d --name tido-registry --restart=unless-stopped \
        -p 127.0.0.1:5000:5000 -v tido-registry:/var/lib/registry registry:3 >/dev/null
    fi
    for _ in $(seq 1 20); do
      curl -fsS "http://${REGISTRY}/v2/" >/dev/null 2>&1 && { echo "Registry ready at ${REGISTRY}"; exit 0; }
      sleep 1
    done
    fail "registry did not become ready"
    ;;
  down) docker_cmd stop tido-registry ;;
  catalog) curl -fsS "http://${REGISTRY}/v2/_catalog" && echo ;;
  *) fail "usage: $0 [up|down|catalog]" ;;
esac
