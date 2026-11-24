/** Affiche le lien d'invitation du bot avec les permissions minimales (sans Administrateur) : npm run invite */
require('dotenv').config();
const { REQUIRED, inviteUrl, clientIdFromToken, bitfield } = require('../src/permissions');
const id = process.argv[2] || clientIdFromToken(process.env.DISCORD_TOKEN);
if (!id) {
  console.error('❌ Impossible de trouver l\'ID du bot : remplis DISCORD_TOKEN dans .env (ou : npm run invite -- <ID_APPLICATION>)');
  process.exit(1);
}
console.log('\n🔗 Lien d\'invitation de Kensei (permissions minimales, sans Administrateur) :\n');
console.log(`   ${inviteUrl(id)}\n`);
console.log(`Permissions (${bitfield()}) :`);
for (const [name, why] of Object.entries(REQUIRED)) console.log(`   • ${name.padEnd(22)} ${why}`);
console.log('\nSi le bot est déjà sur le serveur : ouvre ce lien quand même, Discord mettra simplement ses permissions à jour.');
console.log('Ensuite, dans Paramètres du serveur → Rôles : place le rôle du bot tout en haut, et retire-lui Administrateur.\n');
