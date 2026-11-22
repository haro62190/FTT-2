/**
 * Commandes d'administration de Ronin Builder :
 * /setup /roles /channels /welcome /moderation /config /embed /evenement
 * Toute modification importante demande une confirmation.
 */
const fs = require('fs');
const path = require('path');
const {
  ChannelType,
  EmbedBuilder,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  MessageFlags,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
} = require('discord.js');
const builder = require('./builder');
const settings = require('./settings');
const levels = require('./levels');
const { BRAND_COLOR, findChannel, findRole } = require('./shared');
const { confirm, progress } = require('./confirm');

const BOT_NAME = 'Ronin Builder';
const ephemeral = (content, extra = {}) => ({ content, flags: MessageFlags.Ephemeral, ...extra });
const nl = (s) => s.replaceAll('\\n', '\n');
const list = (arr, max = 10) => (arr.length ? arr.slice(0, max).join(', ') + (arr.length > max ? ` … (+${arr.length - max})` : '') : '—');

function planText(p) {
  return [
    `👥 **Rôles** : ${p.rolesCreate.length} à créer, ${p.rolesRename.length} à renommer, ${p.rolesUpdate} à mettre à jour`,
    p.rolesCreate.length ? `　＋ ${list(p.rolesCreate)}` : null,
    p.rolesRename.length ? `　✎ ${list(p.rolesRename, 5)}` : null,
    `📁 **Salons et catégories** : ${p.chCreate.length} à créer, ${p.chRename.length} à renommer, ${p.chUpdate} à mettre à jour (permissions)`,
    p.chCreate.length ? `　＋ ${list(p.chCreate)}` : null,
    p.chRename.length ? `　✎ ${list(p.chRename, 5)}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Donne au bot son identité (nom + avatar), sans bloquer si Discord refuse (limite de changements). */
async function brandBot(client, log) {
  if (client.user.username !== BOT_NAME) {
    await client.user.setUsername(BOT_NAME).then(() => log(`  ✔ Bot renommé « ${BOT_NAME} »`)).catch(() => log('  ⚠ Nom du bot : change-le dans le portail développeur'));
  }
  // Avatar = assets/icon.png ; remis à jour automatiquement quand l'image change
  const icon = path.join(__dirname, '..', 'assets', 'icon.png');
  if (!fs.existsSync(icon)) return;
  const { db, save } = require('./store');
  const hash = require('crypto').createHash('sha1').update(fs.readFileSync(icon)).digest('hex');
  if (db.botAvatarHash === hash && client.user.avatar) return;
  await client.user
    .setAvatar(icon)
    .then(() => {
      db.botAvatarHash = hash;
      save();
      log('  ✔ Avatar du bot mis à jour');
    })
    .catch((e) => log(`  ⚠ Avatar du bot : ${e.message}`));
}

/** Date « JJ/MM/AAAA HH:MM » à l'heure de Paris -> Date */
function parisDate(str) {
  const m = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})[h:](\d{2})$/i);
  if (!m) return null;
  const [d, mo, y, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = (t) => Date.parse(new Date(t).toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).replace(' ', 'T') + 'Z') - t;
  const date = new Date(guess - offset(guess - offset(guess)));
  if (Number.isNaN(date.getTime())) return null;
  // Refuse les dates impossibles (31/02 -> 03/03) : le jour lu à Paris doit être celui saisi
  const [py, pmo, pd] = date.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }).split('-').map(Number);
  return py === y && pmo === mo && pd === d ? date : null;
}

async function runBuild(i, title, steps, what) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  await i.guild.roles.fetch();
  await i.guild.channels.fetch();
  const ok = await confirm(i, `${what}\n\n_Rien ne sera supprimé. Une sauvegarde est faite avant (voir \`/backup liste\`)._`);
  if (!ok) return;
  require('./backup').createBackup(i.guild, `avant-${title.toLowerCase()}-${new Date().toISOString().slice(0, 16)}`, i.user.id);
  const prog = progress(i, `⚙️ ${title} en cours…`);
  try {
    await steps(prog.log);
    await prog.done('✅ Terminé ! Pense à placer le rôle du bot tout en haut de la liste des rôles.');
  } catch (err) {
    await prog.done(`❌ Erreur : ${err.message}${err.code === 50013 ? '\n→ Le bot manque de permissions (Administrateur requis).' : ''}`);
  }
}

const SECURITY_PARAMS = [
  ['raidJoins', 'Anti-raid : nombre d\'arrivées', 2, 100],
  ['raidWindowSec', 'Anti-raid : en combien de secondes', 5, 600],
  ['lockdownMinutes', 'Durée du verrouillage (min)', 1, 1440],
  ['minAccountAgeDays', 'Âge minimum du compte (jours, 0 = off)', 0, 365],
  ['spamMessages', 'Anti-spam : nombre de messages', 3, 50],
  ['spamWindowSec', 'Anti-spam : en combien de secondes', 2, 60],
  ['spamMuteMinutes', 'Anti-spam : durée du mute (min)', 1, 10080],
  ['maxMentions', 'Mentions max par message', 2, 50],
];

const commands = [
  // ───────── Construction ─────────
  {
    category: '🏯 Ronin Builder',
    staff: true,
    data: new SlashCommandBuilder().setName('setup').setDescription('Construire tout le serveur : rôles, salons, permissions, messages, paramètres').setDefaultMemberPermissions(P.Administrator),
    run: (i) =>
      runBuild(
        i,
        'Setup',
        async (log) => {
          await brandBot(i.client, log);
          await builder.buildAll(i.guild, log);
          await require('./commands').register(i.guild);
          log('  ✔ Commandes / à jour');
        },
        `🏯 **/setup — construction complète de ${i.guild.name}**\n\n${planText(builder.plan(i.guild))}\n⚙️ Paramètres du serveur, icône, règlement, panneaux de rôles et de tickets`,
      ),
  },
  {
    category: '🏯 Ronin Builder',
    staff: true,
    data: new SlashCommandBuilder().setName('roles').setDescription('Créer / mettre à jour les rôles (couleurs, permissions, hiérarchie)').setDefaultMemberPermissions(P.Administrator),
    run: (i) =>
      runBuild(i, 'Rôles', (log) => builder.ensureRoles(i.guild, log), `👥 **/roles**\n\n${planText(builder.plan(i.guild)).split('\n📁')[0]}`),
  },
  {
    category: '🏯 Ronin Builder',
    staff: true,
    data: new SlashCommandBuilder().setName('channels').setDescription('Créer / mettre à jour les catégories, salons et permissions').setDefaultMemberPermissions(P.Administrator),
    run: (i) =>
      runBuild(
        i,
        'Salons',
        async (log) => {
          await builder.ensureChannels(i.guild, log);
          await i.guild.channels.fetch();
          await builder.postMessages(i.guild, log);
        },
        `📁 **/channels**\n\n📁${planText(builder.plan(i.guild)).split('\n📁')[1] ?? ''}`,
      ),
  },

  // ───────── Bienvenue ─────────
  {
    category: '🏯 Ronin Builder',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('welcome')
      .setDescription('Messages de bienvenue et de départ')
      .setDefaultMemberPermissions(P.ManageGuild)
      .addSubcommand((s) => s.setName('voir').setDescription('Voir la configuration actuelle'))
      .addSubcommand((s) =>
        s
          .setName('bienvenue')
          .setDescription('Modifier le message de bienvenue')
          .addStringOption((o) => o.setName('message').setDescription('Variables : {user} {username} {server} {count} {rules} — \\n = retour à la ligne').setMaxLength(1500))
          .addBooleanOption((o) => o.setName('actif').setDescription('Activer / désactiver')),
      )
      .addSubcommand((s) =>
        s
          .setName('depart')
          .setDescription('Modifier le message de départ')
          .addStringOption((o) => o.setName('message').setDescription('Variables : {username} {server} {count}').setMaxLength(1500))
          .addBooleanOption((o) => o.setName('actif').setDescription('Activer / désactiver')),
      )
      .addSubcommand((s) => s.setName('tester').setDescription('Prévisualiser les deux messages avec ton profil')),
    async run(i) {
      const sub = i.options.getSubcommand();
      const rules = findChannel(i.guild, 'rules');
      const fill = (t) =>
        String(t)
          .replaceAll('{user}', `${i.user}`)
          .replaceAll('{username}', i.user.username)
          .replaceAll('{server}', i.guild.name)
          .replaceAll('{count}', String(i.guild.memberCount))
          .replaceAll('{rules}', rules ? `${rules}` : 'règlement');
      if (sub === 'bienvenue' || sub === 'depart') {
        const key = sub === 'bienvenue' ? 'welcome' : 'goodbye';
        const msg = i.options.getString('message');
        const actif = i.options.getBoolean('actif');
        if (msg) settings.set(`${key}.message`, nl(msg));
        if (actif !== null) settings.set(`${key}.enabled`, actif);
        if (!msg && actif === null) return i.reply(ephemeral('Indique un `message` et/ou `actif`.'));
      }
      const w = settings.get('welcome');
      const g = settings.get('goodbye');
      if (sub === 'tester') {
        return i.reply(
          ephemeral('Aperçu :', {
            embeds: [
              new EmbedBuilder().setColor(BRAND_COLOR).setDescription(fill(w.message)).setThumbnail(i.user.displayAvatarURL()).setFooter({ text: `Membre n°${i.guild.memberCount}` }),
              new EmbedBuilder().setColor(0x3a3a3a).setDescription(fill(g.message)).setThumbnail(i.user.displayAvatarURL()),
            ],
          }),
        );
      }
      return i.reply(
        ephemeral(sub === 'voir' ? '' : '✅ Enregistré.', {
          embeds: [
            new EmbedBuilder()
              .setColor(BRAND_COLOR)
              .setTitle('🏮 Bienvenue & départ')
              .addFields(
                { name: `Bienvenue — ${w.enabled ? '✅ actif' : '⛔ désactivé'}`, value: w.message.slice(0, 1024) },
                { name: `Départ — ${g.enabled ? '✅ actif' : '⛔ désactivé'}`, value: g.message.slice(0, 1024) },
              )
              .setFooter({ text: 'Publiés dans le salon de bienvenue' }),
          ],
        }),
      );
    },
  },

  // ───────── Modération ─────────
  {
    category: '🏯 Ronin Builder',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('moderation')
      .setDescription('Régler l\'anti-raid, l\'anti-spam et l\'anti-nuke')
      .setDefaultMemberPermissions(P.Administrator)
      .addSubcommand((s) => s.setName('voir').setDescription('Voir les réglages'))
      .addSubcommand((s) =>
        s
          .setName('regler')
          .setDescription('Modifier un seuil')
          .addStringOption((o) =>
            o
              .setName('parametre')
              .setDescription('Le réglage')
              .setRequired(true)
              .addChoices(...SECURITY_PARAMS.map(([value, name]) => ({ name, value }))),
          )
          .addIntegerOption((o) => o.setName('valeur').setDescription('Nouvelle valeur').setRequired(true).setMinValue(0).setMaxValue(10080)),
      )
      .addSubcommand((s) =>
        s
          .setName('protections')
          .setDescription('Activer / désactiver une protection')
          .addBooleanOption((o) => o.setName('invitations').setDescription('Bloquer les invitations vers d\'autres serveurs'))
          .addBooleanOption((o) => o.setName('antinuke').setDescription('Protection contre la suppression de masse')),
      )
      .addSubcommand((s) =>
        s
          .setName('confiance')
          .setDescription('Ajouter / retirer quelqu\'un de la liste de confiance (ignoré par l\'anti-nuke)')
          .addUserOption((o) => o.setName('membre').setDescription('Membre ou bot').setRequired(true))
          .addBooleanOption((o) => o.setName('ajouter').setDescription('true = ajouter, false = retirer').setRequired(true)),
      ),
    async run(i) {
      const sub = i.options.getSubcommand();
      if (sub === 'regler') {
        const key = i.options.getString('parametre');
        const [, label, min, max] = SECURITY_PARAMS.find(([k]) => k === key);
        const value = i.options.getInteger('valeur');
        if (value < min || value > max) return i.reply(ephemeral(`Valeur entre ${min} et ${max}.`));
        settings.set(`security.${key}`, value);
      } else if (sub === 'protections') {
        const inv = i.options.getBoolean('invitations');
        const nuke = i.options.getBoolean('antinuke');
        if (inv !== null) settings.set('security.blockInvites', inv);
        if (nuke !== null) {
          if (!nuke && !(await confirm(i, '⚠️ Désactiver l\'anti-nuke ? Le serveur ne sera plus protégé contre la suppression de masse.', { danger: true, yes: 'Désactiver' }))) return;
          settings.set('security.antiNuke', nuke);
        }
      } else if (sub === 'confiance') {
        const user = i.options.getUser('membre');
        const add = i.options.getBoolean('ajouter');
        const wl = new Set(settings.get('security.whitelist') ?? []);
        if (add) {
          if (!(await confirm(i, `⚠️ ${user} pourra supprimer / bannir en masse sans être bloqué par l'anti-nuke. Confirmer ?`, { danger: true }))) return;
          wl.add(user.id);
        } else wl.delete(user.id);
        settings.set('security.whitelist', [...wl]);
      }
      const s = settings.get('security');
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle('🛡️ Modération automatique')
        .setDescription(
          [
            `**Anti-raid** : ${s.raidJoins} arrivées en ${s.raidWindowSec} s → verrouillage ${s.lockdownMinutes} min`,
            `**Comptes récents** : ${s.minAccountAgeDays ? `refusés si moins de ${s.minAccountAgeDays} jour(s)` : 'acceptés'}`,
            `**Anti-spam** : ${s.spamMessages} messages en ${s.spamWindowSec} s ou ${s.maxMentions} mentions → mute ${s.spamMuteMinutes} min`,
            `**Invitations Discord** : ${s.blockInvites ? '🚫 bloquées' : '✅ autorisées'}`,
            `**Anti-nuke** : ${s.antiNuke ? '✅ actif' : '⛔ désactivé'}`,
            `**Liste de confiance** : ${(s.whitelist ?? []).map((id) => `<@${id}>`).join(' ') || '—'}`,
          ].join('\n'),
        );
      const payload = { content: sub === 'voir' ? '' : '✅ Enregistré.', embeds: [embed], components: [] };
      return i.deferred || i.replied ? i.editReply(payload) : i.reply({ ...payload, flags: MessageFlags.Ephemeral });
    },
  },

  // ───────── Configuration ─────────
  {
    category: '🏯 Ronin Builder',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('config')
      .setDescription('Paramètres du bot : niveaux, récompenses, notifications')
      .setDefaultMemberPermissions(P.Administrator)
      .addSubcommand((s) => s.setName('voir').setDescription('Voir tous les paramètres'))
      .addSubcommand((s) =>
        s
          .setName('niveaux')
          .setDescription('Système de niveaux')
          .addBooleanOption((o) => o.setName('actif').setDescription('Gagner de l\'XP en écrivant'))
          .addBooleanOption((o) => o.setName('annonce').setDescription('Annoncer chaque passage de niveau')),
      )
      .addSubcommand((s) =>
        s
          .setName('recompense')
          .setDescription('Rôle donné automatiquement à un niveau')
          .addIntegerOption((o) => o.setName('niveau').setDescription('Niveau à atteindre').setRequired(true).setMinValue(1).setMaxValue(500))
          .addRoleOption((o) => o.setName('role').setDescription('Rôle à donner (vide = retirer la récompense de ce niveau)')),
      )
      .addSubcommand((s) =>
        s
          .setName('notifications')
          .setDescription('Alertes automatiques')
          .addBooleanOption((o) => o.setName('twitch').setDescription('Alertes de live Twitch'))
          .addBooleanOption((o) => o.setName('tiktok').setDescription('Alertes TikTok (vidéos + lives)')),
      )
      .addSubcommand((s) =>
        s
          .setName('reinitialiser')
          .setDescription('Remettre une partie des réglages par défaut')
          .addStringOption((o) =>
            o
              .setName('partie')
              .setDescription('Quoi')
              .setRequired(true)
              .addChoices(
                { name: 'Bienvenue / départ', value: 'welcome,goodbye' },
                { name: 'Modération', value: 'security' },
                { name: 'Niveaux', value: 'levels' },
                { name: 'Notifications', value: 'notifications' },
                { name: 'Tout', value: '*' },
              ),
          ),
      ),
    async run(i) {
      const sub = i.options.getSubcommand();
      if (sub === 'niveaux') {
        for (const k of ['actif', 'annonce']) {
          const v = i.options.getBoolean(k);
          if (v !== null) settings.set(`levels.${k === 'actif' ? 'enabled' : 'announce'}`, v);
        }
      } else if (sub === 'recompense') {
        const lvl = i.options.getInteger('niveau');
        const role = i.options.getRole('role');
        const rewards = { ...(settings.get('levels.rewards') ?? {}) };
        if (role) {
          if (role.managed || role.id === i.guild.id) return i.reply(ephemeral('Ce rôle ne peut pas être donné.'));
          if (role.permissions.has(P.Administrator) || role.permissions.has(P.ManageGuild)) return i.reply(ephemeral('⛔ Par sécurité, un rôle avec des permissions d\'administration ne peut pas être une récompense.'));
          if (!role.editable) return i.reply(ephemeral('Ce rôle est au-dessus du rôle du bot : place le bot plus haut.'));
          rewards[lvl] = role.id;
        } else delete rewards[lvl];
        settings.set('levels.rewards', rewards);
      } else if (sub === 'notifications') {
        for (const k of ['twitch', 'tiktok']) {
          const v = i.options.getBoolean(k);
          if (v !== null) settings.set(`notifications.${k}`, v);
        }
      } else if (sub === 'reinitialiser') {
        const part = i.options.getString('partie');
        if (!(await confirm(i, `♻️ Remettre par défaut : **${part === '*' ? 'tous les réglages' : part}** ?`, { danger: true, yes: 'Réinitialiser' }))) return;
        settings.reset(part === '*' ? undefined : part.split(','));
      }
      const s = settings.all();
      const rewards = levels.rewardList(i.guild).map((r) => `niv. ${r.level} → ${r.role}`).join('\n') || '—';
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle('⚙️ Paramètres de Ronin Builder')
        .addFields(
          { name: '🏮 Bienvenue / départ', value: `${s.welcome.enabled ? '✅' : '⛔'} bienvenue · ${s.goodbye.enabled ? '✅' : '⛔'} départ — \`/welcome\``, inline: false },
          { name: '⚔️ Niveaux', value: `${s.levels.enabled ? '✅ actifs' : '⛔ désactivés'} · annonces ${s.levels.announce ? '✅' : '⛔'}`, inline: true },
          { name: '📡 Notifications', value: `Twitch ${s.notifications.twitch ? '✅' : '⛔'} · TikTok ${s.notifications.tiktok ? '✅' : '⛔'}`, inline: true },
          { name: '🎖️ Récompenses de niveau', value: rewards.slice(0, 1024) },
          { name: '🛡️ Modération', value: '`/moderation voir`' },
        )
        .setFooter({ text: 'Aussi modifiable depuis le tableau de bord web' });
      const payload = { content: sub === 'voir' ? '' : '✅ Enregistré.', embeds: [embed], components: [] };
      return i.deferred || i.replied ? i.editReply(payload) : i.reply({ ...payload, flags: MessageFlags.Ephemeral });
    },
  },

  // ───────── Embeds & événements ─────────
  {
    category: '📢 Staff',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('embed')
      .setDescription('Publier un message intégré personnalisé')
      .setDefaultMemberPermissions(P.ManageMessages)
      .addStringOption((o) => o.setName('description').setDescription('Texte (\\n = retour à la ligne)').setRequired(true).setMaxLength(4000))
      .addStringOption((o) => o.setName('titre').setDescription('Titre').setMaxLength(256))
      .addChannelOption((o) => o.setName('salon').setDescription('Où publier (ici par défaut)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addStringOption((o) => o.setName('couleur').setDescription('Couleur hex, ex : #E10600'))
      .addStringOption((o) => o.setName('image').setDescription('Lien d\'une image'))
      .addStringOption((o) => o.setName('miniature').setDescription('Lien d\'une petite image'))
      .addStringOption((o) => o.setName('pied').setDescription('Texte en bas'))
      .addRoleOption((o) => o.setName('mention').setDescription('Rôle à mentionner')),
    async run(i) {
      const channel = i.options.getChannel('salon') ?? i.channel;
      if (!channel.permissionsFor(i.member).has(P.SendMessages)) return i.reply(ephemeral('Tu ne peux pas écrire dans ce salon.'));
      const color = i.options.getString('couleur');
      const embed = new EmbedBuilder().setColor(color && /^#?[0-9a-f]{6}$/i.test(color) ? parseInt(color.replace('#', ''), 16) : BRAND_COLOR).setDescription(nl(i.options.getString('description')));
      const title = i.options.getString('titre');
      if (title) embed.setTitle(title);
      for (const [opt, fn] of [['image', 'setImage'], ['miniature', 'setThumbnail']]) {
        const url = i.options.getString(opt);
        if (url && /^https?:\/\//.test(url)) embed[fn](url);
      }
      const footer = i.options.getString('pied');
      if (footer) embed.setFooter({ text: footer });
      const role = i.options.getRole('mention');
      await channel.send({ content: role ? `${role}` : undefined, embeds: [embed], allowedMentions: { roles: role ? [role.id] : [] } });
      return i.reply(ephemeral(`✅ Publié dans ${channel}.`));
    },
  },
  {
    category: '📢 Staff',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('evenement')
      .setDescription('Créer un événement Discord et l\'annoncer')
      .setDefaultMemberPermissions(P.ManageEvents)
      .addStringOption((o) => o.setName('titre').setDescription('Nom de l\'événement').setRequired(true).setMaxLength(100))
      .addStringOption((o) => o.setName('date').setDescription('JJ/MM/AAAA HH:MM (heure de Paris), ex : 25/12/2026 20:30').setRequired(true))
      .addStringOption((o) => o.setName('description').setDescription('Description').setMaxLength(1000))
      .addIntegerOption((o) => o.setName('duree').setDescription('Durée en heures (2 par défaut)').setMinValue(1).setMaxValue(72))
      .addStringOption((o) => o.setName('lieu').setDescription('Lieu ou lien (ta chaîne Twitch par défaut)').setMaxLength(100))
      .addBooleanOption((o) => o.setName('mention').setDescription('Mentionner 📢 Notif Annonces ?')),
    async run(i) {
      const start = parisDate(i.options.getString('date'));
      if (!start) return i.reply(ephemeral('Format de date : `JJ/MM/AAAA HH:MM`, ex : `25/12/2026 20:30`.'));
      if (start.getTime() < Date.now() + 60_000) return i.reply(ephemeral('La date doit être dans le futur.'));
      const end = new Date(start.getTime() + (i.options.getInteger('duree') ?? 2) * 3600_000);
      const twitch = process.env.TWITCH_CHANNEL ? `https://twitch.tv/${process.env.TWITCH_CHANNEL}` : 'Discord';
      const location = i.options.getString('lieu') || twitch;
      const description = i.options.getString('description') ?? '';
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const event = await i.guild.scheduledEvents.create({
        name: i.options.getString('titre'),
        scheduledStartTime: start,
        scheduledEndTime: end,
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.External,
        entityMetadata: { location },
        description,
        reason: `Créé par ${i.user.tag}`,
      });
      const channel = findChannel(i.guild, 'announcements');
      const role = i.options.getBoolean('mention') ? findRole(i.guild, 'notif_news') : null;
      await channel
        ?.send({
          content: [role ? `${role}` : null, event.url].filter(Boolean).join(' '),
          allowedMentions: { roles: role ? [role.id] : [] },
          embeds: [
            new EmbedBuilder()
              .setColor(BRAND_COLOR)
              .setTitle(`🎌 ${event.name}`)
              .setDescription(`${description}\n\n🗓️ <t:${Math.floor(start / 1000)}:F> (<t:${Math.floor(start / 1000)}:R>)\n📍 ${location}\n\nClique sur **Intéressé** dans l'événement pour être prévenu !`)
              .setURL(event.url),
          ],
        })
        .catch(() => {});
      return i.editReply(`✅ Événement créé${channel ? ` et annoncé dans ${channel}` : ''} : ${event.url}`);
    },
  },
];

module.exports = { commands, parisDate, brandBot };
