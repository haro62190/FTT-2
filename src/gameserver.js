/**
 * ⛏️ Serveur Minecraft de la communauté : le bot interroge le serveur chaque minute
 * (protocole « Server List Ping », le même que la liste des serveurs du jeu, sans mot de passe)
 * et tient à jour un message d'état dans ⛏️┃serveur-minecraft.
 *
 * Liste blanche : chaque membre s'inscrit avec /minecraft inscrire (un pseudo par compte Discord) ;
 * le bot l'ajoute via RCON, uniquement en local (127.0.0.1).
 *
 * .env : MINECRAFT_HOST (127.0.0.1), MINECRAFT_PORT (25565), MINECRAFT_ADDRESS (adresse affichée aux joueurs),
 *        MINECRAFT_RCON_PORT (25575), MINECRAFT_RCON_PASSWORD (écrit par scripts/minecraft-install.sh)
 */
const net = require('net');
const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { findChannel } = require('./shared');
const { db, save } = require('./store');

const HOST = () => process.env.MINECRAFT_HOST || '127.0.0.1';
const PORT = () => Number(process.env.MINECRAFT_PORT) || 25565;
const ADDRESS = () => (process.env.MINECRAFT_ADDRESS || '').trim();
const configured = () => Boolean(ADDRESS() || process.env.MINECRAFT_HOST);
const state = () => (db.gameServer ??= { online: false, players: 0, max: 0, names: [], version: null, motd: '', checkedAt: 0, since: 0 });

// ───────── Protocole (VarInt + chaînes UTF-8) ─────────
function varint(n) {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
}
function readVarint(buf, offset) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (offset + i >= buf.length) return null;
    const b = buf[offset + i];
    value |= (b & 0x7f) << (7 * i);
    if (!(b & 0x80)) return [value >>> 0, i + 1];
  }
  throw new Error('VarInt invalide');
}
const str = (s) => Buffer.concat([varint(Buffer.byteLength(s)), Buffer.from(s, 'utf8')]);
const packet = (id, ...parts) => {
  const body = Buffer.concat([varint(id), ...parts]);
  return Buffer.concat([varint(body.length), body]);
};

/** Texte du « MOTD » (chaîne ou composant JSON), codes couleur retirés. */
function motdText(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.replace(/§./g, '');
  return `${d.text ?? ''}${(d.extra ?? []).map(motdText).join('')}`.replace(/§./g, '');
}

/** Interroge un serveur Minecraft Java. */
function ping(host = HOST(), port = PORT(), timeout = 5000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    let buf = Buffer.alloc(0);
    const fail = (e) => {
      sock.destroy();
      reject(e);
    };
    sock.setTimeout(timeout, () => fail(new Error('pas de réponse')));
    sock.on('error', fail);
    sock.on('connect', () => {
      const port16 = Buffer.alloc(2);
      port16.writeUInt16BE(port);
      sock.write(packet(0x00, varint(767), str(host), port16, varint(1))); // poignée de main → statut
      sock.write(packet(0x00)); // demande de statut
    });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length > 1_000_000) return fail(new Error('réponse trop grande'));
      try {
        const len = readVarint(buf, 0);
        if (!len || buf.length < len[1] + len[0]) return; // paquet incomplet
        let off = len[1];
        const id = readVarint(buf, off);
        off += id[1];
        const sl = readVarint(buf, off);
        off += sl[1];
        const json = JSON.parse(buf.subarray(off, off + sl[0]).toString('utf8'));
        sock.destroy();
        resolve({
          online: true,
          players: Number(json.players?.online) || 0,
          max: Number(json.players?.max) || 0,
          names: (json.players?.sample ?? []).map((p) => String(p.name ?? '').slice(0, 32)).filter(Boolean).slice(0, 20),
          version: String(json.version?.name ?? '').slice(0, 40) || null,
          motd: motdText(json.description).slice(0, 200),
        });
      } catch (e) {
        fail(e);
      }
    });
  });
}

// ───────── RCON (console à distance, en local seulement) ─────────
const PSEUDO = /^[A-Za-z0-9_]{3,16}$/;

function rcon(command, timeout = 5000) {
  const password = process.env.MINECRAFT_RCON_PASSWORD;
  if (!password) return Promise.reject(new Error('RCON non configuré (MINECRAFT_RCON_PASSWORD)'));
  const pkt = (id, type, body) => {
    const b = Buffer.from(body, 'utf8');
    const out = Buffer.alloc(14 + b.length);
    out.writeInt32LE(10 + b.length, 0);
    out.writeInt32LE(id, 4);
    out.writeInt32LE(type, 8);
    b.copy(out, 12);
    return out;
  };
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: process.env.MINECRAFT_HOST || '127.0.0.1', port: Number(process.env.MINECRAFT_RCON_PORT) || 25575 });
    let buf = Buffer.alloc(0);
    let authed = false;
    const done = (err, val) => {
      sock.destroy();
      err ? reject(err) : resolve(val);
    };
    sock.setTimeout(timeout, () => done(new Error('pas de réponse')));
    sock.on('error', (e) => done(e));
    sock.on('connect', () => sock.write(pkt(1, 3, password)));
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 4 && buf.length >= 4 + buf.readInt32LE(0)) {
        const len = buf.readInt32LE(0);
        const id = buf.readInt32LE(4);
        const body = buf.subarray(12, 4 + len - 2).toString('utf8');
        buf = buf.subarray(4 + len);
        if (!authed) {
          if (id === -1) return done(new Error('mot de passe RCON refusé'));
          authed = true;
          sock.write(pkt(2, 2, command));
        } else return done(null, body.replace(/§./g, ''));
      }
    });
  });
}

