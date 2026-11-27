/**
 * Musique : YouTube, SoundCloud, Bandcamp… (tout ce que yt-dlp sait lire).
 * Pré-requis sur la machine : ffmpeg et yt-dlp (voir README).
 */
const { spawn } = require('child_process');
const { YTDLP, cookieArgs, ytdlpJson } = require('./ytdlp');
const {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} = require('@discordjs/voice');
const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits: P } = require('discord.js');
const { BRAND_COLOR, findRole } = require('./shared');

const FFMPEG = require('./ytdlp').findBinary('ffmpeg', process.env.FFMPEG_PATH); // ytdlp.js complète le PATH
const MAX_PLAYLIST = 50;
const IDLE_LEAVE_MS = 2 * 60_000;

/** guildId -> file d'attente */
const queues = new Map();

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });
const isUrl = (s) => /^https?:\/\//i.test(s);

function formatDuration(sec) {
  if (!sec && sec !== 0) return 'live';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// ───────────────────────── yt-dlp ─────────────────────────


// ───────── YouTube bloque souvent les serveurs (VPS) : bascule automatique sur SoundCloud ─────────
const BLOCK_MS = 6 * 3600_000;
let ytBlockedAt = 0;
/** « Sign in to confirm you're not a bot », etc. : YouTube refuse ce serveur. */
const isBotBlock = (text) => /sign in to confirm|not a bot|confirm you.?re not|--cookies/i.test(String(text ?? ''));
const ytBlocked = () => !cookieArgs().length && Date.now() - ytBlockedAt < BLOCK_MS;
const isYouTube = (url) => /(^|\.)youtu(\.be|be\.com)/i.test((() => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
})());
/** « Artiste - Titre (Official Video) [4K] » → « Artiste - Titre » pour chercher ailleurs. */
const cleanTitle = (t) =>
  String(t ?? '')
    .replace(/[([][^)\]]*(official|officiel|video|vidéo|clip|lyrics?|paroles|audio|visuali[sz]er|4k|hd|hq|remaster)[^)\]]*[)\]]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

/** Transforme une recherche ou un lien en liste de morceaux. */
async function resolveTracks(query, source, requestedBy) {
  // YouTube bloque le serveur depuis peu : une recherche par titre passe directement par SoundCloud
  if (!source && ytBlocked()) source = 'soundcloud';
  const target = isUrl(query) ? query : `${source === 'soundcloud' ? 'scsearch1' : 'ytsearch1'}:${query}`;
  const info = await ytdlpJson(['-J', '--flat-playlist', '--no-warnings', '--playlist-end', String(MAX_PLAYLIST), target]);
  const entries = info._type === 'playlist' ? info.entries ?? [] : [info];
  return entries
    .filter((e) => e && (e.url || e.webpage_url))
    .map((e) => ({
      title: e.title ?? 'Sans titre',
      url: e.webpage_url ?? e.url,
      duration: e.duration ?? null,
      thumbnail: e.thumbnail ?? e.thumbnails?.at(-1)?.url ?? null,
      requestedBy,
      playlist: info._type === 'playlist' && isUrl(query) ? info.title : null,
    }));
}

