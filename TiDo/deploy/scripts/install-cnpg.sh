#!/usr/bin/env bash
# Installs (or upgrades) the CloudNativePG operator into cnpg-system.
source "$(dirname "$0")/lib.sh"
need kubectl
CNPG_VERSION="${CNPG_VERSION:-1.30.1}"
MINOR="${CNPG_VERSION%.*}"

step "Applying CloudNativePG ${CNPG_VERSION}"
kubectl apply --server-side --force-conflicts -f \
  "https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-${MINOR}/releases/cnpg-${CNPG_VERSION}.yaml"
kubectl -n cnpg-system rollout status deployment/cnpg-controller-manager --timeout=180s
kubectl get crd clusters.postgresql.cnpg.io
