#!/usr/bin/env bash
# Met le bot à jour depuis GitHub s'il y a du nouveau, puis le redémarre.
# Lancé automatiquement toutes les 5 minutes par cron (voir README).
set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
PM2_NAME="${PM2_NAME:-bot-discord}"

# Fichier « travail en attente » : si npm ci / setup / restart échoue, on réessaie au prochain passage
PENDING=.update-pending

git fetch --quiet origin "$BRANCH"
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse FETCH_HEAD)

if [ "$LOCAL" != "$REMOTE" ]; then
  echo "[$(date '+%F %T')] Mise à jour ${LOCAL:0:7} -> ${REMOTE:0:7}"
  CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE")
  # Nouvelles dépendances ?
  grep -qE '^package(-lock)?\.json$' <<<"$CHANGED" && echo deps >> "$PENDING"
  # Structure du serveur modifiée (salons, rôles, règlement, images) ?
  grep -qE '^(config/server\.js|src/setup\.js|src/builder\.js|src/shared\.js|assets/.*)$' <<<"$CHANGED" && echo setup >> "$PENDING"
  echo restart >> "$PENDING"
  git merge --ff-only --quiet FETCH_HEAD
fi

[ -f "$PENDING" ] || exit 0

if grep -qx deps "$PENDING"; then
  npm ci --omit=dev --no-audit --no-fund
  sed -i '/^deps$/d' "$PENDING"
fi
if grep -qx setup "$PENDING"; then
  npm run setup
  sed -i '/^setup$/d' "$PENDING"
fi

pm2 restart "$PM2_NAME" --update-env
rm -f "$PENDING"
echo "[$(date '+%F %T')] ✅ Bot mis à jour et redémarré"
