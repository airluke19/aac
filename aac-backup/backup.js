'use strict';
/**
 * coach-backup: backup notturno dei database di AAC.
 *
 * - Copia coerente a caldo di ogni database SQLite (API di backup di SQLite: sicura mentre l'app scrive)
 * - Verifica: PRAGMA integrity_check sulla copia, poi compressione gzip e SHA-256
 * - Una cartella per backup (/backups/AAAA-MM-GG_HHMM) con manifest.json; scritta in .tmp e rinominata solo se tutto e' ok
 * - Conservazione: ultimi N giorni, poi uno a settimana e uno al mese
 * - Stato in /backups/.stato.json (usato dall'healthcheck)
 *
 * Uso: node backup.js            servizio con pianificazione (BACKUP_CRON)
 *      node backup.js --ora      un backup subito e termina
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const Database = require('better-sqlite3');
const cron = require('node-cron');

const DATA = process.env.DATA_DIR || '/data';
const DEST = process.env.BACKUP_DIR || '/backups';
const CRON = process.env.BACKUP_CRON || '30 3 * * *';
const TZ = process.env.TZ || 'Europe/Rome';
const TENGO = {
  giorni: int(process.env.BACKUP_KEEP_DAILY, 7),
  settimane: int(process.env.BACKUP_KEEP_WEEKLY, 4),
  mesi: int(process.env.BACKUP_KEEP_MONTHLY, 6),
};
const NOME = /^\d{4}-\d{2}-\d{2}_\d{4}$/; // solo le cartelle create da qui vengono mai cancellate
const STATO = path.join(DEST, '.stato.json');
// File non-database indispensabili: la chiave che cifra le API key di Intervals (se APP_SECRET non e' impostata).
// Senza, dopo un ripristino ogni utente dovrebbe reinserire la propria chiave.
const EXTRA = ['.chiave-app'];

function int(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
}
const log = (...a) => console.log(new Date().toISOString(), '[backup]', ...a);

// Database da salvare: *.db in /data e in /data/utenti. La demo si rigenera da sola ogni giorno.
function databases() {
  const out = [];
  const aggiungi = (dir, rel) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.db') && fs.statSync(path.join(dir, f)).isFile()) out.push(path.join(rel, f));
    }
  };
  aggiungi(DATA, '');
  aggiungi(path.join(DATA, 'utenti'), 'utenti');
  return out.sort();
}

async function sha256(file) {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), h);
  return h.digest('hex');
}

function nomeCartella(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}_${p.hour}${p.minute}`;
}

async function eseguiBackup() {
  const inizio = Date.now();
  const nome = nomeCartella();
  const tmp = path.join(DEST, `.${nome}.tmp`);
  const finale = path.join(DEST, nome);
  if (fs.existsSync(finale)) { log(`esiste gia' ${nome}, salto`); return; }
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, 'utenti'), { recursive: true, mode: 0o700 });
  const manifest = { creato: new Date().toISOString(), fuso: TZ, versione: 1, file: [] };
  try {
    for (const rel of databases()) {
      const src = path.join(DATA, rel);
      const copia = path.join(tmp, rel);
      const db = new Database(src, { readonly: true, fileMustExist: true });
      db.pragma('busy_timeout = 10000');
      try {
        await db.backup(copia);
      } finally {
        db.close();
      }
      // copia autonoma in un solo file (niente -wal/-shm), poi verifica prima di accettarla
      const w = new Database(copia);
      w.pragma('journal_mode = DELETE');
      w.close();
      const v = new Database(copia, { readonly: true });
      const esito = v.pragma('integrity_check', { simple: true });
      const tabelle = v.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
      const righe = Object.fromEntries(tabelle.map((t) => [t, v.prepare(`SELECT COUNT(*) AS n FROM "${t.replace(/"/g, '""')}"`).get().n]));
      v.close();
      if (esito !== 'ok') throw new Error(`integrity_check fallito su ${rel}: ${esito}`);
      const gz = copia + '.gz';
      await pipeline(fs.createReadStream(copia), zlib.createGzip({ level: 9 }), fs.createWriteStream(gz, { mode: 0o600 }));
      const byte = fs.statSync(copia).size;
      fs.rmSync(copia);
      manifest.file.push({ db: rel, file: rel + '.gz', byte, byte_gz: fs.statSync(gz).size, sha256: await sha256(gz), righe });
    }
    if (!manifest.file.length) throw new Error(`nessun database trovato in ${DATA}`);
    manifest.extra = [];
    for (const rel of EXTRA) {
      const src = path.join(DATA, rel);
      if (!fs.existsSync(src)) continue;
      const dst = path.join(tmp, 'extra', rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
      fs.copyFileSync(src, dst);
      fs.chmodSync(dst, 0o600);
      manifest.extra.push({ file: rel, byte: fs.statSync(dst).size, sha256: await sha256(dst) });
    }
    manifest.durata_ms = Date.now() - inizio;
    fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, finale); // il backup compare solo se completo
    const tot = manifest.file.reduce((t, f) => t + f.byte_gz, 0);
    log(`ok ${nome}: ${manifest.file.length} database${manifest.extra.length ? ' + chiave di cifratura' : ''}, ${(tot / 1024).toFixed(0)} KB compressi, ${manifest.durata_ms} ms`);
    scriviStato({ ok: true, ultimo_ok: manifest.creato, cartella: nome, database: manifest.file.length, byte_gz: tot });
    pulisci();
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    log(`ERRORE: ${e.message}`);
    scriviStato({ ok: false, errore: e.message, quando: new Date().toISOString() });
    throw e;
  }
}

function scriviStato(nuovo) {
  let vecchio = {};
  try { vecchio = JSON.parse(fs.readFileSync(STATO, 'utf8')); } catch (_) { /* primo avvio */ }
  // l'ultimo backup riuscito resta registrato anche dopo un tentativo fallito
  const s = nuovo.ok ? nuovo : { ...vecchio, ok: false, errore: nuovo.errore, quando: nuovo.quando };
  fs.writeFileSync(STATO, JSON.stringify(s, null, 2), { mode: 0o600 });
}

