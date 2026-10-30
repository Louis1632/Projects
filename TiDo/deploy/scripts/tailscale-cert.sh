#!/usr/bin/env bash
# Fetches (or renews) this machine's Tailscale HTTPS certificate and stores it as the TLS secret
# of production and staging (both serve the same name, on ports 443 and 8443). Tailscale only
# renews when the certificate is close to expiry, so running this weekly from cron is cheap.
# Needs deploy/scripts/prod-host-setup.sh first.
# Usage: deploy/scripts/tailscale-cert.sh
source "$(dirname "$0")/lib.sh"
# cron's PATH lacks /usr/local/bin, where K3s installs kubectl.
export PATH="/usr/local/bin:${PATH}"
need tailscale; need kubectl

HOST="$(tailscale_host)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
tailscale cert --cert-file "$tmp/tls.crt" --key-file "$tmp/tls.key" "$HOST"
for ns in "$PROD_NAMESPACE" "$NAMESPACE"; do
  # An environment that hasn't been released yet gets the certificate at its first release.
  kubectl get namespace "$ns" >/dev/null 2>&1 || continue
  kubectl -n "$ns" create secret tls tido-tls --cert="$tmp/tls.crt" --key="$tmp/tls.key" \
    --dry-run=client -o yaml | kubectl apply -f -
done
echo "Certificate for ${HOST} valid until $(openssl x509 -enddate -noout -in "$tmp/tls.crt" | cut -d= -f2)"
