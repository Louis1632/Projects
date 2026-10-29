# Production gates

`deploy/k8s/overlays/production` exists so production stays reviewable, but **do not apply
it** until every gate below is done and recorded here.

| Gate                                                                                                | Why                                                                                      | Done |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---- |
| Trusted TLS on a real hostname (for example cert-manager + Let's Encrypt), HTTP→HTTPS redirect      | Session cookies are `Secure` and `__Host-` prefixed; browsers must trust the certificate | ☐    |
| Hardened image registry: TLS, authentication, digests pinned in the overlay                         | The staging registry is plain HTTP on loopback with no authentication                    | ☐    |
| Off-host PostgreSQL backups (CloudNativePG Barman Cloud to S3-compatible storage, or a second host) | A single node's disk is a single point of failure                                        | ☐    |
| Documented restore drill: restore into a scratch cluster and verify the data                        | An untested backup is not a backup                                                       | ☐    |
| Scoped Kubernetes credentials for whoever releases                                                  | Avoid using the cluster-admin kubeconfig                                                 | ☐    |
| Review of rate limits and login throttling for public exposure; consider MFA                        | TiDo has so far only been exposed to staging                                             | ☐    |

Deferred features that are fine to launch without: MFA, SMTP email, attachments, comments,
notifications, timed calendar slots.
