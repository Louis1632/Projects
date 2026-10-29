# Host setup (once per machine)

TiDo staging runs on one Ubuntu host with K3s. Root is needed only for the steps in
`deploy/scripts/host-setup.sh`; read it, then run:

```bash
sudo bash deploy/scripts/host-setup.sh
```

It is idempotent and does three things:

1. Installs Docker Engine, Buildx and Compose from `download.docker.com`.
2. Adds you to the `docker` group. Log out and back in (or reboot) before using Docker without sudo.
3. Writes `/etc/rancher/k3s/registries.yaml` so K3s's containerd can pull from the staging
   registry at `http://localhost:5000`, then restarts K3s. K3s only reads this file at start-up,
   so any later change also needs `sudo systemctl restart k3s`.

Then, without sudo:

```bash
deploy/scripts/install-cnpg.sh     # CloudNativePG operator (cnpg-system namespace)
deploy/scripts/registry.sh up      # temporary registry on 127.0.0.1:5000
```

Staging is served over Tailscale (see [staging-release.md](staging-release.md)), so it also
needs `sudo bash deploy/scripts/prod-host-setup.sh`, which lets you fetch Tailscale
certificates without sudo. It needs Traefik's port 8443 too, from `scripts/install.sh traefik` in
`Louis1632/homelab-platform`.

## Kubernetes access

`~/.kube/config` holds an admin credential copied from `/etc/rancher/k3s/k3s.yaml`. That is
fine for a single-person staging box. Before sharing the machine, replace it with a scoped
ServiceAccount whose Role covers only the `tido-staging` namespace.

## Portainer

Portainer (namespace `portainer`) is for visibility and logs. Do not edit TiDo resources in
Portainer: Git and the scripts are the source of truth, and the next release overwrites manual
changes.
