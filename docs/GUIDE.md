# 📖 Guide des commandes — 剣聖 Kensei

> Généré automatiquement à partir du bot (`npm run guide`). Dans Discord : salon 📖┃guide ou `/guide`.

## Pour tout le monde

**Bienvenue chez Les Ronins de haro62190 !** Voici tout ce que tu peux faire ici. ⚔️

**🚪 Pour commencer**
1. Lis le #règlement et clique sur **Je prête serment**, puis réussis le petit test (clique sur le bon emoji).
2. Choisis tes notifications et tes rôles dans #rôles (🔴 lives, 📱 TikTok, 📢 annonces…).
3. Viens dire bonjour dans #discussion !

**⚔️ XP et niveaux** — tu gagnes de l'XP en écrivant (1 fois par minute) et en vocal. Les grades arrivent tout seuls : 🗡️ Ashigaru (niv. 5), ⚔️ Samouraï (niv. 15), 🏯 Daimyō (niv. 30).
**🏆 Saisons** — chaque mois, le top 3 de l'XP gagne des ryō et le premier devient 🏆 Champion du mois.
**💰 Ryō (両)** — la monnaie du dojo : gagnée en écrivant, en vocal et avec `/daily`, à dépenser dans la `/boutique` (couleurs de pseudo, VIP…) ou en duel.

Tape `/` dans n'importe quel salon pour voir toutes les commandes, ou `/guide` pour relire ce guide.

## Sans commande

**🔊 Ton propre vocal** — rejoins **➕ Créer ton vocal** : un salon perso est créé. Dans son chat, choisis 🔓 libre ou 🔒 fermé, renomme-le, limite les places, autorise ou expulse quelqu'un. Il disparaît quand il est vide.

**🎫 Besoin d'aide ?** — clique sur **Ouvrir un ticket** dans #ouvrir-un-ticket : un salon privé s'ouvre avec le staff.

**💡 Une idée ?** — écris-la dans #suggestions : elle devient une carte où tout le monde vote 👍 / 👎.

**🏯 Hall of Fame** — réagis ⚔️ aux meilleurs messages : à 5 réactions, ils entrent dans #hall-of-fame.

**🎁 Giveaways** — clique sur **Participer** sous un giveaway. Reclique pour te retirer.

**🎂 Anniversaire** — `/anniversaire definir` : le jour J, le dojo te le souhaite et tu reçois un cadeau.

**🔴 Lives & TikTok** — les alertes arrivent dans #en-live et #tiktok, les clips dans #clips, le planning dans #planning.

## Commandes des membres

### 🎉 Général

| Commande | Ce qu'elle fait |
|---|---|
| `/help` | Liste des commandes de Kensei |
| `/ping` | Vérifie que le bot répond |
| `/live` | Le stream est-il en ligne ? |
| `/profil [membre:]` | Infos sur un membre |
| `/serveur` | Infos sur le serveur |
| `/sondage question: choix1: choix2: [choix3:] [choix4:] [duree:]` | Créer un sondage |
| `/guide [staff:]` | Le guide du serveur et de toutes les commandes |

### ⭐ Niveaux

| Commande | Ce qu'elle fait |
|---|---|
| `/rang [membre:]` | Ton niveau et ton XP |
| `/classement` | Le top 10 des membres les plus actifs |
| `/saison` | Le classement du mois (le 1er : podium, ryō et rôle 🏆 Champion) |

### 💰 Ryō & jeux

| Commande | Ce qu'elle fait |
|---|---|
| `/bourse [membre:]` | Ton solde de ryō (両) |
| `/daily` | Ta récompense quotidienne (bonus si tu reviens chaque jour) |
| `/donner membre: montant:` | Donner des ryō à un membre |
| `/richesse` | Les 10 ronins les plus riches |
| `/boutique` | Voir la boutique du dojo |
| `/acheter article:` | Acheter (ou rééquiper) un article de la boutique |
| `/duel adversaire: [mise:]` | Défier un membre en duel de samouraïs |
| `/chifoumi choix: [mise:]` | Pierre-feuille-ciseaux contre le bot |

