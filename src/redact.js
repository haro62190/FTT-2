/**
 * Masque les secrets (tokens, clés) avant qu'un texte ne parte dans un log, un fichier ou un salon Discord.
 */
const SECRET_VARS = ['DISCORD_TOKEN', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'ANTHROPIC_API_KEY'];
const TOKEN_RE = /[MNO][A-Za-z\d_-]{23,28}\.[\w-]{6,7}\.[\w-]{27,}/g; // forme d'un token de bot Discord

function redact(text) {
  let out = String(text ?? '');
  for (const name of SECRET_VARS) {
    const v = process.env[name];
    if (v && v.length >= 8) out = out.split(v).join(`[${name} masqué]`);
  }
  return out.replace(TOKEN_RE, '[token masqué]');
}

module.exports = { redact };