/** Inscrit (ou remplace) le pseudo Minecraft d'un membre sur la liste blanche. */
async function whitelist(userId, pseudo) {
  if (!PSEUDO.test(pseudo)) throw new Error('Pseudo invalide : 3 à 16 caractères, lettres, chiffres ou _.');
  const wl = (db.mcWhitelist ??= {});
  const taken = Object.entries(wl).find(([id, p]) => id !== userId && p.toLowerCase() === pseudo.toLowerCase());
  if (taken) throw new Error('Ce pseudo est déjà inscrit par un autre membre.');
  const old = wl[userId];
  if (old && old.toLowerCase() !== pseudo.toLowerCase()) await rcon(`whitelist remove ${old}`).catch(() => {});
  const reply = await rcon(`whitelist add ${pseudo}`);
  wl[userId] = pseudo;
  save();
  return { old, reply };
}

async function unwhitelist(userId) {
  const wl = db.mcWhitelist ?? {};
  const p = wl[userId];
  if (!p) return null;
  await rcon(`whitelist remove ${p}`).catch(() => {});
  delete wl[userId];
  save();
  return p;
}

function embed(s = state()) {
  const addr = ADDRESS();
  const e = new EmbedBuilder()
    .setColor(s.online ? 0x54c987 : 0x3a3a3a)
    .setTitle(`⛏️ Serveur Minecraft : ${s.online ? '🟢 en ligne' : '🔴 hors ligne'}`)
    .setFooter({ text: 'Mis à jour automatiquement chaque minute' })
    .setTimestamp(s.checkedAt || Date.now());
  const lines = [];
  if (addr) lines.push(`🌐 Adresse : \`${addr}\``);
  if (s.version) lines.push(`🧩 Version : **${s.version}** (Java)`);
  if (s.online) lines.push(`👥 Joueurs : **${s.players} / ${s.max}**${s.names.length ? `\n${s.names.map((n) => `\`${n}\``).join(' ')}` : ''}`);
  if (s.motd) lines.push(`> ${s.motd.replace(/\n/g, '\n> ')}`);
  if (s.since) lines.push(`${s.online ? '⏱️ En ligne' : '⏸️ Hors ligne'} depuis <t:${Math.floor(s.since / 1000)}:R>`);
  return e.setDescription(lines.join('\n') || 'Le serveur n\'est pas encore configuré.');
}

async function check(guild) {
  if (!configured() || !require('./settings').on('gameServer')) return state();
  const s = state();
  const before = s.online;
  const firstCheck = !s.checkedAt;
  let r;
  try {
    r = await ping();
  } catch {
    r = { online: false, players: 0, names: [] };
  }
  Object.assign(s, r, { checkedAt: Date.now() });
  if (before !== s.online || !s.since) {
    s.since = Date.now();
    if (!firstCheck) require('./feed').push(s.online ? '🟢' : '🔴', `Serveur Minecraft ${s.online ? 'en ligne' : 'hors ligne'}`);
  }
  save();
  const channel = guild && findChannel(guild, 'game_server');
  if (channel) await require('./builder').upsertBotMessage(channel, { embeds: [embed(s)] }, () => {}, 'minecraft-status').catch(() => {});
  return s;
}

function start(guild) {
  if (!configured()) return;
  check(guild).catch(() => {});
  setInterval(() => check(guild).catch((e) => console.error('Minecraft :', e.message)), 60_000);
}

const commands = [
  {
    category: '🎮 Gaming',
    module: 'gameServer',
    data: new SlashCommandBuilder()
      .setName('minecraft')
      .setDescription('Serveur Minecraft de la communauté')
      .addSubcommand((c) => c.setName('etat').setDescription('Adresse, état et joueurs connectés'))
      .addSubcommand((c) =>
        c
          .setName('inscrire')
          .setDescription('T\'ajouter à la liste blanche (un pseudo par compte Discord)')
          .addStringOption((o) => o.setName('pseudo').setDescription('Ton pseudo Minecraft Java').setRequired(true).setMinLength(3).setMaxLength(16)),
      )
      .addSubcommand((c) => c.setName('desinscrire').setDescription('Te retirer de la liste blanche')),
    async run(i) {
      if (!configured()) return i.reply({ content: '⛏️ Le serveur Minecraft n\'est pas encore installé.', flags: MessageFlags.Ephemeral });
      const sub = i.options.getSubcommand();
      if (sub === 'etat') {
        await i.deferReply();
        const s = await check(i.guild);
        return i.editReply({ embeds: [embed(s)] });
      }
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        if (sub === 'desinscrire') {
          const p = await unwhitelist(i.user.id);
          return i.editReply(p ? `✅ **${p}** retiré de la liste blanche.` : 'Tu n\'es pas inscrit.');
        }
        const pseudo = i.options.getString('pseudo').trim();
        const { old } = await whitelist(i.user.id, pseudo);
        require('./feed').push('⛏️', `${i.user.username} inscrit sur le serveur Minecraft`);
        return i.editReply(`✅ **${pseudo}** est sur la liste blanche${old && old !== pseudo ? ` (à la place de ${old})` : ''} !${ADDRESS() ? ` Connecte-toi sur \`${ADDRESS()}\`.` : ''}`);
      } catch (e) {
        return i.editReply(`❌ ${e.message.includes('ECONNREFUSED') ? 'Le serveur Minecraft est éteint, réessaie plus tard.' : e.message}`);
      }
    },
  },
];

module.exports = { ping, check, start, embed, state, configured, address: ADDRESS, rcon, whitelist, unwhitelist, commands, _proto: { varint, readVarint, packet, str, motdText } };