### 🎉 Animation

| Commande | Ce qu'elle fait |
|---|---|
| `/anniversaire definir jour: mois:` | Enregistrer ta date d'anniversaire |
| `/anniversaire retirer` | Effacer ta date |
| `/anniversaire prochains` | Les prochains anniversaires du serveur |

### 🎵 Musique

| Commande | Ce qu'elle fait |
|---|---|
| `/play musique: [source:]` | Jouer une musique (lien YouTube, SoundCloud… ou recherche) |
| `/skip` | Passer à la musique suivante |
| `/stop` | Arrêter la musique et vider la file |
| `/pause` | Mettre en pause |
| `/reprendre` | Reprendre la lecture |
| `/boucle` | Répéter la musique en cours (on/off) |
| `/melanger` | Mélanger la file d'attente |
| `/file` | Voir la file d'attente |
| `/retirer position:` | Retirer un morceau de la file |

### 📊 Statistiques

| Commande | Ce qu'elle fait |
|---|---|
| `/stats voir` | Voir les compteurs |
| `/stats rafraichir` | Mettre à jour les salons compteurs maintenant (staff) |
| `/stats tiktok nombre:` | Valeur de secours pour TikTok, utilisée si la lecture automatique échoue (staff) |

### 🎫 Tickets

| Commande | Ce qu'elle fait |
|---|---|
| `/ticket ajouter membre:` | Ajouter quelqu'un au ticket |
| `/ticket retirer membre:` | Retirer quelqu'un du ticket |
| `/ticket fermer` | Fermer ce ticket |

## Commandes du staff

**🎖️ Les grades du staff**
🏯 **Gardien** — responsable de la modération : bannir, expulser, mute, `/lockdown`, événements, copie de la base.
🛡️ **Modérateur** — expulser, mute sans limite, avertissements (et les effacer), annonces, pseudos. Pas de ban.
🔰 **Sentinelle** — supprimer des messages, avertir, mute 1 h maximum, déplacer en vocal. Ni kick ni ban : appelle un Modérateur.

**🧭 Rappels pour le staff**
• Les commandes de modération respectent la hiérarchie : impossible d'agir sur un grade égal ou supérieur au sien.
• Toutes les actions (kick, ban, mute, rôles, messages supprimés…) sont notées dans 📋┃logs, avec leur auteur.
• En cas de raid : `/lockdown action:Activer`. L'anti-raid et l'anti-nuke se déclenchent aussi tout seuls (alertes dans 🚨┃alertes-sécurité).
• Les commandes qui modifient le serveur (`/setup`, `/restore`…) montrent d'abord ce qu'elles vont faire et demandent une confirmation.
• Presque tout se règle aussi sur le **tableau de bord web** (administrateurs).

### 💰 Ryō & jeux

| Commande | Ce qu'elle fait |
|---|---|
| `/ryo membre: montant:` | Ajouter ou retirer des ryō à un membre (staff) |

### 🎉 Animation

| Commande | Ce qu'elle fait |
|---|---|
| `/giveaway lancer prix: duree: [gagnants:] [salon:] [mention:]` | Lancer un giveaway |
| `/giveaway terminer message:` | Terminer maintenant |
| `/giveaway relancer message:` | Tirer un nouveau gagnant |

### 📢 Staff

| Commande | Ce qu'elle fait |
|---|---|
| `/annonce message: [titre:] [mention:]` | Publier une annonce dans le salon annonces |
| `/embed description: [titre:] [salon:] [couleur:] [image:] [miniature:] [pied:] [mention:]` | Publier un message intégré personnalisé |
| `/evenement titre: date: [description:] [duree:] [lieu:] [mention:]` | Créer un événement Discord et l'annoncer |

