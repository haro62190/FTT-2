/**
 * Permissions minimales du bot : plus besoin de lui donner « Administrateur ».
 * - REQUIRED : la liste exacte de ce dont le bot a besoin (et pourquoi)
 * - missing(guild) : ce qui lui manque sur le serveur
 * - inviteUrl(clientId) : lien d'invitation avec ces permissions (npm run invite)
 */
const { PermissionFlagsBits: P, PermissionsBitField } = require('discord.js');

const REQUIRED = {
  ViewChannel: 'voir les salons',
  ManageChannels: 'créer / ranger les salons, tickets, vocaux temporaires',
  ManageRoles: 'créer les rôles, donner les grades, permissions des salons',
  ManageGuild: 'paramètres du serveur, icône, AutoMod, pause des invitations',
  ViewAuditLog: 'logs et anti-nuke (savoir qui a fait quoi)',
  ManageNicknames: 'modération des pseudos',
  ChangeNickname: 'surnom 剣聖 ・ Kensei',
  KickMembers: '/kick, anti-nuke contre les bots inconnus',
  BanMembers: '/ban',
  ModerateMembers: '/mute, anti-spam',
  ManageMessages: '/clear, anti-spam, suggestions, épingles',
  ManageThreads: 'fils des suggestions',
  ManageEvents: 'événements Discord (planning Twitch, /evenement)',
  CreateEvents: 'événements Discord',
  SendMessages: 'écrire',
  SendMessagesInThreads: 'écrire dans les fils',
  CreatePublicThreads: 'fils de discussion des suggestions',
  EmbedLinks: 'messages intégrés',
  AttachFiles: 'carte de rang, transcriptions, copies de la base',
  ReadMessageHistory: 'retrouver ses messages fixes',
  AddReactions: 'réactions',
  UseExternalEmojis: 'emojis',
  MentionEveryone: 'mentionner les rôles de notification',
  Connect: 'musique',
  Speak: 'musique',
  Stream: 'permissions des vocaux temporaires',
  UseVAD: 'permissions des vocaux temporaires',
  PrioritySpeaker: 'droits du créateur d\'un vocal temporaire',
  MuteMembers: 'modération vocale',
  DeafenMembers: 'modération vocale',
  MoveMembers: 'vocaux temporaires, modération vocale',
};

const bitfield = () => new PermissionsBitField(Object.keys(REQUIRED).map((k) => P[k])).bitfield;

/** Permissions manquantes au bot sur ce serveur ([] si tout va bien ou s'il est Administrateur). */
function missing(guild) {
  const me = guild.members.me;
  if (!me) return Object.keys(REQUIRED);
  if (me.permissions.has(P.Administrator)) return [];
  return Object.keys(REQUIRED).filter((k) => !me.permissions.has(P[k]));
}

/** ID de l'application déduit du token (sa première partie est l'ID encodé en base64). */
function clientIdFromToken(token) {
  try {
    return Buffer.from(String(token).split('.')[0], 'base64').toString('utf8').replace(/\D/g, '') || null;
  } catch {
    return null;
  }
}

function inviteUrl(clientId) {
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=${bitfield()}`;
}

/**
 * Permissions qu'un rôle doit recevoir, en ne touchant pas à ce que le bot ne contrôle pas :
 * sans Administrateur, Discord interdit de donner une permission qu'on n'a pas soi-même.
 * @returns {{ bits: bigint, dropped: string[] }}
 */
function grantable(guild, wanted, current = 0n) {
  const me = guild.members.me;
  const want = new PermissionsBitField(wanted).bitfield;
  if (!me || me.permissions.has(P.Administrator)) return { bits: want, dropped: [] };
  const mine = me.permissions.bitfield;
  const bits = (want & mine) | (BigInt(current) & ~mine); // on garde tel quel ce que le bot ne peut pas changer
  const dropped = new PermissionsBitField(want & ~mine).toArray();
  return { bits, dropped };
}

module.exports = { REQUIRED, bitfield, missing, inviteUrl, clientIdFromToken, grantable };
