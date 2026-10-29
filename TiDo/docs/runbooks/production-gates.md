# Production gates

Production is released with `deploy/scripts/release-production.sh` (see
`production-release.md`) only when every gate below is met or explicitly accepted.

**Decision (2026-10-29):** production is private. It is reachable only from devices on the
owner's Tailscale network, at this machine's Tailscale name (`<machine>.<tailnet>.ts.net`). No
router ports are opened. The gates were set for a public deployment; the ones that guard
against internet exposure are accepted on that basis, and must be revisited before TiDo is
ever made public.

| Gate                                                   | How it is met for private (Tailscale-only) production                                                                                                                                                                     | Status                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Trusted TLS on a real hostname, HTTP→HTTPS redirect    | Let's Encrypt certificate for the Tailscale name via `tailscale cert` (`tailscale-cert.sh`, renewed weekly from cron); Traefik redirects HTTP to HTTPS (`redirect.yaml`)                                                  | ☐ until the first release |
| Hardened image registry, digests pinned                | **Accepted:** the registry listens on loopback only, so nothing off this machine can reach it. Production promotes the exact digests tested on staging; they are pinned in Git                                            | ☑ accepted                |
| Backups off the database disk                          | Nightly `pg_dump` (02:30 SAST, 30 kept) to a separate USB drive, plus one before every production migration. **Limit:** the drive sits next to the PC, so it survives a disk failure but not theft, fire or a power surge | ☐ until the first backup  |
| Documented restore drill                               | `restore-drill.sh` restores the newest dump into a throwaway container and compares row counts with live production. Record each run below                                                                                | ☐ until the first drill   |
| Scoped Kubernetes credentials for whoever releases     | **Accepted:** one person releases, from the cluster's own machine, as its administrator                                                                                                                                   | ☑ accepted                |
| Rate limits and login throttling reviewed for exposure | **Accepted:** only tailnet devices can connect. Login throttling is per process, so the API stays at one replica                                                                                                          | ☑ accepted                |

Deferred features that are fine to launch without: MFA, SMTP email, attachments, comments,
notifications, timed calendar slots.

## Restore drills

| Date | Dump | Duration | Result |
| ---- | ---- | -------- | ------ |
