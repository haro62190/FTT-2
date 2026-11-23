/**
 * XP et ryō en vocal : chaque minute passée en vocal à au moins 2 humains rapporte de l'XP et des ryō.
 * Pas de gain si seul, en sourdine (casque coupé) ou dans le salon AFK.
 */
const { findChannel } = require('./shared');
const settings = require('./settings');
const levels = require('./levels');
const economy = require('./economy');

async function tick(guild) {
  if (settings.get('voiceXp.enabled') === false) return;
  const afk = guild.afkChannelId;
  const xp = settings.get('voiceXp.xpPerMinute') ?? 10;
  for (const channel of guild.channels.cache.filter((c) => c.isVoiceBased() && c.id !== afk).values()) {
    const humans = channel.members.filter((m) => !m.user.bot);
    if (humans.size < 2) continue;
    for (const member of humans.values()) {
      if (member.voice.selfDeaf || member.voice.serverDeaf) continue;
      economy.onVoiceMinute(member.id);
      require('./history').bump('voice');
      const lvl = levels.addXp(member.id, xp);
      if (lvl !== null) {
        const rewards = await levels.applyRewards(member, lvl);
        if (settings.get('levels.announce') || rewards.length) {
          const where = findChannel(guild, 'bot_commands') ?? findChannel(guild, 'general');
          await where
            ?.send({
              content: `🎙️ GG ${member}, tu passes au **niveau ${lvl}** en vocal !${rewards.length ? `\n🎖️ Nouveau grade : ${rewards.map((r) => `**${r.name}**`).join(', ')}` : ''}`,
              allowedMentions: { users: [member.id] },
            })
            .catch(() => {});
        }
      }
    }
  }
}

function start(guild) {
  setInterval(() => tick(guild).catch((e) => console.error('XP vocal :', e.message)), 60_000);
}

module.exports = { start };