### 🛡️ Modération

| Commande | Ce qu'elle fait |
|---|---|
| `/clear nombre: [membre:]` | Supprimer des messages dans ce salon |
| `/warn membre: raison:` | Avertir un membre |
| `/warns membre:` | Voir les avertissements d'un membre |
| `/clearwarns membre:` | Effacer les avertissements d'un membre |
| `/mute membre: duree: [raison:]` | Rendre un membre muet temporairement (timeout) |
| `/unmute membre:` | Rendre la parole à un membre |
| `/kick membre: [raison:]` | Expulser un membre |
| `/ban membre: [raison:] [supprimer_messages:]` | Bannir un membre |
| `/lockdown action: [minutes:]` | Verrouiller le serveur (raid) : invitations en pause, nouveaux arrivants expulsés |
| `/quarantaine membre: [raison:] [duree:]` | Isoler un membre dans 🏚️┃cachot (ses rôles lui seront rendus) |
| `/liberer membre:` | Sortir un membre de quarantaine (rend ses rôles) |

### 🏯 Kensei

| Commande | Ce qu'elle fait |
|---|---|
| `/setup` | Construire tout le serveur : rôles, salons, permissions, messages, paramètres |
| `/roles` | Créer / mettre à jour les rôles (couleurs, permissions, hiérarchie) |
| `/channels` | Créer / mettre à jour les catégories, salons et permissions |
| `/logo [image:] [appliquer:] [reinitialiser:]` | Changer le logo du serveur et l'avatar du bot |
| `/welcome voir` | Voir la configuration actuelle |
| `/welcome bienvenue [message:] [actif:]` | Modifier le message de bienvenue |
| `/welcome depart [message:] [actif:]` | Modifier le message de départ |
| `/welcome tester` | Prévisualiser les deux messages avec ton profil |
| `/moderation voir` | Voir les réglages |
| `/moderation regler parametre: valeur:` | Modifier un seuil |
| `/moderation protections [invitations:] [antinuke:]` | Activer / désactiver une protection |
| `/moderation confiance membre: ajouter:` | Ajouter / retirer quelqu'un de la liste de confiance (ignoré par l'anti-nuke) |
| `/config voir` | Voir tous les paramètres |
| `/config niveaux [actif:] [annonce:]` | Système de niveaux |
| `/config recompense niveau: [role:]` | Rôle donné automatiquement à un niveau |
| `/config notifications [twitch:] [tiktok:]` | Alertes automatiques |
| `/config reinitialiser partie:` | Remettre une partie des réglages par défaut |
| `/automod voir` | Voir les règles et les mots interdits |
| `/automod appliquer` | Créer / mettre à jour les règles AutoMod |
| `/automod ajouter-mot mot:` | Interdire un mot (* = joker, ex : *arnaque*) |
| `/automod retirer-mot mot:` | Ne plus interdire un mot |
| `/automod desactiver` | Désactiver les règles Ronin (les autres règles AutoMod ne sont pas touchées) |
| `/statut` | État du bot : temps de marche, latence, version, sauvegardes |
| `/commande ajouter nom: reponse: [encadre:]` | Créer ou modifier une commande |
| `/commande retirer nom:` | Supprimer une commande |
| `/commande liste` | Voir les commandes |

### 💾 Sauvegardes

| Commande | Ce qu'elle fait |
|---|---|
| `/backup creer [nom:]` | Créer une sauvegarde |
| `/backup liste` | Voir les sauvegardes |
| `/backup copie-base` | Envoyer maintenant une copie de la base dans 💾┃sauvegardes |
| `/backup exporter id:` | Télécharger une sauvegarde (fichier .json) |
| `/backup supprimer id:` | Supprimer une sauvegarde |
| `/restore [id:] [fichier:]` | Restaurer une sauvegarde (recrée ce qui manque, ne supprime rien) |