// Conservazione (cartelle dal piu' recente):
//   giornalieri  il piu' recente di ciascuno degli ultimi N giorni
//   settimanali  il PRIMO backup di ciascuna delle W settimane precedenti a quella in corso (copie di 1-2 settimane fa)
//   mensili      il PRIMO backup di ciascuno degli M mesi precedenti a quello in corso (copie di 1-2 mesi fa)
// Si tiene anche il primo backup della settimana e del mese in corso: alla fine del periodo diventa
// la copia "precedente" (altrimenti verrebbe cancellato prima, quando e' ancora del periodo in corso).
// Il primo backup di un periodo concluso non cambia piu': resta una copia stabile e davvero vecchia.
const settimanaDi = (c) => {
  const d = new Date(c.slice(0, 10) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
function daTenere(cartelle, tengo = TENGO) {
  const ord = cartelle.filter((f) => NOME.test(f)).sort().reverse();
  const tieni = new Set();
  if (!ord.length) return tieni;
  const giorni = new Set();
  for (const c of ord) {
    const g = c.slice(0, 10);
    if (!giorni.has(g) && giorni.size < tengo.giorni) { giorni.add(g); tieni.add(c); }
  }
  const primoPer = (chiave, inCorso, quanti) => {
    if (!quanti) return;
    const primo = new Map(); // periodo -> backup piu' vecchio di quel periodo
    for (const c of ord) primo.set(chiave(c), c);
    if (primo.has(inCorso)) tieni.add(primo.get(inCorso)); // candidato per il prossimo periodo
    [...primo.keys()].filter((k) => k < inCorso).sort().reverse().slice(0, quanti).forEach((k) => tieni.add(primo.get(k)));
  };
  primoPer(settimanaDi, settimanaDi(ord[0]), tengo.settimane);
  primoPer((c) => c.slice(0, 7), ord[0].slice(0, 7), tengo.mesi);
  return tieni;
}

function pulisci() {
  const cartelle = fs.readdirSync(DEST).filter((f) => NOME.test(f));
  const tieni = daTenere(cartelle);
  for (const c of cartelle) {
    if (tieni.has(c)) continue;
    fs.rmSync(path.join(DEST, c), { recursive: true, force: true });
    log(`rimosso ${c} (oltre la conservazione)`);
  }
}

function ultimoOk() {
  try { return Date.parse(JSON.parse(fs.readFileSync(STATO, 'utf8')).ultimo_ok) || 0; } catch (_) { return 0; }
}

async function main() {
  if (!fs.existsSync(DEST)) throw new Error(`cartella dei backup mancante: ${DEST}`);
  if (process.argv.includes('--ora')) { await eseguiBackup(); return; }
  if (!cron.validate(CRON)) throw new Error(`BACKUP_CRON non valido: ${CRON}`);
  log(`attivo: "${CRON}" (${TZ}), conservo ${TENGO.giorni} giorni, ${TENGO.settimane} settimane, ${TENGO.mesi} mesi`);
  // all'avvio: se l'ultimo backup ha piu' di 24 ore (o non c'e'), ne faccio uno subito
  if (Date.now() - ultimoOk() > 24 * 3600e3) await eseguiBackup().catch(() => {});
  let inCorso = false;
  cron.schedule(CRON, async () => {
    if (inCorso) return;
    inCorso = true;
    try { await eseguiBackup(); } catch (_) { /* gia' registrato */ } finally { inCorso = false; }
  }, { timezone: TZ });
}

if (require.main === module) main().catch((e) => { log(`ERRORE: ${e.message}`); process.exit(1); });

module.exports = { daTenere }; // per i test della conservazione
