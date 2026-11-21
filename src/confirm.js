/**
 * Demande de confirmation avant une modification importante (boutons ✅ / ❌, 60 secondes).
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

/** Renvoie true si la personne a confirmé. Le message éphémère reste utilisable via i.editReply(). */
async function confirm(i, content, { yes = 'Confirmer', danger = false } = {}) {
  const id = `confirm:${i.id}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${id}:yes`).setLabel(yes).setEmoji('✅').setStyle(danger ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${id}:no`).setLabel('Annuler').setEmoji('❌').setStyle(ButtonStyle.Secondary),
  );
  const payload = { content, components: [row], embeds: [] };
  if (i.deferred || i.replied) await i.editReply(payload);
  else await i.reply({ ...payload, flags: MessageFlags.Ephemeral });
  const msg = await i.fetchReply();
  try {
    const click = await msg.awaitMessageComponent({ filter: (c) => c.user.id === i.user.id && c.customId.startsWith(id), time: 60_000 });
    const ok = click.customId.endsWith(':yes');
    await click.update({ content: ok ? '⏳ C\'est parti…' : '❌ Annulé, rien n\'a été modifié.', components: [] });
    return ok;
  } catch {
    await i.editReply({ content: '⌛ Temps écoulé, rien n\'a été modifié.', components: [] }).catch(() => {});
    return false;
  }
}

/** Journal de progression affiché dans la réponse éphémère (mis à jour au plus toutes les 1,5 s). */
function progress(i, title) {
  const lines = [];
  let timer = null;
  const render = () => {
    const body = lines.join('\n');
    return i.editReply({ content: `**${title}**\n\`\`\`\n${body.length > 1800 ? '…' + body.slice(-1800) : body || '…'}\n\`\`\``, components: [] }).catch(() => {});
  };
  return {
    log: (...a) => {
      lines.push(a.join(' ').replace(/^\n+/, ''));
      timer ??= setTimeout(() => {
        timer = null;
        render();
      }, 1500);
    },
    done: async (footer) => {
      clearTimeout(timer);
      if (footer) lines.push('', footer);
      await render();
    },
  };
}

module.exports = { confirm, progress };