/** yt-dlp (meilleur flux audio) -> ffmpeg (Opus/Ogg) -> Discord */
function createStream(track, onFail = () => {}) {
  const ytdlp = spawn(YTDLP, ['-f', 'bestaudio/best', '-o', '-', '-q', '--no-warnings', '--no-playlist', ...cookieArgs(), track.url], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ffmpeg = spawn(
    FFMPEG,
    ['-loglevel', 'error', '-i', 'pipe:0', '-vn', '-c:a', 'libopus', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-f', 'ogg', 'pipe:1'],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  ytdlp.stdout.pipe(ffmpeg.stdin);
  ffmpeg.stdin.on('error', () => {}); // ffmpeg fermé avant la fin (skip)
  let stderr = '';
  ytdlp.stderr.on('data', (d) => (stderr += d));
  ffmpeg.stderr.on('data', (d) => (stderr += d));
  ytdlp.on('error', () => {});
  ytdlp.on('close', (code) => {
    // code === null : processus tué volontairement (skip / stop)
    if (code) onFail((stderr.split('\n').find((l) => l.includes('ERROR')) || `yt-dlp a échoué (code ${code})`).slice(0, 300));
  });
  ffmpeg.on('error', () => {});

  const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.OggOpus, metadata: track });
  const kill = () => {
    ytdlp.kill('SIGKILL');
    ffmpeg.kill('SIGKILL');
  };
  return { resource, kill, stderr: () => stderr };
}

// ───────────────────────── File d'attente ─────────────────────────

class GuildQueue {
  constructor(guild, voiceChannel, textChannel) {
    this.guild = guild;
    this.textChannel = textChannel;
    this.tracks = [];
    this.current = null;
    this.loop = false;
    this.stream = null;
    this.idleTimer = null;

    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    this.connection.subscribe(this.player);

    this.player.on(AudioPlayerStatus.Idle, () => this.next());
    this.player.on('error', (err) => {
      const detail = this.stream?.stderr().split('\n').find((l) => l.includes('ERROR')) ?? err.message;
      if (isBotBlock(detail)) return; // géré par onFail (bascule SoundCloud)
      this.send(`⚠️ Impossible de lire **${err.resource?.metadata?.title ?? 'ce morceau'}** : ${detail.slice(0, 300)}`);
    });

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // Déplacé dans un autre salon : on se reconnecte tout seul
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        this.destroy(); // déconnecté pour de bon (kick, salon supprimé…)
      }
    });
  }

  get channelId() {
    return this.connection.joinConfig.channelId;
  }

  send(content) {
    return this.textChannel?.send({ content, allowedMentions: { parse: [] }, flags: MessageFlags.SuppressEmbeds }).catch(() => {});
  }

  /** Un morceau n'a pas pu être lu : si YouTube bloque le serveur, on le cherche sur SoundCloud. */
  async onFail(track, reason) {
    if (!isBotBlock(reason) || !isYouTube(track.url)) return this.send(`⚠️ Impossible de lire **${track.title}** : ${reason}`);
    ytBlockedAt = Date.now();
    if (track.fallback) return null;
    this.send(`🛡️ YouTube bloque la lecture depuis le serveur du bot (protection anti-robots). Je cherche **${cleanTitle(track.title)}** sur SoundCloud…`);
    const found = await resolveTracks(cleanTitle(track.title), 'soundcloud', track.requestedBy).catch(() => []);
    if (!found.length || this.destroyed) {
      return this.send(`❌ Introuvable sur SoundCloud. Essaie un autre titre, ou \`/play source: SoundCloud\`. (Pour retrouver YouTube, l'admin peut ajouter des cookies YouTube au bot : voir le README, section Musique.)`);
    }
    this.tracks.unshift({ ...found[0], fallback: true });
    if (!this.current || this.current === track) {
      if (this.current === track) this.current = null; // le morceau raté ne doit pas être rejoué en boucle
      this.next();
    }
    return null;
  }

  async ready() {
    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
  }

  add(tracks) {
    this.tracks.push(...tracks);
    if (!this.current) this.next();
  }

  next() {
    if (this.destroyed) return; // file arrêtée : ne pas relancer de minuteur
    this.stream?.kill();
    this.stream = null;
    if (this.loop && this.current) this.tracks.unshift(this.current);
    this.current = this.tracks.shift() ?? null;

    if (!this.current) {
      this.idleTimer ??= setTimeout(() => {
        this.send('👋 File d\'attente terminée, je quitte le vocal.');
        this.destroy();
      }, IDLE_LEAVE_MS);
      return;
    }
    clearTimeout(this.idleTimer);
    this.idleTimer = null;

    const track = this.current;
    this.stream = createStream(track, (reason) => this.onFail(track, reason));
    this.player.play(this.stream.resource);
    if (!this.loop) {
      this.textChannel
        ?.send({ embeds: [trackEmbed('🎶 Lecture en cours', this.current)], allowedMentions: { parse: [] } })
        .catch(() => {});
    }
  }

  skip() {
    const wasLooping = this.loop;
    this.loop = false;
    this.player.stop(true); // déclenche Idle -> next()
    this.loop = wasLooping;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.idleTimer);
    this.tracks = [];
    this.current = null;
    this.stream?.kill();
    this.player.stop(true);
    if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) this.connection.destroy();
    // Ne supprime que SA file (une nouvelle file a pu être créée depuis)
    if (queues.get(this.guild.id) === this) queues.delete(this.guild.id);
  }
}

