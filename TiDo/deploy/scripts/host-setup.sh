#!/usr/bin/env bash
# One-time host preparation for TiDo staging on a single Ubuntu + K3s machine.
# Run as root:  sudo bash deploy/scripts/host-setup.sh [username]
#
# 1. Installs Docker Engine, Buildx and Compose from Docker's apt repository.
# 2. Lets the given user (default: the sudo caller) run docker without sudo.
# 3. Points K3s at the host-local staging registry on localhost:5000 and restarts K3s.
# Every step is idempotent, so re-running is safe.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

TARGET_USER="${1:-${SUDO_USER:-}}"
REGISTRY_HOST="localhost:5000"

step() { printf '\n==> %s\n' "$*"; }

step "Installing Docker Engine from download.docker.com"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  . /etc/os-release
  cat > /etc/apt/sources.list.d/docker.sources <<SOURCES
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
SOURCES
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "Docker already installed: $(docker --version)"
fi
systemctl enable --now docker

if [[ -n "$TARGET_USER" ]]; then
  step "Adding ${TARGET_USER} to the docker group"
  usermod -aG docker "$TARGET_USER"
  echo "Log out and back in (or reboot) for this to take effect."
fi

step "Configuring K3s to pull from the staging registry at ${REGISTRY_HOST}"
REGISTRIES=/etc/rancher/k3s/registries.yaml
DESIRED=$(cat <<YAML
# Managed by TiDo deploy/scripts/host-setup.sh. Staging only: plain HTTP on loopback.
mirrors:
  "${REGISTRY_HOST}":
    endpoint:
      - "http://${REGISTRY_HOST}"
YAML
)
if [[ ! -f "$REGISTRIES" ]] || [[ "$(cat "$REGISTRIES")" != "$DESIRED" ]]; then
  if [[ -f "$REGISTRIES" ]]; then
    cp "$REGISTRIES" "${REGISTRIES}.bak.$(date +%Y%m%d%H%M%S)"
  fi
  printf '%s\n' "$DESIRED" > "$REGISTRIES"
  chmod 0644 "$REGISTRIES"
  echo "Restarting K3s so containerd picks up the registry configuration…"
  systemctl restart k3s
  for _ in $(seq 1 60); do
    if k3s kubectl get --raw=/readyz >/dev/null 2>&1; then break; fi
    sleep 2
  done
  k3s kubectl get nodes
else
  echo "registries.yaml already up to date."
fi

step "Done"
docker --version
docker buildx version
docker compose version
