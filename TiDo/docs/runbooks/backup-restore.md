# Backups and restore

> **Production backups are currently off.** Everything below applies once they are turned on
> (`production-release.md`, backups section). Until then, take a manual dump before risky
> changes: `kubectl -n tido-production exec tido-db-1 -c postgres -- pg_dump -Fc tido > tido-$(date +%F).dump`.

## Production backups

The `tido-backup` CronJob in `tido-production` writes a `pg_dump` custom-format dump to the
USB backup drive every night at 02:30 (Africa/Johannesburg):

- They land in `/srv/tido-backups/production/tido-<UTC time>.dump`, and the newest 30 are kept.
- A dump is only kept if `pg_restore` can read it back.
- If the drive is not mounted, the job fails rather than writing to the internal disk. A
  marker file on the drive tells the two apart.
- `release-production.sh` also takes a dump before every migration.

Check recent runs and run one now:

```bash
kubectl -n tido-production get jobs -l app.kubernetes.io/name=tido-backup
kubectl -n tido-production create job tido-backup-manual-$(date +%s) --from=cronjob/tido-backup
ls -lh /srv/tido-backups/production
```

The drive protects against the PC's disk failing, but not against theft, fire or a power
surge. For that, copy a recent dump somewhere else now and then (another drive kept
elsewhere, or cloud storage).

## Restore drill

Run this at least monthly and after any change to backups. It restores a dump into a
throwaway local container (production is only read) and compares row counts with live
production:

```bash
deploy/scripts/restore-drill.sh                 # newest dump
deploy/scripts/restore-drill.sh /path/to.dump   # a specific one
```

Record the date, dump, duration and result in `production-gates.md`.

## Restoring production

This replaces production's data with the dump. Take a fresh backup first unless the
database is unusable.

```bash
DUMP=/srv/tido-backups/production/tido-<time>.dump
kubectl -n tido-production scale deploy/tido-api --replicas=0
kubectl -n tido-production exec -i tido-db-1 -c postgres -- \
  pg_restore --dbname=tido --clean --if-exists --no-owner --role=tido --single-transaction < "$DUMP"
kubectl -n tido-production scale deploy/tido-api --replicas=1
```

If the dump comes from an older release, roll the app back to that release first (see
`production-release.md`), so the code matches the restored schema.

## Staging

Staging has no scheduled backups. For a one-off copy:

```bash
kubectl -n tido-staging exec tido-db-1 -c postgres -- pg_dump -Fc tido > tido-staging-$(date +%F).dump
```