function trackEmbed(title, track) {
  const e = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: title })
    .setTitle(track.title.slice(0, 256))
    .setURL(track.url)
    .setDescription(`⏱️ ${formatDuration(track.duration)} · demandé par <@${track.requestedBy}>`);
  if (track.thumbnail) e.setThumbnail(track.thumbnail);
  return e;
}

// ───────────────────────── Commandes ─────────────────────────

const isMod = (member) => require('./shared').isStaffMember(member);

/** Vérifie que la personne est dans le même vocal que le bot. */
function getQueueFor(i) {
  const q = queues.get(i.guildId);
  if (!q) return [null, 'Il n\'y a pas de musique en cours.'];
  if (i.member.voice.channelId !== q.channelId && !isMod(i.member)) return [null, 'Tu dois être dans le même vocal que moi.'];
  return [q];
}

const simple = (name, description, fn) => ({
  category: '🎵 Musique',
  data: new SlashCommandBuilder().setName(name).setDescription(description),
  async run(i) {
    const [q, err] = getQueueFor(i);
    if (!q) return i.reply(ephemeral(err));
    return fn(i, q);
  },
});

const commands = [
  {
    category: '🎵 Musique',
    data: new SlashCommandBuilder()
      .setName('play')
      .setDescription('Jouer une musique (lien YouTube, SoundCloud… ou recherche)')
      .addStringOption((o) => o.setName('musique').setDescription('Lien ou titre à rechercher').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('source')
          .setDescription('Où chercher si ce n\'est pas un lien (YouTube par défaut)')
          .addChoices({ name: 'YouTube', value: 'youtube' }, { name: 'SoundCloud', value: 'soundcloud' }),
      ),
    async run(i) {
      if (!require('./settings').on('music')) return i.reply(ephemeral('🎵 La musique est désactivée pour le moment.'));
      const voice = i.member.voice.channel;
      if (!voice) return i.reply(ephemeral('🔊 Rejoins d\'abord un salon vocal.'));
      const existing = queues.get(i.guildId);
      if (existing && existing.channelId !== voice.id) {
        return i.reply(ephemeral(`Je suis déjà en train de jouer dans <#${existing.channelId}>.`));
      }
      if (!voice.joinable) return i.reply(ephemeral('Je n\'ai pas le droit de rejoindre ce vocal.'));

      await i.deferReply();
      let tracks;
      try {
        tracks = await resolveTracks(i.options.getString('musique'), i.options.getString('source'), i.user.id);
      } catch (err) {
        return i.editReply(`❌ ${err.message}`);
      }
      if (!tracks.length) return i.editReply('🔍 Aucun résultat.');

      // Relire la file : un autre /play a pu en créer une pendant la recherche
      let q = queues.get(i.guildId);
      if (q && q.channelId !== voice.id) return i.editReply(`Je suis déjà en train de jouer dans <#${q.channelId}>.`);
      if (!q) {
        q = new GuildQueue(i.guild, voice, i.channel);
        queues.set(i.guildId, q);
        try {
          await q.ready();
        } catch {
          q.destroy();
          return i.editReply('❌ Impossible de me connecter au vocal.');
        }
      }
      q.textChannel = i.channel;
      const startsNow = !q.current;
      q.add(tracks);

      if (tracks.length > 1) {
        return i.editReply(`📃 **${tracks.length} morceaux** ajoutés${tracks[0].playlist ? ` depuis *${tracks[0].playlist}*` : ''}.`);
      }
      if (startsNow) return i.editReply(`▶️ C'est parti : **${tracks[0].title}**`);
      return i.editReply({ embeds: [trackEmbed(`➕ Ajouté à la file (position ${q.tracks.length})`, tracks[0])] });
    },
  },
  simple('skip', 'Passer à la musique suivante', (i, q) => {
    const title = q.current?.title;
    q.skip();
    return i.reply(`⏭️ **${title ?? 'Morceau'}** passé.`);
  }),
  simple('stop', 'Arrêter la musique et vider la file', (i, q) => {
    q.destroy();
    return i.reply('⏹️ Musique arrêtée.');
  }),
  simple('pause', 'Mettre en pause', (i, q) => i.reply(q.player.pause() ? '⏸️ En pause.' : ephemeral('Déjà en pause.'))),
  simple('reprendre', 'Reprendre la lecture', (i, q) => i.reply(q.player.unpause() ? '▶️ C\'est reparti !' : ephemeral('Pas en pause.'))),
  simple('boucle', 'Répéter la musique en cours (on/off)', (i, q) => {
    q.loop = !q.loop;
    return i.reply(q.loop ? '🔂 Répétition activée.' : '➡️ Répétition désactivée.');
  }),
  simple('melanger', 'Mélanger la file d\'attente', (i, q) => {
    for (let n = q.tracks.length - 1; n > 0; n--) {
      const k = Math.floor(Math.random() * (n + 1));
      [q.tracks[n], q.tracks[k]] = [q.tracks[k], q.tracks[n]];
    }
    return i.reply(`🔀 ${q.tracks.length} morceaux mélangés.`);
  }),
  {
    category: '🎵 Musique',
    data: new SlashCommandBuilder().setName('file').setDescription('Voir la file d\'attente'),
    async run(i) {
      const q = queues.get(i.guildId);
      if (!q?.current) return i.reply(ephemeral('La file d\'attente est vide.'));
      const lines = q.tracks.slice(0, 15).map((t, n) => `**${n + 1}.** [${t.title.slice(0, 70)}](${t.url}) · ${formatDuration(t.duration)}`);
      const more = q.tracks.length > 15 ? `\n… et ${q.tracks.length - 15} autres` : '';
      const embed = trackEmbed(`🎶 En cours${q.loop ? ' (🔂 en boucle)' : ''}`, q.current).addFields({
        name: `À suivre (${q.tracks.length})`,
        value: (lines.join('\n') || '_Rien pour l\'instant_') + more,
      });
      return i.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    },
  },
  {
    category: '🎵 Musique',
    data: new SlashCommandBuilder()
      .setName('retirer')
      .setDescription('Retirer un morceau de la file')
      .addIntegerOption((o) => o.setName('position').setDescription('Numéro dans /file').setRequired(true).setMinValue(1)),
    async run(i) {
      const [q, err] = getQueueFor(i);
      if (!q) return i.reply(ephemeral(err));
      const pos = i.options.getInteger('position');
      const [removed] = q.tracks.splice(pos - 1, 1);
      if (!removed) return i.reply(ephemeral('Il n\'y a pas de morceau à cette position.'));
      return i.reply(`🗑️ **${removed.title}** retiré de la file.`);
    },
  },
];

/** Quitte le vocal si le bot s'y retrouve seul. */
function onVoiceStateUpdate(oldState) {
  const q = queues.get(oldState.guild.id);
  if (!q || oldState.channelId !== q.channelId) return;
  const channel = oldState.guild.channels.cache.get(q.channelId);
  if (channel && channel.members.filter((m) => !m.user.bot).size === 0) {
    setTimeout(() => {
      const still = oldState.guild.channels.cache.get(q.channelId);
      if (queues.get(oldState.guild.id) === q && (!still || still.members.filter((m) => !m.user.bot).size === 0)) {
        q.send('👋 Plus personne dans le vocal, j\'arrête la musique.');
        q.destroy();
      }
    }, 30_000);
  }
}

module.exports = { commands, onVoiceStateUpdate, formatDuration, createStream, queues, isBotBlock, isYouTube, cleanTitle, GuildQueue };
