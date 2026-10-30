# Releasing to staging

Prerequisites: host setup done (including `prod-host-setup.sh`, for Tailscale certificates),
CloudNativePG installed, Traefik's port 8443 configured (`scripts/install.sh traefik` in
homelab-platform), registry running (`deploy/scripts/registry.sh up`), and all changes committed.

Staging is at **https://synisterpc.tailbe657c.ts.net:8443**: production's Tailscale name and
certificate, on port 8443. Like production, it answers only devices on the tailnet (403
otherwise), so to test on a phone, turn Tailscale on there and open that address. It has its own
session cookie name, so you can be signed in to staging and production in the same browser.

## Release notes

If the release changes anything people will notice, bump `version` in the root `package.json`
and add an entry at the top of `apps/web/src/features/about/releases.ts`, written for the
people who use TiDo. The web tests fail if the two disagree. The app shows the notes on its
**What's new** page, marks the version **New** in the sidebar until each person has seen it,
and offers open tabs a reload once the new build is live. Each build's Git commit is shown
as its build number.

## Running the release

```bash
deploy/scripts/release-staging.sh
```

What it does, in order:

1. Builds `tido/api` and `tido/web` tagged with the Git commit, pushes them to
   `localhost:5000`, and reads back each image's **digest**.
2. Writes those digests into `deploy/k8s/overlays/staging/kustomization.yaml`, and this
   machine's Tailscale name into `ingress-patch.yaml` and `config-patch.yaml`, so the manifests
   in Git name the exact bytes that run and where.
3. Applies platform resources (`-l tido.io/phase=platform`): namespace (Pod Security
   `restricted`), config, the CloudNativePG cluster, network policies, services and ingress.
4. Creates `tido-api-secrets` (random session secret) if it doesn't exist, and installs the
   Tailscale certificate as `tido-tls` (`deploy/scripts/tailscale-cert.sh`, which the weekly
   cron job also runs for both environments). Neither is ever stored in Git.
5. Waits for PostgreSQL, then runs the one-off `tido-migrate-<commit>` Job. If migrations fail,
   it stops and the running app is untouched. API replicas never migrate on their own.
6. Applies the deployments and waits for both rollouts.

Then commit the pinned digests it printed.

## First release only: create the owner

```bash
deploy/scripts/bootstrap-owner.sh you@example.com "Your Name"
```

It prints a single-use setup link (valid for 72 hours) and deletes the job so the link does not
linger in logs. Open it on a device with Tailscale on, and set your password. Running it again once an owner exists is refused; owners issue reset links instead.

## Checking a release

```bash
kubectl -n tido-staging get pods,cluster
kubectl -n tido-staging get deploy -o jsonpath='{range .items[*]}{.metadata.name}{"  "}{.spec.template.spec.containers[0].image}{"\n"}{end}'
curl https://synisterpc.tailbe657c.ts.net:8443/api/v1/auth/me   # 401 = API reachable, auth enforced
```

Data survives pod restarts because PostgreSQL uses a persistent volume:

```bash
kubectl -n tido-staging delete pod -l cnpg.io/cluster=tido-db
kubectl -n tido-staging wait --for=condition=Ready cluster/tido-db --timeout=300s
```

## Rolling back

Check out the previous release commit's `deploy/k8s/overlays/staging/kustomization.yaml` and
run `kubectl apply -k deploy/k8s/overlays/staging`. Migrations are forward-only. If a release
included a migration, roll back only to a version that understands the newer schema, or
restore a backup.
