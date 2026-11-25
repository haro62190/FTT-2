#!/usr/bin/env bash
# 🧩 Installe un modpack (ex. FTB Evolution 2) À LA PLACE du serveur Minecraft normal.
#   bash /root/bot/scripts/modpack-install.sh <lien-ou-fichier-du-server-pack.zip> [java] [mémoire] [adresse]
#   ex. : bash /root/bot/scripts/modpack-install.sh /root/ServerFiles.zip 25 6G haro62190.tech
# - prend le « Server Pack » officiel du modpack (.zip, onglet Files de CurseForge ou site FTB)
# - SAUVEGARDE l'ancien serveur (/opt/minecraft-sauvegarde-<date>) avant de le remplacer
# - installe NeoForge/Forge si le pack contient seulement l'installateur
# - garde la liste blanche, le RCON pour le bot, le service systemd et le pare-feu
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Lance ce script en root."; exit 1; }
SRC="${1:-}"; JAVA="${2:-25}"; MEM="${3:-6G}"; ADDRESS="${4:-haro62190.tech}"
[ -n "$SRC" ] || { sed -n '2,9p' "$0"; exit 1; }
DIR=/opt/minecraft
BOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV="$BOT_DIR/.env"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Pour héberger un serveur Minecraft, il faut accepter le CLUF : https://aka.ms/MinecraftEULA"
read -r -p "Tu l'acceptes ? Tape « oui » : " ok
[ "$ok" = "oui" ] || { echo "Annulé."; exit 1; }

apt-get update -qq
apt-get install -y -qq wget gpg unzip ufw >/dev/null

# 1) Le server pack
if [ -f "$SRC" ]; then cp "$SRC" "$TMP/pack.zip"; else wget -q --show-progress -O "$TMP/pack.zip" "$SRC"; fi
unzip -q "$TMP/pack.zip" -d "$TMP/pack"
# Si tout est dans un seul sous-dossier, on remonte d'un niveau
ROOT="$TMP/pack"
if [ "$(find "$ROOT" -mindepth 1 -maxdepth 1 | wc -l)" = 1 ] && [ -d "$(find "$ROOT" -mindepth 1 -maxdepth 1)" ]; then ROOT="$(find "$ROOT" -mindepth 1 -maxdepth 1)"; fi
[ -d "$ROOT/mods" ] || { echo "❌ Ce .zip n'a pas de dossier « mods » : ce n'est pas un server pack (prends le fichier « Server Pack » / « Server Files »)."; exit 1; }

# 2) Java (Temurin)
if ! dpkg -s "temurin-$JAVA-jre" >/dev/null 2>&1; then
  wget -qO- https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor --yes -o /etc/apt/trusted.gpg.d/adoptium.gpg
  echo "deb https://packages.adoptium.net/artifactory/deb $(. /etc/os-release && echo "$VERSION_CODENAME") main" > /etc/apt/sources.list.d/adoptium.list
  apt-get update -qq
  apt-get install -y -qq "temurin-$JAVA-jre" >/dev/null
fi
JAVA_HOME_DIR=$(ls -d /usr/lib/jvm/temurin-"$JAVA"-jre* | head -1)

# 3) Ancien serveur : arrêt + sauvegarde complète (monde compris)
RCON_PASS=""
if [ -d "$DIR" ]; then
  systemctl stop minecraft 2>/dev/null || true
  RCON_PASS=$(grep -s '^rcon.password=' "$DIR/server.properties" | cut -d= -f2- || true)
  BK="/opt/minecraft-sauvegarde-$(date +%F-%H%M)"
  mv "$DIR" "$BK"
  echo "💾 Ancien serveur sauvegardé dans $BK"
fi
[ -n "$RCON_PASS" ] || RCON_PASS=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
id minecraft >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin minecraft
mkdir -p "$DIR"
cp -a "$ROOT"/. "$DIR"/
cd "$DIR"

# 4) NeoForge / Forge : installation si besoin
export JAVA_HOME="$JAVA_HOME_DIR" PATH="$JAVA_HOME_DIR/bin:$PATH"
if [ ! -f run.sh ]; then
  INSTALLER=$(ls neoforge-*-installer.jar forge-*-installer.jar 2>/dev/null | head -1 || true)
  if [ -n "$INSTALLER" ]; then
    echo "🔧 Installation de $INSTALLER…"
    java -jar "$INSTALLER" --installServer >/dev/null
    rm -f "$INSTALLER" "$INSTALLER.log"
  fi
fi
if [ -f run.sh ]; then
  START="/bin/bash run.sh nogui"
  echo "-Xms2G -Xmx$MEM -XX:+UseG1GC" > user_jvm_args.txt
else
  JAR=$(ls ./*.jar 2>/dev/null | head -1 || true)
  [ -n "$JAR" ] || { echo "❌ Impossible de trouver comment démarrer ce pack (ni run.sh, ni installateur, ni .jar)."; exit 1; }
  START="$JAVA_HOME_DIR/bin/java -Xms2G -Xmx$MEM -XX:+UseG1GC -jar $JAR nogui"
fi
echo "eula=true" > eula.txt

# 5) Réglages : liste blanche + RCON local pour le bot (on garde ceux du pack pour le reste)
touch server.properties
prop() { if grep -q "^$1=" server.properties; then sed -i "s|^$1=.*|$1=$2|" server.properties; else echo "$1=$2" >> server.properties; fi; }
prop motd "Les Ronins - FTB"
prop white-list true
prop enforce-whitelist true
prop enable-rcon true
prop rcon.port 25575
prop rcon.password "$RCON_PASS"
prop max-players 10
chown -R minecraft:minecraft "$DIR"
chmod 600 server.properties

# 6) Service systemd (démarre seul, redémarre en cas de plantage)
cat > /etc/systemd/system/minecraft.service <<UNIT
[Unit]
Description=Serveur Minecraft (modpack) de la communauté
After=network-online.target

[Service]
User=minecraft
WorkingDirectory=$DIR
Environment=JAVA_HOME=$JAVA_HOME_DIR
Environment=PATH=$JAVA_HOME_DIR/bin:/usr/bin:/bin
ExecStart=$START
Restart=on-failure
RestartSec=30
SuccessExitStatus=0 143
TimeoutStopSec=90

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable minecraft >/dev/null 2>&1
systemctl restart minecraft

# 7) Pare-feu + réglages du bot
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 25565/tcp >/dev/null
ufw deny 25575/tcp >/dev/null; ufw --force enable >/dev/null
touch "$ENV"
setenv() { if grep -q "^$1=" "$ENV"; then sed -i "s|^$1=.*|$1=$2|" "$ENV"; else echo "$1=$2" >> "$ENV"; fi; }
setenv MINECRAFT_ADDRESS "$ADDRESS"
setenv MINECRAFT_HOST 127.0.0.1
setenv MINECRAFT_RCON_PASSWORD "$RCON_PASS"
chmod 600 "$ENV"
pm2 restart bot-discord --update-env >/dev/null && pm2 save >/dev/null

echo
echo "✅ Modpack installé et lancé (le 1er démarrage d'un gros pack prend 2 à 5 minutes)."
echo "   Suivre le démarrage : journalctl -u minecraft -f   (attends « Done »)"
echo "   Puis sur Discord : /minecraft inscrire pseudo:<ton pseudo>  →  connecte-toi sur $ADDRESS"
