#!/usr/bin/env bash
# Met le bot à jour depuis GitHub s'il y a du nouveau, puis le redémarre.
# Lancé automatiquement toutes les 5 minutes par cron (voir README).
set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
PM2_NAME="${PM2_NAME:-bot-discord}"

git fetch --quiet origin "$BRANCH"
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse FETCH_HEAD)
[ "$LOCAL" = "$REMOTE" ] && exit 0

echo "[$(date '+%F %T')] Mise à jour ${LOCAL:0:7} -> ${REMOTE:0:7}"
CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE")
git merge --ff-only --quiet FETCH_HEAD

# Nouvelles dépendances ?
if grep -qE '^package(-lock)?\.json$' <<<"$CHANGED"; then
  npm ci --omit=dev --no-audit --no-fund
fi
# Structure du serveur modifiée (salons, rôles, règlement) ?
if grep -qE '^(config/server\.js|src/setup\.js|src/builder\.js|src/shared\.js|assets/.*)$' <<<"$CHANGED"; then
  npm run setup
fi

pm2 restart "$PM2_NAME" --update-env
echo "[$(date '+%F %T')] ✅ Bot mis à jour et redémarré"
