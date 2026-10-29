# Backups and restore (draft — complete before production)

CloudNativePG handles backups through the Barman Cloud plugin, writing base backups and WAL to
S3-compatible object storage.

## Plan

1. Choose an off-host target: an S3-compatible bucket (for example Backblaze B2, Wasabi, or MinIO
   on a second machine).
2. Install the Barman Cloud plugin for the CNPG version in use (see the CloudNativePG docs for
   v1.30) and create an `ObjectStore` that references a Secret holding the bucket credentials.
3. Point the `tido-db` Cluster at it and add a `ScheduledBackup` (for example, daily), with
   retention matching how far back you might need to go.
4. **Restore drill**: create a new Cluster with `bootstrap.recovery` from that object store in a
   scratch namespace, connect, and check row counts and recent tasks. Record the date, duration
   and result in `production-gates.md`.

## Until then

For staging, a logical dump is enough:

```bash
kubectl -n tido-staging exec tido-db-1 -c postgres -- pg_dump -Fc tido > tido-$(date +%F).dump
```

Keep the dump off this machine.
