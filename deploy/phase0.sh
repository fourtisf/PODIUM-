#!/usr/bin/env bash
# Phase 0: serve the prototype as a static site. Run on the VPS as root, from the repo root.
#   DOMAIN=play.example.com EMAIL=you@example.com bash deploy/phase0.sh
# Needs: Nginx and certbot installed, and a DNS A record for $DOMAIN pointing at this server.
set -euo pipefail
: "${DOMAIN:?Set DOMAIN, e.g. DOMAIN=play.example.com}"
: "${EMAIL:?Set EMAIL for the Let's Encrypt registration}"

install -d -m 755 /var/www/podium
install -m 644 prototype/podium-v9.html /var/www/podium/index.html

# The podium-static block is everything in deploy/nginx.conf before the podium-app section.
conf=/etc/nginx/sites-available/podium
sed -n '/^server {/,/^}/p' deploy/nginx.conf | sed "s/<DOMAIN>/$DOMAIN/g" > "$conf"
ln -sf "$conf" /etc/nginx/sites-enabled/podium

nginx -t
systemctl reload nginx
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
echo "Live at https://$DOMAIN"
