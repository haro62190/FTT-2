#!/usr/bin/env bash
# 🌐 Publie la page vitrine et la page de surveillance via Caddy (HTTPS automatique).
#   bash /root/bot/scripts/site-install.sh [domaine]        (par défaut : haro62190.tech)
# Avant : dans la zone DNS du domaine, fais pointer @, www et status vers l'IP du VPS.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Lance ce script en root."; exit 1; }
DOMAIN="${1:-haro62190.tech}"
BOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV="$BOT_DIR/.env"

# 1) Le bot doit savoir quel domaine sert la vitrine
touch "$ENV"
if grep -q '^PUBLIC_HOST=' "$ENV"; then sed -i "s/^PUBLIC_HOST=.*/PUBLIC_HOST=$DOMAIN/" "$ENV"; else echo "PUBLIC_HOST=$DOMAIN" >> "$ENV"; fi

# 2) Caddy : tableau de bord, vitrine, surveillance (l'ancien fichier est gardé en .bak)
[ -f /etc/caddy/Caddyfile ] && cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.$(date +%F-%H%M).bak"
cat > /etc/caddy/Caddyfile <<CADDY
# Généré par scripts/site-install.sh
bot.$DOMAIN {
	reverse_proxy 127.0.0.1:3000
}

$DOMAIN, www.$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}

status.$DOMAIN {
	reverse_proxy 127.0.0.1:3001
}
CADDY
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy

# 3) Redémarre le bot pour qu'il lise PUBLIC_HOST
pm2 restart bot-discord --update-env >/dev/null && pm2 save >/dev/null
echo
echo "✅ Vitrine : https://$DOMAIN  (et https://www.$DOMAIN)"
echo "✅ Tableau de bord : https://bot.$DOMAIN"
echo "ℹ️  Surveillance : https://status.$DOMAIN (après scripts/uptime-kuma-install.sh)"
echo "Le certificat HTTPS est obtenu automatiquement en moins d'une minute si le DNS pointe bien vers ce VPS."
