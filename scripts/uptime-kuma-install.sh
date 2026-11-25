#!/usr/bin/env bash
# 📈 Installe Uptime Kuma (surveillance gratuite) : https://status.<domaine> après scripts/site-install.sh
#   bash /root/bot/scripts/uptime-kuma-install.sh
# Il n'écoute qu'en local (127.0.0.1:3001) : on y accède seulement par Caddy, en HTTPS.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Lance ce script en root."; exit 1; }
command -v docker >/dev/null || { apt-get update -qq && apt-get install -y -qq docker.io >/dev/null; }
systemctl enable --now docker >/dev/null 2>&1
if docker ps -a --format '{{.Names}}' | grep -qx uptime-kuma; then
  docker pull -q louislam/uptime-kuma:1 >/dev/null
  docker rm -f uptime-kuma >/dev/null
fi
docker run -d --name uptime-kuma --restart unless-stopped --network host \
  -e UPTIME_KUMA_HOST=127.0.0.1 -e UPTIME_KUMA_PORT=3001 \
  -v uptime-kuma:/app/data louislam/uptime-kuma:1 >/dev/null
echo "✅ Uptime Kuma lancé. Ouvre https://status.$(grep -m1 '^PUBLIC_HOST=' "$(dirname "$0")/../.env" 2>/dev/null | cut -d= -f2 || echo 'ton-domaine')"
echo "   Crée ton compte administrateur TOUT DE SUITE (la première personne qui ouvre la page le crée)."
