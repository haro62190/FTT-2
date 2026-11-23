/**
 * AutoMod natif de Discord : règles appliquées par Discord lui-même, même quand le bot est éteint.
 * Créées / mises à jour par /setup et /automod. Les modos et administrateurs ne sont pas concernés.
 */
const {
  AutoModerationActionType: Action,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType: Preset,
  AutoModerationRuleTriggerType: Trigger,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
} = require('discord.js');
const { BRAND_COLOR, config, findChannel, findRole } = require('./shared');
const settings = require('./settings');
const { confirm } = require('./confirm');

const PREFIX = 'Ronin ・ ';

/** Mots interdits : config/server.js (automod.blockedWords) + ajouts avec /automod */
const words = () => [...new Set([...(config.automod?.blockedWords ?? []), ...(settings.get('automod.extraWords') ?? [])])].slice(0, 1000);

function rules(guild) {
  const alert = findChannel(guild, 'mod_logs');
  const block = (msg) => ({ type: Action.BlockMessage, metadata: { customMessage: msg } });
  const notify = alert ? [{ type: Action.SendAlertMessage, metadata: { channel: alert.id } }] : [];
  const list = [
    {
      name: `${PREFIX}Mots interdits`,
      triggerType: Trigger.Keyword,
      triggerMetadata: { keywordFilter: words().length ? words() : ['ronin-mot-interdit-exemple'] },
      actions: [block('⛩️ Ce message contient un mot interdit sur Les Ronins.'), ...notify],
    },
    {
      name: `${PREFIX}Arnaques et invitations`,
      triggerType: Trigger.Keyword,
      triggerMetadata: {
        keywordFilter: ['*free nitro*', '*nitro gratuit*', '*nitro free*', '*steam gift*', '*gift steam*', '*airdrop*'],
        regexPatterns: [
          'discord(?:app)?\\.(?:gg|com/invite)/[a-z0-9-]+',
          '(?:dlscord|disc0rd|discorcl|d1scord|discordgift|discord-nitro)\\.[a-z]{2,}',
          '(?:steamcommunnity|stearncommunity|steamcomunity|steamcommunlty)\\.[a-z]{2,}',
        ],
      },
      actions: [block('🚫 Liens d\'invitation et arnaques interdits.'), ...notify],
    },
    {
      name: `${PREFIX}Contenu choquant`,
      triggerType: Trigger.KeywordPreset,
      triggerMetadata: { presets: [Preset.Profanity, Preset.SexualContent, Preset.Slurs] },
      actions: [block('⛩️ Contenu interdit sur Les Ronins.'), ...notify],
    },
    {
      name: `${PREFIX}Spam de mentions`,
      triggerType: Trigger.MentionSpam,
      triggerMetadata: { mentionTotalLimit: 6, mentionRaidProtectionEnabled: true },
      actions: [block('🚫 Trop de mentions dans un seul message.'), ...notify, { type: Action.Timeout, metadata: { durationSeconds: 600 } }],
    },
    {
      name: `${PREFIX}Spam`,
      triggerType: Trigger.Spam,
      triggerMetadata: {},
      actions: [block('🚫 Message détecté comme spam.'), ...notify],
    },
  ];
  return list;
}

/** Crée ou met à jour les règles « Ronin ・ … » (ne touche pas aux autres règles AutoMod). */
async function ensureAutoMod(guild, log = console.log) {
  if (settings.get('automod.enabled') === false) return log('\n🛡️ AutoMod Discord : désactivé (/automod)');
  log('\n🛡️ AutoMod Discord');
  const existing = await guild.autoModerationRules.fetch();
  const mod = findRole(guild, 'mod');
  for (const r of rules(guild)) {
    const data = { ...r, eventType: AutoModerationRuleEventType.MessageSend, enabled: true, exemptRoles: mod ? [mod.id] : [] };
    // Une seule règle Spam / KeywordPreset / MentionSpam par serveur : on réutilise celle qui existe
    const unique = [Trigger.Spam, Trigger.KeywordPreset, Trigger.MentionSpam].includes(r.triggerType);
    const current = existing.find((x) => x.name === r.name) ?? (unique ? existing.find((x) => x.triggerType === r.triggerType) : null);
    try {
      if (current) {
        const { triggerType, ...editable } = data;
        await current.edit(editable);
        log(`  ✔ ${r.name}`);
      } else {
        await guild.autoModerationRules.create(data);
        log(`  ＋ ${r.name}`);
      }
    } catch (err) {
      log(`  ⚠ ${r.name} : ${err.message}`);
    }
  }
}

