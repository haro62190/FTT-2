/**
 * Journal des actions d'administration : commandes du staff (Discord) et actions du tableau de bord.
 * Consultable sur le site (page « Journal »). 1000 dernières entrées conservées.
 */
const { db, save } = require('./store');

function record({ userId = null, user = '?', source = 'discord', action, details = '' }) {
  const list = (db.adminLog ??= []);
  list.unshift({ at: Date.now(), userId, user: String(user).slice(0, 64), source, action: String(action).slice(0, 80), details: String(details).slice(0, 300) });
  if (list.length > 1000) list.length = 1000;
  save();
}

/** Résumé lisible des options d'une commande / (sans contenu sensible) */
function describeOptions(interaction) {
  const parts = [];
  const walk = (opts = []) => {
    for (const o of opts) {
      if (o.options) {
        parts.push(o.name);
        walk(o.options);
      } else if (o.user) parts.push(`${o.name}:@${o.user.username}`);
      else if (o.role) parts.push(`${o.name}:@${o.role.name}`);
      else if (o.channel) parts.push(`${o.name}:#${o.channel.name}`);
      else if (o.attachment) parts.push(`${o.name}:fichier`);
      else parts.push(`${o.name}:${String(o.value).slice(0, 60)}`);
    }
  };
  walk(interaction.options?.data);
  return parts.join(' ');
}

module.exports = { record, describeOptions };
