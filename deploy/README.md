# Deploy and operations

The live site runs from a clone of the public repository on a Hostinger VPS, behind Nginx, with
PM2 running two processes: `<PM2_PREFIX>-web` (Next.js) and `<PM2_PREFIX>-api` (Fastify).
This server also hosts other apps, so this one uses its own ports (web 3300, API 4300), its own
Redis database (5) and its own PM2 names (`climbgames-*`).

Phase 3 (the devnet test token) is off by default; its steps are in `deploy/phase3-devnet.md`.

## First deploy

Prerequisites (once per server, see HANDOFF.md section 9): Node 20+, pnpm, PostgreSQL 15+, Redis 7,
Nginx, PM2 and certbot, plus a PostgreSQL database and user for the app.

```bash
git clone https://github.com/fourtisf/PODIUM- /srv/climbgames
cd /srv/climbgames
cp .env.example .env
```

Edit `.env`. The values that differ from the example on this server:

```bash
NODE_ENV=production
PUBLIC_URL=https://climbgames.fun
PORT=4300
WEB_PORT=3300
API_INTERNAL_URL=http://127.0.0.1:4300
PM2_PREFIX=climbgames
DATABASE_URL=postgresql://<user>:<password>@127.0.0.1:5432/<database>
REDIS_URL=redis://127.0.0.1:6379/5
SESSION_SECRET=<output of: openssl rand -hex 32>
CONTACT_EMAIL=<address shown on /terms and /privacy>
NEXT_PUBLIC_CONTACT_EMAIL=<same address>
ADMIN_EMAILS=<your sign-in email>
```

Values that contain spaces must be quoted (`BRAND_NAME="Climb Games"`); the scripts read them as
data and never run them.

Build, migrate and start:

```bash
bash deploy/phase1.sh
```

Nginx: copy the `podium-app` block from `deploy/nginx.conf` into
`/etc/nginx/sites-available/climbgames`, uncomment it, set `server_name climbgames.fun;`, and
replace the ports: `127.0.0.1:4000` becomes `127.0.0.1:4300` and `127.0.0.1:3000` becomes
`127.0.0.1:3300`. Then:

```bash
ln -s /etc/nginx/sites-available/climbgames /etc/nginx/sites-enabled/climbgames
nginx -t && systemctl reload nginx
certbot --nginx -d climbgames.fun
```

## Updates

```bash
cd /srv/climbgames
git pull && bash deploy/phase1.sh
```

`phase1.sh` installs dependencies, applies new migrations, rebuilds and reloads only this app's
two PM2 processes. `NEXT_PUBLIC_*` values (brand, contact email, X link, chain mode) are baked in
at build time, so change them in `.env` and run `phase1.sh` again.

## Operations setup (once, as root)

```bash
cd /srv/climbgames
sudo bash deploy/ops-setup.sh
```

It is idempotent and installs:

- `/etc/cron.d/climbgames`
  - 03:15 every night: `deploy/backup.sh`, a gzipped `pg_dump` into `/var/backups/podium`,
    keeping 14 days (`BACKUP_KEEP_DAYS`). Set `BACKUP_REMOTE` in `.env` to also copy each dump
    off the server with rclone or scp.
  - every 5 minutes: `deploy/healthcheck.sh`, which calls `${PUBLIC_URL}/api/health`. If it fails
    twice in a row it logs the failure and runs `pm2 restart <PM2_PREFIX>-api <PM2_PREFIX>-web`,
    at most once per 15 minutes (stamp file `/var/run/climbgames-health.restart`).
- `/etc/logrotate.d/climbgames`: weekly rotation of the two logs below, 8 weeks kept.

The cron times are in the server's time zone; a default VPS is on UTC (`timedatectl` shows it).

## Admin

Operators are listed in `.env`: `ADMIN_EMAILS` and `ADMIN_WALLETS` (comma-separated). An account
whose email or linked wallet is listed can open `/admin` (overview, flagged runs, users). Every
admin action is written to the `AdminAction` table. Restart the API after changing the lists
(`bash deploy/phase1.sh`, or `pm2 restart climbgames-api --update-env`).

## Backups: test a restore

Do this once after setting up, and after any PostgreSQL upgrade. It restores into a scratch
database and never touches the live one.

```bash
sudo -u postgres createdb climbgames_restore_test
gunzip -c "$(ls -t /var/backups/podium/podium-*.sql.gz | head -1)" | sudo -u postgres psql -q climbgames_restore_test
sudo -u postgres psql climbgames_restore_test -c 'SELECT count(*) AS users FROM "User";' -c 'SELECT count(*) AS runs FROM "Run";'
sudo -u postgres dropdb climbgames_restore_test
```

The counts should match the live database at the time of the dump.

## Where the logs are

| What | Where |
|---|---|
| API and web output | `pm2 logs climbgames-api`, `pm2 logs climbgames-web` (files in `~/.pm2/logs/` of the user that runs PM2) |
| Health check failures and restarts | `/var/log/climbgames-health.log` |
| Nightly backups | `/var/log/climbgames-backup.log` |
| Nginx | `/var/log/nginx/access.log`, `/var/log/nginx/error.log` |
| Cron itself | `grep CRON /var/log/syslog` |
