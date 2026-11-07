'use strict';
/**
 * Ripristino di un backup di coach-backup.
 *
 * PRIMA fermare il backend:   docker compose stop backend
 * Elenco dei backup:          docker compose run --rm backup node restore.js
 * Ripristino:                 docker compose run --rm backup node restore.js 2026-11-08_0330
 * POI riavviare:              docker compose start backend
 *
 * Verifica lo SHA-256 e l'integrita' di ogni file prima di toccare i dati. I database attuali
 * non vengono cancellati: si spostano in /data/pre-restore-<data>/.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const Database = require('better-sqlite3');

const DATA = process.env.DATA_DIR || '/data';
const DEST = process.env.BACKUP_DIR || '/backups';
const NOME = /^\d{4}-\d{2}-\d{2}_\d{4}$/;
const log = (...a) => console.log('[restore]', ...a);

async function main() {
  const quale = process.argv[2];
  const elenco = fs.readdirSync(DEST).filter((f) => NOME.test(f)).sort().reverse();
  if (!quale) {
    log(elenco.length ? 'backup disponibili (dal piu\' recente):' : 'nessun backup');
    for (const c of elenco) {
      const m = JSON.parse(fs.readFileSync(path.join(DEST, c, 'manifest.json'), 'utf8'));
      log(`  ${c}  ${m.file.length} database  ${(m.file.reduce((t, f) => t + f.byte_gz, 0) / 1024).toFixed(0)} KB`);
    }
    return;
  }
  if (!NOME.test(quale) || !elenco.includes(quale)) throw new Error(`backup non trovato: ${quale}`);
  const dir = path.join(DEST, quale);
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

  // 0. il backend deve essere fermo: con l'app accesa i file -wal/-shm esistono (alla chiusura spariscono).
  //    Sostituire un database aperto farebbe perdere le scritture successive.
  const aperti = m.file.flatMap((f) => ['-wal', '-shm'].map((s) => f.db + s)).filter((x) => fs.existsSync(path.join(DATA, x)));
  if (aperti.length && !process.argv.includes('--forza')) {
    throw new Error(`database in uso (${aperti.slice(0, 3).join(', ')}${aperti.length > 3 ? '…' : ''}): ferma prima il backend con "docker compose stop backend"`);
  }

  // 1. verifica completa in una cartella temporanea, senza toccare /data
  const tmp = path.join(DATA, `.restore-${quale}.tmp`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, 'utenti'), { recursive: true });
  for (const f of m.file) {
    if (f.db.includes('..') || path.isAbsolute(f.db)) throw new Error(`percorso non valido nel manifest: ${f.db}`);
    const gz = path.join(dir, f.file);
    const h = crypto.createHash('sha256');
    await pipeline(fs.createReadStream(gz), h);
    if (h.digest('hex') !== f.sha256) throw new Error(`SHA-256 diverso per ${f.file}: backup danneggiato`);
    const out = path.join(tmp, f.db);
    await pipeline(fs.createReadStream(gz), zlib.createGunzip(), fs.createWriteStream(out));
    const v = new Database(out, { readonly: true });
    const ok = v.pragma('integrity_check', { simple: true });
    v.close();
    if (ok !== 'ok') throw new Error(`integrita' non valida per ${f.db}`);
  }
  const extra = m.extra || [];
  for (const x of extra) {
    if (x.file.includes('/') || x.file.includes('..')) throw new Error(`percorso non valido nel manifest: ${x.file}`);
    const h = crypto.createHash('sha256');
    await pipeline(fs.createReadStream(path.join(dir, 'extra', x.file)), h);
    if (h.digest('hex') !== x.sha256) throw new Error(`SHA-256 diverso per ${x.file}: backup danneggiato`);
  }
  log(`verificati ${m.file.length} database${extra.length ? ' e la chiave di cifratura' : ''} del ${quale}`);

  // 2. i database attuali si spostano da parte, poi entrano quelli del backup
  //    Se un passo fallisce, si rimette tutto com'era (nessuno stato a meta').
  const parte = path.join(DATA, `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(path.join(parte, 'utenti'), { recursive: true });
  const spostati = [], messi = [];
  try {
    for (const f of m.file) {
      for (const suf of ['', '-wal', '-shm']) {
        const att = path.join(DATA, f.db + suf);
        if (fs.existsSync(att)) { fs.renameSync(att, path.join(parte, f.db + suf)); spostati.push(f.db + suf); }
      }
      const dest = path.join(DATA, f.db);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(path.join(tmp, f.db), dest);
      messi.push(f.db);
    }
    for (const x of extra) {
      const att = path.join(DATA, x.file);
      if (fs.existsSync(att)) { fs.renameSync(att, path.join(parte, x.file)); spostati.push(x.file); }
      fs.copyFileSync(path.join(dir, 'extra', x.file), att);
      fs.chmodSync(att, 0o600);
      messi.push(x.file);
    }
  } catch (e) {
    for (const x of messi) fs.rmSync(path.join(DATA, x), { force: true });
    for (const x of spostati) fs.renameSync(path.join(parte, x), path.join(DATA, x));
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error(`ripristino annullato, dati rimessi com'erano: ${e.message}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  log(`ripristinato ${quale}. I database precedenti sono in ${parte}`);
  log('ora riavvia il backend: docker compose start backend');
}

main().catch((e) => { log(`ERRORE: ${e.message}`); process.exit(1); });
