#!/usr/bin/env bash
# One-time operations setup on the VPS. Run as root from the repo root:
#   sudo bash deploy/ops-setup.sh
# Safe to run again: it rewrites the same three files and changes nothing else.
#   /etc/cron.d/climbgames        nightly backup (03:15 UTC) and a health check every 5 minutes
#   /etc/logrotate.d/climbgames   weekly rotation of the health and backup logs
#   /var/backups/podium           backup directory (mode 700)
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run this as root (sudo bash deploy/ops-setup.sh)."; exit 1; }
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"

for bin in curl flock pg_dump gzip; do
  command -v "$bin" >/dev/null 2>&1 || { echo "$bin is not installed."; exit 1; }
done
pm2_bin="$(command -v pm2 || true)"
[ -n "$pm2_bin" ] || { echo "pm2 is not on root's PATH. Install it or run this from a shell where 'pm2' works."; exit 1; }
node_bin="$(command -v node || true)"
[ -n "${PUBLIC_URL:-}" ] || { echo "PUBLIC_URL is not set in $ROOT/.env."; exit 1; }
tz="$(date +%Z)"
[ "$tz" = UTC ] || echo "Note: the server clock is $tz, not UTC. The backup runs at 03:15 $tz."

# Cron has a bare PATH; give it the directories pm2 and node live in (nvm installs them per user).
path="$(dirname "$pm2_bin")"
[ -n "$node_bin" ] && path="$path:$(dirname "$node_bin")"
path="$path:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

mkdir -p /var/backups/podium
chmod 700 /var/backups/podium

cat > /etc/cron.d/climbgames <<EOF
# Installed by $ROOT/deploy/ops-setup.sh. Edit that script, not this file.
# Times are in the server's time zone; a default VPS runs on UTC (check with: timedatectl).
SHELL=/bin/bash
PATH=$path
HOME=/root
PM2_HOME=${PM2_HOME:-/root/.pm2}
15 3 * * * root bash $ROOT/deploy/backup.sh >> /var/log/climbgames-backup.log 2>&1
*/5 * * * * root bash $ROOT/deploy/healthcheck.sh >/dev/null 2>&1
EOF
chmod 644 /etc/cron.d/climbgames

cat > /etc/logrotate.d/climbgames <<'EOF'
/var/log/climbgames-health.log /var/log/climbgames-backup.log {
    weekly
    rotate 8
    compress
    delaycompress
    missingok
    notifempty
    create 0640 root adm
}
EOF
chmod 644 /etc/logrotate.d/climbgames

touch /var/log/climbgames-health.log /var/log/climbgames-backup.log

# Pick up the new cron file at once (cron also rereads /etc/cron.d on its own every minute).
if command -v systemctl >/dev/null 2>&1; then systemctl reload cron 2>/dev/null || systemctl reload crond 2>/dev/null || true; fi

echo "Installed /etc/cron.d/climbgames and /etc/logrotate.d/climbgames."
echo "Health URL: ${PUBLIC_URL%/}/api/health  (PM2 processes: ${PM2_PREFIX:-climbgames}-api, ${PM2_PREFIX:-climbgames}-web)"
echo "Check now:  bash $ROOT/deploy/healthcheck.sh && echo healthy"
echo "Backup now: bash $ROOT/deploy/backup.sh"
