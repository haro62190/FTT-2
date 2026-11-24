require('./setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const run = (dir, code) => execFileSync(process.execPath, ['-e', code], { env: { ...process.env, RONIN_DATA_DIR: dir }, encoding: 'utf8', cwd: path.join(__dirname, '..') });
const fresh = () => fs.mkdtempSync(path.join(require('os').tmpdir(), 'ronin-stab-'));

test('aucune perte de données entre deux démarrages', () => {
  const dir = fresh();
  run(dir, "const s=require('./src/store'); s.db.levels.a={xp:42}; s.flush();");
  const out = run(dir, "process.stdout.write(String(require('./src/store').db.levels.a.xp))");
  assert.equal(out, '42');
});

test('copie de la base : créée, vérifiée, relisible', () => {
  const dir = fresh();
  const out = run(dir, "const s=require('./src/store'); s.db.levels.b={xp:7}; const e=require('./src/dbbackup').create('auto'); process.stdout.write(JSON.stringify(e))");
  const e = JSON.parse(out);
  assert.equal(e.verified, true);
  assert.ok(e.check.sections >= 2);
  assert.ok(fs.existsSync(path.join(dir, 'sauvegardes', e.file)));
});

test('base corrompue : restauration automatique depuis la dernière copie vérifiée', () => {
  const dir = fresh();
  run(dir, "const s=require('./src/store'); s.db.levels.c={xp:99}; require('./src/dbbackup').create('auto'); s.sql.close();");
  fs.writeFileSync(path.join(dir, 'ronin.db'), 'ceci n\'est pas une base SQLite'.repeat(200));
  for (const ext of ['-wal', '-shm']) fs.rmSync(path.join(dir, `ronin.db${ext}`), { force: true });
  const out = run(dir, "const s=require('./src/store'); process.stdout.write(JSON.stringify({xp:s.db.levels.c?.xp, rec:s.recovery.happened}))");
  assert.deepEqual(JSON.parse(out.slice(out.lastIndexOf('{'))), { xp: 99, rec: true });
  assert.ok(fs.readdirSync(dir).some((f) => f.includes('corrompue')), 'la base abîmée est gardée de côté');
});

test('rotation : générations journalières / hebdomadaires / mensuelles', () => {
  const dir = fresh();
  const out = run(dir, `
    const fs=require('fs'); const path=require('path'); const {BACKUP_DIR}=require('./src/store'); const b=require('./src/dbbackup');
    fs.mkdirSync(BACKUP_DIR,{recursive:true});
    const list=[]; const now=Date.parse('2026-11-24T12:00:00Z');
    for (let d=0; d<200; d++) { const file='f'+d+'.db'; fs.writeFileSync(path.join(BACKUP_DIR,file),'x'); list.push({file, at: now - d*86400e3, kind:'auto', verified:true}); }
    const kept=b.rotate(list); process.stdout.write(String(kept.length));`);
  const n = Number(out);
  assert.ok(n >= 7 && n <= 7 + 4 + 6, `${n} copies gardées`);
});
