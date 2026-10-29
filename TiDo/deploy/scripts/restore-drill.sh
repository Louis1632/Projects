#!/usr/bin/env bash
# Restore drill: loads a production backup into a throwaway local PostgreSQL container and
# compares row counts with the live production database. Production is only read.
# Usage: deploy/scripts/restore-drill.sh [dump file]   (default: the newest dump)
source "$(dirname "$0")/lib.sh"
need kubectl

DUMP="${1:-$(ls -1t "${BACKUP_DIR}"/tido-*.dump 2>/dev/null | head -1 || true)}"
[[ -f "$DUMP" ]] || fail "no dump found in ${BACKUP_DIR} (is the backup drive mounted?)"
TABLES=(users workspaces projects sections tasks task_completions recurrence_series audit_events)
COUNT_SQL=""
for t in "${TABLES[@]}"; do COUNT_SQL+="${COUNT_SQL:+ union all }select '${t}', count(*) from ${t}"; done

started=$(date +%s)
name="tido-restore-drill-$$"
step "Restoring $(basename "$DUMP") ($(du -h "$DUMP" | cut -f1)) into a scratch container"
docker_cmd run -d --rm --name "$name" -e POSTGRES_PASSWORD="$(openssl rand -hex 16)" \
  -v "${DUMP}:/drill.dump:ro" postgres:17-alpine >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$name" pg_isready -U postgres -q 2>/dev/null && break; sleep 1; done
docker exec "$name" createdb -U postgres drill
docker exec "$name" pg_restore -U postgres --dbname=drill --no-owner --no-acl --exit-on-error /drill.dump
restored="$(docker exec "$name" psql -U postgres -d drill -tAF ' ' -c "$COUNT_SQL")"

step "Comparing with live production"
live="$(kubectl -n "$PROD_NAMESPACE" exec tido-db-1 -c postgres -- psql -d tido -tAF ' ' -c "$COUNT_SQL")"
printf '%-20s %10s %10s\n' table restored live
join -j1 <(sort <<<"$restored") <(sort <<<"$live") | while read -r t r l; do
  printf '%-20s %10s %10s%s\n' "$t" "$r" "$l" "$([[ $r == "$l" ]] || echo '   (changed since the dump)')"
done
[[ "$(awk '$1=="users"{print $2}' <<<"$restored")" -ge 1 ]] || fail "the restored database has no users"

step "Restore drill passed in $(($(date +%s) - started))s ($(date -u +%FT%TZ), $(basename "$DUMP"))"
echo "Record it in docs/runbooks/production-gates.md."
