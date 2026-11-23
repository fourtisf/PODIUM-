#!/usr/bin/env bash
# Nightly database dump. Cron example (03:15 UTC):
#   15 3 * * * cd /srv/podium && bash deploy/backup.sh >> /var/log/podium-backup.log 2>&1
# Set BACKUP_REMOTE to an rclone or scp target to copy the dump off the server (HANDOFF.md 9.6).
# Test a restore once: gunzip -c <file> | psql "$DATABASE_URL_OF_A_SCRATCH_DB"
set -euo pipefail
set -a; . ./.env; set +a
dir="${BACKUP_DIR:-/var/backups/podium}"
mkdir -p "$dir"
file="$dir/podium-$(date -u +%Y%m%d-%H%M%S).sql.gz"
pg_dump "$DATABASE_URL" | gzip > "$file"
find "$dir" -name 'podium-*.sql.gz' -mtime +14 -delete
if [ -n "${BACKUP_REMOTE:-}" ]; then
  if command -v rclone >/dev/null 2>&1; then rclone copy "$file" "$BACKUP_REMOTE"; else scp -q "$file" "$BACKUP_REMOTE"; fi
fi
echo "$(date -u +%FT%TZ) wrote $file"
