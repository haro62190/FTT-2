/**
 * Crée (ou met à jour) toute la structure du serveur depuis le terminal.
 * Usage : npm run setup   (équivalent de la commande /setup dans Discord)
 */
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { buildAll } = require('./builder');

const { DISCORD_TOKEN, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !GUILD_ID) {
  console.error('❌ DISCORD_TOKEN et GUILD_ID doivent être définis dans .env');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    console.log(`🚀 Configuration de "${guild.name}" avec ${client.user.tag}`);
    await buildAll(guild);
    console.log('\n✅ Serveur prêt ! Lance maintenant le bot avec `npm start`.');
    console.log('ℹ️  Pense à placer le rôle du bot tout en haut de la liste des rôles (Paramètres du serveur > Rôles).');
  } catch (err) {
    console.error('\n❌ Erreur pendant la configuration :', err.message);
    if (err.code === 50013) console.error('   → Le bot manque de permissions. Invite-le avec la permission Administrateur (voir README).');
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
});

client.login(DISCORD_TOKEN);
