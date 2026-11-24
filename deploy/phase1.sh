#!/usr/bin/env bash
# Phase 1/2: build and (re)start the app. Run on the VPS from the repo root, as the app user.
# One-time setup it does NOT do (see HANDOFF.md section 9): install Node 20+, pnpm, PostgreSQL 15+,
# Redis 7, Nginx, PM2 and certbot; create the database and its user; write .env from .env.example;
# open ports 80 and 443 only; install the podium-app block from deploy/nginx.conf and run certbot.
# Phase 3 (devnet test token, off by default): see deploy/phase3-devnet.md for the order. This script
# is still the build-and-restart step; NEXT_PUBLIC_* values are read at build time.
set -euo pipefail
[ -f .env ] || { echo "Create .env from .env.example first."; exit 1; }

pnpm install --frozen-lockfile
set -a; . ./.env; set +a
pnpm --filter @podium/api exec prisma migrate deploy
pnpm covers
pnpm build

# Only this app's two processes are touched; other PM2 apps on the server keep running.
if pm2 describe "${PM2_PREFIX:-climbgames}-api" >/dev/null 2>&1; then
  pm2 reload deploy/ecosystem.config.js --update-env
else
  pm2 start deploy/ecosystem.config.js
fi
pm2 save

sleep 3
curl -fsS "http://127.0.0.1:${PORT:-4000}/api/health" && echo && echo "API healthy."
