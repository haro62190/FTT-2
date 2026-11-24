#!/usr/bin/env bash
# Met le bot à jour depuis GitHub s'il y a du nouveau, puis le redémarre.
# Lancé automatiquement toutes les 5 minutes par cron (voir README).
#
# Sécurités :
#  - si npm ci / setup échoue, la mise à jour reste « en attente » et est retentée au passage suivant
#  - après le redémarrage, le bot doit donner signe de vie (data/heartbeat.json) dans les 2 minutes ;
#    sinon RETOUR ARRIÈRE automatique sur la version précédente, et la version fautive est ignorée
#    jusqu'à ce qu'une nouvelle version arrive sur GitHub. Le staff est prévenu sur Discord.
set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
PM2_NAME="${PM2_NAME:-bot-discord}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
PENDING=.update-pending   # étapes restant à faire
PREV=.update-prev         # version qui marchait avant la mise à jour
BAD=.update-bad           # version fautive à ignorer

log() { echo "[$(date '+%F %T')] $*"; }

git fetch --quiet origin "$BRANCH"
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse FETCH_HEAD)

if [ -f "$BAD" ] && [ "$(cat "$BAD")" = "$REMOTE" ]; then
  exit 0 # version déjà annulée : on attend une correction
fi

if [ "$LOCAL" != "$REMOTE" ]; then
  log "Mise à jour ${LOCAL:0:7} -> ${REMOTE:0:7}"
  CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE")
  [ -f "$PENDING" ] || echo "$LOCAL" > "$PREV"
  grep -qE '^package(-lock)?\.json$' <<<"$CHANGED" && echo deps >> "$PENDING"
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

STARTED=$(date +%s)
pm2 restart "$PM2_NAME" --update-env >/dev/null

# Le bot est-il bien reparti ? (battement de cœur écrit après la connexion à Discord)
healthy() {
  node -e "
    try {
      const h = require('./data/heartbeat.json');
      process.exit(h.ready && h.at > ${STARTED}000 ? 0 : 1);
    } catch { process.exit(1); }"
}
ok=1
for _ in $(seq 1 $((HEALTH_TIMEOUT / 5))); do
  sleep 5
  if healthy; then ok=0; break; fi
done

if [ "$ok" -eq 0 ]; then
  rm -f "$PENDING" "$PREV" "$BAD"
  log "✅ Bot mis à jour et redémarré ($(git rev-parse --short HEAD))"
  exit 0
fi

# ───── Retour arrière ─────
NEW=$(git rev-parse HEAD)
GOOD=$(cat "$PREV" 2>/dev/null || true)
if [ -z "$GOOD" ] || [ "$GOOD" = "$NEW" ]; then
  log "❌ Le bot ne répond pas après la mise à jour, et aucune version précédente connue."
  exit 1
fi
log "❌ Le bot ne répond pas après la mise à jour ${NEW:0:7} : retour à ${GOOD:0:7}"
echo "$NEW" > "$BAD"
DEPS_CHANGED=$(git diff --name-only "$GOOD" "$NEW" | grep -cE '^package(-lock)?\.json$' || true)
git reset --hard --quiet "$GOOD"
[ "$DEPS_CHANGED" -gt 0 ] && npm ci --omit=dev --no-audit --no-fund
mkdir -p data
printf '{"bad":"%s","good":"%s","at":%s000}\n' "$NEW" "$GOOD" "$(date +%s)" > data/rollback.json
rm -f "$PENDING" "$PREV"
pm2 restart "$PM2_NAME" --update-env >/dev/null
log "↩️  Retour arrière effectué. La version ${NEW:0:7} sera ignorée jusqu'à la prochaine sur GitHub."
