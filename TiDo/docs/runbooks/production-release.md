# Releasing to production

Production is private: only devices on your Tailscale network can reach it, at
`https://<machine>.<tailnet>.ts.net`. It runs in the `tido-production` namespace next to
staging, and it never gets its own build. A production release **promotes** the images
already running on staging, by digest.

## One-time setup

1. Install Tailscale and log in:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```
2. In the Tailscale admin console (DNS page), turn on **MagicDNS** and **HTTPS Certificates**.
3. Let your user fetch the Tailscale certificate:
   ```bash
   sudo bash deploy/scripts/prod-host-setup.sh
   ```
4. Renew the certificate weekly (Tailscale only renews when it is close to expiry):
   ```bash
   (crontab -l 2>/dev/null; echo "0 4 * * 1 \"$PWD/deploy/scripts/tailscale-cert.sh\" >> \"$HOME/.local/state/tido-cert.log\" 2>&1") | crontab -
   ```
5. Install the Tailscale app on each phone or laptop that should use TiDo, logged in to the
   same tailnet.

## Each release

Release to staging first and check it (`staging-release.md`), with everything committed. Then:

```bash
deploy/scripts/release-production.sh
```

In order, it:

1. Checks that staging is healthy and runs the digests pinned in Git.
2. Checks that the backup drive is mounted.
3. Writes those digests and this machine's Tailscale name into
   `deploy/k8s/overlays/production`.
4. Applies the platform resources and creates the session secret (first release only).
5. Installs the Tailscale certificate as `tido-tls`.
6. Takes a backup of the current database (`tido-backup-pre-<release>`). If that fails, it
   stops before changing anything.
7. Runs the migration job, then rolls out the API and web app.

Then commit what it wrote:

```bash
git add deploy/k8s/overlays/production && git commit -m "Release <release> to production"
```

## First release only: create the owner

```bash
TIDO_NAMESPACE=tido-production deploy/scripts/bootstrap-owner.sh you@example.com "Your Name"
```

Open the printed link from a device on your tailnet and choose a password.

## Checking production

```bash
kubectl -n tido-production get pods,cluster
curl https://<machine>.<tailnet>.ts.net/api/v1/auth/me   # 401 = API reachable, auth enforced; no -k needed
```

## Backups

Backups are **off** for now (see `production-gates.md`). To turn them on:

1. Plug in a drive with an ext4, xfs or btrfs partition (formatting a drive erases it). Find
   the partition with `lsblk`, then run `sudo bash deploy/scripts/prod-host-setup.sh /dev/sdXN`.
   This mounts it at `/srv/tido-backups` on every boot and creates `production/` there.
2. Uncomment `components: [backups]` in `deploy/k8s/overlays/production/kustomization.yaml`,
   commit, and run `release-production.sh`. From then on every release also takes a backup
   before migrating.
3. Run a restore drill (`backup-restore.md`) and record it in `production-gates.md`.

## Rolling back

Check out the previous release commit's `deploy/k8s/overlays/production/kustomization.yaml`
and run `kubectl apply -k deploy/k8s/overlays/production`. Migrations are forward-only. If the
release included a migration, roll back only to a version that understands the newer schema,
or (with backups on) restore the `tido-backup-pre-<release>` dump (see `backup-restore.md`).