async function disableAutoMod(guild) {
  const existing = await guild.autoModerationRules.fetch();
  for (const r of existing.values()) if (r.name.startsWith(PREFIX)) await r.setEnabled(false).catch(() => {});
}

const commands = [
  {
    category: '🏯 Kensei',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('automod')
      .setDescription('AutoMod Discord : mots interdits, arnaques, spam')
      .setDefaultMemberPermissions(P.Administrator)
      .addSubcommand((s) => s.setName('voir').setDescription('Voir les règles et les mots interdits'))
      .addSubcommand((s) => s.setName('appliquer').setDescription('Créer / mettre à jour les règles AutoMod'))
      .addSubcommand((s) =>
        s.setName('ajouter-mot').setDescription('Interdire un mot (* = joker, ex : *arnaque*)').addStringOption((o) => o.setName('mot').setDescription('Le mot').setRequired(true).setMaxLength(60)),
      )
      .addSubcommand((s) => s.setName('retirer-mot').setDescription('Ne plus interdire un mot').addStringOption((o) => o.setName('mot').setDescription('Le mot').setRequired(true)))
      .addSubcommand((s) => s.setName('desactiver').setDescription('Désactiver les règles Ronin (les autres règles AutoMod ne sont pas touchées)')),
    async run(i) {
      const sub = i.options.getSubcommand();
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      if (sub === 'desactiver') {
        if (!(await confirm(i, '⚠️ Désactiver toutes les règles AutoMod « Ronin » ?', { danger: true, yes: 'Désactiver' }))) return;
        settings.set('automod.enabled', false);
        await disableAutoMod(i.guild);
        return i.editReply({ content: '⛔ AutoMod Ronin désactivé. `/automod appliquer` pour le réactiver.', components: [] });
      }
      if (sub === 'ajouter-mot' || sub === 'retirer-mot') {
        const mot = i.options.getString('mot').trim().toLowerCase();
        const extra = new Set(settings.get('automod.extraWords') ?? []);
        if (sub === 'ajouter-mot') extra.add(mot);
        else extra.delete(mot);
        settings.set('automod.extraWords', [...extra]);
      }
      if (sub !== 'voir') {
        settings.set('automod.enabled', true);
        const lines = [];
        await ensureAutoMod(i.guild, (l) => lines.push(l.trim()));
        const ok = lines.filter((l) => l.startsWith('⚠')).length === 0;
        if (!ok) return i.editReply(lines.join('\n'));
      }
      const fromConfig = new Set(config.automod?.blockedWords ?? []);
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle('🛡️ AutoMod Discord')
        .setDescription(
          `État : ${settings.get('automod.enabled') === false ? '⛔ désactivé' : '✅ actif'}\n\n` +
            rules(i.guild).map((r) => `• **${r.name}**`).join('\n') +
            `\n\n**Mots interdits (${words().length})** : ${words().map((w) => (fromConfig.has(w) ? `\`${w}\`` : `**\`${w}\`**`)).join(' ').slice(0, 1500) || '—'}`,
        )
        .setFooter({ text: 'En gras : ajoutés avec /automod. Les modos ne sont pas concernés. Alertes dans 📋┃logs.' });
      return i.editReply({ content: sub === 'voir' ? '' : '✅ Règles AutoMod à jour.', embeds: [embed], components: [] });
    },
  },
];

module.exports = { ensureAutoMod, commands, words, disableAutoMod };
