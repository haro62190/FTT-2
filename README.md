# 💜 Serveur Discord communautaire pour ta chaîne Twitch

Un bot qui **crée automatiquement tout ton serveur Discord** (rôles, catégories, salons, permissions, règlement) puis **l'anime** : accueil des nouveaux, rôles en libre-service, **alertes quand tu passes en live** et logs de modération.

## 🗺️ Ce qui est créé

```
📌 ACCUEIL                    (visible par tout le monde)
   👋・bienvenue               message d'accueil automatique
   📜・règlement               règlement + bouton « J'accepte » → débloque le serveur
   📢・annonces                (lecture seule)
   🔴・en-live                 alerte automatique quand le stream démarre
   🎭・rôles                   boutons pour choisir ses notifs / rôles
💬 COMMUNAUTÉ                 (membres ayant accepté le règlement)
   💬・discussion  🖼️・médias  😂・memes  🎮・gaming  🎵・musique  🤖・commandes-bot
📺 STREAM
   📅・planning (lecture seule)  ✂️・clips  🎨・fan-art  💡・suggestions
⭐ VIP & ABONNÉS              (VIP, abonnés Twitch, staff)
   ⭐・salon-vip   🔊 Vocal VIP
🔊 VOCAUX
   🔊 Général  🎮 Gaming #1  🎮 Gaming #2  📺 Watch party  💤 AFK
🛡️ MODÉRATION                 (modérateurs uniquement)
   🛡️・mod-chat   📋・logs (arrivées, départs, messages supprimés)
```

**Rôles :** 👑 Chef · 🛡️ Modérateur · 🤝 Amis (accès à tous les vocaux) · 🎥 Streamer (accès VIP) · 💎 VIP · ⭐ Abonné Twitch · 🎮 Membre · et en libre-service : 🔴 Notif Live · 📱 Notif TikTok · 📢 Notif Annonces · 🕹️ Joueur · 🎨 Artiste.

**Réglages de sécurité appliqués :** e-mail vérifié obligatoire, filtre de contenu explicite pour tous, notifications par défaut sur « @mentions uniquement » (évite que les gens quittent à cause du bruit).

Tout est modifiable dans [`config/server.js`](config/server.js).

---

## 🚀 Installation (≈ 10 minutes)

