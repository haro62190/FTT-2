/**
 * Rôles temporaires (boutique, anniversaires) : retirés automatiquement à la date prévue,
 * même après un redémarrage du bot.
 */
const { db, save } = require('./store');

const list = () => (db.tempRoles ??= []);

/** Donne `role` à `member` pendant `ms` millisecondes (prolonge si déjà en cours). */
async function grant(member, role, ms, reason) {
  await member.roles.add(role, reason);
  const existing = list().find((t) => t.userId === member.id && t.roleId === role.id);
  const until = Math.max(existing?.until ?? 0, Date.now()) + ms;
  if (existing) existing.until = until;
  else list().push({ userId: member.id, roleId: role.id, until });
  save();
  return until;
}

async function sweep(guild) {
  const now = Date.now();
  const due = list().filter((t) => t.until <= now);
  if (!due.length) return;
  for (const t of due) {
    const member = await guild.members.fetch(t.userId).catch(() => null);
    if (member) await member.roles.remove(t.roleId, 'Rôle temporaire expiré').catch(() => {});
  }
  db.tempRoles = list().filter((t) => t.until > now);
  save();
}

function start(guild) {
  const run = () => sweep(guild).catch((e) => console.error('Rôles temporaires :', e.message));
  run();
  setInterval(run, 60_000);
}

module.exports = { grant, start };
