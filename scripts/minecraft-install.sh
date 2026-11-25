#!/usr/bin/env bash
# ⛏️ Installe (ou met à jour) un serveur Minecraft Java officiel pour la communauté.
#   bash /root/bot/scripts/minecraft-install.sh [adresse]   (par défaut : haro62190.tech)
# - dernière version officielle (Mojang), Java installé automatiquement dans la bonne version
# - liste blanche activée : les membres s'inscrivent sur Discord avec /minecraft inscrire
# - RCON (console à distance) avec mot de passe aléatoire, enregistré dans le .env du bot
# - service systemd « minecraft » : démarre tout seul au redémarrage du VPS
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Lance ce script en root."; exit 1; }
ADDRESS="${1:-haro62190.tech}"
DIR=/opt/minecraft
MEM="${MC_MEMORY:-3G}"
BOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV="$BOT_DIR/.env"

if [ ! -f "$DIR/eula.txt" ]; then
  echo "Pour héberger un serveur Minecraft, il faut accepter le CLUF de Minecraft :"
  echo "  https://aka.ms/MinecraftEULA"
  read -r -p "Tu l'acceptes ? Tape « oui » : " ok
  [ "$ok" = "oui" ] || { echo "Installation annulée."; exit 1; }
fi

apt-get update -qq
apt-get install -y -qq wget gpg jq ufw >/dev/null

# 1) Version officielle la plus récente
MANIFEST=$(wget -qO- https://piston-meta.mojang.com/mc/game/version_manifest_v2.json)
VERSION=$(echo "$MANIFEST" | jq -r '.latest.release')
VJSON=$(wget -qO- "$(echo "$MANIFEST" | jq -r --arg v "$VERSION" '.versions[] | select(.id==$v) | .url')")
JAR_URL=$(echo "$VJSON" | jq -r '.downloads.server.url')
JAR_SHA=$(echo "$VJSON" | jq -r '.downloads.server.sha1')
JAVA=$(echo "$VJSON" | jq -r '.javaVersion.majorVersion')
echo "⛏️  Minecraft $VERSION (Java $JAVA)"

# 2) Java (dépôt Adoptium / Eclipse Temurin)
if ! dpkg -s "temurin-$JAVA-jre" >/dev/null 2>&1; then
  wget -qO- https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor --yes -o /etc/apt/trusted.gpg.d/adoptium.gpg
  echo "deb https://packages.adoptium.net/artifactory/deb $(. /etc/os-release && echo "$VERSION_CODENAME") main" > /etc/apt/sources.list.d/adoptium.list
  apt-get update -qq
  apt-get install -y -qq "temurin-$JAVA-jre" >/dev/null
fi
JAVA_BIN=$(ls -d /usr/lib/jvm/temurin-"$JAVA"-jre*/bin/java | head -1)

# 3) Fichiers du serveur
id minecraft >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin minecraft
mkdir -p "$DIR"
wget -qO "$DIR/server.jar.new" "$JAR_URL"
echo "$JAR_SHA  $DIR/server.jar.new" | sha1sum -c --quiet
mv "$DIR/server.jar.new" "$DIR/server.jar"
echo "eula=true" > "$DIR/eula.txt"

if [ ! -f "$DIR/server.properties" ]; then
  RCON_PASS=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
  cat > "$DIR/server.properties" <<PROPS
motd=Les Ronins - serveur de la commu
max-players=20
difficulty=normal
view-distance=8
simulation-distance=8
white-list=true
enforce-whitelist=true
enable-rcon=true
rcon.port=25575
rcon.password=$RCON_PASS
spawn-protection=16
PROPS
else
  RCON_PASS=$(grep '^rcon.password=' "$DIR/server.properties" | cut -d= -f2-)
fi
chown -R minecraft:minecraft "$DIR"
chmod 600 "$DIR/server.properties"

# 4) Service systemd
cat > /etc/systemd/system/minecraft.service <<UNIT
[Unit]
Description=Serveur Minecraft de la communauté
After=network-online.target

[Service]
User=minecraft
WorkingDirectory=$DIR
ExecStart=$JAVA_BIN -Xms1G -Xmx$MEM -XX:+UseG1GC -jar server.jar nogui
Restart=on-failure
RestartSec=20
SuccessExitStatus=0 143

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable minecraft >/dev/null 2>&1
systemctl restart minecraft

# 5) Pare-feu : seul le port du jeu est ouvert (RCON reste fermé de l'extérieur)
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 25565/tcp >/dev/null
ufw deny 25575/tcp >/dev/null
ufw --force enable >/dev/null

# 6) Réglages du bot (le mot de passe RCON n'est jamais affiché)
touch "$ENV"
setenv() { if grep -q "^$1=" "$ENV"; then sed -i "s|^$1=.*|$1=$2|" "$ENV"; else echo "$1=$2" >> "$ENV"; fi; }
setenv MINECRAFT_ADDRESS "$ADDRESS"
setenv MINECRAFT_HOST 127.0.0.1
setenv MINECRAFT_RCON_PASSWORD "$RCON_PASS"
chmod 600 "$ENV"
pm2 restart bot-discord --update-env >/dev/null && pm2 save >/dev/null

echo
echo "✅ Serveur Minecraft $VERSION lancé (1re génération du monde : ~1 minute)."
echo "   Adresse pour les joueurs : $ADDRESS"
echo "   Journal : journalctl -u minecraft -f      Arrêt/démarrage : systemctl stop|start minecraft"
echo "   Sur Discord : /setup pour créer ⛏️┃serveur-minecraft, puis chacun fait /minecraft inscrire"
