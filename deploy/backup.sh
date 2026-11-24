#!/usr/bin/env bash
# Nightly database dump, keeping 14 days. Installed as a root cron entry by deploy/ops-setup.sh
# (03:15 UTC, see /etc/cron.d/climbgames); it can also be run by hand from anywhere:
#   bash /srv/climbgames/deploy/backup.sh
# Set BACKUP_DIR to change where dumps go (default /var/backups/podium).
# Set BACKUP_REMOTE to an rclone or scp target to copy the dump off the server (HANDOFF.md 9.6).
# Test a restore: see "Backups" in deploy/README.md.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
: "${DATABASE_URL:?DATABASE_URL is not set in .env}"

dir="${BACKUP_DIR:-/var/backups/podium}"
keep_days="${BACKUP_KEEP_DAYS:-14}"
mkdir -p "$dir"
chmod 700 "$dir"
file="$dir/podium-$(date -u +%Y%m%d-%H%M%S).sql.gz"
tmp="$file.part"
# Write to a temporary name first so a failed dump never looks like a good one.
trap 'rm -f "$tmp"' EXIT
pg_dump --no-owner "$DATABASE_URL" | gzip > "$tmp"
mv "$tmp" "$file"
chmod 600 "$file"
find "$dir" -name 'podium-*.sql.gz' -mtime +"$keep_days" -delete
if [ -n "${BACKUP_REMOTE:-}" ]; then
  if command -v rclone >/dev/null 2>&1; then rclone copy "$file" "$BACKUP_REMOTE"; else scp -q "$file" "$BACKUP_REMOTE"; fi
fi
echo "$(date -u +%FT%TZ) wrote $file ($(du -h "$file" | cut -f1))"
