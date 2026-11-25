require('./setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { db } = require('../src/store');

test('vitrine : domaine public reconnu (avec www et port), autres refusés', () => {
  process.env.PUBLIC_HOST = 'haro62190.tech';
  const v = require('../src/vitrine');
  assert.ok(v.isPublicHost('haro62190.tech'));
  assert.ok(v.isPublicHost('WWW.haro62190.tech:443'));
  assert.ok(!v.isPublicHost('bot.haro62190.tech'));
  assert.ok(!v.isPublicHost('evil.example'));
});

test('vitrine : page complète, contenu échappé, lecteur Twitch pendant le live', async () => {
  process.env.PUBLIC_HOST = 'haro62190.tech';
  process.env.TWITCH_CHANNEL = 'haro62190';
  const settings = require('../src/settings');
  settings.set('vitrine.invite', 'https://discord.gg/ronins');
  settings.set('vitrine.about', '<script>alert(1)</script>');
  db.twitchLive = { title: 'Soirée <b>Warzone</b>', peak: 12 };
  db.twitchSchedule = { events: {}, upcoming: [{ start: Date.now() + 86_400_000, title: 'Ranked', game: 'Warzone' }] };
  db.clipsGallery = { a: { id: 'a', url: 'https://clips.twitch.tv/a', title: 'Clip', creator: 'x', views: 5, thumb: 'javascript:alert(1)', createdAt: Date.now() } };
  const html = await require('../src/vitrine').render({ name: 'Les Ronins', memberCount: 42 }, 'haro62190.tech');
  assert.ok(html.includes('https://discord.gg/ronins'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;b&gt;Warzone'));
  assert.ok(html.includes('player.twitch.tv/?channel=haro62190&parent=haro62190.tech'));
  assert.ok(html.includes('Ranked'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('>42<'));
  db.twitchLive = null;
});

test('minecraft : liste blanche par RCON, pseudos invalides refusés', async () => {
  const sent = [];
  const srv = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (c) => {
      buf = Buffer.concat([buf, c]);
      while (buf.length >= 4 && buf.length >= 4 + buf.readInt32LE(0)) {
        const len = buf.readInt32LE(0);
        const id = buf.readInt32LE(4);
        const type = buf.readInt32LE(8);
        const body = buf.subarray(12, 4 + len - 2).toString();
        buf = buf.subarray(4 + len);
        const reply = (rid, text) => {
          const b = Buffer.from(text);
          const out = Buffer.alloc(14 + b.length);
          out.writeInt32LE(10 + b.length, 0);
          out.writeInt32LE(rid, 4);
          out.writeInt32LE(0, 8);
          b.copy(out, 12);
          sock.write(out);
        };
        if (type === 3) reply(body === 'secret' ? id : -1, '');
        else {
          sent.push(body);
          reply(id, `ok ${body}`);
        }
      }
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  process.env.MINECRAFT_HOST = '127.0.0.1';
  process.env.MINECRAFT_RCON_PORT = String(srv.address().port);
  process.env.MINECRAFT_RCON_PASSWORD = 'secret';
  const gs = require('../src/gameserver');
  db.mcWhitelist = {};
  await gs.whitelist('u1', 'Haro_62');
  await gs.whitelist('u1', 'Haro2'); // changement de pseudo : l'ancien est retiré
  await assert.rejects(gs.whitelist('u2', 'haro2'), /déjà inscrit/);
  await assert.rejects(gs.whitelist('u3', 'x; op moi'), /Pseudo invalide/);
  assert.equal(await gs.unwhitelist('u1'), 'Haro2');
  assert.deepEqual(sent, ['whitelist add Haro_62', 'whitelist remove Haro_62', 'whitelist add Haro2', 'whitelist remove Haro2']);
  process.env.MINECRAFT_RCON_PASSWORD = 'faux';
  await assert.rejects(gs.rcon('list'), /refusé/);
  srv.close();
  delete process.env.MINECRAFT_RCON_PASSWORD;
});
