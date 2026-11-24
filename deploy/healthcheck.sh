#!/usr/bin/env bash
# Health check, run every 5 minutes by root cron (installed by deploy/ops-setup.sh).
# Calls ${PUBLIC_URL}/api/health. On failure it logs to /var/log/climbgames-health.log and restarts
# this app's two PM2 processes (<PM2_PREFIX>-api and <PM2_PREFIX>-web), at most once per 15 minutes.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh" || exit 1

log="${HEALTH_LOG:-/var/log/climbgames-health.log}"
stamp="${HEALTH_RESTART_STAMP:-/var/run/climbgames-health.restart}"
lock="${HEALTH_LOCK:-/var/run/climbgames-health.lock}"
min_gap=900 # seconds between two restarts
prefix="${PM2_PREFIX:-climbgames}"
url="${PUBLIC_URL:-http://127.0.0.1:${PORT:-4000}}"
url="${url%/}/api/health"

# One check at a time, even if a slow one overlaps the next cron tick.
exec 9>"$lock"
flock -n 9 || exit 0

now() { date -u +%FT%TZ; }

if out="$(curl -fsS --max-time 15 "$url" 2>&1)"; then
  exit 0
fi
# One retry a little later, so a single slow response does not restart the app.
sleep 10
if out="$(curl -fsS --max-time 15 "$url" 2>&1)"; then
  echo "$(now) health check recovered on retry: $url" >> "$log"
  exit 0
fi

echo "$(now) health check FAILED: $url: ${out:-no answer}" >> "$log"
if [ -f "$stamp" ]; then
  last="$(stat -c %Y "$stamp" 2>/dev/null || echo 0)"
  if [ $(( $(date +%s) - last )) -lt "$min_gap" ]; then
    echo "$(now) restart skipped: the last restart was less than 15 minutes ago" >> "$log"
    exit 1
  fi
fi
touch "$stamp"
echo "$(now) restarting ${prefix}-api ${prefix}-web" >> "$log"
pm2 restart "${prefix}-api" "${prefix}-web" >> "$log" 2>&1 || echo "$(now) pm2 restart failed" >> "$log"
exit 1