### 1. Créer le serveur Discord
Dans Discord : **＋ Ajouter un serveur → Créer le mien → Pour moi et mes amis**. Donne-lui un nom. (Pas besoin de créer de salons, le bot s'en charge.)

> 💡 Recommandé : **Paramètres du serveur → Activer la Communauté**. Ça permet le vrai salon d'annonces (que les autres serveurs peuvent suivre). Sinon, un salon texte classique est créé à la place.

### 2. Créer le bot
1. Va sur <https://discord.com/developers/applications> → **New Application** (nomme-le, ex. « MaChaîne Bot »).
2. Onglet **Bot** → **Reset Token** → copie le token (garde-le secret !).
3. Toujours dans **Bot**, active les 2 *Privileged Gateway Intents* : **Server Members Intent** et **Message Content Intent**.
4. Onglet **OAuth2 → URL Generator** : coche `bot`, puis la permission **Administrator**. Ouvre l'URL générée et ajoute le bot à ton serveur.

### 3. (Optionnel) Alertes de live Twitch
1. Va sur <https://dev.twitch.tv/console/apps> → **Register Your Application**.
2. OAuth Redirect URL : `http://localhost` · Catégorie : *Chat Bot*.
3. Récupère le **Client ID**, puis **New Secret** pour le **Client Secret**.

### 4. Configurer et lancer
Il faut [Node.js](https://nodejs.org) 18 ou plus.

```bash
npm install
cp .env.example .env      # puis remplis le fichier .env
npm run setup             # crée toute la structure du serveur (une seule fois, ou après modif de la config)
npm start                 # lance le bot (doit tourner en continu)
```

Pour trouver le `GUILD_ID` : Discord → Paramètres utilisateur → Avancés → active le **Mode développeur**, puis clic droit sur ton serveur → **Copier l'identifiant du serveur**.

### 5. Finitions manuelles (2 minutes)
- **Paramètres du serveur → Rôles** : glisse le rôle du bot **tout en haut** (sinon il ne peut pas donner les rôles).
- Donne-toi le rôle **👑 Chef**, donne **🛡️ Modérateur** à tes modos et **🤝 Amis** à tes potes (ils pourront rejoindre tous les vocaux, y compris le vocal VIP).
- **Abonnés Twitch** : Paramètres utilisateur → Connexions → relie ton compte Twitch, puis dans *Paramètres du serveur → Intégrations → Twitch*, active la synchronisation des abonnés. Discord crée alors un rôle géré automatiquement : tu peux soit l'utiliser à la place de ⭐ Abonné Twitch, soit renommer ce rôle exactement `⭐ Abonné Twitch` dans la config.
- Remplis **📅・planning** avec ton planning de streams.
- Crée un lien d'invitation permanent (clic droit sur 👋・bienvenue → Inviter → « Jamais » expirer) et mets-le dans ta bio / tes panneaux Twitch et une commande `!discord` dans ton chat.

---

## 🤖 Ce que fait le bot en continu (`npm start`)

| Fonction | Détail |
|---|---|
| Accueil | Message de bienvenue personnalisé dans 👋・bienvenue avec le numéro du membre |
| Règlement | Le bouton ✅ donne le rôle 🎮 Membre, qui débloque le reste du serveur |
| Rôles libre-service | Boutons dans 🎭・rôles (cliquer à nouveau retire le rôle) |
| Alerte live | Toutes les 60 s, vérifie Twitch ; au début du live, poste titre + jeu + miniature et mentionne 🔴 Notif Live. À la fin, l'annonce passe en « live terminé ». Pas de doublon si le bot redémarre pendant un live. |
| Logs | Arrivées, départs et messages supprimés dans 📋・logs |

Le bot doit tourner en permanence : sur ton PC pendant les streams, ou mieux sur un petit hébergement (Raspberry Pi, VPS, Railway, fly.io…).

## ⌨️ Commandes `/` (façon MEE6)

Tape `/` dans Discord pour voir la liste. `/aide` affiche les commandes auxquelles tu as accès.

| Commande | Qui | Ce qu'elle fait |
|---|---|---|
| `/aide` `/ping` | tous | aide, test du bot |
| `/live` | tous | le stream est-il en ligne ? (titre, jeu, viewers) |
| `/profil [membre]` `/serveur` | tous | infos sur un membre / le serveur |
| `/sondage` | tous | sondage Discord (2 à 4 choix, durée en heures) |
| `/rang [membre]` `/classement` | tous | niveau, XP, top 10 |
| `/annonce` | staff | publie une annonce dans 📢・annonces (option : mentionner 📢 Notif Annonces) |
| `/clear nombre [membre]` | staff | supprime jusqu'à 100 messages |
| `/warn` `/warns` `/clearwarns` | staff | avertissements (le membre reçoit un MP) |
| `/mute` `/unmute` | staff | rendre muet de 1 min à 1 semaine |
| `/kick` `/ban` | staff | expulser / bannir |

Toutes les actions de modération sont notées dans 📋・logs. Les commandes staff sont cachées aux membres normaux (tu peux ajuster qui les voit dans *Paramètres du serveur → Intégrations → ton bot*).

**Niveaux :** chaque message rapporte 15 à 25 XP (une fois par minute max, anti-spam). Le bot félicite le membre à chaque niveau. Les données (XP, avertissements) sont dans `data/db.json` — ne supprime pas ce fichier.

## ☁️ Héberger 24h/24 sur un VPS, avec mises à jour automatiques

Sur un VPS Debian 12 / Ubuntu, en root :

```bash
apt update && apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm install -g pm2

git clone -b <branche> https://github.com/<toi>/<depot>.git /root/bot   # dépôt privé : voir « clé de déploiement » ci-dessous
cd /root/bot
nano .env                      # colle le contenu de ton .env
npm ci --omit=dev
npm run setup
pm2 start src/bot.js --name bot-discord
pm2 save && pm2 startup        # redémarrage automatique si le VPS redémarre

# Vérifie GitHub toutes les 5 minutes et met à jour le bot s'il y a du nouveau
(crontab -l 2>/dev/null; echo "*/5 * * * * /root/bot/scripts/update.sh >> /root/bot/update.log 2>&1") | crontab -
```

`scripts/update.sh` récupère les nouveautés, réinstalle les dépendances si besoin, relance `npm run setup` si la structure du serveur a changé, puis redémarre le bot. `.env` et `data/` ne sont jamais touchés. Historique des mises à jour : `cat /root/bot/update.log`.

**Dépôt privé — clé de déploiement (lecture seule) :** sur le VPS, `ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519`, puis `cat ~/.ssh/id_ed25519.pub` et colle la clé dans GitHub → ton dépôt → *Settings → Deploy keys → Add deploy key* (ne coche pas *Allow write access*). Clone ensuite avec `git clone -b <branche> git@github.com:<toi>/<depot>.git /root/bot`.

## 📱 Alertes TikTok

Remplis `TIKTOK_USERNAME` dans `.env` (pseudo sans @) puis redémarre le bot. Il vérifie ton profil toutes les 2 minutes :
- **nouvelle vidéo** → lien posté dans 📱・tiktok avec mention de 📱 Notif TikTok ;
- **live TikTok** → alerte dans 🔴・en-live avec mention de 🔴 Notif Live, transformée en « live terminé » à la fin.

Au premier lancement, les vidéos déjà publiées sont mémorisées sans être annoncées. Nécessite yt-dlp (voir Musique). TikTok n'ayant pas d'API publique pour ça, le bot lit ta page publique : si TikTok change son site, il faut mettre yt-dlp à jour (`yt-dlp -U`, fait automatiquement chaque nuit).

## 🎵 Musique

`/play musique:<lien ou titre>` dans un vocal : YouTube, SoundCloud, Bandcamp… (tout ce que lit [yt-dlp](https://github.com/yt-dlp/yt-dlp)). Les playlists sont acceptées (50 morceaux max).
Autres commandes : `/skip` `/stop` `/pause` `/reprendre` `/boucle` `/melanger` `/file` `/retirer`. Le bot quitte le vocal quand la file est finie ou qu'il est seul.

**À installer une fois sur la machine du bot :**

```bash
# VPS Debian / Ubuntu
apt install -y ffmpeg unzip
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp
curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh -s -- -y   # requis par yt-dlp pour YouTube
(crontab -l; echo "0 4 * * * /usr/local/bin/yt-dlp -U >> /root/bot/update.log 2>&1") | crontab -   # yt-dlp à jour chaque nuit
pm2 restart bot-discord
```

Sur Windows : `winget install yt-dlp.yt-dlp Gyan.FFmpeg DenoLand.Deno` puis rouvre le terminal.

⚠️ YouTube interdit dans ses conditions d'utilisation la lecture de ses vidéos hors de son lecteur, et bloque souvent les adresses IP de VPS (« Sign in to confirm you're not a bot »). Si ça arrive : utilise SoundCloud, ou exporte les cookies YouTube d'un compte secondaire dans `cookies.txt` et indique son chemin dans `YTDLP_COOKIES`.

## 🔊 Vocaux temporaires

Rejoindre **➕ Créer ton vocal** crée un salon vocal perso et t'y déplace. Dans le chat du vocal, un panneau te demande s'il doit être **🔓 libre d'accès** ou **🔒 fermé**, avec aussi : ✏️ renommer, 👥 limite de places, ✅ autoriser quelqu'un (même fermé), 👢 expulser (il ne peut plus revenir), 👑 récupérer le salon si le propriétaire est parti.

Le créateur a tous les droits sur son salon (clic droit sur un membre → rendre muet, déplacer, déconnecter). Les 🛡️ modos ont les mêmes droits, et les 🤝 Amis peuvent entrer même quand c'est fermé. Si le propriétaire part, la couronne passe à quelqu'un d'autre ; quand le salon est vide, il est supprimé.

## ✏️ Personnaliser

Tout se passe dans [`config/server.js`](config/server.js) : noms et couleurs des rôles, salons, niveaux d'accès, règlement, message de bienvenue. Après une modification, relance `npm run setup` : rien n'est recréé en double, les permissions et messages du bot sont simplement mis à jour.

⚠️ Si tu renommes un salon ou un rôle **dans la config**, l'ancien n'est pas supprimé : un nouveau est créé. Renomme-le aussi dans Discord (ou supprime l'ancien).

## 📂 Structure

```
config/server.js   structure du serveur (rôles, salons, règlement…)
src/setup.js       création / mise à jour du serveur
src/bot.js         bot en continu (accueil, boutons, alertes Twitch, XP, logs)
src/commands.js    commandes /
src/music.js       musique (yt-dlp + ffmpeg)
src/tiktok.js      alertes TikTok
src/ytdlp.js       appels à yt-dlp
src/tempvoice.js   vocaux temporaires
src/levels.js      système de niveaux
src/store.js       sauvegarde (data/db.json)
src/twitch.js      client API Twitch
src/shared.js      messages et utilitaires communs
```
