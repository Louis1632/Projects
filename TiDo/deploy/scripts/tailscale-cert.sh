#!/usr/bin/env bash
# Fetches (or renews) this machine's Tailscale HTTPS certificate and stores it as the
# production TLS secret. Tailscale only renews when the certificate is close to expiry,
# so running this weekly from cron is cheap. Needs deploy/scripts/prod-host-setup.sh first.
# Usage: deploy/scripts/tailscale-cert.sh
source "$(dirname "$0")/lib.sh"
need tailscale; need kubectl

HOST="$(tailscale_host)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
tailscale cert --cert-file "$tmp/tls.crt" --key-file "$tmp/tls.key" "$HOST"
kubectl -n "$PROD_NAMESPACE" create secret tls tido-tls --cert="$tmp/tls.crt" --key="$tmp/tls.key" \
  --dry-run=client -o yaml | kubectl apply -f -
echo "Certificate for ${HOST} valid until $(openssl x509 -enddate -noout -in "$tmp/tls.crt" | cut -d= -f2)"
