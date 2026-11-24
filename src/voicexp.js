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
      economy.onVoiceMinute(member.id, member);
      require('./history').bump('voice');
      require('./quests').progress(member.id, 'voice');
      require('./social').track(member.id, 'voice');
      require('./challenges').progress('voice', member.id);
      const lvl = levels.addXp(member.id, xp, member);
      if (lvl !== null) {
        const rewards = await levels.applyRewards(member, lvl);
        if (settings.get('levels.announce') || rewards.length) {
          const where = findChannel(guild, 'bot_commands') ?? findChannel(guild, 'general');
          await require('./levelcard').announce(where, member, lvl, rewards, { voice: true });
        }
      }
    }
  }
}

function start(guild) {
  setInterval(() => tick(guild).catch((e) => console.error('XP vocal :', e.message)), 60_000);
}

module.exports = { start };
