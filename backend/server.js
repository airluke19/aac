'use strict';

/**
 * Always Adaptive Coach - Backend
 * ---------------------------------------------------------------------------
 * - Express + SQLite (better-sqlite3): database locale corse.db
 * - Sincronizzazione con Intervals.icu (manuale via POST /api/sync, all'apertura e cron ogni 15 minuti)
 * - GET /api/coach-data: stato di forma (CTL/ATL/TSB), zona, prossimi 3 allenamenti
 * - Serve la SPA statica da ./public
 *
 * I segreti di Intervals.icu (API key e Athlete ID) restano solo qui, lato server.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const express = require('express');
const Database = require('better-sqlite3');
const cron = require('node-cron');

// ===========================================================================
// Configurazione
// ===========================================================================

const BASE = {
  port: parseInt(process.env.PORT || '3000', 10),
  dbPath: process.env.DB_PATH || path.join(__dirname, 'data', 'corse.db'),
  publicDir: process.env.PUBLIC_DIR || path.join(__dirname, 'public'),
  intervalsBase: (process.env.INTERVALS_BASE_URL || 'https://intervals.icu').replace(/\/+$/, ''),
  apiKey: (process.env.INTERVALS_API_KEY || '').trim(),
  athleteId: (process.env.INTERVALS_ATHLETE_ID || '').trim(),
  syncCron: process.env.SYNC_CRON || '*/15 * * * *',
  timezone: process.env.TZ || 'Europe/Rome',
  historyDays: parseInt(process.env.SYNC_HISTORY_DAYS || '365', 10),
  recentDays: parseInt(process.env.SYNC_RECENT_DAYS || '21', 10),
  fullResyncDays: parseInt(process.env.SYNC_FULL_EVERY_DAYS || '7', 10),
  syncOnStart: (process.env.SYNC_ON_START || 'true').toLowerCase() === 'true',
  seedMock: (process.env.SEED_MOCK || 'true').toLowerCase() === 'true',
  allowedEmail: (process.env.ALLOWED_EMAIL || '').trim().toLowerCase(),
  eta: parseInt(process.env.ATHLETE_AGE || '33', 10),
  // Data di inizio del programma di ripartenza (YYYY-MM-DD); vuoto = disattivato
  programmaInizio: /^\d{4}-\d{2}-\d{2}$/.test(process.env.PROGRAMMA_INIZIO || '') ? process.env.PROGRAMMA_INIZIO : null,
  // Orario delle sedute nel calendario (.ics), ora locale HH:MM
  programmaOra: /^\d{2}:\d{2}$/.test(process.env.PROGRAMMA_ORA || '') ? process.env.PROGRAMMA_ORA : '06:30',
  // --- Account (login con Google). Senza queste variabili l'app resta a utente singolo, senza login ---
  publicUrl: (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, ''),
  googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
  googleClientSecret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
  adminEmail: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  appSecret: (process.env.APP_SECRET || '').trim(),
};
BASE.dataDir = path.dirname(BASE.dbPath);
// Formula di Tanaka (2001) per la FC massima stimata: 208 - 0,7 x eta'. Piu' accurata di 220 - eta',
// che la sottostima dopo i 40 anni. Con l'eta' predefinita (33) da' 185 bpm.
const fcMaxTanaka = (eta) => Math.round(208 - 0.7 * (eta || 33));
BASE.fcMax = fcMaxTanaka(BASE.eta);

// Ogni richiesta (e ogni sincronizzazione) gira nel contesto di un utente: database e impostazioni sono i suoi.
const contesto = new AsyncLocalStorage();
const CAMPI_UTENTE = new Set(['apiKey', 'athleteId', 'eta', 'etaImpostata', 'dataNascita', 'fcMax', 'fcMaxReale', 'altezza', 'peso', 'pesoData', 'programmaInizio', 'programmaOra', 'seedMock', 'settimanaIniziale', 'obiettivo', 'intensita', 'intensitaAuto', 'giorniSedute', 'giorniModo', 'ripartiData', 'ripartiSett']);
const CONFIG = new Proxy(BASE, {
  get(t, k) {
    const c = contesto.getStore();
    // FC massima: quella indicata dall'utente (o vista nelle sue corse), altrimenti la formula di Tanaka dall'eta'
    if (c && CAMPI_UTENTE.has(k)) {
      // con la data di nascita l'eta' e' sempre quella di oggi (non quella del giorno in cui e' stata salvata)
      const eta = c.cfg.dataNascita ? etaDa(c.cfg.dataNascita) : c.cfg.eta;
      if (k === 'eta') return eta;
      if (k === 'etaImpostata') return c.cfg.dataNascita ? eta : c.cfg.etaImpostata;
      return k === 'fcMax' ? c.cfg.fcMaxReale || fcMaxTanaka(eta) : c.cfg[k];
    }
    return t[k];
  },
});

// Soglie del coach (TSB = CTL - ATL; ramp rate = variazione di CTL in 7 giorni)
const SOGLIE = {
  verdeMin: -10, //   TSB >= -10  -> zona verde (freschezza)
  rossaMax: -25, //   TSB <  -25  -> zona rossa (sovraccarico)
  rampAttenzione: 5, // ramp rate > 5 CTL/settimana -> almeno arancione
  rampAllerta: 8, //    ramp rate > 8 CTL/settimana -> rossa
  calo7gAttenzione: -15, // TSB in calo di oltre 15 punti in 7 giorni -> almeno arancione
};

const K_CTL = Math.exp(-1 / 42);
const K_ATL = Math.exp(-1 / 7);
const TIPI_CORSA = new Set(['Run', 'TrailRun', 'VirtualRun']);
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const GIORNI_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ===========================================================================
// Utility date (tutte le date sono stringhe locali YYYY-MM-DD)
// ===========================================================================

// Lingua dei testi generati: impostata per ogni richiesta (?lang=en), elaborazione sincrona
let LINGUA = 'it';
const L = (it, en) => (LINGUA === 'en' ? en : it);
const P = (coppia) => (Array.isArray(coppia) ? coppia[LINGUA === 'en' ? 1 : 0] : coppia);

const DAY_MS = 86400000;
const pad = (n) => String(n).padStart(2, '0');

function oggi() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dayMs(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function msToStr(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function addDays(s, n) {
  return msToStr(dayMs(s) + n * DAY_MS);
}
function diffDays(a, b) {
  return Math.round((dayMs(a) - dayMs(b)) / DAY_MS);
}
function lunedi(s) {
  const dow = (new Date(dayMs(s)).getUTCDay() + 6) % 7;
  return addDays(s, -dow);
}
function giornoSettimana(s) {
  return (LINGUA === 'en' ? GIORNI_EN : GIORNI)[new Date(dayMs(s)).getUTCDay()];
}
function isoWeek(s) {
  const d = new Date(dayMs(s));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7);
  return { anno: d.getUTCFullYear(), settimana: week };
}

// ===========================================================================
// Utility numeriche / formattazione
// ===========================================================================

const round = (x, dec = 1) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** dec) / 10 ** dec);
const num = (x) => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
const mezzoKm = (x) => Math.round(x * 2) / 2;
const it1 = (x) => (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');
const mediana = (arr) => {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
function fmtPasso(sec) {
  const tot = Math.round(sec);
  return `${Math.floor(tot / 60)}:${pad(tot % 60)}`;
}
function rangePasso(sec, da, a) {
  return `${fmtPasso(sec + da)}–${fmtPasso(sec + a)}`;
}
function rangeFc(minPct, maxPct) {
  return `${Math.round(CONFIG.fcMax * minPct)}–${Math.round(CONFIG.fcMax * maxPct)}`;
}

// ===========================================================================
// Database
// ===========================================================================

fs.mkdirSync(path.dirname(CONFIG.dbPath), { recursive: true });
// Database di un utente: schema e migrazioni vengono applicati all'apertura
function apriDbUtente(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS attivita (
      id                TEXT PRIMARY KEY,
      data              TEXT NOT NULL,          -- giorno locale YYYY-MM-DD
      distanza          REAL NOT NULL,          -- km
      tempo             INTEGER NOT NULL,       -- secondi (moving time)
      passo_medio       REAL,                   -- secondi per km
      fc_media          REAL,                   -- bpm
      ctl               REAL,
      atl               REAL,
      tsb               REAL,
      efficiency_factor REAL,
      origine           TEXT NOT NULL DEFAULT 'intervals'   -- 'intervals' | 'mock'
    );
    CREATE INDEX IF NOT EXISTS idx_attivita_data ON attivita (data);

    -- Valori giornalieri CTL/ATL (anche nei giorni senza corsa), da Intervals.icu
    CREATE TABLE IF NOT EXISTS benessere (
      data TEXT PRIMARY KEY,
      ctl  REAL,
      atl  REAL
    );

    CREATE TABLE IF NOT EXISTS meta (
      chiave TEXT PRIMARY KEY,
      valore TEXT
    );

    -- Attivita' diverse dalla corsa (camminate, palestra, bici...): solo informative,
    -- non entrano nel calcolo degli allenamenti di corsa
    CREATE TABLE IF NOT EXISTS altre_attivita (
      id        TEXT PRIMARY KEY,
      data      TEXT NOT NULL,
      tipo      TEXT NOT NULL,
      nome      TEXT,
      durata    INTEGER,          -- secondi
      distanza  REAL,             -- km
      fc_media  REAL,
      calorie   REAL,
      carico    REAL              -- training load di Intervals.icu
    );
    CREATE INDEX IF NOT EXISTS idx_altre_data ON altre_attivita (data);

    -- Sedute segnate come fatte a mano (es. orologio dimenticato)
    CREATE TABLE IF NOT EXISTS sedute_manuali (
      data   TEXT PRIMARY KEY,
      creato TEXT NOT NULL
    );

    -- Diario del coach: ogni intervento (decisioni settimanali, sedute alleggerite, zone, carico, notifiche)
    CREATE TABLE IF NOT EXISTS diario (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      quando TEXT NOT NULL,          -- ISO
      tipo   TEXT NOT NULL,          -- settimana | alleggerita | intensita | frequenza | zone | carico | notifica
      chiave TEXT NOT NULL UNIQUE,   -- evita i doppioni
      titolo TEXT NOT NULL,
      testo  TEXT
    );
  `);

  // Migrazione: diario in due lingue (titolo/testo = italiano, *_en = inglese)
  {
    const cd = new Set(db.prepare('PRAGMA table_info(diario)').all().map((c) => c.name));
    if (!cd.has('titolo_en')) db.exec('ALTER TABLE diario ADD COLUMN titolo_en TEXT');
    if (!cd.has('testo_en')) db.exec('ALTER TABLE diario ADD COLUMN testo_en TEXT');
  }

  // Migrazione: dettagli delle corse per lo storico e le statistiche
  {
    const esistenti = new Set(db.prepare('PRAGMA table_info(attivita)').all().map((c) => c.name));
    const nuove = [
      ['nome', 'TEXT'],
      ['tipo', 'TEXT'],
      ['fc_max', 'REAL'],
      ['cadenza', 'REAL'],
      ['dislivello', 'REAL'],
      ['carico', 'REAL'],
      ['calorie', 'REAL'],
      ['decoupling', 'REAL'],
      ['zone_fc', 'TEXT'], // JSON: secondi per zona FC (da Intervals.icu)
      // Analisi dei dati secondo per secondo: solo i tratti di corsa (esclusa la camminata)
      ['tempo_corsa', 'INTEGER'],
      ['distanza_corsa', 'REAL'],
      ['passo_corsa', 'REAL'],
      ['fc_corsa', 'REAL'],
      ['parziali', 'TEXT'], // JSON: secondi per ogni km completo
      ['serie', 'TEXT'], // JSON: dati campionati ogni ~5 s per i grafici della seduta
      ['v_analisi', 'INTEGER'], // versione dell'analisi stream: sotto ANALISI_V la corsa viene rianalizzata
      ['giri', 'TEXT'], // JSON: giri dell'orologio (es. 1' corsa / 2' cammino), '[]' se assenti
      ['fc_istogramma', 'TEXT'], // JSON: [[bpm, secondi], ...] dallo stream FC al secondo di Intervals (dato derivato, ricalcolabile)
      ['rpe', 'REAL'], // sforzo percepito 1-10
      ['contatto', 'REAL'], // tempo di contatto col suolo, ms
      ['oscillazione', 'REAL'], // oscillazione verticale, cm
      ['lung_passo', 'REAL'], // lunghezza del passo in corsa, m
      ['ora_inizio', 'TEXT'], // HH:MM locale di partenza
      ['scarpa_id', 'INTEGER'], // scarpa usata (tabella scarpe)
      ['meteo', 'TEXT'], // JSON: meteo all'ora della corsa (Open-Meteo); '{}' = non disponibile
      ['stream_ok', 'INTEGER'], // NULL = da analizzare, 1 = analizzata, 0 = dati non disponibili, -1 = errore (si riprova)
      ['deriva', 'REAL'], // deriva cardiaca (Pa:HR, %) calcolata da AAC sugli stream: usata se Intervals non fornisce decoupling
      ['passo_gap', 'REAL'], // passo equivalente in piano (GAP di Intervals), s/km
      ['fc_recupero', 'REAL'], // calo della FC nel minuto dopo il picco (HRR di Intervals), bpm
      ['rapporto_verticale', 'REAL'], // oscillazione / lunghezza passo, %
    ];
    for (const [nome, tipo] of nuove) {
      if (!esistenti.has(nome)) db.exec(`ALTER TABLE attivita ADD COLUMN ${nome} ${tipo}`);
    }
    // Scarpe dell'utente: km = km_iniziali + corse assegnate
    db.exec(`CREATE TABLE IF NOT EXISTS scarpe (
      id INTEGER PRIMARY KEY,
      nome TEXT NOT NULL,
      km_iniziali REAL NOT NULL DEFAULT 0,
      limite_km REAL NOT NULL DEFAULT 700,
      attiva INTEGER NOT NULL DEFAULT 1,
      predefinita INTEGER NOT NULL DEFAULT 0,
      creata TEXT NOT NULL
    )`);
  }

  // Migrazione: dati di salute giornalieri (orologio/app di salute -> Intervals.icu) nella tabella benessere
  {
    const esistenti = new Set(db.prepare('PRAGMA table_info(benessere)').all().map((c) => c.name));
    const nuove = [
      ['fc_riposo', 'REAL'],
      ['hrv', 'REAL'],
      ['sonno_sec', 'INTEGER'],
      ['sonno_score', 'REAL'],
      ['passi', 'INTEGER'],
      ['peso', 'REAL'],
      ['vo2max', 'REAL'],
      ['spo2', 'REAL'],
      ['respirazione', 'REAL'],
      ['fc_sonno', 'REAL'],
      ['grasso', 'REAL'], // massa grassa %
      ['pressione_max', 'REAL'], // mmHg
      ['pressione_min', 'REAL'],
      ['glicemia', 'REAL'], // mmol/L
      ['piani', 'INTEGER'], // piani saliti
    ];
    for (const [nome, tipo] of nuove) {
      if (!esistenti.has(nome)) db.exec(`ALTER TABLE benessere ADD COLUMN ${nome} ${tipo}`);
    }
  }
  return db;
}

const dbAperti = new Map();
function dbPer(file) {
  if (!dbAperti.has(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    dbAperti.set(file, apriDbUtente(file));
  }
  return dbAperti.get(file);
}
const { creaAccount, etaDa } = require('./account');
const account = creaAccount({ BASE, dbPer, chiudiDb, contesto, cambioObiettivo: (ctx, nuovo) => mappaCambioObiettivo(ctx, nuovo) });

// Strava come seconda fonte di dati (OAuth, solo attivita'): vedi strava.js
const { creaStrava } = require('./strava');
const strava = creaStrava({ sis: account.sistema, cifra: account.cifra, decifra: account.decifra, publicUrl: BASE.publicUrl,
  clientId: (process.env.STRAVA_CLIENT_ID || '').trim(), clientSecret: (process.env.STRAVA_CLIENT_SECRET || '').trim() });
account.eventi.stravaDisponibile = () => strava.attivo;

// Notifiche push (seduta del mattino, riepilogo della domenica): vedi notifiche.js
const { creaNotifiche } = require('./notifiche');
const notifiche = creaNotifiche({
  sis: account.sistema, cifra: account.cifra, decifra: account.decifra,
  soggetto: /^https:\/\//.test(BASE.publicUrl || '') ? BASE.publicUrl : 'https://aac.run',
  testo: (u, tipo, lingua) => testoNotifica(u, tipo, lingua),
  annota: (utenteId, crea) => {
    const it = crea('it'), en = crea('en') || it;
    if (!it || it.tag === 'prova') return;
    const u = account.utentiAttivi().find((x) => x.id === utenteId);
    if (!u) return;
    const quando = new Date().toISOString();
    account.contestoDi(u).db.prepare('INSERT OR IGNORE INTO diario (quando, tipo, chiave, titolo, testo, titolo_en, testo_en) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(quando, 'notifica', `notifica:${it.tag}:${quando.slice(0, 16)}`, it.title, it.body, en.title, en.body);
  },
  oraLocale: () => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: CONFIG.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
      .formatToParts(new Date()).map((x) => [x.type, x.value]));
    return { giorno: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}`, giornoSett: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
  },
});

// Diario del coach: ogni intervento, una volta sola (chiave unica), salvato in italiano e in inglese.
// vociDiario e' pura (testi nella lingua corrente, nessuna scrittura); registraDiario scrive solo le voci nuove
// e, solo se ce ne sono, ricalcola i testi nell'altra lingua.
function vociDiario(cd) {
  const p = cd.programma;
  if (!p) return [];
  const voci = [];
  const ora = new Date().toISOString();
  const add = (quando, tipo, chiave, titolo, testo) => voci.push({ quando, tipo, chiave, titolo, testo });
  const gm = (d) => `${giornoSettimana(d)} ${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;
  for (const w of p.storia || []) {
    const t = { avanti: L('si avanza', 'moving forward'), ripeti: L('la ripetiamo', 'we repeat it'), indietro: L('un passo indietro', 'one step back') }[w.esito];
    if (t) add(`${w.a}T21:00:00`, 'settimana', `settimana:${w.da}`, L(`Settimana ${w.numero}: ${t}`, `Week ${w.numero}: ${t}`), w.motivi.join(', '));
  }
  const s0 = p.prossime && p.prossime[0];
  if (s0 && s0.adattata) add(ora, 'alleggerita', `alleggerita:${s0.data}`, L('Seduta alleggerita', 'Session lightened'),
    `${gm(s0.data)}. ${spiegaAlleggerita(s0)}`);
  const im = p.intensita && p.intensita.ultima_modifica;
  if (im) add(`${im.data}T21:00:00`, 'intensita', `intensita:${im.data}`, L('Intensità ritoccata', 'Intensity adjusted'), im.motivo);
  const fm = p.frequenza && p.frequenza.ultima_modifica;
  if (fm) add(`${fm.data}T21:00:00`, 'frequenza', `frequenza:${fm.data}`, L('Sedute a settimana', 'Sessions per week'), fm.motivo);
  const c = p.carico;
  if (c && c.livello !== 'ok') add(ora, 'carico', `carico:${cd.oggi}:${c.livello}`, c.livello === 'alto' ? L('Carico troppo alto', 'Load too high') : L('Carico in crescita rapida', 'Load rising fast'), c.segnali.join('; '));
  // zone: quando cambiano (prima volta: confronto con il vecchio calcolo in % della FC max)
  const z = limitiZone(), mz = metodoZone();
  const firma = `${mz.metodo}:${mz.fc_riposo || ''}:${z[2].da}:${z[3].da}`;
  const prima = getMeta('zone_firma') || `fcmax::${Math.floor(CONFIG.fcMax * 0.7) + 1}:${Math.floor(CONFIG.fcMax * 0.8) + 1}`;
  if (prima !== firma) {
    const fac = z[2].da - 1, q = `${z[3].da}–${z[3].a}`;
    add(ora, 'zone', `zone:${firma}:${cd.oggi}`, L('Zone cardiache aggiornate', 'Heart-rate zones updated'), mz.metodo === 'riserva'
      ? L(`Corsa facile fino a ${fac} bpm, qualità ${q} bpm: calcolate sulla tua FC a riposo (${mz.fc_riposo} bpm, mediana di 28 giorni) e sulla FC max (${CONFIG.fcMax} bpm), con la riserva cardiaca. La corsa facile non supera mai l’80% della FC max.`,
        `Easy running up to ${fac} bpm, quality ${q} bpm: based on your resting HR (${mz.fc_riposo} bpm, 28-day median) and max HR (${CONFIG.fcMax} bpm), using heart-rate reserve. Easy running never exceeds 80% of max HR.`)
      : L(`Corsa facile fino a ${fac} bpm, qualità ${q} bpm: in % della FC max (${CONFIG.fcMax} bpm).`, `Easy running up to ${fac} bpm, quality ${q} bpm: as % of max HR (${CONFIG.fcMax} bpm).`));
    voci[voci.length - 1].firma = firma;
  }
  return voci;
}
function registraDiario(cd) {
  const voci = vociDiario(cd);
  const esiste = db.prepare('SELECT 1 FROM diario WHERE chiave = ?');
  const nuove = voci.filter((v) => !esiste.get(v.chiave));
  const zona = voci.find((v) => v.firma);
  if (!nuove.length) { if (zona) setMeta('zone_firma', zona.firma); return []; }
  // stesse voci nell'altra lingua (stessa chiave)
  const qui = LINGUA, altra = LINGUA === 'en' ? 'it' : 'en';
  let tradotte = new Map();
  LINGUA = altra;
  try { tradotte = new Map(vociDiario(costruisciCoachData()).map((v) => [v.chiave, v])); } catch (e) { console.warn('[diario] traduzione', e.message); } finally { LINGUA = qui; }
  const ins = db.prepare('INSERT OR IGNORE INTO diario (quando, tipo, chiave, titolo, testo, titolo_en, testo_en) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const scritte = [];
  db.transaction(() => {
    for (const v of nuove) {
      const t = tradotte.get(v.chiave) || v;
      const it = qui === 'it' ? v : t, en = qui === 'en' ? v : t;
      if (ins.run(v.quando, v.tipo, v.chiave, it.titolo, it.testo, en.titolo, en.testo).changes) scritte.push({ quando: v.quando, tipo: v.tipo, titolo: it.titolo, testo: it.testo, titolo_en: en.titolo, testo_en: en.testo });
    }
    if (zona) setMeta('zone_firma', zona.firma);
  })();
  return scritte;
}

// Ogni nuova voce del diario arriva anche sul telefono: solo le voci recenti (niente storico ricostruito),
// al massimo 3 per volta. La seduta alleggerita prima della notifica del mattino viaggia con quella.
function notificaVoci(utenteId, nuove) {
  if (!nuove.length || !notifiche.haIscrizioni(utenteId)) return;
  const pref = notifiche.preferenzeDi(utenteId);
  const limite = new Date(Date.now() - 3 * 864e5).toISOString();
  const oggiStr = oggi();
  const da = nuove.filter((v) => v.quando >= limite).filter((v) => !(v.tipo === 'alleggerita' && pref && pref.mattina && !pref.ultima.includes(`mattina:${oggiStr}`)));
  for (const v of da.slice(0, 3)) {
    notifiche.avvisa(utenteId, (lingua) => (lingua === 'en'
      ? { title: v.titolo_en || v.titolo, body: v.testo_en || v.testo || '', tag: `diario-${v.tipo}`, url: '/#diario' }
      : { title: v.titolo, body: v.testo || '', tag: `diario-${v.tipo}`, url: '/#diario' })).catch((e) => console.warn('[notifiche] diario', e.message));
  }
}
// Dopo ogni sincronizzazione automatica il coach rivede i dati di tutti: cosi' gli avvisi arrivano anche ad app chiusa
function aggiornaDiariTutti() {
  for (const u of account.utentiAttivi()) {
    if (!notifiche.haIscrizioni(u.id)) continue;
    try {
      contesto.run(account.contestoDi(u), () => {
        const prima = LINGUA; LINGUA = 'it'; // i testi si salvano comunque in entrambe le lingue
        try { notificaVoci(u.id, registraDiario(costruisciCoachData())); } finally { LINGUA = prima; }
      });
    } catch (e) { console.warn(`[diario] u${u.id}`, e.message); }
  }
}

// L'amministratore riceve una notifica a ogni nuova richiesta di accesso (tocco = pannello di amministrazione)
account.eventi.nuovaRichiesta = (u) => {
  const chi = u.nome || u.email;
  notifiche.avvisaAdmin((lingua) => (lingua === 'en'
    ? { title: 'New access request', body: `${chi} wants to use AAC. Approve or decline in the admin panel.`, tag: 'richiesta-' + u.id, url: '/#admin' }
    : { title: 'Nuova richiesta di accesso', body: `${chi} vuole usare AAC. Approva o rifiuta dal pannello di amministrazione.`, tag: 'richiesta-' + u.id, url: '/#admin' }))
    .catch((e) => console.warn('[notifiche] avviso admin', e.message));
};

// Seduta alleggerita spiegata come nell'app: perche', prevista, oggi (notifiche e diario)
function spiegaAlleggerita(s) {
  const a = s.adattata;
  if (!a) return '';
  const pct = a.originale_min ? Math.round(s.durata_min / a.originale_min * 100) : null;
  const oggiTxt = a.originale_tipo === 'qualita'
    ? L(`${s.durata_min}′ di corsa facile, niente qualità finché non hai recuperato`, `${s.durata_min}′ of easy running, no quality work until you have recovered`)
    : L(`${s.durata_min}′ invece di ${a.originale_min}′${pct ? ` (circa il ${pct}%)` : ''}, stesso ritmo tranquillo`, `${s.durata_min}′ instead of ${a.originale_min}′${pct ? ` (about ${pct}%)` : ''}, same easy pace`);
  return L(`Perché: ${a.motivi.join(', ')}. Prevista: ${a.originale_titolo ? a.originale_titolo + ', ' : ''}${a.originale}. Oggi: ${oggiTxt}. Il piano non cambia.`,
    `Why: ${a.motivi.join(', ')}. Planned: ${a.originale_titolo ? a.originale_titolo + ', ' : ''}${a.originale}. Today: ${oggiTxt}. Your plan doesn’t change.`);
}

// ---------------------------------------------------------------------------
// Il parere del coach su una corsa: regole dichiarate sui tuoi dati (nessun servizio esterno, nessuna AI).
// Seduta prevista vs fatta, FC rispetto al limite della seduta, efficienza rispetto alle ultime corse,
// record, deriva cardiaca e prossima seduta. Usato nel dettaglio della corsa e nella notifica dopo il sync.
// ---------------------------------------------------------------------------
function parereCorsa(id, oggiStr = oggi(), gia = null) {
  const a = gia || costruisciAttivita(id, oggiStr);
  if (!a) return null;
  const c = a.corsa, pr = a.prevista, cf = a.confronto;
  const punti = []; // { tono: 'ok' | 'warn' | 'info' | 'tip', testo }
  const consigli = []; // in ordine di priorita': il primo diventa "Il consiglio del coach"
  const minuti = (sec) => Math.round(sec / 60);
  const num = (x, d = 1) => String(round(x, d)).replace('.', LINGUA === 'en' ? '.' : ',');
  const nomeS = (t) => t.replace(/^(Sett\.|Wk) \d+ · /, '');
  const tipo = pr ? pr.tipo : null;
  // la giornata conta una volta: piu' corse nello stesso giorno si sommano
  const delGiorno = db.prepare("SELECT tempo FROM attivita WHERE origine = 'intervals' AND data = ?").all(c.data);
  const minGiorno = minuti(delGiorno.reduce((t, x) => t + (x.tempo || 0), 0));
  let tono = 'ok';

  // 0. a cosa serviva la seduta (il perche' fisiologico)
  const scopo = {
    facile: L('Le corse facili sono l’80% dell’allenamento dei migliori runner (Seiler): costruiscono capillari e mitocondri, il motore della resistenza.', 'Easy runs make up 80% of top runners’ training (Seiler): they build capillaries and mitochondria, the engine of endurance.'),
    lungo: L('Il lungo allena il cuore a pompare più sangue a ogni battito e i muscoli a usare i grassi: è la seduta che ti porta al traguardo.', 'The long run trains your heart to pump more blood per beat and your muscles to burn fat: it’s the session that gets you to the finish line.'),
    'corsa-cammino': L('Alternare corsa e cammino lascia a tendini e articolazioni il tempo di adattarsi: è il modo più sicuro per costruire la corsa continua.', 'Alternating running and walking gives tendons and joints time to adapt: it’s the safest way to build continuous running.'),
    qualita: L('Il lavoro intenso alza la soglia e il VO₂max: ti rende più veloce a parità di fatica.', 'Hard work raises your threshold and VO₂max: it makes you faster for the same effort.'),
    recupero: L('La corsa di recupero fa circolare il sangue senza aggiungere fatica: il corpo ripara e si rinforza.', 'A recovery run gets blood flowing without adding fatigue: your body repairs and gets stronger.'),
  }[tipo];

  // 1. la seduta: fatta come previsto?
  if (pr && pr.durata_min && tipo !== 'gara') {
    const r = minGiorno / pr.durata_min;
    if (r >= 0.9 && r <= 1.25) punti.push({ tono: 'ok', testo: L(`${nomeS(pr.titolo)} completata: ${minGiorno}′ su ${pr.durata_min}′. ${scopo || ''}`, `${nomeS(pr.titolo)} completed: ${minGiorno}′ of ${pr.durata_min}′. ${scopo || ''}`).trim() });
    else if (r < 0.9) {
      punti.push({ tono: 'info', testo: L(`${nomeS(pr.titolo)}: ${minGiorno}′ su ${pr.durata_min}′. Conta comunque: ogni uscita aggiunge un mattone.`, `${nomeS(pr.titolo)}: ${minGiorno}′ of ${pr.durata_min}′. It still counts: every run adds a brick.`) });
      consigli.push(L('Se ti sei fermato per stanchezza, la prossima volta parti più piano: è il ritmo dell’inizio che decide come finisci.', 'If you stopped because you were tired, start slower next time: the opening pace decides how you finish.'));
    } else {
      tono = 'warn';
      punti.push({ tono: 'warn', testo: L(`${minGiorno}′ invece di ${pr.durata_min}′. L’entusiasmo è un ottimo segno, ma i tessuti si adattano più lentamente del fiato.`, `${minGiorno}′ instead of ${pr.durata_min}′. Enthusiasm is a great sign, but your tissues adapt more slowly than your lungs.`) });
      consigli.push(L('Fermati al tempo previsto: gli infortuni da corsa nascono quasi sempre da aumenti troppo rapidi (al massimo +10% alla volta).', 'Stop at the planned time: running injuries almost always come from building up too fast (at most +10% at a time).'));
    }
  } else if (!pr) {
    punti.push({ tono: 'info', testo: L('Corsa fuori piano: conta per la settimana. Bella iniziativa, ma ricorda che il recupero fa parte dell’allenamento.', 'Off-plan run: it counts for the week. Nice initiative, but remember recovery is part of training.') });
  }

  // 2. l'intensita'
  const tz = c.tempo_zone;
  const lim = soglieFcPiano().facile;
  if (tz && tz.totale > 300 && pr) {
    const sopra = tz.zone.slice(2).reduce((t, z) => t + z.sec, 0);
    const pct = Math.round((sopra / tz.totale) * 100);
    if (['facile', 'lungo', 'recupero', 'corsa-cammino'].includes(tipo)) {
      if (pct <= 10) punti.push({ tono: 'ok', testo: L(`Intensità perfetta: ${100 - pct}% del tempo sotto ${lim} bpm. Correre piano oggi è quello che ti farà correre forte domani.`, `Perfect intensity: ${100 - pct}% of the time below ${lim} bpm. Running slow today is what makes you fast tomorrow.`) });
      else if (pct <= 30) {
        punti.push({ tono: 'info', testo: L(`${minuti(sopra)}′ sopra ${lim} bpm (${pct}% del tempo): un po’ sopra il ritmo facile.`, `${minuti(sopra)}′ above ${lim} bpm (${pct}% of the time): a bit above easy pace.`) });
        consigli.push(L('In salita e nell’ultimo terzo accorcia il passo e rallenta: se riesci a parlare a frasi intere sei nella zona giusta.', 'On climbs and in the last third shorten your stride and slow down: if you can talk in full sentences you’re in the right zone.'));
      } else {
        tono = 'warn';
        punti.push({ tono: 'warn', testo: L(`Troppo forte per una seduta facile: ${minuti(sopra)}′ sopra ${lim} bpm (${pct}%). Così si accumula fatica senza costruire la base aerobica.`, `Too hard for an easy session: ${minuti(sopra)}′ above ${lim} bpm (${pct}%). That piles up fatigue without building your aerobic base.`) });
        consigli.push(L(`La prossima volta guarda l’orologio e resta sotto ${lim} bpm, anche camminando qualche secondo: sembra lento, ma è così che il cuore diventa più efficiente.`, `Next time watch your heart rate and stay below ${lim} bpm, even walking for a few seconds: it feels slow, but that’s how your heart becomes more efficient.`));
      }
    } else if (tipo === 'qualita') {
      const z4 = tz.zone[3].sec + tz.zone[4].sec;
      if (z4 >= 240) punti.push({ tono: 'ok', testo: L(`${minuti(z4)}′ in Z4–Z5: lavoro di qualità centrato. È qui che alzi la soglia.`, `${minuti(z4)}′ in Z4–Z5: quality work on target. This is where you raise your threshold.`) });
      else {
        punti.push({ tono: 'info', testo: L(`Solo ${minuti(z4)}′ in Z4–Z5: i tratti veloci sono rimasti un po’ tranquilli.`, `Only ${minuti(z4)}′ in Z4–Z5: the fast parts stayed a bit easy.`) });
        consigli.push(L('Nei tratti veloci spingi fino a respirare a fondo e parlare a fatica: poche parole, non frasi. Nei recuperi invece rallenta davvero.', 'In the fast parts push until you breathe hard and can only say a few words. In the recoveries, really slow down.'));
      }
    }
  }

  // 3. efficienza (velocita' per battito) rispetto alle ultime corse
  if (cf && cf.corse >= 3 && cf.ef && c.efficiency_factor) {
    const d = (c.efficiency_factor / cf.ef - 1) * 100;
    if (d >= 3) punti.push({ tono: 'ok', testo: L(`Efficienza +${Math.round(d)}% sulle tue ultime ${cf.corse} corse: più veloce con lo stesso battito. Il lavoro sta pagando.`, `Efficiency +${Math.round(d)}% over your last ${cf.corse} runs: faster at the same heart rate. The work is paying off.`) });
    else if (d <= -6) {
      if (c.meteo && c.meteo.temp >= 24) punti.push({ tono: 'info', testo: L(`Efficienza più bassa del solito, ma con ${Math.round(c.meteo.temp)}° è fisiologico: col caldo il cuore batte di più per raffreddarti.`, `Efficiency lower than usual, but at ${Math.round(c.meteo.temp)}° that’s physiology: in the heat your heart beats faster to cool you down.`) });
      else {
        punti.push({ tono: 'info', testo: L(`Efficienza ${Math.round(d)}% rispetto al solito. Un giorno così capita: conta la tendenza delle prossime settimane.`, `Efficiency ${Math.round(d)}% vs usual. Days like this happen: the trend over the next weeks is what counts.`) });
        consigli.push(L('Stanchezza, poco sonno o salite? Stanotte punta a 7–9 ore: è dormendo che il corpo assimila l’allenamento.', 'Fatigue, short sleep or hills? Aim for 7–9 hours tonight: it’s while you sleep that your body absorbs training.'));
      }
    }
  }

  // 4. cadenza, deriva cardiaca, record
  const cad = c.cadenza;
  if (cad && cad >= 120 && cad < 160 && tipo !== 'corsa-cammino') consigli.push(L(`Cadenza ${Math.round(cad)} passi al minuto: prova ad aumentarla del 5–10% con passi più corti e leggeri. Riduce il carico su ginocchia e anche (Heiderscheit, 2011).`, `Cadence ${Math.round(cad)} steps per minute: try raising it by 5–10% with shorter, lighter steps. It reduces load on knees and hips (Heiderscheit, 2011).`));
  if (c.decoupling != null && c.tempo >= 2400) {
    if (c.decoupling <= 5) punti.push({ tono: 'ok', testo: L(`Deriva cardiaca ${num(c.decoupling)}%: il cuore è rimasto stabile fino alla fine. Segno di una buona resistenza aerobica.`, `Cardiac drift ${num(c.decoupling)}%: your heart stayed steady to the end. A sign of good aerobic endurance.`) });
    else consigli.push(L(`Deriva cardiaca ${num(c.decoupling)}%: nella seconda parte il cuore ha faticato di più. Parti più piano e bevi già prima di uscire.`, `Cardiac drift ${num(c.decoupling)}%: your heart worked harder in the second half. Start slower and drink before you head out.`));
  }
  const piuLunga = db.prepare("SELECT MAX(distanza) AS m FROM attivita WHERE origine = 'intervals' AND (data < ? OR (data = ? AND id <> ?))").get(c.data, c.data, c.id).m;
  const record = Boolean(c.distanza && piuLunga && c.distanza > piuLunga);
  if (record) {
    punti.unshift({ tono: 'ok', testo: L(`La tua corsa più lunga di sempre: ${num(c.distanza)} km! 🎉 Ogni chilometro in più è resistenza nuova.`, `Your longest run ever: ${num(c.distanza)} km! 🎉 Every extra kilometre is new endurance.`) });
    // salto oltre il 10% sulla piu' lunga precedente: prima si consolida (Frandsen et al., BJSM 2025)
    if (c.distanza > piuLunga * 1.1) consigli.unshift(L(`È il ${Math.round((c.distanza / piuLunga - 1) * 100)}% in più della tua corsa più lunga precedente: per un paio di settimane non allungare ancora. Il rischio di infortunio sale quando una corsa supera di oltre il 10% la più lunga del mese prima.`, `That’s ${Math.round((c.distanza / piuLunga - 1) * 100)}% more than your previous longest run: don’t go longer for a couple of weeks. Injury risk rises when a run exceeds the previous month’s longest by more than 10%.`));
  }

  // 5. il consiglio del coach (uno solo, il piu' utile) e il recupero
  if (!consigli.length) consigli.push(tipo === 'qualita' || tipo === 'lungo' || minGiorno >= 60
    ? L('Nei 30–60 minuti dopo mangia carboidrati e un po’ di proteine, e bevi: è la finestra in cui il muscolo si ricarica meglio.', 'In the 30–60 minutes after, eat carbs and some protein, and drink: that’s when your muscles refuel best.')
    : L('Ripeti la stessa ricetta: la costanza batte l’intensità. Tre uscite facili alla settimana per mesi fanno più di una corsa eroica.', 'Repeat the same recipe: consistency beats intensity. Three easy runs a week for months do more than one heroic run.'));

  // 6. la chiusa: settimana e prossima seduta
  const p = costruisciProgramma(oggiStr);
  let chiusa = null;
  // solo per le corse della settimana in corso: su una corsa vecchia "settimana e prossima" non hanno senso
  if (p && p.attivo && p.settimana && c.data >= p.settimana.da) {
    const st = p.settimana, prox = p.prossime.find((x) => x.data > c.data && !x.fatta);
    const sett = st && st.sedute ? (st.fatte >= st.sedute ? L(`Settimana completa: ${st.fatte} sedute su ${st.sedute}. Si avanza!`, `Week complete: ${st.fatte} of ${st.sedute} sessions. Moving forward!`)
      : st.fatte >= Math.max(2, st.sedute - 1) ? L(`${st.fatte} sedute su ${st.sedute}: la settimana è già salva.`, `${st.fatte} of ${st.sedute} sessions: the week is already in the bag.`)
      : L(`${st.fatte} ${st.fatte === 1 ? 'seduta' : 'sedute'} su ${st.sedute} questa settimana: avanti così.`, `${st.fatte} of ${st.sedute} sessions this week: keep it up.`)) : '';
    chiusa = [sett, prox ? L(`Prossima: ${giornoSettimana(prox.data)}, ${nomeS(prox.titolo)} ${prox.durata_min}′.`, `Next: ${giornoSettimana(prox.data)}, ${nomeS(prox.titolo)} ${prox.durata_min}′.`) : ''].filter(Boolean).join(' ');
  }

  const titolo = tono === 'warn' ? L('Corsa fatta, ma ascoltami', 'Run done, but listen to me')
    : record ? L('Che corsa! 🎉', 'What a run! 🎉')
    : punti.some((x) => x.tono === 'ok') ? L('Bella corsa! 👏', 'Nice run! 👏') : L('Corsa fatta 💪', 'Run done 💪');
  return { id: c.id, data: c.data, titolo, tono, punti, consiglio: consigli[0], chiusa, km: c.distanza, tempo: c.tempo };
}

// Dopo il sync: per ogni corsa nuova di oggi o ieri il coach manda il suo parere (una volta, tramite il diario)
function notificaCorseNuove(utenteId, ids) {
  if (!utenteId || !ids || !ids.length) return;
  const ieri = addDays(oggi(), -1);
  const ins = db.prepare('INSERT OR IGNORE INTO diario (quando, tipo, chiave, titolo, testo, titolo_en, testo_en) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const prima = LINGUA;
  for (const id of ids) {
    const r = db.prepare("SELECT id, data FROM attivita WHERE id = ? AND origine = 'intervals'").get(id);
    if (!r || r.data < ieri) continue;
    let it, en;
    try { LINGUA = 'it'; it = parereCorsa(id); LINGUA = 'en'; en = parereCorsa(id); } finally { LINGUA = prima; }
    if (!it || !en) continue;
    // diario: tutto; notifica: il punto principale, il consiglio e la chiusa (il resto nel dettaglio della corsa)
    const cons = (x, l) => (x.consiglio ? (l === 'en' ? 'Tip: ' : 'Il consiglio: ') + x.consiglio : '');
    const testo = (x, l) => [...x.punti.map((p) => p.testo), cons(x, l), x.chiusa || ''].filter(Boolean).join(' ');
    const breve = (x, l) => [x.punti[0] ? x.punti[0].testo : '', cons(x, l), x.chiusa || ''].filter(Boolean).join(' ');
    const km = (x, l) => `${String(round(x.km, 1)).replace('.', l === 'en' ? '.' : ',')} km`;
    if (!ins.run(new Date().toISOString(), 'corsa', `corsa:${id}`, `${it.titolo} · ${km(it, 'it')}`, testo(it, 'it'), `${en.titolo} · ${km(en, 'en')}`, testo(en, 'en')).changes) continue;
    if (!notifiche.haIscrizioni(utenteId)) continue; // senza telefono iscritto resta nel diario e nel dettaglio della corsa
    notifiche.avvisa(utenteId, (lingua) => {
      const x = lingua === 'en' ? en : it;
      return { title: `${x.titolo} · ${km(x, lingua)}`, body: breve(x, lingua), tag: `corsa-${id}`, url: `/#seduta/${encodeURIComponent(id)}` };
    }).catch((e) => console.warn('[notifiche] corsa', e.message));
  }
}

// Testo delle notifiche (solo seduta o settimana, niente dati di salute). Sincrono: LINGUA torna com'era.
function testoNotifica(u, tipo, lingua) {
  const prima = LINGUA;
  LINGUA = lingua === 'en' ? 'en' : 'it';
  try {
    if (tipo === 'prova') return { title: 'Always Adaptive Coach', body: L('Notifiche attive: ogni mattina la tua seduta, la domenica il riepilogo della settimana.', 'Notifications on: your session every morning, your weekly recap on Sunday.'), tag: 'prova', url: '/' };
    return contesto.run(account.contestoDi(u), () => {
      const oggiStr = oggi();
      const p = costruisciProgramma(oggiStr);
      if (!p || !p.attivo) return null;
      const nome = (s) => s.titolo.replace(/^(Sett\.|Wk) \d+ · /, '');
      if (tipo === 'mattina') {
        const s = p.prossime[0];
        if (!s || s.data !== oggiStr || s.fatta) return null; // oggi niente seduta: nessuna notifica
        const corpo = `${nome(s)} · ${s.durata_min}′` + (s.fc_target ? L(` · FC ${s.fc_target}`, ` · HR ${s.fc_target}`) : '');
        return s.adattata
          ? { title: L('Oggi seduta alleggerita', 'Lighter session today'), body: `${corpo}. ${spiegaAlleggerita(s)}`, tag: 'mattina', url: '/' }
          : { title: L('Oggi si corre', 'Run today'), body: corpo, tag: 'mattina', url: '/' };
      }
      if (tipo === 'domenica') {
        const st = p.settimana;
        const r7 = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(distanza), 0) AS km FROM attivita WHERE origine = 'intervals' AND data >= ? AND data <= ?").get(addDays(oggiStr, -6), oggiStr);
        const prox = p.prossime.find((x) => x.data > oggiStr);
        const kmTxt = String(round(r7.km, 1)).replace('.', LINGUA === 'en' ? '.' : ',');
        const corse = r7.n === 1 ? L('1 corsa', '1 run') : L(`${r7.n} corse`, `${r7.n} runs`);
        const piano = L(`piano: ${st.fatte} ${st.fatte === 1 ? 'seduta' : 'sedute'} su ${st.sedute}`, `plan: ${st.fatte} of ${st.sedute} sessions`);
        return {
          title: L('La tua settimana', 'Your week'),
          body: L(`${corse} e ${kmTxt} km negli ultimi 7 giorni · ${piano}.`, `${corse} and ${kmTxt} km in the last 7 days · ${piano}.`) +
            (prox ? L(` Prossima: ${giornoSettimana(prox.data)}, ${nome(prox)} ${prox.durata_min}′.`, ` Next: ${giornoSettimana(prox.data)}, ${nome(prox)} ${prox.durata_min}′.`) : ''),
          tag: 'domenica', url: '/',
        };
      }
      return null;
    });
  } finally {
    LINGUA = prima;
  }
}
function chiudiDb(file) {
  const d = dbAperti.get(file);
  if (d) {
    try { d.close(); } catch (_) { /* gia' chiuso */ }
    dbAperti.delete(file);
  }
}
// Demo pubblica con dati simulati (/demo): le funzioni del motore sono dichiarazioni, gia' disponibili qui
const { creaDemo } = require('./demo');
const demo = creaDemo({
  BASE, dbPer, chiudiDb, contesto,
  fn: { oggi, addDays, costruisciProgramma, analizzaStream, applicaGiri },
});

// `db` punta sempre al database dell'utente della richiesta (o della sincronizzazione) in corso
const db = new Proxy({}, {
  get(_, k) {
    const c = contesto.getStore();
    if (!c) throw new Error('Nessun utente nel contesto per accedere al database');
    const v = c.db[k];
    return typeof v === 'function' ? v.bind(c.db) : v;
  },
});

const getMeta = (k) => {
  const r = db.prepare('SELECT valore FROM meta WHERE chiave = ?').get(k);
  return r ? r.valore : null;
};
const setMeta = (k, v) => {
  db.prepare(
    'INSERT INTO meta (chiave, valore) VALUES (?, ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore'
  ).run(k, v);
};

// ===========================================================================
// Dati simulati di fabbrica (4 settimane ISO complete: 3 di progressione + 1 di scarico)
// ===========================================================================

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generaDatiSimulati() {
  const rnd = mulberry32(20261105);
  const jitter = (ampiezza) => (rnd() * 2 - 1) * ampiezza;

  const lunediCorrente = lunedi(oggi());
  const inizio = addDays(lunediCorrente, -28);
  const fine = addDays(lunediCorrente, -1);

  // offset giorno (0 = lunedì), tipo, km. Settimana 4 = scarico (-35% circa) deciso dal coach.
  const settimane = [
    { scarico: false, sedute: [[1, 'facile', 6.0], [3, 'qualita', 7.0], [5, 'facile', 6.0], [6, 'lungo', 13.0]] },
    { scarico: false, sedute: [[1, 'facile', 6.5], [3, 'qualita', 7.5], [5, 'facile', 6.5], [6, 'lungo', 14.5]] },
    { scarico: false, sedute: [[1, 'facile', 7.0], [3, 'qualita', 8.0], [5, 'facile', 7.0], [6, 'lungo', 16.0]] },
    { scarico: true, sedute: [[1, 'facile', 5.0], [3, 'qualita', 5.0], [5, 'facile', 4.5], [6, 'lungo', 9.5]] },
  ];
  const base = {
    facile: { passo: 355, fc: 146, intensita: 1.0 },
    qualita: { passo: 318, fc: 165, intensita: 1.35 },
    lungo: { passo: 352, fc: 152, intensita: 1.05 },
  };

  const sedutePerGiorno = new Map();
  settimane.forEach((sett, w) => {
    const lun = addDays(inizio, w * 7);
    sett.sedute.forEach(([offset, tipo, km]) => {
      const b = base[tipo];
      const passo = b.passo - w * 3.5 - (sett.scarico ? 2 : 0) + jitter(4);
      const fc = b.fc - w * 0.5 - (sett.scarico ? 2.5 : 0) + jitter(2);
      sedutePerGiorno.set(addDays(lun, offset), {
        tipo,
        km,
        passo,
        fc,
        carico: km * 6.5 * b.intensita,
      });
    });
  });

  const righe = [];
  let ctl = 30;
  let atl = 32;
  for (let d = inizio; d <= fine; d = addDays(d, 1)) {
    const s = sedutePerGiorno.get(d);
    const carico = s ? s.carico : 0;
    ctl = ctl * K_CTL + carico * (1 - K_CTL);
    atl = atl * K_ATL + carico * (1 - K_ATL);
    if (!s) continue;
    righe.push({
      id: `mock-${d.replace(/-/g, '')}`,
      data: d,
      distanza: round(s.km, 3),
      tempo: Math.round(s.km * s.passo),
      passo_medio: round(s.passo, 1),
      fc_media: round(s.fc, 1),
      ctl: round(ctl, 1),
      atl: round(atl, 1),
      tsb: round(ctl - atl, 1),
      efficiency_factor: round(60000 / s.passo / s.fc, 3),
      origine: 'mock',
    });
  }
  return righe;
}

const CAMPI_ATTIVITA = [
  'id', 'data', 'distanza', 'tempo', 'passo_medio', 'fc_media', 'ctl', 'atl', 'tsb', 'efficiency_factor', 'origine',
  'nome', 'tipo', 'fc_max', 'cadenza', 'dislivello', 'carico', 'calorie', 'decoupling', 'zone_fc',
  'rpe', 'contatto', 'oscillazione', 'lung_passo', 'ora_inizio', 'passo_gap', 'fc_recupero', 'rapporto_verticale',
];
const SQL_UPSERT = `
  INSERT INTO attivita (${CAMPI_ATTIVITA.join(', ')})
  VALUES (${CAMPI_ATTIVITA.map((c) => '@' + c).join(', ')})
  ON CONFLICT(id) DO UPDATE SET
    ${CAMPI_ATTIVITA.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(',\n    ')}
`;
// better-sqlite3 richiede tutti i parametri nominati: i campi mancanti valgono NULL
const rigaCompleta = (r) => Object.fromEntries(CAMPI_ATTIVITA.map((c) => [c, r[c] ?? null]));

function seedSeVuoto() {
  // Con il programma di ripartenza attivo i dati simulati (da mezzofondista) sarebbero fuorvianti
  if (CONFIG.programmaInizio) {
    const { changes } = db.prepare("DELETE FROM attivita WHERE origine = 'mock'").run();
    if (changes) console.log(`[seed] Programma di ripartenza attivo: rimosse ${changes} corse simulate.`);
    return;
  }
  if (!CONFIG.seedMock) return;
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM attivita').get();
  if (n > 0) return;
  const righe = generaDatiSimulati();
  const ins = db.prepare(SQL_UPSERT);
  db.transaction(() => righe.forEach((r) => ins.run(rigaCompleta(r))))();
  console.log(`[seed] Database vuoto: inseriti ${righe.length} allenamenti simulati (4 settimane).`);
}

// ===========================================================================
// Sincronizzazione con Intervals.icu
// ===========================================================================

class ErroreSync extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

// Fonti dei dati: Intervals.icu (chiave + Athlete ID) e/o Strava (collegato con OAuth)
const intervalsConfigurato = () => Boolean(CONFIG.apiKey && CONFIG.athleteId);
const stravaCollegato = () => { const st = contesto.getStore(); return Boolean(st && st.utente && strava.collegato(st.utente.id)); };
const sincronizzazioneConfigurata = () => intervalsConfigurato() || stravaCollegato();

// Carico di un'attivita' Strava (Strava non lo fornisce): stima stile hrTSS dalla FC media rispetto alla soglia
// (circa l'89% della FC max); senza cardio, un carico moderato per ora. Serve a CTL/ATL, forma e carico e infortuni.
function caricoDaFc(durataSec, fcMedia) {
  const ore = durataSec / 3600;
  if (!(ore > 0)) return null;
  if (!(fcMedia > 40)) return round(ore * 55, 1);
  const intensita = fcMedia / (CONFIG.fcMax * 0.89);
  return round(ore * intensita * intensita * 100, 1);
}
// Stessa uscita registrata due volte (Intervals e Strava): stesso giorno, partenza entro 5 minuti, distanza entro il 15%
const minutiDi = (s) => { const m = /T(\d{2}):(\d{2})/.exec(String(s || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
function stessaUscita(a, b) {
  if (String(a.start_date_local || '').slice(0, 10) !== String(b.start_date_local || '').slice(0, 10)) return false;
  const ma = minutiDi(a.start_date_local), mb = minutiDi(b.start_date_local);
  if (ma != null && mb != null && Math.abs(ma - mb) > 5) return false;
  const da = Number(a.distance) || 0, db_ = Number(b.distance) || 0;
  if (da > 0 && db_ > 0) return Math.abs(da - db_) / Math.max(da, db_) <= 0.15;
  return ma != null && mb != null;
}

// Doppioni dentro Intervals: due app caricano la stessa uscita (es. Intervals Companion e Health Sync dall'Apple Watch).
// Resta quella con piu' dati (cadenza, RPE, passo, cardio...), a parita' la prima caricata; la corsa conta una volta sola.
const CAMPI_RICCHEZZA = ['average_heartrate', 'max_heartrate', 'average_cadence', 'total_elevation_gain', 'icu_rpe', 'average_stride', 'calories', 'icu_lap_count'];
const ricchezza = (g) => CAMPI_RICCHEZZA.filter((k) => g[k] != null && g[k] !== 0).length;
const eCorsa = (g) => /Run/i.test(String(g.type || ''));
function unisciDoppioni(lista) {
  const tenute = [], scartate = [];
  const ord = lista.filter(Boolean).sort((a, b) => ricchezza(b) - ricchezza(a) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  for (const g of ord) {
    const dup = tenute.find((t) => eCorsa(t) === eCorsa(g) && stessaUscita(t, g));
    if (dup) scartate.push({ id: String(g.id), tenuta: String(dup.id) });
    else tenute.push(g);
  }
  return { tenute, scartate };
}

async function intervalsGet(percorso, params) {
  const url = new URL(`${CONFIG.intervalsBase}/api/v1/athlete/${encodeURIComponent(CONFIG.athleteId)}${percorso}`);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const auth = Buffer.from(`API_KEY:${CONFIG.apiKey}`).toString('base64');

  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(45000),
    });
  } catch (e) {
    throw new ErroreSync(`Intervals.icu non raggiungibile (${e.name === 'TimeoutError' ? 'timeout' : e.message})`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new ErroreSync('Credenziali Intervals.icu non valide: controlla API Key e Athlete ID.', 502);
  }
  if (!res.ok) {
    throw new ErroreSync(`Intervals.icu ha risposto con errore ${res.status} su ${percorso}.`);
  }
  return res.json();
}

async function intervalsGetAttivita(id, percorso, params) {
  const url = new URL(`${CONFIG.intervalsBase}/api/v1/activity/${encodeURIComponent(id)}${percorso}`);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const auth = Buffer.from(`API_KEY:${CONFIG.apiKey}`).toString('base64');
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Sedute del piano nel calendario di Intervals.icu (interruttore nel profilo, spento di default)
// Intervals le passa da solo a Garmin Connect; per Apple Watch serve un'app che legga il calendario
// di Intervals. AAC tocca solo i suoi eventi (external_id "aac-AAAA-MM-GG"), mai quelli dell'utente.
// Si inviano i prossimi 7 giorni dopo ogni sync, solo se qualcosa e' cambiato.
// ---------------------------------------------------------------------------
const SEDUTE_INTERVALS_GIORNI = 7;
const idEventoAac = (data) => `aac-${data}`;

async function intervalsScrivi(metodo, percorso, corpo) {
  const url = `${CONFIG.intervalsBase}/api/v1/athlete/${encodeURIComponent(CONFIG.athleteId)}${percorso}`;
  const auth = Buffer.from(`API_KEY:${CONFIG.apiKey}`).toString('base64');
  const res = await fetch(url, {
    method: metodo,
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Intervals.icu ha risposto ${res.status} su ${percorso}`);
  return res.json().catch(() => null);
}

const lingueSeduteIntervals = new Set(['it', 'en']);
function linguaSeduteIntervals(id) {
  const u = account.sistema.prepare('SELECT intervals_sedute FROM utenti WHERE id = ?').get(id);
  return u && lingueSeduteIntervals.has(u.intervals_sedute) ? u.intervals_sedute : null;
}

// "120–140" -> [120, 140]; "< 140" -> [inizio Z1, 139]
function intervalloFc(txt) {
  const t = String(txt || '');
  const r = t.match(/(\d{2,3})\s*[–-]\s*(\d{2,3})/);
  if (r) return [Number(r[1]), Number(r[2])];
  const s = t.match(/<\s*(\d{2,3})/);
  if (s) return [limitiZone()[0].da, Number(s[1]) - 1];
  return null;
}

// Un passo nella sintassi di Intervals: "- Testo 10m 120-140bpm HR". Il testo non deve contenere numeri
// (Intervals li leggerebbe come durata o intensita'). modo 'pct' = % della FC max (riserva, vedi sotto).
function passoIntervals(testo, min, fc, modo) {
  let t = '';
  if (fc && modo === 'pct') t = ` ${Math.round((fc[0] / CONFIG.fcMax) * 100)}-${Math.round((fc[1] / CONFIG.fcMax) * 100)}% HR`;
  else if (fc) t = ` ${fc[0]}-${fc[1]}bpm HR`;
  const durata = min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? `${min % 60}m` : ''}` : `${min}m`;
  return `- ${testo} ${durata}${t}`;
}

// Seduta del calendario -> descrizione strutturata per Intervals (ripetute raggruppate con "Nx")
function descrizioneIntervals(s, modo) {
  const qualita = s.tipo === 'qualita' || s.tipo === 'gara';
  const fcSeduta = intervalloFc(s.fc_target);
  const fcFacileR = [limitiZone()[0].da, soglieFcPiano().facile - 1];
  const nomeForte = /4×4|4x4/.test(s.titolo) ? L('Forte', 'Hard') : s.tipo === 'gara' ? L('Gara', 'Race') : /fartlek/i.test(s.titolo) ? L('Brillante', 'Lively') : L('Ritmo', 'Pace');
  const segs = s.segmenti || [];
  const passo = (g, i) => {
    if (g.tipo === 'walk') return passoIntervals(i === 0 && segs.length > 1 ? L('Riscaldamento camminando', 'Warm-up walk') : L('Camminata', 'Walk'), g.min, null, modo);
    if (g.tipo === 'cool') return passoIntervals(L('Defaticamento camminando', 'Cool-down walk'), g.min, null, modo);
    if (g.tipo === 'fast') return passoIntervals(nomeForte, g.min, fcSeduta, modo);
    if (s.tipo === 'gara') return passoIntervals(L('Gara', 'Race'), g.min, fcSeduta, modo);
    if (qualita) return passoIntervals(L('Corsa facile', 'Easy run'), g.min, fcFacileR, modo);
    return passoIntervals(s.tipo === 'corsa-cammino' ? L('Corsa lenta', 'Slow run') : L('Corsa facile', 'Easy run'), g.min, fcSeduta || fcFacileR, modo);
  };
  const righe = segs.map(passo);
  // coppie che si ripetono (corsa-cammino, fartlek, ritmo, 4×4) -> blocco "Nx"
  const out = [];
  for (let i = 0; i < righe.length;) {
    let n = 1;
    while (i + 2 * n + 1 < righe.length && righe[i + 2 * n] === righe[i] && righe[i + 2 * n + 1] === righe[i + 1]) n++;
    if (n >= 2) {
      out.push('', `${n}x`, righe[i], righe[i + 1], '');
      i += 2 * n;
    } else {
      out.push(righe[i]);
      i++;
    }
  }
  const testo = [
    s.blocchi,
    s.fc_target ? `${L('FC', 'HR')}: ${s.fc_target} bpm` : null,
    s.adattata ? L(`Alleggerita dal coach: ${s.adattata.motivi.join(', ')}.`, `Lightened by the coach: ${s.adattata.motivi.join(', ')}.`) : null,
    s.nota || null,
  ].filter(Boolean);
  const coda = L('Dal piano di AAC: se il coach cambia la seduta, si aggiorna da sola.', 'From your AAC plan: if the coach changes the session, it updates by itself.');
  return [...testo, '', ...out, '', coda].join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function eventiSeduteIntervals(oggiStr, modo) {
  const p = costruisciProgramma(oggiStr);
  if (!p) return [];
  const fine = addDays(oggiStr, SEDUTE_INTERVALS_GIORNI - 1);
  const [hh, mm] = String(CONFIG.programmaOra || '06:30').split(':');
  return p.calendario
    .filter((s) => s.data >= oggiStr && s.data <= fine && !s.fatta)
    .map((s) => ({
      category: 'WORKOUT',
      type: s.tipo === 'recupero' ? 'Walk' : 'Run',
      start_date_local: `${s.data}T${pad(Number(hh) || 6)}:${pad(Number(mm) || 0)}:00`,
      name: `${s.titolo.replace(/^(Sett\.|Wk) \d+ · /, '')} · AAC`,
      description: descrizioneIntervals(s, modo),
      moving_time: s.durata_min * 60,
      external_id: idEventoAac(s.data),
    }));
}

// Il passo ha capito i limiti di FC? (Intervals restituisce la seduta gia' interpretata in workout_doc)
function fcCapita(eventi) {
  const docs = (Array.isArray(eventi) ? eventi : []).map((e) => e && e.workout_doc).filter(Boolean);
  if (!docs.length) return null; // risposta senza workout_doc: non si puo' dire
  const passi = (l) => (l || []).flatMap((x) => [x, ...passi(x.steps)]);
  return docs.some((d) => passi(d.steps).some((x) => x && Object.keys(x).some((k) => /^hr|heart/i.test(k))));
}

// Invia (o toglie) le sedute dei prossimi giorni. Chiamata dopo ogni sync dell'utente, dentro il suo contesto.
async function aggiornaSeduteIntervals(forza) {
  const st = contesto.getStore();
  const id = st && st.utente && st.utente.id;
  if (typeof id !== 'number' || !intervalsConfigurato()) return null;
  const lingua = linguaSeduteIntervals(id);
  const oggiStr = oggi();
  let stato = {};
  try { stato = JSON.parse(getMeta('intervals_sedute') || '{}') || {}; } catch (_) { stato = {}; }
  const inviate = Array.isArray(stato.date) ? stato.date.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
  if (!lingua) return null;
  // % della FC max: Intervals non legge la FC in bpm (provato il 13 nov 2026). 'bpm' resta per un eventuale ritorno.
  const modo = stato.modo === 'bpm' ? 'bpm' : 'pct';

  // i testi nella lingua scelta quando l'utente ha acceso l'interruttore (il cron gira senza richiesta)
  const prima = LINGUA;
  let eventi;
  LINGUA = lingua;
  try { eventi = eventiSeduteIntervals(oggiStr, modo); } finally { LINGUA = prima; }

  const date = eventi.map((e) => e.start_date_local.slice(0, 10));
  // sedute inviate prima e sparite dal piano (giorno cambiato, piano ricalcolato): si tolgono, solo da oggi in poi
  const fatteOggi = new Set();
  const via = inviate.filter((d) => d >= oggiStr && !date.includes(d));
  const firma = crypto.createHash('sha256').update(JSON.stringify([eventi, via])).digest('hex').slice(0, 16);
  if (!forza && firma === stato.firma) return { inviate: 0, tolte: 0 };

  if (via.length) {
    // non togliere la seduta di oggi se e' gia' stata fatta: resta nel calendario accanto alla corsa
    const p = costruisciProgramma(oggiStr);
    for (const s of (p && p.calendario) || []) if (s.data === oggiStr && s.fatta) fatteOggi.add(s.data);
    const daTogliere = via.filter((d) => !fatteOggi.has(d));
    if (daTogliere.length) await intervalsScrivi('PUT', '/events/bulk-delete', daTogliere.map((d) => ({ external_id: idEventoAac(d) })));
  }
  let risposta = eventi.length ? await intervalsScrivi('POST', '/events/bulk?upsert=true', eventi) : null;
  // Riserva: se Intervals non riconosce la FC in bpm, si passa alla % della FC max
  if (modo === 'bpm' && eventi.length && fcCapita(risposta) === false) {
    console.warn(`[intervals:sedute] u${id}: FC in bpm non riconosciuta, uso la % della FC max`);
    LINGUA = lingua;
    try { eventi = eventiSeduteIntervals(oggiStr, 'pct'); } finally { LINGUA = prima; }
    risposta = await intervalsScrivi('POST', '/events/bulk?upsert=true', eventi);
    stato.modo = 'pct';
  }
  const tenute = [...new Set([...inviate.filter((d) => d < oggiStr || fatteOggi.has(d)), ...date])].sort().slice(-60);
  setMeta('intervals_sedute', JSON.stringify({ modo: stato.modo || modo, firma, date: tenute, quando: new Date().toISOString() }));
  console.log(`[intervals:sedute] u${id}: ${eventi.length} sedute inviate, ${via.length} tolte`);
  return { inviate: eventi.length, tolte: via.length };
}

// Interruttore spento: via dal calendario di Intervals le sedute di AAC da oggi in poi (quelle passate restano)
async function togliSeduteIntervals() {
  if (!intervalsConfigurato()) return 0;
  const oggiStr = oggi();
  let stato = {};
  try { stato = JSON.parse(getMeta('intervals_sedute') || '{}') || {}; } catch (_) { stato = {}; }
  const future = new Set((Array.isArray(stato.date) ? stato.date : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= oggiStr));
  // anche i prossimi giorni, nel caso la memoria locale sia incompleta: gli id che non esistono vengono ignorati
  for (let i = 0; i < SEDUTE_INTERVALS_GIORNI; i++) future.add(addDays(oggiStr, i));
  await intervalsScrivi('PUT', '/events/bulk-delete', [...future].map((d) => ({ external_id: idEventoAac(d) })));
  setMeta('intervals_sedute', JSON.stringify({ modo: stato.modo, date: (stato.date || []).filter((d) => d < oggiStr) }));
  return future.size;
}

/**
 * Analizza i dati secondo per secondo di una corsa: separa corsa e camminata
 * (cadenza >= 140 passi/min, oppure velocità >= 1,9 m/s se la cadenza manca)
 * e calcola tempo, distanza, passo e FC dei soli tratti corsi, più i parziali per km.
 */
function analizzaStream(streams) {
  const prendi = (t) => {
    const s = Array.isArray(streams) ? streams.find((x) => x && x.type === t) : streams && streams[t];
    const d = s && (Array.isArray(s) ? s : s.data);
    return Array.isArray(d) && d.length ? d.map((x) => (x == null ? null : Number(x))) : null;
  };
  const time = prendi('time');
  const vel = prendi('velocity_smooth');
  const hr = prendi('heartrate');
  const dist = prendi('distance');
  const alt = prendi('fixed_altitude') || prendi('altitude');
  const pw = prendi('watts');
  // latlng: data = latitudine, data2 = longitudine
  const ll = Array.isArray(streams) ? streams.find((x) => x && x.type === 'latlng') : null;
  const lat = ll && Array.isArray(ll.data) && Array.isArray(ll.data2) && ll.data2.length === ll.data.length ? ll.data : null;
  const lng = lat ? ll.data2 : null;
  let cad = prendi('cadence');
  if (!time || (!vel && !dist)) return null;
  if (cad) {
    const nz = cad.filter((c) => c > 0).sort((a, b) => a - b);
    if (!nz.length) cad = null;
    else if (nz[Math.floor(nz.length / 2)] < 100) cad = cad.map((c) => (c == null ? null : c * 2)); // cadenza "per gamba"
  }
  let tCorsa = 0, dCorsa = 0, hrSomma = 0, hrPeso = 0, cum = 0;
  const parziali = [];
  let tUltimoKm = time[0];
  for (let i = 1; i < time.length; i++) {
    const dt = Math.min(10, time[i] - time[i - 1]);
    if (!(dt > 0)) continue;
    const v = vel && vel[i] != null ? vel[i] : dist && dist[i] != null && dist[i - 1] != null ? (dist[i] - dist[i - 1]) / dt : 0;
    const passi = cad ? cad[i] : null;
    const corre = cad ? passi >= 140 : v >= 1.9;
    if (corre && v > 0.5) {
      tCorsa += dt;
      dCorsa += v * dt;
      if (hr && hr[i] > 40) { hrSomma += hr[i] * dt; hrPeso += dt; }
    }
    // parziali per km sulla distanza totale (camminata compresa)
    const prima = cum;
    cum = dist && dist[i] != null ? dist[i] : cum + Math.max(0, v) * dt;
    if (Math.floor(cum / 1000) > Math.floor(prima / 1000) && parziali.length < 60) {
      const k = Math.floor(cum / 1000) * 1000;
      const frac = cum > prima ? (k - prima) / (cum - prima) : 1;
      const tKm = time[i - 1] + frac * (time[i] - time[i - 1]);
      parziali.push(Math.round(tKm - tUltimoKm));
      tUltimoKm = tKm;
    }
  }
  const serie = campionaSerie({ time, vel, hr, dist, cad, alt, pw, lat, lng });
  if (tCorsa < 60 || dCorsa < 150) return { tempo_corsa: Math.round(tCorsa), distanza_corsa: round(dCorsa / 1000, 3), passo_corsa: null, fc_corsa: null, parziali, serie };
  return {
    serie,
    tempo_corsa: Math.round(tCorsa),
    distanza_corsa: round(dCorsa / 1000, 3),
    passo_corsa: round(tCorsa / (dCorsa / 1000), 1),
    fc_corsa: hrPeso ? round(hrSomma / hrPeso, 1) : null,
    parziali,
  };
}

/**
 * Riduce i dati secondo per secondo a un punto ogni ~5 s (medie del blocco) per i grafici:
 * t = secondi dall'inizio, d = km, v = m/s, hr = bpm, cad = passi/min, alt = m, c = 1 se sta correndo.
 */
function campionaSerie({ time, vel, hr, dist, cad, alt, pw, lat, lng }) {
  const n = time.length;
  if (n < 2) return null;
  const durata = time[n - 1] - time[0];
  const passo = Math.max(5, Math.ceil(durata / 1500)); // al massimo ~1500 punti
  const out = { passo, t: [], d: [], v: [], hr: [], cad: [], alt: [], pw: [], lat: [], lng: [], c: [] };
  const media = (arr, a, b) => {
    if (!arr) return null;
    let s = 0, k = 0;
    for (let i = a; i < b; i++) if (arr[i] != null && arr[i] > 0) { s += arr[i]; k++; }
    return k ? s / k : null;
  };
  let a = 0;
  let cum = 0;
  while (a < n) {
    const t0 = time[a];
    let b = a + 1;
    while (b < n && time[b] - t0 < passo) b++;
    const v = vel ? media(vel, a, b) : null;
    const c = cad ? media(cad, a, b) : null;
    cum = dist && dist[b - 1] != null ? dist[b - 1] : cum + (v || 0) * (time[Math.min(b, n - 1)] - t0);
    const vv = v != null ? v : null;
    out.t.push(Math.round(t0 - time[0]));
    out.d.push(round(cum / 1000, 3));
    out.v.push(vv != null ? round(vv, 2) : null);
    const h = hr ? media(hr, a, b) : null;
    out.hr.push(h != null ? Math.round(h) : null);
    out.cad.push(c != null ? Math.round(c) : null);
    const al = alt ? media(alt, a, b) : null;
    out.alt.push(al != null ? round(al, 1) : null);
    const p = pw ? media(pw, a, b) : null;
    out.pw.push(p != null ? Math.round(p) : null);
    // posizione: il primo punto valido del blocco
    let la = null, lo = null;
    if (lat) for (let i = a; i < b; i++) if (lat[i] != null && lng[i] != null && Math.abs(lat[i]) > 0.0001) { la = lat[i]; lo = lng[i]; break; }
    out.lat.push(la != null ? round(la, 6) : null);
    out.lng.push(lo != null ? round(lo, 6) : null);
    out.c.push((c != null ? c >= 140 : (vv || 0) >= 1.9) && (vv || 0) > 0.5 ? 1 : 0);
    a = b;
  }
  if (!out.alt.some((x) => x != null)) delete out.alt;
  if (!out.cad.some((x) => x != null)) delete out.cad;
  if (!out.hr.some((x) => x != null)) delete out.hr;
  if (!out.pw.some((x) => x != null)) delete out.pw;
  if (!out.lat.some((x) => x != null)) { delete out.lat; delete out.lng; }
  return out;
}

/**
 * Usa i giri registrati dall'orologio (es. allenamento personalizzato 1' corsa / 2' cammino)
 * per separare corsa e camminata in modo esatto: piu' affidabile della cadenza secondo per secondo,
 * che ai passi lenti sta a cavallo della soglia e spezza i tratti.
 * Aggiorna `analisi` (tempi, passo e FC di corsa, flag `c` della serie) e restituisce i giri.
 */
function applicaGiri(analisi, risposta) {
  const grezzi = (risposta && Array.isArray(risposta.icu_intervals) ? risposta.icu_intervals : [])
    .filter((g) => num(g.elapsed_time) >= 20 && num(g.start_time) != null)
    .sort((x, y) => num(x.start_time) - num(y.start_time));
  if (grezzi.length < 3) return [];
  // cadenza per gamba -> passi al minuto
  const cads = grezzi.map((g) => num(g.average_cadence)).filter((c) => c > 0).sort((x, y) => x - y);
  const perGamba = cads.length && cads[Math.floor(cads.length / 2)] < 100;
  const giri = grezzi.map((g) => {
    const cad = num(g.average_cadence);
    return {
      t0: Math.round(num(g.start_time)),
      dur: Math.round(num(g.moving_time) || num(g.elapsed_time)),
      d: round((num(g.distance) || 0) / 1000, 3),
      v: round(num(g.average_speed), 2),
      hr: round(num(g.average_heartrate), 0),
      hr_max: round(num(g.max_heartrate), 0),
      cad: cad > 0 ? Math.round(perGamba ? cad * 2 : cad) : null,
    };
  });
  // corsa vs cammino: se le velocita' dei giri formano due gruppi netti, il gruppo veloce e' la corsa
  const vs = giri.map((g) => g.v || 0).sort((x, y) => x - y);
  let salto = 0, soglia = null;
  for (let i = 1; i < vs.length; i++) if (vs[i] - vs[i - 1] > salto) { salto = vs[i] - vs[i - 1]; soglia = (vs[i] + vs[i - 1]) / 2; }
  const dueGruppi = salto >= 0.3 && soglia >= 1.7;
  for (const g of giri) g.corsa = dueGruppi ? (g.v || 0) > soglia : g.cad != null ? g.cad >= 140 : (g.v || 0) >= 1.9;
  const corsa = giri.filter((g) => g.corsa);
  // giri tutti uguali (es. autolap a km di una corsa continua): non aggiungono nulla alla separazione
  if (!corsa.length || corsa.length === giri.length || !analisi) return giri;
  const tCorsa = corsa.reduce((t, g) => t + g.dur, 0);
  const dCorsa = corsa.reduce((t, g) => t + g.d, 0);
  const hrPeso = corsa.filter((g) => g.hr).reduce((t, g) => t + g.dur, 0);
  analisi.tempo_corsa = tCorsa;
  analisi.distanza_corsa = round(dCorsa, 3);
  analisi.passo_corsa = dCorsa > 0.15 ? round(tCorsa / dCorsa, 1) : null;
  analisi.fc_corsa = hrPeso ? round(corsa.filter((g) => g.hr).reduce((t, g) => t + g.hr * g.dur, 0) / hrPeso, 1) : analisi.fc_corsa;
  if (analisi.serie) {
    const t0 = analisi.serie.t;
    analisi.serie.c = t0.map((t) => {
      const mezzo = t + analisi.serie.passo / 2;
      return corsa.some((g) => mezzo >= g.t0 && mezzo < g.t0 + g.dur) ? 1 : 0;
    });
    analisi.serie.da_giri = 1;
  }
  return giri;
}

// ---------------------------------------------------------------------------
// Meteo all'ora della corsa (Open-Meteo, gratuito e senza chiave).
// Coordinate arrotondate a 2 decimali (~1 km): basta per il meteo, non rivela l'indirizzo.
// ---------------------------------------------------------------------------
async function aggiornaMeteo(limite = 25) {
  const righe = db
    .prepare("SELECT id, data, ora_inizio, tempo, serie FROM attivita WHERE origine = 'intervals' AND meteo IS NULL AND stream_ok IS NOT NULL ORDER BY data DESC LIMIT ?")
    .all(limite);
  const salva = db.prepare('UPDATE attivita SET meteo = ? WHERE id = ?');
  let fatti = 0;
  for (const r of righe) {
    let lat = null, lng = null;
    try {
      const s = r.serie ? JSON.parse(r.serie) : null;
      const i = s && s.lat ? s.lat.findIndex((x) => x != null) : -1;
      if (i >= 0) { lat = s.lat[i]; lng = s.lng[i]; }
    } catch (_) { /* serie non leggibile */ }
    if (lat == null) { salva.run('{}', r.id); continue; } // senza GPS niente meteo
    const vecchia = diffDays(oggi(), r.data) > 80;
    const base = vecchia ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
    const url = `${base}?latitude=${lat.toFixed(2)}&longitude=${lng.toFixed(2)}&start_date=${r.data}&end_date=${r.data}` +
      '&hourly=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,precipitation&timezone=auto';
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const h = j.hourly;
      if (!h || !h.time || !h.time.length) { salva.run('{}', r.id); continue; }
      // ora centrale della corsa
      const [hh, mm] = (r.ora_inizio || '12:00').split(':').map(Number);
      const ora = Math.min(23, Math.round(hh + (mm + (r.tempo || 0) / 120) / 60));
      const k = Math.max(0, Math.min(h.time.length - 1, ora));
      salva.run(JSON.stringify({
        codice: h.weather_code[k], temp: round(h.temperature_2m[k], 0), percepita: round(h.apparent_temperature[k], 0),
        vento: round(h.wind_speed_10m[k], 0), umidita: round(h.relative_humidity_2m[k], 0), pioggia: round(h.precipitation[k], 1), ora: h.time[k].slice(11, 16),
      }), r.id);
      fatti++;
    } catch (e) {
      console.warn(`[meteo] ${r.id}: ${e.message}`); // si riprova alla prossima sincronizzazione
    }
  }
  return fatti;
}

// ---------------------------------------------------------------------------
// Scarpe
// ---------------------------------------------------------------------------
function elencoScarpe() {
  return db.prepare(`
    SELECT s.*, COALESCE(SUM(a.distanza), 0) AS km_corse, COUNT(a.id) AS corse, MAX(a.data) AS ultimo_uso
    FROM scarpe s LEFT JOIN attivita a ON a.scarpa_id = s.id AND a.origine = 'intervals'
    GROUP BY s.id ORDER BY s.attiva DESC, s.predefinita DESC, s.creata DESC`).all()
    .map((s) => ({ id: s.id, nome: s.nome, km_iniziali: s.km_iniziali, limite_km: s.limite_km, attiva: !!s.attiva, predefinita: !!s.predefinita,
      corse: s.corse, ultimo_uso: s.ultimo_uso, km: round(s.km_iniziali + s.km_corse, 1), km_app: round(s.km_corse, 1) }));
}
function salvaScarpa(id, b) {
  const nome = b.nome != null ? String(b.nome).trim().slice(0, 60) : null;
  const kmIni = b.km_iniziali != null && b.km_iniziali !== '' ? Number(b.km_iniziali) : null;
  const limite = b.limite_km != null && b.limite_km !== '' ? Number(b.limite_km) : null;
  if (id == null && !nome) return { errore: 'nome' };
  if (kmIni != null && !(kmIni >= 0 && kmIni <= 5000)) return { errore: 'km_iniziali' };
  if (limite != null && !(limite >= 100 && limite <= 3000)) return { errore: 'limite_km' };
  db.transaction(() => {
    if (id == null) {
      const prima = !db.prepare('SELECT 1 FROM scarpe WHERE attiva = 1').get();
      id = db.prepare('INSERT INTO scarpe (nome, km_iniziali, limite_km, predefinita, creata) VALUES (?, ?, ?, ?, ?)')
        .run(nome, kmIni || 0, limite || 700, prima || b.predefinita ? 1 : 0, new Date().toISOString()).lastInsertRowid;
      if (prima || b.predefinita) db.prepare('UPDATE scarpe SET predefinita = 0 WHERE id <> ?').run(id);
    } else {
      if (!db.prepare('SELECT 1 FROM scarpe WHERE id = ?').get(id)) { id = null; return; }
      if (nome) db.prepare('UPDATE scarpe SET nome = ? WHERE id = ?').run(nome, id);
      if (kmIni != null) db.prepare('UPDATE scarpe SET km_iniziali = ? WHERE id = ?').run(kmIni, id);
      if (limite != null) db.prepare('UPDATE scarpe SET limite_km = ? WHERE id = ?').run(limite, id);
      if (b.attiva != null) db.prepare('UPDATE scarpe SET attiva = ?, predefinita = CASE WHEN ? = 0 THEN 0 ELSE predefinita END WHERE id = ?').run(b.attiva ? 1 : 0, b.attiva ? 1 : 0, id);
      if (b.predefinita) {
        db.prepare('UPDATE scarpe SET predefinita = 0').run();
        db.prepare('UPDATE scarpe SET predefinita = 1, attiva = 1 WHERE id = ?').run(id);
      }
    }
  })();
  return id == null ? { errore: 'non_trovata' } : { ok: true, id };
}

const ANALISI_V = 3; // 2 = percorso GPS e potenza nella serie; 3 = deriva cardiaca calcolata da AAC

/**
 * Istogramma della FC dai dati grezzi (uno per secondo): secondi passati a ogni bpm.
 * Non dipende dalla FC max, quindi le zone si ricalcolano al volo quando cambia.
 * Pause e buchi nei dati contano al massimo 10 s (come nell'analisi della corsa).
 */
function istogrammaDaStreams(streams) {
  const prendi = (t) => {
    const s = Array.isArray(streams) ? streams.find((x) => x && x.type === t) : streams && streams[t];
    const d = s && (Array.isArray(s) ? s : s.data);
    return Array.isArray(d) && d.length ? d : null;
  };
  const time = prendi('time'), hr = prendi('heartrate');
  if (!time || !hr) return [];
  const sec = new Map();
  for (let i = 1; i < time.length && i < hr.length; i++) {
    const dt = Math.min(10, Number(time[i]) - Number(time[i - 1]));
    const h = Number(hr[i]);
    if (!(dt > 0) || !(h >= 30 && h <= 250)) continue;
    const b = Math.round(h);
    sec.set(b, (sec.get(b) || 0) + dt);
  }
  return [...sec.entries()].sort((x, y) => x[0] - y[0]).map(([b, t]) => [b, Math.round(t * 10) / 10]);
}

// Corse gia' registrate senza istogramma: scarica solo tempo e FC da Intervals e lo calcola.
// Scrive soltanto fc_istogramma (vuota): i dati originali della corsa non vengono toccati.
async function completaIstogrammiFc(limite = 60) {
  const righe = db
    .prepare("SELECT id FROM attivita WHERE origine = 'intervals' AND fc_istogramma IS NULL AND stream_ok = 1 ORDER BY data DESC LIMIT ?")
    .all(limite);
  const agg = db.prepare('UPDATE attivita SET fc_istogramma = ? WHERE id = ? AND fc_istogramma IS NULL');
  let fatte = 0;
  for (const { id } of righe) {
    try {
      const st = id.startsWith('s')
        ? await strava.stream(contesto.getStore().utente.id, id, 'time,heartrate')
        : await intervalsGetAttivita(id, '/streams', { types: 'time,heartrate' });
      agg.run(JSON.stringify(st ? istogrammaDaStreams(st) : []), id);
      fatte++;
    } catch (e) {
      console.warn(`[zone] ${id}: ${e.message}`);
      break; // Intervals non risponde: si riprova alla prossima sincronizzazione
    }
  }
  return fatte;
}

async function analizzaCorseNuove(limite = 40) {
  const daFare = db
    .prepare(`SELECT id FROM attivita WHERE origine = 'intervals' AND (stream_ok IS NULL OR stream_ok = -1 OR (stream_ok = 1 AND (serie IS NULL OR giri IS NULL OR COALESCE(v_analisi, 0) < ${ANALISI_V}))) ORDER BY data DESC LIMIT ?`)
    .all(limite);
  const agg = db.prepare(`UPDATE attivita SET tempo_corsa = ?, distanza_corsa = ?, passo_corsa = ?, fc_corsa = ?, parziali = ?, serie = ?, giri = ?, stream_ok = ?, deriva = ?, v_analisi = ${ANALISI_V} WHERE id = ?`);
  let ok = 0;
  for (const { id } of daFare) {
    try {
      const daStrava = id.startsWith('s');
      const st = daStrava
        ? await strava.stream(contesto.getStore().utente.id, id)
        : await intervalsGetAttivita(id, '/streams', { types: 'time,velocity_smooth,heartrate,cadence,distance,fixed_altitude,altitude,watts,latlng' });
      const a = st ? analizzaStream(st) : null;
      if (st) db.prepare('UPDATE attivita SET fc_istogramma = ? WHERE id = ?').run(JSON.stringify(istogrammaDaStreams(st)), id);
      let giri = [];
      if (!daStrava) {
        try {
          const iv = await intervalsGetAttivita(id, '/intervals');
          giri = applicaGiri(a, iv);
        } catch (e) {
          console.warn(`[giri] ${id}: ${e.message}`);
        }
      }
      if (a) {
        agg.run(a.tempo_corsa, a.distanza_corsa, a.passo_corsa, a.fc_corsa, JSON.stringify(a.parziali), a.serie ? JSON.stringify(a.serie) : null, JSON.stringify(giri), 1, calcolaDeriva(a.serie), id);
        ok++;
      } else {
        agg.run(null, null, null, null, null, null, JSON.stringify(giri), 0, null, id);
      }
    } catch (e) {
      console.warn(`[stream] ${id}: ${e.message}`);
      if (e.status === 429) break; // limite di Strava: si riprende alla prossima sincronizzazione
      db.prepare('UPDATE attivita SET stream_ok = -1 WHERE id = ?').run(id);
    }
  }
  return { analizzate: ok, tentate: daFare.length };
}

/**
 * Deriva cardiaca (Pa:HR): quanto cala la velocità per battito tra la prima e la seconda metà
 * dei tratti corsi, esclusi i primi e gli ultimi 5 minuti. La velocità è corretta per la pendenza
 * (costo energetico di Minetti) così salite e discese non falsano il confronto.
 * Solo corse continue: almeno 20' utili e almeno l'85% del tempo di corsa (no corsa-cammino).
 * e a ritmo costante (velocità corretta delle due metà entro l'8%).
 */
function calcolaDeriva(serie) {
  if (!serie || !serie.hr || !serie.v || !serie.c) return null;
  const { t, d, v, hr, c, alt } = serie;
  const n = t.length;
  const passo = serie.passo || 5;
  const corsiTot = c.reduce((s, x) => s + x, 0) * passo;
  if (!n || corsiTot < (t[n - 1] - t[0]) * 0.85) return null;
  const w = Math.max(1, Math.round(15 / passo)); // pendenza su ~30 s
  const costo = (g) => 155.4 * g ** 5 - 30.4 * g ** 4 - 43.3 * g ** 3 + 46.3 * g ** 2 + 19.5 * g + 3.6;
  const punti = [];
  let tc = 0;
  for (let i = 0; i < n; i++) {
    if (!c[i] || !(v[i] > 0.5) || !(hr[i] > 40)) continue;
    tc += passo;
    let vv = v[i];
    if (alt) {
      const a = Math.max(0, i - w), b = Math.min(n - 1, i + w);
      const dd = (d[b] - d[a]) * 1000;
      if (alt[a] != null && alt[b] != null && dd > 20) vv *= costo(Math.max(-0.25, Math.min(0.25, (alt[b] - alt[a]) / dd))) / 3.6;
    }
    punti.push({ tc, v: vv, hr: hr[i] });
  }
  const utili = punti.filter((p) => p.tc > 300 && p.tc <= tc - 300);
  if (utili.length * passo < 20 * 60) return null;
  const meta = utili[Math.floor(utili.length / 2)].tc;
  const ef = (arr) => arr.reduce((s, p) => s + p.v, 0) / arr.reduce((s, p) => s + p.hr, 0);
  const prima = utili.filter((p) => p.tc < meta), seconda = utili.filter((p) => p.tc >= meta);
  // ritmo non costante (lavori, salita e discesa): la deriva non sarebbe confrontabile
  const vm = (arr) => arr.reduce((s, p) => s + p.v, 0) / arr.length;
  if (Math.abs(vm(seconda) / vm(prima) - 1) > 0.08) return null;
  const ef1 = ef(prima);
  const ef2 = ef(seconda);
  return ef1 > 0 ? round(((ef1 - ef2) / ef1) * 100, 1) : null;
}

function normalizzaAttivita(a, mappaBenessere) {
  if (!a || !TIPI_CORSA.has(a.type)) return null;
  const metri = num(a.distance);
  const tempo = Math.round(num(a.moving_time) || num(a.elapsed_time) || 0);
  if (!(metri >= 500) || !(tempo > 0) || !a.start_date_local || a.id == null) return null;

  const data = String(a.start_date_local).slice(0, 10);
  const km = metri / 1000;
  const passo = tempo / km;
  const fc = num(a.average_heartrate);

  const w = mappaBenessere.get(data);
  let ctl = num(a.icu_ctl);
  let atl = num(a.icu_atl);
  if (ctl == null && w) ctl = w.ctl;
  if (atl == null && w) atl = w.atl;

  let ef = num(a.icu_efficiency_factor);
  if (ef == null && fc) ef = 60000 / passo / fc;

  return {
    id: String(a.id),
    data,
    distanza: round(km, 3),
    tempo,
    passo_medio: round(passo, 1),
    fc_media: round(fc, 1),
    ctl: round(ctl, 1),
    atl: round(atl, 1),
    tsb: ctl != null && atl != null ? round(ctl - atl, 1) : null,
    efficiency_factor: round(ef, 3),
    origine: 'intervals',
    ora_inizio: /T(\d{2}:\d{2})/.test(String(a.start_date_local)) ? String(a.start_date_local).match(/T(\d{2}:\d{2})/)[1] : null,
    nome: a.name ? String(a.name).slice(0, 120) : null,
    tipo: String(a.type),
    fc_max: round(num(a.max_heartrate), 0),
    cadenza: round(num(a.average_cadence), 0),
    dislivello: round(num(a.total_elevation_gain), 0),
    carico: round(num(a.icu_training_load), 1),
    calorie: round(num(a.calories), 0),
    decoupling: round(num(a.decoupling), 1),
    rpe: round(num(a.icu_rpe) ?? num(a.perceived_exertion), 0),
    contatto: round(num(a.average_stance_time), 0),
    oscillazione: num(a.average_vertical_oscillation) != null ? round(num(a.average_vertical_oscillation) / 10, 1) : null,
    lung_passo: num(a.average_step_length) != null ? round(num(a.average_step_length) / 1000, 2) : null,
    rapporto_verticale: round(num(a.average_vertical_ratio), 1),
    passo_gap: num(a.gap) > 0.5 ? round(1000 / num(a.gap), 1) : null,
    fc_recupero: a.icu_hrr && num(a.icu_hrr.hrr) > 0 ? round(num(a.icu_hrr.hrr), 0) : null,
    zone_fc: Array.isArray(a.icu_hr_zone_times) && a.icu_hr_zone_times.length
      ? JSON.stringify(a.icu_hr_zone_times.map((x) => Math.round(num(x) || 0)))
      : null,
  };
}

function normalizzaAltraAttivita(a) {
  if (!a || a.id == null || !a.start_date_local || TIPI_CORSA.has(a.type)) return null;
  const durata = Math.round(num(a.moving_time) || num(a.elapsed_time) || 0);
  if (!(durata > 0)) return null;
  const metri = num(a.distance);
  return {
    id: String(a.id),
    data: String(a.start_date_local).slice(0, 10),
    tipo: String(a.type || 'Other'),
    nome: a.name ? String(a.name).slice(0, 120) : null,
    durata,
    distanza: metri > 0 ? round(metri / 1000, 3) : null,
    fc_media: round(num(a.average_heartrate), 1),
    calorie: round(num(a.calories), 0),
    carico: round(num(a.icu_training_load), 1),
  };
}

function normalizzaBenessere(w) {
  const data = w && w.id ? String(w.id).slice(0, 10) : null;
  if (!data) return null;
  const r = {
    data,
    ctl: round(num(w.ctl), 1),
    atl: round(num(w.atl), 1),
    fc_riposo: round(num(w.restingHR), 0),
    // HRV: rMSSD (Garmin e altri) in `hrv`, SDNN (Apple Watch) in `hrvSDNN`
    hrv: round(num(w.hrv) ?? num(w.hrvSDNN), 0),
    sonno_sec: num(w.sleepSecs) != null ? Math.round(num(w.sleepSecs)) : null,
    sonno_score: round(num(w.sleepScore), 0),
    passi: num(w.steps) != null ? Math.round(num(w.steps)) : null,
    peso: round(num(w.weight), 1),
    vo2max: round(num(w.vo2max), 1),
    spo2: round(num(w.spO2), 1),
    respirazione: round(num(w.respiration), 1),
    fc_sonno: round(num(w.avgSleepingHR), 0),
    grasso: round(num(w.bodyFat), 1),
    pressione_max: round(num(w.systolic), 0),
    pressione_min: round(num(w.diastolic), 0),
    glicemia: round(num(w.bloodGlucose), 1),
    piani: num(w.floorsClimbed) != null ? Math.round(num(w.floorsClimbed)) : null,
  };
  const haDati = Object.entries(r).some(([k, v]) => k !== 'data' && v != null);
  return haDati ? r : null;
}

const syncInCorso = new Map(); // id utente -> promise

function avviaSync(origine) {
  const id = contesto.getStore().utente.id;
  if (syncInCorso.has(id)) return syncInCorso.get(id); // evita sync concorrenti: chi arriva dopo attende lo stesso risultato
  const p = eseguiSync(origine).finally(() => {
    syncInCorso.delete(id);
  });
  syncInCorso.set(id, p);
  return p;
}

async function eseguiSync(origine) {
  if (!sincronizzazioneConfigurata()) {
    throw new ErroreSync(L('Nessuna fonte di dati collegata: collega Intervals.icu o Strava dal profilo.', 'No data source connected: connect Intervals.icu or Strava from your profile.'), 503);
  }
  const haInt = intervalsConfigurato(), haStr = stravaCollegato();
  const t0 = Date.now();
  try {
    const oggiStr = oggi();
    const ultimaReale = db.prepare("SELECT MAX(data) AS m FROM attivita WHERE origine = 'intervals'").get().m;
    const ultimoCompleto = getMeta('ultimo_sync_completo');
    const completo =
      !ultimaReale || !ultimoCompleto || diffDays(oggiStr, ultimoCompleto.slice(0, 10)) >= CONFIG.fullResyncDays;
    const oldest = completo ? addDays(oggiStr, -CONFIG.historyDays) : addDays(ultimaReale, -CONFIG.recentDays);

    let grezze = haInt ? await intervalsGet('/activities', { oldest, newest: addDays(oggiStr, 1) }) : [];
    if (!Array.isArray(grezze)) throw new ErroreSync('Risposta inattesa da Intervals.icu (attività).');

    // Le attivita' importate da Strava arrivano vuote dall'API di Intervals (termini di Strava): le contiamo
    // per avvisare l'utente di collegare l'orologio direttamente a Intervals.icu
    const daStrava = grezze.filter((g) => g && String(g.source || '').toUpperCase() === 'STRAVA' && !(num(g.distance) > 0));
    let stravaPrec = null;
    try { stravaPrec = JSON.parse(getMeta('strava_bloccate') || 'null'); } catch (_) { stravaPrec = null; }
    const ultimaStrava = daStrava.reduce((m, g) => { const d = String(g.start_date_local || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(d) && d > m ? d : m; }, (stravaPrec && stravaPrec.ultima) || '');
    if (haInt) setMeta('strava_bloccate', JSON.stringify({ ultima: ultimaStrava || null, nella_finestra: daStrava.length, controllo: oggiStr }));

    // attivita' presenti oggi su Intervals (per togliere da AAC quelle cancellate li')
    const idsIntervals = new Set(grezze.filter(Boolean).map((g) => String(g.id)));
    // la stessa uscita caricata da due app: ne resta una (la piu' completa)
    const doppioni = unisciDoppioni(grezze);
    grezze = doppioni.tenute;

    let benessereGrezzo = [];
    if (haInt) {
      try {
        benessereGrezzo = await intervalsGet('/wellness', { oldest, newest: oggiStr });
        if (!Array.isArray(benessereGrezzo)) benessereGrezzo = [];
      } catch (e) {
        console.warn(`[sync] Wellness non disponibile (${e.message}): uso CTL/ATL delle attività.`);
      }
    }

    // Strava: attivita' dal suo ultimo dato (o un anno, la prima volta), senza i doppioni gia' arrivati da Intervals
    let daStravaApi = 0, erroreStrava = null;
    if (haStr) {
      try {
        const ultimaSt = db.prepare("SELECT MAX(data) AS m FROM attivita WHERE id LIKE 's%'").get().m;
        const sv = await strava.attivita(contesto.getStore().utente.id, ultimaSt ? addDays(ultimaSt, -CONFIG.recentDays) : addDays(oggiStr, -CONFIG.historyDays), caricoDaFc);
        const dirette = grezze.filter((g) => g && Number(g.distance) > 0);
        const giaDb = db.prepare("SELECT data, ora_inizio, distanza FROM attivita WHERE id NOT LIKE 's%' AND origine = 'intervals' AND data >= ?").all(addDays(oggiStr, -CONFIG.historyDays - 1))
          .map((r) => ({ start_date_local: `${r.data}T${r.ora_inizio || ''}`, distance: (r.distanza || 0) * 1000 }));
        const nuoveSt = sv.filter((a) => !dirette.some((g) => stessaUscita(a, g)) && !giaDb.some((g) => stessaUscita(a, g)));
        daStravaApi = nuoveSt.length;
        grezze = grezze.concat(nuoveSt);
      } catch (e) {
        if (!haInt) throw new ErroreSync(e.message, e.status === 401 ? 401 : 502);
        erroreStrava = e.message;
        console.warn(`[sync] Strava: ${e.message}`);
      }
    }

    const righeBenessere = benessereGrezzo.map(normalizzaBenessere).filter(Boolean);
    const mappaBenessere = new Map();
    for (const w of righeBenessere) {
      if (w.ctl != null && w.atl != null) mappaBenessere.set(w.data, { ctl: w.ctl, atl: w.atl });
    }

    const leggi = db.prepare('SELECT * FROM attivita WHERE id = ?');
    const upsert = db.prepare(SQL_UPSERT);
    const upsertBenessere = db.prepare(`
      INSERT INTO benessere (data, ctl, atl, fc_riposo, hrv, sonno_sec, sonno_score, passi, peso, vo2max, spo2, respirazione, fc_sonno, grasso, pressione_max, pressione_min, glicemia, piani)
      VALUES (@data, @ctl, @atl, @fc_riposo, @hrv, @sonno_sec, @sonno_score, @passi, @peso, @vo2max, @spo2, @respirazione, @fc_sonno, @grasso, @pressione_max, @pressione_min, @glicemia, @piani)
      ON CONFLICT(data) DO UPDATE SET
        ctl = excluded.ctl, atl = excluded.atl, fc_riposo = excluded.fc_riposo, hrv = excluded.hrv,
        sonno_sec = excluded.sonno_sec, sonno_score = excluded.sonno_score, passi = excluded.passi,
        peso = excluded.peso, vo2max = excluded.vo2max, spo2 = excluded.spo2, respirazione = excluded.respirazione, fc_sonno = excluded.fc_sonno,
        grasso = excluded.grasso, pressione_max = excluded.pressione_max, pressione_min = excluded.pressione_min, glicemia = excluded.glicemia, piani = excluded.piani
    `);
    const upsertAltra = db.prepare(`
      INSERT INTO altre_attivita (id, data, tipo, nome, durata, distanza, fc_media, calorie, carico)
      VALUES (@id, @data, @tipo, @nome, @durata, @distanza, @fc_media, @calorie, @carico)
      ON CONFLICT(id) DO UPDATE SET
        data = excluded.data, tipo = excluded.tipo, nome = excluded.nome, durata = excluded.durata,
        distanza = excluded.distanza, fc_media = excluded.fc_media, calorie = excluded.calorie, carico = excluded.carico
    `);
    const campi = ['data', 'distanza', 'tempo', 'passo_medio', 'fc_media', 'ctl', 'atl', 'tsb', 'efficiency_factor'];

    let nuove = 0;
    const idsNuove = [];
    let aggiornate = 0;
    let scartate = 0;
    let corse = 0;
    let altre = 0;

    db.transaction(() => {
      for (const grezza of grezze) {
        const r = normalizzaAttivita(grezza, mappaBenessere);
        if (!r) {
          const altra = normalizzaAltraAttivita(grezza);
          if (altra) {
            upsertAltra.run(altra);
            altre++;
          } else {
            scartate++;
          }
          continue;
        }
        corse++;
        const esistente = leggi.get(r.id);
        if (!esistente) {
          nuove++;
          idsNuove.push(r.id);
        } else if (campi.some((c) => esistente[c] !== r[c]) || esistente.origine !== r.origine) {
          aggiornate++;
        }
        upsert.run(rigaCompleta(r));
      }
      for (const w of righeBenessere) upsertBenessere.run(w);
      // le corse nuove prendono la scarpa predefinita
      const pred = db.prepare('SELECT id FROM scarpe WHERE predefinita = 1 AND attiva = 1').get();
      if (pred) for (const id of idsNuove) db.prepare('UPDATE attivita SET scarpa_id = ? WHERE id = ? AND scarpa_id IS NULL').run(pred.id, id);

      // Attivita' cancellate su Intervals (es. un doppione tolto a mano): spariscono anche da AAC.
      // Solo nella finestra appena scaricata e solo se Intervals ha risposto con almeno un'attivita'.
      if (haInt && idsIntervals.size) {
        const sparite = (t) => db.prepare(`SELECT id FROM ${t} WHERE id LIKE 'i%' AND data >= ? AND data <= ?`).all(oldest, oggiStr).filter((r) => !idsIntervals.has(String(r.id)));
        for (const r of sparite('attivita')) db.prepare("DELETE FROM attivita WHERE id = ? AND origine = 'intervals'").run(r.id);
        for (const r of sparite('altre_attivita')) db.prepare('DELETE FROM altre_attivita WHERE id = ?').run(r.id);
      }
      // Doppioni tolti: la scarpa scelta a mano passa alla corsa che resta, poi l'altra si cancella
      for (const d of doppioni.scartate) {
        db.prepare('UPDATE attivita SET scarpa_id = COALESCE(scarpa_id, (SELECT scarpa_id FROM attivita WHERE id = ?)) WHERE id = ?').run(d.id, d.tenuta);
        db.prepare('DELETE FROM attivita WHERE id = ?').run(d.id);
        db.prepare('DELETE FROM altre_attivita WHERE id = ?').run(d.id);
      }
      // Doppioni gia' salvati (anche fuori dalla finestra del sync): resta la corsa con piu' dati
      {
        const righe = db.prepare("SELECT id, data, ora_inizio, distanza, cadenza, rpe, contatto, giri, fc_media, scarpa_id FROM attivita WHERE origine = 'intervals' AND id NOT LIKE 's%' ORDER BY data, ora_inizio").all();
        const forma = (r) => ({ start_date_local: `${r.data}T${r.ora_inizio || ''}`, distance: (r.distanza || 0) * 1000 });
        const ricco = (r) => [r.cadenza, r.rpe, r.contatto, r.fc_media, r.giri && r.giri.length > 2 ? 1 : null].filter((v) => v != null).length;
        for (let i = 0; i < righe.length; i++) {
          const a = righe[i];
          if (!a || !a.ora_inizio) continue;
          for (let j = i + 1; j < righe.length; j++) {
            const b = righe[j];
            if (!b) continue;
            if (b.data !== a.data) break;
            if (!b.ora_inizio || !stessaUscita(forma(a), forma(b))) continue;
            const [tieni, togli] = ricco(b) > ricco(a) || (ricco(b) === ricco(a) && String(b.id).localeCompare(String(a.id), undefined, { numeric: true }) < 0) ? [b, a] : [a, b];
            db.prepare('UPDATE attivita SET scarpa_id = COALESCE(scarpa_id, ?) WHERE id = ?').run(togli.scarpa_id, tieni.id);
            db.prepare('DELETE FROM attivita WHERE id = ?').run(togli.id);
            righe[righe.indexOf(togli)] = null;
            if (togli === a) break;
          }
        }
      }
      // Arrivate corse reali, le corse simulate di fabbrica non servono piu'
      if (corse > 0) {
        db.prepare("DELETE FROM attivita WHERE origine = 'mock'").run();
      }
      // Una corsa arrivata prima da Strava e poi anche da Intervals: resta quella di Intervals (piu' completa)
      if (haInt) {
        const st = db.prepare("SELECT id, data, ora_inizio, distanza FROM attivita WHERE id LIKE 's%'").all();
        const dirette = db.prepare("SELECT data, ora_inizio, distanza FROM attivita WHERE id NOT LIKE 's%' AND origine = 'intervals'").all();
        const forma = (r) => ({ start_date_local: `${r.data}T${r.ora_inizio || ''}`, distance: (r.distanza || 0) * 1000 });
        const doppie = st.filter((a) => dirette.some((g) => stessaUscita(forma(a), forma(g))));
        for (const d of doppie) db.prepare('DELETE FROM attivita WHERE id = ?').run(d.id);
      }
    })();

    let analisi = { analizzate: 0, tentate: 0 };
    try {
      analisi = await analizzaCorseNuove();
    } catch (e) {
      console.warn(`[stream] analisi non riuscita: ${e.message}`);
    }
    try {
      const n = await completaIstogrammiFc();
      if (n) console.log(`[zone] u${contesto.getStore().utente.id}: tempo nelle zone calcolato dai dati grezzi per ${n} corse`);
    } catch (e) {
      console.warn(`[zone] ${e.message}`);
    }
    try {
      await aggiornaMeteo();
    } catch (e) {
      console.warn(`[meteo] ${e.message}`);
    }
    // il parere del coach sulle corse appena arrivate (notifica + diario), dopo analisi e meteo
    try {
      const st = contesto.getStore();
      if (st && st.utente && typeof st.utente.id === 'number') notificaCorseNuove(st.utente.id, idsNuove);
    } catch (e) { console.warn(`[parere] ${e.message}`); }
    // le sedute dei prossimi giorni nel calendario di Intervals (solo se l'utente l'ha acceso nel profilo)
    if (haInt) {
      try { await aggiornaSeduteIntervals(false); } catch (e) { console.warn(`[intervals:sedute] ${e.message}`); }
    }

    const esito = {
      ok: true,
      origine,
      corse_analizzate: analisi.analizzate,
      nuove,
      aggiornate,
      scartate,
      altre_attivita: altre,
      giorni_salute: righeBenessere.length,
      ricevute: grezze.length,
      doppioni: doppioni.scartate.length,
      da_strava: daStravaApi,
      errore_strava: erroreStrava,
      fonti: { intervals: haInt, strava: haStr },
      completo,
      durata_ms: Date.now() - t0,
    };
    const ts = new Date().toISOString();
    setMeta('ultimo_sync', ts);
    setMeta('ultimo_sync_esito', JSON.stringify({ ...esito, quando: ts }));
    if (completo) setMeta('ultimo_sync_completo', ts);
    console.log(
      `[sync:${origine}] u${contesto.getStore().utente.id} ok - corse nuove ${nuove}, aggiornate ${aggiornate}, altre attività ${altre}, ` +
        `giorni salute ${righeBenessere.length}, scartate ${scartate} (${esito.durata_ms} ms)`
    );
    return esito;
  } catch (e) {
    const ts = new Date().toISOString();
    setMeta('ultimo_sync_esito', JSON.stringify({ ok: false, origine, errore: e.message, quando: ts }));
    console.error(`[sync:${origine}] u${contesto.getStore().utente.id} errore: ${e.message}`);
    throw e;
  }
}

function statoSync() {
  let esito = null;
  try {
    esito = JSON.parse(getMeta('ultimo_sync_esito') || 'null');
  } catch (_) {
    esito = null;
  }
  return {
    configurata: sincronizzazioneConfigurata(),
    fonti: { intervals: intervalsConfigurato(), strava: stravaCollegato() },
    in_corso: syncInCorso.has(contesto.getStore().utente.id),
    ultimo_sync: getMeta('ultimo_sync'),
    ultimo_esito: esito,
    cron: CONFIG.syncCron,
  };
}

// Sincronizza, uno alla volta, tutti gli utenti attivi con Intervals.icu collegato
async function syncTutti(origine) {
  for (const u of account.utentiAttivi()) {
    const ctx = account.contestoDi(u);
    if (!(ctx.cfg.apiKey && ctx.cfg.athleteId) && !strava.collegato(u.id)) continue;
    try {
      await contesto.run(ctx, () => avviaSync(origine));
    } catch (_) {
      /* gia' registrato nell'esito della sincronizzazione */
    }
  }
}

function avviaScheduler() {
  if (!cron.validate(CONFIG.syncCron)) {
    console.error(`[cron] Espressione SYNC_CRON non valida: "${CONFIG.syncCron}". Scheduler non avviato.`);
    return;
  }
  cron.schedule(
    CONFIG.syncCron,
    () => {
      syncTutti('cron').then(aggiornaDiariTutti).catch(() => {});
    },
    { timezone: CONFIG.timezone }
  );
  console.log(`[cron] Sincronizzazione automatica attiva: "${CONFIG.syncCron}" (${CONFIG.timezone}).`);
  // notifiche: ogni 5 minuti si controlla chi deve riceverle (mattina all'ora scelta, domenica alle 19:00)
  cron.schedule('*/5 * * * *', () => { notifiche.giro(account.utentiAttivi()).catch((e) => console.warn('[notifiche]', e.message)); }, { timezone: CONFIG.timezone });
  if (CONFIG.syncOnStart) {
    const t = setTimeout(() => syncTutti('avvio'), 10000);
    if (t.unref) t.unref();
  }
}

// ===========================================================================
// Motore del coach
// ===========================================================================

/**
 * Serie giornaliera CTL/ATL/TSB dal primo dato fino a "fino".
 * Priorita': wellness di Intervals -> valori dell'ultima attivita' del giorno -> decadimento
 * esponenziale (nessun carico) nei giorni senza dati.
 */
function costruisciSerieGiornaliera(fino, soloMock) {
  const attivita = db.prepare('SELECT data, ctl, atl, carico FROM attivita ORDER BY data ASC, id ASC').all();
  if (!attivita.length) return [];
  // carico dei giorni senza CTL/ATL da Intervals (attivita' arrivate da Strava): si costruiscono con le stesse costanti
  const carichi = new Map();
  for (const a of attivita) if (a.ctl == null && a.carico > 0) carichi.set(a.data, (carichi.get(a.data) || 0) + a.carico);
  if (!soloMock) for (const a of db.prepare("SELECT data, carico FROM altre_attivita WHERE id LIKE 's%' AND carico > 0").all()) carichi.set(a.data, (carichi.get(a.data) || 0) + a.carico);

  // Con sole corse simulate, il CTL/ATL reale di Intervals non va mescolato a quello simulato
  const benessere = new Map(
    soloMock
      ? []
      : db
          .prepare('SELECT data, ctl, atl FROM benessere WHERE ctl IS NOT NULL AND atl IS NOT NULL')
          .all()
          .map((r) => [r.data, r])
  );
  const perGiorno = new Map();
  for (const a of attivita) {
    if (a.ctl == null || a.atl == null) continue;
    const cur = perGiorno.get(a.data);
    // Nello stesso giorno CTL e ATL crescono con ogni sessione: vale la piu' alta
    if (!cur || a.ctl + a.atl > cur.ctl + cur.atl) perGiorno.set(a.data, { ctl: a.ctl, atl: a.atl });
  }

  let inizio = attivita[0].data;
  for (const d of benessere.keys()) if (d < inizio) inizio = d;

  const serie = [];
  let ctl = 0;
  let atl = 0;
  for (let d = inizio; d <= fino; d = addDays(d, 1)) {
    const w = benessere.get(d) && benessere.get(d).ctl != null && benessere.get(d).atl != null ? benessere.get(d) : null;
    const a = perGiorno.get(d);
    if (w) {
      ctl = w.ctl;
      atl = w.atl;
    } else if (a) {
      ctl = a.ctl;
      atl = a.atl;
    } else {
      const c = carichi.get(d) || 0;
      ctl = ctl * K_CTL + c * (1 - K_CTL);
      atl = atl * K_ATL + c * (1 - K_ATL);
    }
    serie.push({ data: d, ctl: round(ctl, 1), atl: round(atl, 1), tsb: round(ctl - atl, 1) });
  }
  return serie;
}

function valutaStato(serie) {
  const ora = serie[serie.length - 1];
  const ultimi7 = serie.slice(-7);
  const settegiorniFa = serie.length > 7 ? serie[serie.length - 8] : serie[0];

  const rampRate = round(ora.ctl - settegiorniFa.ctl, 1);
  const variazione7g = round(ultimi7[ultimi7.length - 1].tsb - ultimi7[0].tsb, 1);

  let livello = 0; // 0 verde, 1 arancione, 2 rossa
  const motivazioni = [];

  if (ora.tsb < SOGLIE.rossaMax) {
    livello = 2;
    motivazioni.push(L(`TSB a ${it1(ora.tsb)}: sotto la soglia di sovraccarico (${SOGLIE.rossaMax})`, `TSB at ${ora.tsb}: below the overload threshold (${SOGLIE.rossaMax})`));
  } else if (ora.tsb < SOGLIE.verdeMin) {
    livello = Math.max(livello, 1);
    motivazioni.push(L(`TSB a ${it1(ora.tsb)}: fatica accumulata, sei in piena zona di allenamento`, `TSB at ${ora.tsb}: accumulated fatigue, you are in the training zone`));
  }

  if (rampRate > SOGLIE.rampAllerta) {
    livello = 2;
    motivazioni.push(L(`Ramp rate +${it1(rampRate)} CTL/settimana: crescita troppo rapida (limite ${SOGLIE.rampAllerta})`, `Ramp rate +${rampRate} CTL/week: increasing too fast (limit ${SOGLIE.rampAllerta})`));
  } else if (rampRate > SOGLIE.rampAttenzione) {
    livello = Math.max(livello, 1);
    motivazioni.push(L(`Ramp rate +${it1(rampRate)} CTL/settimana: carico in salita sostenuta`, `Ramp rate +${rampRate} CTL/week: load rising steadily`));
  }

  if (variazione7g < SOGLIE.calo7gAttenzione) {
    livello = Math.max(livello, 1);
    motivazioni.push(L(`TSB sceso di ${it1(Math.abs(variazione7g))} punti negli ultimi 7 giorni`, `TSB dropped ${Math.abs(variazione7g)} points in the last 7 days`));
  }

  if (livello === 0) {
    motivazioni.push(L(`TSB a ${it1(ora.tsb)} (${variazione7g >= 0 ? '+' : '−'}${it1(Math.abs(variazione7g))} in 7 giorni)`, `TSB at ${ora.tsb} (${variazione7g >= 0 ? '+' : '−'}${Math.abs(variazione7g)} in 7 days)`));
    motivazioni.push(L(`Ramp rate ${rampRate >= 0 ? '+' : '−'}${it1(Math.abs(rampRate))} CTL/settimana: sotto controllo`, `Ramp rate ${rampRate >= 0 ? '+' : '−'}${Math.abs(rampRate)} CTL/week: under control`));
    if (ora.tsb > 25) motivazioni.push(L('Molto fresco: stai perdendo condizione, riprendi con continuità', 'Very fresh: you are losing fitness, train consistently again'));
  }

  const zona = ['verde', 'arancione', 'rossa'][livello];
  const testi = {
    verde: {
      titolo: L('Zona Verde · Via libera alla progressione', 'Green zone · Clear to progress'),
      messaggio:
        'Sei fresco e il carico cresce in modo sostenibile. Nei prossimi 3 allenamenti puoi aumentare i chilometri del 5–10%.',
    },
    arancione: {
      titolo: L('Zona Arancione · Mantieni il carico', 'Orange zone · Hold the load'),
      messaggio:
        'La fatica sta salendo. Consolida i volumi attuali senza aggiungere chilometri finché il TSB non risale sopra −10.',
    },
    rossa: {
      titolo: L('Zona Rossa · Scarico obbligato', 'Red zone · Mandatory recovery'),
      messaggio:
        'Rischio sovraccarico: stop alla corsa. I prossimi 3 allenamenti diventano camminata rigenerante e recupero attivo.',
    },
  }[zona];

  return {
    ctl: ora.ctl,
    atl: ora.atl,
    tsb: ora.tsb,
    ramp_rate: rampRate,
    variazione_tsb_7g: variazione7g,
    zona,
    titolo: testi.titolo,
    messaggio: testi.messaggio,
    motivazioni,
    blocco_scarico: zona === 'rossa',
  };
}

// ===========================================================================
// Piano verso la mezza maratona: 26 settimane in 4 fasi, riadattato sui dati.
// Ogni settimana-piano ha 3 sedute di base: [facile, lungo, qualità o facile] (+ sedute facili in più)
// (i giorni li sceglie scegliGiorni, la frequenza cresce da 3 fino al tetto di frequenzaObiettivo).
//
// Adattamento:
//  - settimanale: a fine settimana si decide se avanzare, ripetere o tornare
//    indietro di una settimana-piano (sedute fatte, FC nelle corse, recupero, TSB)
//  - giornaliero: la prossima seduta viene ridotta se FC a riposo, HRV, sonno
//    o TSB indicano che non sei recuperato
// ===========================================================================

// Fasi del piano: dipendono dall'obiettivo (vedi OBIETTIVI piu' sotto)
const FASI_L = () => obiettivoCorrente().fasi.map((f) => ({ id: f.id, da: f.da, a: f.a, nome: P(f.nome), obiettivo: P(f.obiettivo) }));
const faseDi = (n) => { const fs = FASI_L(); return fs.find((f) => n >= f.da && n <= f.a) || fs[fs.length - 1]; };

const NOTA_RITMI = [
  'Ritmo medio = sforzo 6/10, riesci a dire frasi brevi. Ritmo mezza = il passo che pensi di poter tenere per 2 ore e mezza.',
  'Steady pace = effort 6/10, you can speak short sentences. Half-marathon pace = the pace you think you could hold for two and a half hours.',
];
const conRitmi = (it, en) => [`${it} ${NOTA_RITMI[0]}`, `${en} ${NOTA_RITMI[1]}`];

// Descrittori: ['cc', ripetute, corsa, cammino] | ['facile', min, allunghi] | ['lungo', min]
//              ['fartlek', ripetute, veloce, lento] | ['ritmo', ripetute, min, recupero, 'medio'|'mezza'] | ['gara'] | ['recupero', min]
//              ['4x4', ripetute, min, recupero]: 4×4 norvegese (Helgerud et al. 2007), blocchi all'85–95% della FC max con corsetta di recupero
const cc = (r, c, w) => ['cc', r, c, w];
const fa = (m, allunghi) => ['facile', m, Boolean(allunghi)];
const lu = (m) => ['lungo', m];
const nv = (r) => ['4x4', r, 4, 3]; // 4×4 norvegese: solo dalla fase 2 (si corrono gia' 30' di fila), al posto di un fartlek o di un ritmo

const PIANO_MEZZA = [
  // ---- Fase 1 · Ripartenza ----
  { sedute: [cc(8, 1, 2), cc(8, 1, 2), cc(8, 1, 2)], nota: ['Corsa lentissima: devi riuscire a parlare. Se hai il fiatone, rallenta o cammina.', 'Very slow running: you must be able to talk. If you are out of breath, slow down or walk.'] },
  { sedute: [cc(6, 2, 2), cc(6, 2, 2), cc(6, 2, 2)], nota: ['Stesso ritmo tranquillo della settimana 1, solo frazioni più lunghe.', 'Same easy pace as week 1, just longer intervals.'] },
  { sedute: [cc(5, 3, 2), cc(5, 3, 2), cc(5, 3, 2)], nota: ['Se i 3 minuti sono troppi non preoccuparti: il coach ti farà ripetere la settimana.', 'If 3 minutes feel too much, don’t worry: the coach will have you repeat the week.'] },
  { sedute: [cc(4, 3, 2), cc(4, 3, 2), cc(4, 3, 2)], scarico: true, nota: ['Settimana più leggera per assorbire il lavoro: tendini e articolazioni ringraziano.', 'Lighter week to absorb the work: your tendons and joints will thank you.'] },
  { sedute: [cc(4, 5, 2), cc(4, 5, 2), cc(4, 5, 2)], nota: ['Primo vero salto: tieni il passo ancora più lento del solito.', 'First real step up: keep the pace even slower than usual.'] },
  { sedute: [cc(3, 8, 2), cc(3, 8, 2), cc(3, 8, 2)], nota: ['Concentrati su una respirazione regolare e un appoggio leggero.', 'Focus on steady breathing and a light foot strike.'] },
  { sedute: [cc(2, 12, 2), cc(2, 12, 2), cc(2, 12, 2)], nota: ['Due blocchi lunghi: il cammino serve solo per riprendere fiato.', 'Two long blocks: the walk is only there to catch your breath.'] },
  { sedute: [fa(22), fa(22), fa(22)], nota: ['Traguardo della fase 1: 20–25 minuti di corsa senza fermarti, sempre a ritmo conversazione.', 'Phase 1 milestone: 20–25 minutes of running without stopping, always at conversational pace.'] },
  // ---- Fase 2 · Base aerobica ----
  { sedute: [fa(25), lu(28), fa(25)], nota: ['Da qui arriva il lungo: è la seduta più importante della settimana, il coach lo mette di preferenza nel weekend.', 'From now on there is a long run: it is the most important session of the week, and the coach prefers to put it at the weekend.'] },
  { sedute: [fa(25), lu(32), fa(28)], nota: ['Il ritmo resta da conversazione anche se i minuti aumentano.', 'The pace stays conversational even as the minutes go up.'] },
  { sedute: [fa(28), lu(36), fa(28, true)], nota: ['Allunghi: 4 accelerazioni progressive da 20" a fine corsa, recuperando camminando. Servono per la tecnica, non per la fatica.', 'Strides: 4 progressive 20" accelerations at the end of the run, walking to recover. They are for technique, not fatigue.'] },
  { sedute: [fa(25), lu(30), fa(25)], scarico: true, nota: ['Settimana di scarico: meno volume per consolidare.', 'Recovery week: less volume to consolidate.'] },
  { sedute: [fa(30), lu(40), fa(30, true)], nota: ['40 minuti di lungo: a questo punto corri già più di molti principianti.', '40-minute long run: by now you already run more than many beginners.'] },
  { sedute: [fa(32), lu(45), ['fartlek', 6, 1, 2]], nota: ['Primo fartlek: 1 minuto brillante (sforzo 7/10) e 2 facili. Divertiti, non è una gara.', 'First fartlek: 1 minute lively (effort 7/10) and 2 easy. Have fun, it is not a race.'] },
  { sedute: [fa(35), lu(50), nv(3)], nota: ['Primo 4×4 norvegese (qui 3 blocchi): sforzo forte ma controllato, l’ultimo blocco deve riuscire come il primo. Il lungo arriva a 50 minuti: parti piano.', 'First Norwegian 4×4 (3 blocks here): hard but controlled, the last block should go as well as the first. The long run reaches 50 minutes: start slow.'] },
  { sedute: [fa(30), lu(40), fa(30, true)], scarico: true, nota: ['Scarico prima della fase di costruzione.', 'Recovery week before the build phase.'] },
  // ---- Fase 3 · Costruzione ----
  { sedute: [fa(35), lu(60), ['ritmo', 3, 5, 2, 'medio']], nota: conRitmi('Primo lungo da 1 ora.', 'First 1-hour long run.') },
  { sedute: [fa(40), lu(65), nv(4)], nota: ['Lungo: porta acqua se fa caldo. Il 4×4 norvegese alza il motore aerobico (VO₂max): 4 blocchi forti, recupero corricchiando.', 'Long run: bring water if it is warm. The Norwegian 4×4 raises your aerobic engine (VO₂max): 4 hard blocks, jog to recover.'] },
  { sedute: [fa(40), lu(75), ['ritmo', 2, 10, 3, 'medio']], nota: ['Lungo di 75 minuti: prova a bere qualche sorso ogni 20 minuti.', '75-minute long run: try to take a few sips every 20 minutes.'] },
  { sedute: [fa(35), lu(55), fa(30, true)], scarico: true, nota: ['Scarico: il corpo si adatta nei giorni leggeri, non in quelli duri.', 'Recovery: your body adapts on easy days, not hard ones.'] },
  { sedute: [fa(40), lu(85), ['ritmo', 3, 8, 2, 'mezza']], nota: conRitmi('Prime frazioni a ritmo mezza maratona.', 'First reps at half-marathon pace.') },
  { sedute: [fa(45), lu(95), ['ritmo', 2, 12, 3, 'mezza']], nota: ['Oltre i 90 minuti prova un gel o qualche dattero: allena anche lo stomaco per la gara.', 'Beyond 90 minutes try a gel or a few dates: train your stomach for race day too.'] },
  // ---- Fase 4 · Mezza maratona ----
  { sedute: [fa(45), lu(105), ['ritmo', 3, 8, 2, 'mezza']], nota: ['Prova l’equipaggiamento della gara: scarpe, calze, maglia, rifornimento.', 'Test your race kit: shoes, socks, shirt, fuelling.'] },
  { sedute: [fa(45), lu(115), fa(40, true)], nota: ['Picco del piano: il lungo di quasi 2 ore (circa 16–17 km). Dopo questo sei pronto.', 'Peak of the plan: a long run of almost 2 hours (about 16–17 km). After this you are ready.'] },
  { sedute: [fa(40), lu(75), ['ritmo', 3, 5, 2, 'mezza']], scarico: true, nota: ['Scarico pre-gara: meno volume, mantieni un po’ di ritmo per restare brillante.', 'Pre-race taper: less volume, keep a little pace work to stay sharp.'] },
  { sedute: [fa(20, true), ['gara'], ['recupero', 30]], nota: ['Settimana della gara. Dormi bene, mangia cose che conosci, niente novità.', 'Race week. Sleep well, eat what you know, nothing new.'] },
];
// ===========================================================================
// Frequenza e giorni delle sedute (il coach decide, l'utente indica le sue preferenze)
//
// Frequenza: si parte sempre da 3 sedute a settimana. La 4ª (e la 5ª per mezza e maratona) si guadagna
// come nei piani classici (Daniels, Pfitzinger, Higdon): 3 settimane di fila tutte fatte, in avanti, senza
// segnali di fatica e con il carico che cresce in modo sicuro (rapporto acuto/cronico ATL/CTL <= 1,3,
// Gabbett 2016). Si toglie con fatica, passi indietro o se per 2 settimane non entra nella settimana.
// Nelle settimane di scarico, di gara e nella fase corsa-cammino si torna a 3. Le sedute in più sono
// corse facili in Z2 (80/20, Seiler): il volume aumenta senza aggiungere intensità.
//
// Giorni: per ogni settimana si provano tutte le combinazioni di giorni e si sceglie la migliore.
//  - vincoli: mai due sedute impegnative (lungo, ritmo/fartlek, gara) in giorni di fila, anche a cavallo
//    tra due settimane; nelle prime due fasi mai 3 giorni di corsa di fila
//  - punti: giorni preferiti dall'utente, lungo e gara nel weekend, giorni non attaccati, stessi giorni della
//    settimana prima, e nei giorni gia' passati la seduta va dove hai corso davvero (quella saltata si
//    sposta sui giorni che restano)
// ===========================================================================
const FREQUENZA = { '5k': [3, 3, 3, 3], '10k': [3, 3, 4, 4], mezza: [3, 3, 4, 4], maratona: [3, 4, 4, 5, 4] };
const FREQ_MAX = { '5k': 4, '10k': 4, mezza: 5, maratona: 5 };
const ACWR_MAX = 1.3;
const ruoloSeduta = (d) => (d[0] === 'lungo' ? 'L' : d[0] === 'gara' ? 'G' : d[0] === 'ritmo' || d[0] === 'fartlek' || d[0] === '4x4' ? 'Q' : 'E');
const sedutaDura = (d) => ruoloSeduta(d) !== 'E';

// sedute a settimana previste dall'obiettivo per questa settimana-piano (il tetto: va comunque guadagnato)
function frequenzaObiettivo(stepIdx) {
  const cod = OBIETTIVI[CONFIG.obiettivo] ? CONFIG.obiettivo : 'mezza';
  const st = pianoAttivo()[stepIdx];
  const f = faseDi(stepIdx + 1);
  if (!st || f.id === 1 || st.scarico || st.sedute.some((d) => d[0] === 'gara' || d[0] === 'cc')) return 3;
  let n = FREQUENZA[cod][f.id - 1] ?? 3;
  if (CONFIG.intensita === 'ambiziosa') n += 1;
  if (CONFIG.intensita === 'tranquilla') n -= 1;
  return Math.max(3, Math.min(FREQ_MAX[cod], n));
}

// seduta in più: corsa facile all'80% della prima corsa facile della settimana (minimo 20')
function descExtra(stepIdx, intensita) {
  const base = conIntensita(pianoAttivo()[stepIdx].sedute.find((d) => d[0] === 'facile') || fa(25), intensita);
  return ['facile', Math.max(20, Math.round((base[1] * 0.8) / 5) * 5), false];
}

// Giorni obbligatori: il coach usa solo quelli (oltre ai giorni passati in cui hai corso davvero)
const giorniFissi = () => (CONFIG.giorniModo === 'fissi' && Array.isArray(CONFIG.giorniSedute) && CONFIG.giorniSedute.length ? CONFIG.giorniSedute : null);
// con meno sedute di quelle del piano si tengono le piu' importanti: gara, lungo, qualita', poi le facili.
// turno: con 1 seduta a settimana la settimana del piano dura 2 settimane e la seconda propone l'altra seduta chiave
function sceltaSedute(descs, n, turno) {
  if (n >= descs.length) return descs.map((_, i) => i);
  const rango = { G: 0, L: 1, Q: 2, E: 3 };
  const ord = descs.map((d, i) => i).sort((x, y) => rango[ruoloSeduta(descs[x])] - rango[ruoloSeduta(descs[y])] || x - y);
  const k = turno % ord.length;
  return [...ord.slice(k), ...ord.slice(0, k)].slice(0, n).sort((x, y) => x - y);
}

// Consigli sui giorni scelti (profilo, anteprima e "il coach dice"): onesti, mai bloccanti
function consigliGiorni(giorni, modo, obiettivo) {
  const out = [];
  if (!Array.isArray(giorni) || !giorni.length) return out;
  const set = new Set(giorni), k = giorni.length;
  const nomeG = (g) => (LINGUA === 'en' ? GIORNI_EN : GIORNI)[g];
  const diFila = (g) => set.has((g + 1) % 7);
  const fila3 = giorni.some((g) => set.has((g + 1) % 7) && set.has((g + 2) % 7));
  const nomeOb = P((OBIETTIVI[obiettivo] || OBIETTIVI.mezza).nome);
  if (modo === 'fissi') {
    if (k === 1) out.push(L(`Un solo giorno (${nomeG(giorni[0])}): ogni settimana del piano durerà 2 settimane, quindi l’obiettivo slitta. Non è l’ideale, il corpo si adatta meglio con 2–3 uscite, ma ci proviamo. Se riesci, a metà settimana fai 30′ di camminata veloce: non conta per il piano ma aiuta tendini e fiato.`,
      `A single day (${nomeG(giorni[0])}): each plan week will last 2 weeks, so your goal moves later. Not ideal, the body adapts better with 2–3 outings, but let’s try. If you can, add a 30′ brisk walk midweek: it does not count for the plan but helps tendons and breathing.`));
    if (k === 2 && giorni.some(diFila)) out.push(L('Due giorni di fila: il primo è per la seduta chiave, il secondo è sempre facile (la qualità diventa corsa facile). Poi tanti giorni di riposo: se puoi, distanziali.',
      'Two days in a row: the first is for the key session, the second is always easy (quality becomes an easy run). Then many rest days: spread them out if you can.'));
    else if (k === 2) out.push(L('Due giorni: il piano non si allunga, ma salta una corsa facile a settimana. Tieni il ritmo davvero da conversazione.', 'Two days: the plan does not get longer, but skips one easy run a week. Keep the pace truly conversational.'));
    if (k <= 2 && (obiettivo === 'mezza' || obiettivo === 'maratona')) out.push(L(`Per ${nomeOb === 'Maratona' ? 'la maratona' : 'la mezza'} nelle fasi finali servono almeno 3 uscite a settimana: con ${k} ${k === 1 ? 'giorno' : 'giorni'} valuta 10 km o 5 km, oppure aggiungi un giorno più avanti.`,
      `For the ${obiettivo === 'maratona' ? 'marathon' : 'half marathon'} the final phases need at least 3 runs a week: with ${k} day${k === 1 ? '' : 's'} consider 10K or 5K, or add a day later on.`));
    if (k === 3 || k === 4) out.push(L('Con giorni fissi la 4ª e 5ª seduta arrivano solo se ci sono giorni liberi: il coach non ne aggiunge altri.', 'With fixed days the 4th and 5th session only come if there are free days: the coach adds no others.'));
  }
  if (fila3) out.push(L('Tre giorni di corsa di fila affaticano gambe e tendini, soprattutto all’inizio: se puoi, lascia un giorno di riposo in mezzo.', 'Three running days in a row tire legs and tendons, especially at first: leave a rest day in between if you can.'));
  return out;
}

// Sceglie i giorni delle sedute di una settimana. sedute = descrittori nell'ordine del piano.
// Restituisce [{ off, i }] (off = giorno 0-6 dall'inizio del blocco, i = indice nella lista sedute).
function scegliGiorni(sedute, c) {
  const n = sedute.length;
  const dure = sedute.map((d, i) => (sedutaDura(d) ? i : -1)).filter((i) => i >= 0);
  const facili = sedute.map((d, i) => (sedutaDura(d) ? -1 : i)).filter((i) => i >= 0);
  const dataDi = (off) => addDays(c.da, off);
  const dowDi = (off) => new Date(dayMs(dataDi(off))).getUTCDay();
  // giorni possibili: con giorni obbligatori solo quelli, piu' i giorni passati in cui hai corso davvero
  const ammesso = (off) => !c.fissi || c.fissi.has(dowDi(off)) || (dataDi(off) <= c.oggi && c.giorniCorsa.has(dataDi(off)));
  let migliore = null;
  const valuta = (giorni, mappa) => {
    // mappa[k] = indice della seduta nel giorno giorni[k]
    const dura = new Set(), corsa = new Set(giorni.map(dataDi));
    giorni.forEach((g, k) => { if (sedutaDura(sedute[mappa[k]])) dura.add(dataDi(g)); });
    let p = 0;
    // vincoli: con c.rilassa (giorni obbligatori senza alternative) diventano penalita'
    for (const d of dura) if (dura.has(addDays(d, -1)) || c.precDure.has(addDays(d, -1))) { if (!c.rilassa) return null; p -= 8; }
    for (const d of corsa) {
      const ieri = corsa.has(addDays(d, -1)) || c.precCorsa.has(addDays(d, -1));
      const altroieri = corsa.has(addDays(d, -2)) || c.precCorsa.has(addDays(d, -2));
      if (ieri) p -= 1;
      if (ieri && altroieri) { if (c.maxFila2 && !c.rilassa) return null; p -= 2; }
    }
    // settimana della gara: meglio la corsa facile prima e la camminata di recupero dopo
    const kGara = giorni.findIndex((_, k) => sedute[mappa[k]][0] === 'gara');
    if (kGara >= 0) giorni.forEach((_, k) => {
      const t = sedute[mappa[k]][0];
      if (t === 'recupero' && k > kGara) p += 3;
      if (t === 'facile' && k < kGara) p += 2;
    });
    giorni.forEach((g, k) => {
      const d = dataDi(g), dow = dowDi(g), sed = sedute[mappa[k]];
      if (c.preferiti.has(dow) && sed[0] !== 'gara') p += 4; // la gara non segue le preferenze: e' quasi sempre nel weekend
      if (sed[0] === 'lungo' && (dow === 0 || dow === 6)) p += 2;
      if (sed[0] === 'gara' && (dow === 0 || dow === 6)) p += 8;
      if (c.precDow.has(dow)) p += 0.5;
      if (d < c.oggi) p += c.giorniCorsa.has(d) ? 5 : -6;
      else if (d === c.oggi && c.giorniCorsa.has(d)) p += 5;
    });
    return p;
  };
  const combina = (da, scelti) => {
    if (scelti.length === n) {
      // posti delle sedute impegnative (in ogni ordine), le facili nei giorni rimasti nell'ordine del piano
      const posti = (rest, usati) => {
        if (!rest.length) {
          const mappa = new Array(n);
          usati.forEach((k, j) => { mappa[k] = dure[j]; });
          let f = 0;
          for (let k = 0; k < n; k++) if (mappa[k] == null) mappa[k] = facili[f++];
          const p = valuta(scelti, mappa);
          if (p != null && (!migliore || p > migliore.p)) migliore = { p, giorni: scelti.slice(), mappa };
          return;
        }
        for (let k = 0; k < n; k++) if (!usati.includes(k)) posti(rest.slice(1), [...usati, k]);
      };
      posti(dure, []);
      return;
    }
    for (let g = da; g <= 6; g++) if (ammesso(g)) combina(g + 1, [...scelti, g]);
  };
  combina(0, []);
  if (!migliore) return null; // nessuna combinazione valida: decide chi chiama (qualita' -> facile, poi vincoli rilassati)
  return migliore.giorni.map((off, k) => ({ off, i: migliore.mappa[k] }));
}

// ---------------------------------------------------------------------------
// Piani per obiettivo. Ripartenza (sett. 1-8) e Base aerobica (9-16) sono comuni; poi ogni distanza ha i suoi lavori.
// Ritmi: 'medio' = sforzo 6/10; 'gara' = ritmo dell'obiettivo (5 km, 10 km, maratona); 'mezza' = ritmo mezza.
// ---------------------------------------------------------------------------
const RIPARTENZA = PIANO_MEZZA.slice(0, 8);
const BASE_AEROBICA = PIANO_MEZZA.slice(8, 16);
const nGara = (it, en) => [it, en];
const settGara = (nota) => ({ sedute: [fa(20, true), ['gara'], ['recupero', 30]], nota });

const PIANO_5K = [
  ...RIPARTENZA,
  // ---- Base aerobica (corta) ----
  { sedute: [fa(25), lu(28), fa(25)], nota: ['Da qui arriva il lungo, anche per il 5 km: costruisce la resistenza che ti serve in gara.', 'From now on there is a long run, even for the 5K: it builds the endurance you need on race day.'] },
  { sedute: [fa(25), lu(32), fa(25, true)], nota: ['Allunghi: 4 accelerazioni da 20" a fine corsa. Preparano le gambe ai lavori veloci.', 'Strides: 4 × 20" accelerations at the end of the run. They prepare your legs for faster work.'] },
  { sedute: [fa(28), lu(36), ['fartlek', 6, 1, 2]], nota: ['Primo fartlek: 1 minuto brillante (sforzo 7/10) e 2 facili. Divertiti, non è una gara.', 'First fartlek: 1 minute lively (effort 7/10) and 2 easy. Have fun, it is not a race.'] },
  { sedute: [fa(25), lu(30), fa(25, true)], scarico: true, nota: ['Settimana di scarico prima dei lavori di velocità.', 'Recovery week before the speed work.'] },
  // ---- Velocità ----
  { sedute: [fa(30), lu(38), ['ritmo', 6, 2, 2, 'gara']], nota: ['Prime frazioni a ritmo 5 km: il passo che pensi di tenere per tutta la gara, sforzo 8/10. Recupera trotterellando.', 'First reps at 5K pace: the pace you think you could hold for the whole race, effort 8/10. Jog to recover.'] },
  { sedute: [fa(30), lu(42), nv(4)], nota: ['4×4 norvegese: 4 blocchi da 4′ forti (sforzo 8–9/10) con 3′ di corsetta. Per il 5 km è oro: alza il VO₂max.', 'Norwegian 4×4: four 4′ hard blocks (effort 8–9/10) with 3′ jogging. Gold for the 5K: it raises VO₂max.'] },
  { sedute: [fa(28), lu(35), ['ritmo', 3, 4, 2, 'gara']], scarico: true, nota: ['Meno volume, un po’ di ritmo: arrivi fresco alla gara.', 'Less volume, a little pace work: you arrive fresh on race day.'] },
  settGara(['Settimana della gara: 5 km. Riscaldati bene, parti controllato e accelera nell’ultimo chilometro.', 'Race week: 5K. Warm up well, start controlled and speed up in the last kilometre.']),
];

const PIANO_10K = [
  ...RIPARTENZA,
  ...BASE_AEROBICA,
  // ---- Costruzione ----
  { sedute: [fa(35), lu(55), nv(4)], nota: ['4×4 norvegese: 4 blocchi da 4′ forti (sforzo 8–9/10) con 3′ di corsetta. È il lavoro che più alza il VO₂max.', 'Norwegian 4×4: four 4′ hard blocks (effort 8–9/10) with 3′ jogging. It is the workout that raises VO₂max the most.'] },
  { sedute: [fa(40), lu(60), ['ritmo', 4, 5, 2, 'gara']], nota: ['Ritmo 10 km = il passo che pensi di tenere per tutta la gara, sforzo 7–8/10.', '10K pace = the pace you think you could hold for the whole race, effort 7–8/10.'] },
  { sedute: [fa(40), lu(65), ['ritmo', 3, 8, 2, 'gara']], nota: ['Frazioni più lunghe a ritmo 10 km: l’ultima deve essere come la prima.', 'Longer reps at 10K pace: the last should feel like the first.'] },
  { sedute: [fa(40), lu(70), ['ritmo', 2, 12, 3, 'gara']], nota: ['Lungo di 70 minuti e due blocchi da 12′ a ritmo gara: sei pronto per i 10 km.', '70-minute long run and two 12′ blocks at race pace: you are ready for the 10K.'] },
  // ---- Scarico e gara ----
  { sedute: [fa(30), lu(45), ['ritmo', 3, 5, 2, 'gara']], scarico: true, nota: ['Scarico pre-gara: meno volume, mantieni un po’ di ritmo per restare brillante.', 'Pre-race taper: less volume, keep a little pace work to stay sharp.'] },
  settGara(['Settimana della gara: 10 km. Parti più piano di quanto ti venga naturale e chiudi in crescendo.', 'Race week: 10K. Start slower than feels natural and finish strong.']),
];

const COSTRUZIONE_M = PIANO_MEZZA.slice(16, 22).map((w) => ({ ...w, sedute: w.sedute.map((d) => (d[0] === 'ritmo' && d[4] === 'mezza' ? [...d.slice(0, 4), 'medio'] : d)) }));
const PIANO_MARATONA = [
  ...RIPARTENZA,
  ...BASE_AEROBICA,
  ...COSTRUZIONE_M,
  // ---- Maratona ----
  { sedute: [fa(45), lu(105), ['ritmo', 2, 15, 3, 'gara']], nota: ['Ritmo maratona = il passo che potresti tenere per ore, sforzo 5–6/10. Impara a riconoscerlo.', 'Marathon pace = the pace you could hold for hours, effort 5–6/10. Learn to recognise it.'] },
  { sedute: [fa(45), lu(115), fa(40, true)], nota: ['Lungo di quasi 2 ore: prova gel e bevande che userai in gara.', 'Almost 2-hour long run: test the gels and drinks you will use on race day.'] },
  { sedute: [fa(50), lu(125), ['ritmo', 3, 15, 3, 'gara']], nota: ['Bevi qualche sorso ogni 15–20 minuti anche se non hai sete.', 'Take a few sips every 15–20 minutes even if you are not thirsty.'] },
  { sedute: [fa(40), lu(90), fa(35, true)], scarico: true, nota: ['Scarico: il corpo si rinforza nei giorni leggeri.', 'Recovery: your body gets stronger on easy days.'] },
  { sedute: [fa(50), lu(135), ['ritmo', 2, 20, 4, 'gara']], nota: ['Oltre le 2 ore: parti molto piano, la seconda metà deve sembrare facile quanto la prima.', 'Beyond 2 hours: start very slowly, the second half should feel as easy as the first.'] },
  { sedute: [fa(55), lu(145), fa(45, true)], nota: ['Prova l’equipaggiamento della gara: scarpe, calze, maglia, rifornimento.', 'Test your race kit: shoes, socks, shirt, fuelling.'] },
  { sedute: [fa(55), lu(155), ['ritmo', 3, 20, 4, 'gara']], nota: ['Dormi bene in questi giorni: è lì che assorbi il lavoro.', 'Sleep well these days: that is when you absorb the work.'] },
  { sedute: [fa(45), lu(100), fa(40, true)], scarico: true, nota: ['Scarico prima dei lunghi più importanti.', 'Recovery week before the key long runs.'] },
  { sedute: [fa(55), lu(165), ['ritmo', 2, 30, 5, 'gara']], nota: ['Due blocchi da 30′ a ritmo maratona: la prova generale del passo gara.', 'Two 30′ blocks at marathon pace: the dress rehearsal of race pace.'] },
  { sedute: [fa(60), lu(180), fa(45, true)], nota: ['Picco del piano: il lungo di 3 ore. Dopo questo sei pronto.', 'Peak of the plan: the 3-hour long run. After this you are ready.'] },
  { sedute: [fa(50), lu(150), ['ritmo', 3, 20, 4, 'gara']], nota: ['Ultimo lungo impegnativo prima dello scarico.', 'Last demanding long run before the taper.'] },
  // ---- Scarico e gara ----
  { sedute: [fa(45), lu(120), ['ritmo', 2, 15, 3, 'gara']], scarico: true, nota: ['Inizia lo scarico: meno volume, stessa qualità.', 'Taper begins: less volume, same quality.'] },
  { sedute: [fa(40), lu(80), ['ritmo', 2, 10, 3, 'gara']], scarico: true, nota: ['Ultima settimana prima della gara: tante ore di sonno e carboidrati negli ultimi 3 giorni.', 'Last week before the race: plenty of sleep and carbs in the last 3 days.'] },
  settGara(['Settimana della gara: maratona. Parti piano, bevi e mangia a ogni ristoro, la gara inizia dopo il 30° km.', 'Race week: marathon. Start slowly, drink and eat at every aid station, the race starts after km 30.']),
];

const fase = (id, da, a, nome, obiettivo) => ({ id, da, a, nome, obiettivo });
const F_RIP = fase(1, 1, 8, ['Ripartenza', 'Restart'], ['Da zero a 20–25 minuti di corsa continua', 'From zero to 20–25 minutes of continuous running']);
const F_BASE = fase(2, 9, 16, ['Base aerobica', 'Aerobic base'], ['Correre 45–50 minuti senza fermarsi', 'Run 45–50 minutes without stopping']);
const OBIETTIVI = {
  '5k': {
    km: 5, nome: ['5 km', '5K'], ritmo: ['ritmo 5 km', '5K pace'], titoloRitmo: ['Ritmo 5 km', '5K pace'], mesi: [4, 8],
    fcGara: 0.9, zonaGara: [0.92, 0.97], deriva: 1, durataGara: 40, stimaGara: ['circa 30–40 minuti', 'about 30–40 minutes'],
    notaGara: ['Riscaldati bene: 10′ di corsetta e qualche allungo. Parti controllato, nel primo km è facile esagerare.', 'Warm up well: 10′ easy jog and a few strides. Start controlled: it is easy to overdo the first km.'],
    piano: PIANO_5K,
    fasi: [F_RIP, fase(2, 9, 12, ['Base aerobica', 'Aerobic base'], ['Correre 35–40 minuti senza fermarsi', 'Run 35–40 minutes without stopping']),
      fase(3, 13, 15, ['Velocità', 'Speed'], ['Frazioni a ritmo 5 km', 'Reps at 5K pace']), fase(4, 16, 16, ['5 km', '5K'], ['La gara', 'The race'])],
  },
  '10k': {
    km: 10, nome: ['10 km', '10K'], ritmo: ['ritmo 10 km', '10K pace'], titoloRitmo: ['Ritmo 10 km', '10K pace'], mesi: [6, 12],
    fcGara: 0.86, zonaGara: [0.89, 0.94], deriva: 0.98, durataGara: 75, stimaGara: ['circa 60–75 minuti', 'about 60–75 minutes'],
    notaGara: ['Parti più piano di quanto ti venga naturale: la seconda metà è quella che conta.', 'Start slower than feels natural: the second half is what counts.'],
    piano: PIANO_10K,
    fasi: [F_RIP, F_BASE, fase(3, 17, 20, ['Costruzione', 'Build'], ['Lungo fino a 70 minuti e frazioni a ritmo 10 km', 'Long run up to 70 minutes and reps at 10K pace']),
      fase(4, 21, 22, ['10 km', '10K'], ['Scarico e gara', 'Taper and race'])],
  },
  mezza: {
    km: 21.0975, nome: ['Mezza maratona', 'Half marathon'], ritmo: ['ritmo mezza', 'half-marathon pace'], titoloRitmo: ['Ritmo mezza maratona', 'Half-marathon pace'], mesi: [6, 12],
    fcGara: 0.8, zonaGara: [0.85, 0.9], deriva: 0.96, durataGara: 150, stimaGara: ['circa 2h20–2h35', 'about 2h20–2h35'],
    notaGara: ['Parti più lento di quanto ti venga naturale: i primi 5 km devono sembrare facilissimi. Bevi a ogni ristoro. Goditela.', 'Start slower than feels natural: the first 5 km should feel very easy. Drink at every aid station. Enjoy it.'],
    piano: PIANO_MEZZA,
    fasi: [F_RIP, F_BASE, fase(3, 17, 22, ['Costruzione', 'Build'], ['Lungo fino a 1h35 e primi lavori a ritmo gara', 'Long run up to 1h35 and first race-pace work']),
      fase(4, 23, 26, ['Mezza maratona', 'Half marathon'], ['Picco del lungo, scarico e gara', 'Peak long run, taper and race'])],
  },
  maratona: {
    km: 42.195, nome: ['Maratona', 'Marathon'], ritmo: ['ritmo maratona', 'marathon pace'], titoloRitmo: ['Ritmo maratona', 'Marathon pace'], mesi: [9, 15],
    fcGara: 0.76, zonaGara: [0.8, 0.86], deriva: 0.93, durataGara: 300, stimaGara: ['circa 4h30–5h30', 'about 4h30–5h30'],
    notaGara: ['Parti piano: la maratona inizia al 30° km. Bevi e mangia a ogni ristoro, anche se non ne senti il bisogno.', 'Start slowly: the marathon starts at km 30. Drink and eat at every aid station, even if you do not feel the need.'],
    piano: PIANO_MARATONA,
    fasi: [F_RIP, F_BASE, fase(3, 17, 22, ['Costruzione', 'Build'], ['Lungo fino a 1h35 e lavori a ritmo medio', 'Long run up to 1h35 and steady-pace work']),
      fase(4, 23, 33, ['Maratona', 'Marathon'], ['Lunghi fino a 3 ore e ritmo maratona', 'Long runs up to 3 hours and marathon pace']),
      fase(5, 34, 36, ['Scarico e gara', 'Taper and race'], ['Meno volume, stessa qualità, poi la gara', 'Less volume, same quality, then the race'])],
  },
};
const OBIETTIVI_VALIDI = Object.keys(OBIETTIVI);
const obiettivoCorrente = () => OBIETTIVI[CONFIG.obiettivo] || OBIETTIVI.mezza;
const pianoAttivo = () => obiettivoCorrente().piano;

// ---------------------------------------------------------------------------
// Intensità: scelta dall'utente e regolata dal coach (un gradino di ±10% al massimo, ogni 3 settimane al più).
// Agisce sulla durata di corse facili e lunghi e sul numero di ripetute; la fase corsa-cammino non cambia.
// ---------------------------------------------------------------------------
const INTENSITA = {
  tranquilla: { mult: 0.85, rep: -1, nome: ['Tranquilla', 'Easy-going'] },
  equilibrata: { mult: 1, rep: 0, nome: ['Equilibrata', 'Balanced'] },
  ambiziosa: { mult: 1.15, rep: 1, nome: ['Ambiziosa', 'Ambitious'] },
};
const PASSO_AUTO = 0.1;
const intensitaScelta = () => INTENSITA[CONFIG.intensita] || INTENSITA.equilibrata;
function conIntensita(d, it) {
  if (!it || (it.mult === 1 && !it.rep)) return d;
  const [t, a] = d;
  const r5 = (m) => Math.max(15, Math.round((m * it.mult) / 5) * 5);
  if (t === 'facile') return ['facile', r5(a), d[2]];
  if (t === 'lungo') return ['lungo', r5(a)];
  if ((t === 'fartlek' || t === 'ritmo') && it.rep) return [t, Math.max(2, a + it.rep), ...d.slice(2)];
  if (t === '4x4' && it.rep) return [t, Math.min(4, Math.max(3, a + it.rep)), ...d.slice(2)]; // il protocollo resta 3–4 blocchi
  return d;
}

const fcFacile = () => sottoZona(3); // Z2 o meno (< 70% FC max)
const fcQualita = () => zonaRange(4); // Z4 (80-90% FC max)
const ripeti = (n, f) => Array.from({ length: n }).flatMap(f);

function specSeduta(d) {
  const [tipo, a, b, c, e] = d;
  const base = { riscaldamento: 5, defaticamento: 5, fc: fcFacile(), nota: null };
  const facile = L('facile', 'easy');
  switch (tipo) {
    case 'cc':
      return { ...base, fc: fcCorsaCammino(), tipo: 'corsa-cammino', titolo: L('Corsa e cammino', 'Run-walk'),
        blocchi: L(`${a} × (${b}' corsa lenta + ${c}' camminata)`, `${a} × (${b}' slow run + ${c}' walk)`),
        lavoro: a * (b + c), corsa: a * b, segmenti: ripeti(a, () => [{ tipo: 'run', min: b }, { tipo: 'walk', min: c }]) };
    case 'facile':
      return { ...base, tipo: 'facile', titolo: b ? L('Corsa facile + allunghi', 'Easy run + strides') : L('Corsa facile', 'Easy run'),
        blocchi: L(`${a}' di corsa facile${b ? ' + 4 allunghi da 20"' : ''}`, `${a}' easy run${b ? ' + 4 × 20" strides' : ''}`),
        lavoro: a, corsa: a, segmenti: [{ tipo: 'run', min: a }] };
    case 'lungo':
      return { ...base, tipo: 'lungo', titolo: L('Lungo', 'Long run'), blocchi: L(`${a}' di corsa lenta e costante`, `${a}' of slow, steady running`),
        lavoro: a, corsa: a, segmenti: [{ tipo: 'run', min: a }] };
    case 'fartlek': {
      const lavoro = 10 + a * (b + c) + 5;
      return { ...base, tipo: 'qualita', titolo: 'Fartlek', fc: fcQualita(),
        blocchi: L(`10' facile + ${a} × (${b}' brillante + ${c}' facile) + 5' facile`, `10' easy + ${a} × (${b}' lively + ${c}' easy) + 5' easy`),
        lavoro, corsa: lavoro,
        segmenti: [{ tipo: 'run', min: 10 }, ...ripeti(a, () => [{ tipo: 'fast', min: b }, { tipo: 'run', min: c }]), { tipo: 'run', min: 5 }] };
    }
    case '4x4': {
      const lavoro = 10 + a * b + (a - 1) * c + 5;
      return { ...base, tipo: 'qualita', titolo: L('4×4 norvegese', 'Norwegian 4×4'), fc: `${Math.round(CONFIG.fcMax * 0.85)}–${Math.round(CONFIG.fcMax * 0.95)}`,
        blocchi: L(`10' facile + ${a} × ${b}' forte (85–95% FC max) con ${c}' di corsetta + 5' facile`, `10' easy + ${a} × ${b}' hard (85–95% max HR) with ${c}' jog + 5' easy`),
        lavoro, corsa: lavoro,
        segmenti: [{ tipo: 'run', min: 10 }, ...ripeti(a, (_, k) => (k < a - 1 ? [{ tipo: 'fast', min: b }, { tipo: 'run', min: c }] : [{ tipo: 'fast', min: b }])), { tipo: 'run', min: 5 }],
        nota: L('Forte = sforzo 8–9/10: respiro pesante, poche parole. Nei 3′ di recupero continua a corricchiare piano. Se all’ultimo blocco non riesci più a tenere lo sforzo, fermati lì: conta la qualità, non il numero.', 'Hard = effort 8–9/10: heavy breathing, few words. Keep jogging slowly in the 3′ recoveries. If you can no longer hold the effort in the last block, stop there: quality counts, not the number.') };
    }
    case 'ritmo': {
      const lavoro = 10 + a * (b + c) + 5;
      const og = obiettivoCorrente();
      const veloce = e === 'mezza' || e === 'gara';
      const etichetta = e === 'mezza' ? L('ritmo mezza', 'half-marathon pace') : e === 'gara' ? P(og.ritmo) : L('ritmo medio', 'steady pace');
      const titoloR = e === 'mezza' ? L('Ritmo mezza maratona', 'Half-marathon pace') : e === 'gara' ? P(og.titoloRitmo) : L('Ritmo medio', 'Steady pace');
      const zg = e === 'mezza' ? OBIETTIVI.mezza.zonaGara : og.zonaGara;
      return { ...base, tipo: 'qualita', titolo: titoloR, fc: veloce ? `${Math.round(CONFIG.fcMax * zg[0])}–${Math.round(CONFIG.fcMax * zg[1])}` : fcQualita(),
        blocchi: L(`10' ${facile} + ${a} × (${b}' a ${etichetta} + ${c}' ${facile}) + 5' ${facile}`, `10' easy + ${a} × (${b}' at ${etichetta} + ${c}' easy) + 5' easy`),
        lavoro, corsa: lavoro,
        segmenti: [{ tipo: 'run', min: 10 }, ...ripeti(a, () => [{ tipo: 'fast', min: b }, { tipo: 'run', min: c }]), { tipo: 'run', min: 5 }] };
    }
    case 'gara': {
      const og = obiettivoCorrente();
      const kmTxt = String(round(og.km, 1)).replace('.', LINGUA === 'en' ? '.' : ',');
      return { ...base, riscaldamento: 10, defaticamento: 10, tipo: 'gara', titolo: '🏁 ' + P(og.nome), fc: `${Math.round(CONFIG.fcMax * og.zonaGara[0])}–${Math.round(CONFIG.fcMax * og.zonaGara[1])}`,
        blocchi: L(`${kmTxt} km a ritmo costante (${og.stimaGara[0]})`, `${kmTxt} km at a steady pace (${og.stimaGara[1]})`),
        lavoro: og.durataGara, corsa: og.durataGara, segmenti: [{ tipo: 'run', min: og.durataGara }],
        nota: P(og.notaGara) };
    }
    case 'recupero':
    default:
      return { ...base, riscaldamento: 0, defaticamento: 0, tipo: 'recupero', titolo: L('Camminata di recupero', 'Recovery walk'),
        blocchi: L(`${a || 30}' di camminata tranquilla`, `${a || 30}' easy walk`), lavoro: a || 30, corsa: 0, segmenti: [{ tipo: 'walk', min: a || 30 }] };
  }
}

// Versione ridotta di una seduta quando i dati dicono che non sei recuperato
function riduci(d) {
  const [tipo, a, b, c] = d;
  if (tipo === 'cc') return cc(Math.max(2, Math.ceil(a * 0.6)), b, c);
  if (tipo === 'facile' || tipo === 'lungo') return fa(Math.max(15, Math.round((a * 0.6) / 5) * 5));
  if (tipo === 'fartlek' || tipo === 'ritmo' || tipo === '4x4') return fa(25);
  return d;
}

function sedutaDa(stepIdx, sIdx, data, override, intensita) {
  const st = pianoAttivo()[stepIdx];
  const desc = override || conIntensita(st.sedute[sIdx], intensita);
  const sp = specSeduta(desc);
  const fase = faseDi(stepIdx + 1);
  const riscText = sp.tipo === 'gara'
    ? L('Camminata + qualche minuto di corsetta leggerissima', 'Walk + a few minutes of very light jogging')
    : L('Camminata a passo svelto, braccia sciolte', 'Brisk walk, relaxed arms');
  return {
    settimana: stepIdx + 1,
    seduta: sIdx + 1,
    data,
    giorno: giornoSettimana(data),
    fase: fase.nome,
    fase_id: fase.id,
    scarico: Boolean(st.scarico),
    tipo: sp.tipo,
    titolo: `${L('Sett.', 'Wk')} ${stepIdx + 1} · ${sp.titolo}`,
    blocchi: sp.blocchi,
    durata_min: sp.riscaldamento + sp.lavoro + sp.defaticamento,
    corsa_min: sp.corsa,
    segmenti: [
      ...(sp.riscaldamento ? [{ tipo: 'walk', min: sp.riscaldamento }] : []),
      ...sp.segmenti,
      ...(sp.defaticamento ? [{ tipo: 'cool', min: sp.defaticamento }] : []),
    ],
    struttura: [
      sp.riscaldamento ? { fase: L('Riscaldamento', 'Warm-up'), min: sp.riscaldamento, testo: riscText } : null,
      { fase: sp.tipo === 'recupero' ? L('Recupero', 'Recovery') : L('Lavoro', 'Main set'), min: sp.lavoro, testo: sp.blocchi },
      sp.defaticamento ? { fase: L('Defaticamento', 'Cool-down'), min: sp.defaticamento, testo: L('Camminata tranquilla + 5\' di allungamento polpacci, quadricipiti, flessori', 'Easy walk + 5\' stretching calves, quads, hip flexors') } : null,
    ].filter(Boolean),
    fc_target: sp.fc,
    nota: sp.nota || P(st.nota),
  };
}

// ---------------------------------------------------------------------------
// Dati per l'adattamento
// ---------------------------------------------------------------------------
function datiAdattamento(inizio, oggiStr) {
  const corse = db
    .prepare("SELECT id, data, tempo, distanza, fc_media, rpe FROM attivita WHERE origine = 'intervals' AND data >= ? AND data <= ?")
    .all(inizio, oggiStr);
  const camminate = db
    .prepare("SELECT data FROM altre_attivita WHERE tipo IN ('Walk', 'Hike') AND durata >= 900 AND data >= ? AND data <= ?")
    .all(inizio, oggiStr);
  const manuali = db.prepare('SELECT data FROM sedute_manuali WHERE data >= ?').all(inizio);
  const benessere = new Map(
    db.prepare('SELECT * FROM benessere WHERE data >= ? AND data <= ?').all(addDays(inizio, -35), oggiStr).map((r) => [r.data, r])
  );
  const serie = corse.length ? costruisciSerieGiornaliera(oggiStr, false) : [];
  return {
    corse,
    // AAC e' un'app di corsa: per l'algoritmo (avanzare, ripetere, tornare indietro) contano solo le corse
    // e le sedute segnate a mano come fatte. Le camminate valgono solo per le sedute "Camminata di recupero".
    giorniCorsa: new Set([...corse, ...manuali].map((r) => r.data)),
    giorniCamminata: new Set(camminate.map((r) => r.data)),
    manuali: new Set(manuali.map((r) => r.data)),
    benessere,
    tsb: new Map(serie.map((p) => [p.data, p.tsb])),
    acwr: new Map(serie.filter((p) => p.ctl >= 5).map((p) => [p.data, p.atl / p.ctl])), // carico acuto / cronico
  };
}

// Collegamento: avviso se le ultime attivita' arrivano solo da Strava (Intervals non le passa ad altre app)
function statoCollegamento(oggiStr) {
  let s = null;
  try { s = JSON.parse(getMeta('strava_bloccate') || 'null'); } catch (_) { s = null; }
  const diretta = db.prepare("SELECT MAX(data) AS m FROM attivita WHERE origine = 'intervals'").get().m || null;
  if (!s || !s.ultima || stravaCollegato()) return { strava_ultima: null, ultima_diretta: diretta, avviso: false };
  return { strava_ultima: s.ultima, ultima_diretta: diretta, avviso: diffDays(oggiStr, s.ultima) <= 30 && (!diretta || s.ultima > diretta) };
}

/**
 * Carico e infortuni: tre segnali con soglie dichiarate.
 *  - ACWR (ATL/CTL): 0,8–1,3 zona sicura; > 1,3 attenzione; > 1,5 alto (la prossima seduta viene alleggerita).
 *  - km degli ultimi 7 giorni oltre +30% sulla media delle 4 settimane prima (e almeno +5 km).
 *  - corsa singola oltre il 110% della piu' lunga dei 30 giorni prima (Frandsen et al., BJSM 2025); oltre il 130% = alto.
 *    Le corse dello stesso giorno si sommano (uscita interrotta o doppia seduta): e' il carico di quel giorno che conta.
 * Il limite consigliato per il prossimo lungo e' il 110% della corsa piu' lunga degli ultimi 30 giorni.
 */
const CARICO = { acwrAttenzione: 1.3, acwrAlto: 1.5, aumentoKm: 0.3, aumentoKmMin: 5, salto: 1.1, saltoAlto: 1.3 };
function valutaCarico(oggiStr, acwrMappa) {
  const corse = db
    // per giorno: piu' corse nello stesso giorno (es. orologio interrotto) contano come un'unica uscita
    .prepare("SELECT data, SUM(distanza) AS distanza, COUNT(*) AS n FROM attivita WHERE origine = 'intervals' AND data >= ? AND data <= ? AND distanza > 0 GROUP BY data ORDER BY data ASC")
    .all(addDays(oggiStr, -64), oggiStr);
  const km = (da, a) => corse.filter((c) => c.data >= da && c.data <= a).reduce((t, c) => t + c.distanza, 0);
  const segnali = [];
  let livello = 'ok';
  const alza = (l) => { if (l === 'alto' || (l === 'attenzione' && livello === 'ok')) livello = l; };

  let acwr = null;
  for (let d = oggiStr, i = 0; i < 3 && acwr == null; i++, d = addDays(d, -1)) acwr = acwrMappa && acwrMappa.has(d) ? acwrMappa.get(d) : null;
  if (acwr != null) {
    if (acwr > CARICO.acwrAlto) { alza('alto'); segnali.push(L(`carico degli ultimi 7 giorni ${it1(acwr)} volte quello abituale (sicuro fino a 1,3)`, `last 7 days load ${round(acwr, 1)}× your usual (safe up to 1.3)`)); }
    else if (acwr > CARICO.acwrAttenzione) { alza('attenzione'); segnali.push(L(`carico in crescita rapida: ${it1(acwr)} volte quello abituale (sicuro fino a 1,3)`, `load rising fast: ${round(acwr, 1)}× your usual (safe up to 1.3)`)); }
  }

  const km7 = km(addDays(oggiStr, -6), oggiStr);
  const media = km(addDays(oggiStr, -34), addDays(oggiStr, -7)) / 4;
  const aumento = media >= 5 ? km7 / media - 1 : null;
  if (aumento != null && aumento > CARICO.aumentoKm && km7 - media >= CARICO.aumentoKmMin) {
    alza('attenzione');
    segnali.push(L(`${it1(km7)} km negli ultimi 7 giorni: +${Math.round(aumento * 100)}% sulla tua media (${it1(media)} km a settimana)`, `${round(km7, 1)} km in the last 7 days: +${Math.round(aumento * 100)}% over your average (${round(media, 1)} km a week)`));
  }

  // salto della corsa piu' lunga: ogni corsa degli ultimi 7 giorni contro la piu' lunga dei 30 giorni prima
  let salto = null;
  for (const c of corse.filter((x) => x.data >= addDays(oggiStr, -6))) {
    const prima = corse.filter((x) => x.data >= addDays(c.data, -30) && x.data < c.data);
    if (prima.length < 2) continue;
    const max = Math.max(...prima.map((x) => x.distanza));
    const r = c.distanza / max;
    if (r > CARICO.salto && c.distanza - max >= 1 && (!salto || r > salto.rapporto)) salto = { data: c.data, km: round(c.distanza, 1), precedente: round(max, 1), rapporto: round(r, 2), corse: c.n };
  }
  if (salto) {
    alza(salto.rapporto > CARICO.saltoAlto ? 'alto' : 'attenzione');
    const cosa = salto.corse > 1 ? L(`${salto.corse} corse del ${salto.data.slice(8)}/${salto.data.slice(5, 7)}, in tutto`, `${salto.corse} runs on ${salto.data.slice(5, 7)}/${salto.data.slice(8)}, in total`) : L(`corsa del ${salto.data.slice(8)}/${salto.data.slice(5, 7)} di`, `run on ${salto.data.slice(5, 7)}/${salto.data.slice(8)} of`);
    segnali.push(L(`${cosa} ${it1(salto.km)} km: +${Math.round((salto.rapporto - 1) * 100)}% sulla più lunga del mese prima (${it1(salto.precedente)} km)`, `${cosa} ${round(salto.km, 1)} km: +${Math.round((salto.rapporto - 1) * 100)}% over the longest of the month before (${round(salto.precedente, 1)} km)`));
  }

  const ult30 = corse.filter((x) => x.data >= addDays(oggiStr, -29));
  const lungoMax = ult30.length ? Math.max(...ult30.map((x) => x.distanza)) : null;
  return {
    livello,
    segnali,
    acwr: acwr != null ? round(acwr, 2) : null,
    km_7: round(km7, 1),
    media_settimanale: media > 0 ? round(media, 1) : null,
    aumento_pct: aumento != null ? Math.round(aumento * 100) : null,
    salto,
    lungo_max_30: lungoMax != null ? round(lungoMax, 1) : null,
    limite_lungo_km: lungoMax != null && lungoMax >= 3 ? round(lungoMax * CARICO.salto, 1) : null,
    soglie: CARICO,
  };
}

function mediaBase(benessere, campo, data) {
  const vals = [];
  for (let d = addDays(data, -28); d < data; d = addDays(d, 1)) {
    const r = benessere.get(d);
    if (r && r[campo] != null) vals.push(r[campo]);
  }
  return vals.length >= 5 ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
}

function segnaliRecupero(benessere, data) {
  const r = benessere.get(data);
  if (!r) return [];
  const out = [];
  const fcB = mediaBase(benessere, 'fc_riposo', data);
  const hrvB = mediaBase(benessere, 'hrv', data);
  if (r.fc_riposo != null && fcB != null && r.fc_riposo >= fcB + 5)
    out.push(L(`FC a riposo ${Math.round(r.fc_riposo)} bpm (+${Math.round(r.fc_riposo - fcB)} sulla tua media)`, `resting HR ${Math.round(r.fc_riposo)} bpm (+${Math.round(r.fc_riposo - fcB)} vs your average)`));
  if (r.hrv != null && hrvB != null && r.hrv <= hrvB * 0.85)
    out.push(L(`HRV ${Math.round(r.hrv)} ms (−${Math.round((1 - r.hrv / hrvB) * 100)}% sulla tua media)`, `HRV ${Math.round(r.hrv)} ms (−${Math.round((1 - r.hrv / hrvB) * 100)}% vs your average)`));
  if (r.sonno_sec != null && r.sonno_sec < 5.5 * 3600)
    out.push(L(`solo ${Math.floor(r.sonno_sec / 3600)}h ${String(Math.round((r.sonno_sec % 3600) / 60)).padStart(2, '0')}′ di sonno`, `only ${Math.floor(r.sonno_sec / 3600)}h ${String(Math.round((r.sonno_sec % 3600) / 60)).padStart(2, '0')}′ of sleep`));
  return out;
}

// ---------------------------------------------------------------------------
// Motore: storia delle settimane, proiezione e adattamento della prossima seduta
// ---------------------------------------------------------------------------
/**
 * Valutazione iniziale: dalle corse delle ultime settimane stima da quale settimana del piano partire
 * (chi corre gia' non deve rifare la fase corsa-cammino) e la FC massima vista nelle corse.
 */
// Si parte al massimo dalla settimana prima dell'ultima fase (gara/scarico) del piano scelto
const massimaSettimanaIniziale = () => { const fs = obiettivoCorrente().fasi; return fs[fs.length - 1].da - 1; };
// Corsa continua richiesta da ogni settimana (massimo progressivo): serve a stimare da dove partire
function sogliePiano() {
  const pi = pianoAttivo(), cap = massimaSettimanaIniziale();
  let max = 0;
  const cont = pi.slice(0, cap).map((w) => {
    for (const d of w.sedute) {
      const v = d[0] === 'cc' ? d[2] : d[0] === 'facile' || d[0] === 'lungo' ? d[1] : 0;
      if (v > max) max = v;
    }
    return max;
  });
  return cont.map((m, k) => [m, k + 1]).filter(([m]) => m >= 10).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
}
function valutaLivello(oggiStr) {
  const da = addDays(oggiStr, -56);
  const corse = db
    .prepare("SELECT data, tempo, distanza, fc_max, tempo_corsa, passo_medio FROM attivita WHERE origine = 'intervals' AND data >= ? AND data <= ?")
    .all(da, oggiStr);
  const fcMaxOss = db
    .prepare("SELECT MAX(fc_max) AS m FROM attivita WHERE origine = 'intervals' AND data >= ? AND fc_max BETWEEN 120 AND 220")
    .get(addDays(oggiStr, -365)).m;
  // corsa continua: quasi tutta di corsa (dai dati secondo per secondo) o, senza dettagli, a passo da corsa
  const continua = (r) => (r.tempo_corsa != null ? r.tempo_corsa / r.tempo >= 0.85 : r.passo_medio && r.passo_medio <= 510);
  const lungo = Math.round(Math.max(0, ...corse.filter(continua).map((r) => r.tempo / 60)));
  const recenti = corse.filter((r) => r.data >= addDays(oggiStr, -42));
  const perSett = recenti.length / 6;
  const kmSett = round(recenti.reduce((t, r) => t + (r.distanza || 0), 0) / 6, 1);

  // corsa continua piu' lunga -> settimana del piano con un lungo di pari durata (stima prudente)
  const SOGLIE = sogliePiano();
  let sett = 1;
  if (recenti.length >= 4 && perSett >= 1) for (const [min, s] of SOGLIE) if (lungo >= min) { sett = s; break; }
  if (perSett < 2 && sett > 8) sett = 8; // per la base aerobica servono almeno 2 uscite a settimana
  sett = Math.min(massimaSettimanaIniziale(), sett);

  const fase = faseDi(sett);
  const perSettTxt = String(round(perSett, 1)).replace('.', LINGUA === 'en' ? '.' : ',');
  const kmSettTxt = String(kmSett).replace('.', LINGUA === 'en' ? '.' : ',');
  const motivo = !corse.length
    ? L('Su Intervals.icu non vedo corse nelle ultime 8 settimane: raccontami tu come stai messo.', 'I see no runs on Intervals.icu in the last 8 weeks: tell me where you are.')
    : L(`Nelle ultime 6 settimane hai fatto ${recenti.length === 1 ? '1 corsa' : recenti.length + ' corse'} (${perSettTxt} a settimana, ${kmSettTxt} km a settimana); la corsa continua più lunga è di ${lungo}′.`,
        `In the last 6 weeks you did ${recenti.length === 1 ? '1 run' : recenti.length + ' runs'} (${perSettTxt} per week, ${kmSettTxt} km per week); your longest continuous run is ${lungo}′.`) +
      (sett === 1 ? L(' Conviene partire dalla settimana 1, con brevi tratti di corsa.', ' Best to start from week 1, with short running bouts.')
        : L(` Puoi saltare le prime ${sett - 1} settimane e partire da “${fase.nome}”.`, ` You can skip the first ${sett - 1} weeks and start from “${fase.nome}”.`));

  const oggiL = oggiStr;
  const settimane = pianoAttivo().slice(0, massimaSettimanaIniziale()).map((p, k) => {
    const sp = p.sedute.map((d) => specSeduta(d));
    const lu = sp.find((x) => x.tipo === 'lungo');
    // descrizione centrata sulla corsa: quanti minuti si corrono, non quanto si cammina
    const [t0, a0, b0] = p.sedute[0];
    const desc0 = t0 === 'cc' ? L(`${a0 * b0}′ di corsa, in tratti da ${b0}′`, `${a0 * b0}′ of running, in ${b0}′ bouts`) : sp[0].blocchi;
    return { n: k + 1, fase: faseDi(k + 1).nome, desc: lu ? L(`lungo ${lu.lavoro}′`, `long run ${lu.lavoro}′`) + ' · ' + desc0 : desc0 };
  });
  void oggiL;
  const formula = fcMaxTanaka(CONFIG.eta);
  return {
    settimana_consigliata: sett,
    fase: fase.nome,
    motivo,
    dati: { corse: corse.length, corse_6_settimane: recenti.length, per_settimana: round(perSett, 1), km_settimana: kmSett, corsa_continua_max_min: lungo },
    fc_max_stimata: formula,
    fc_max_osservata: fcMaxOss || null,
    fc_max_consigliata: fcMaxOss && fcMaxOss > formula ? fcMaxOss : null,
    soglie: SOGLIE, // corsa continua (minuti) -> settimana, per la stima dalle risposte dell'utente
    obiettivo: CONFIG.obiettivo || 'mezza',
    settimana_attuale: CONFIG.settimanaIniziale || 1,
    fc_max_attuale: CONFIG.fcMax,
    settimane,
  };
}

function mappaCambioObiettivo(ctx, nuovo) {
  return contesto.run(ctx, () => {
    const oggiStr = oggi();
    if (!CONFIG.programmaInizio || CONFIG.programmaInizio > oggiStr || !OBIETTIVI[nuovo]) return null; // piano non ancora iniziato
    const p = costruisciProgramma(oggiStr);
    if (!p) return null;
    const vecchie = obiettivoCorrente().fasi, nuove = OBIETTIVI[nuovo].fasi;
    const sett = p.settimana_piano;
    const i = Math.max(0, vecchie.findIndex((f) => sett >= f.da && sett <= f.a));
    const fv = vecchie[i];
    const frazione = (sett - fv.da) / (fv.a - fv.da + 1);
    const ultimaVecchia = i === vecchie.length - 1;
    const j = ultimaVecchia ? nuove.length - 1 : Math.min(i, nuove.length - 2);
    const fn = nuove[j];
    let nuovaSett = fn.da + Math.floor(frazione * (fn.a - fn.da + 1));
    if (!ultimaVecchia) nuovaSett = Math.min(nuovaSett, nuove[nuove.length - 1].da - 1);
    // la data di inizio non cambia: storico e corse fatte restano, dalla settimana in corso si segue il nuovo piano
    return { riparti_settimana: Math.max(1, nuovaSett), riparti_data: p.settimana.da };
  });
}

function costruisciProgramma(oggiStr) {
  if (!CONFIG.programmaInizio) return null;
  const inizio = CONFIG.programmaInizio;
  const dati = datiAdattamento(inizio, oggiStr);
  const settCorrente = Math.max(0, Math.floor(diffDays(oggiStr, inizio) / 7));
  const ultimo = pianoAttivo().length - 1;
  const og = obiettivoCorrente();

  // ---- Settimane concluse: avanti / ripeti / indietro ----
  const storia = [];
  // punto di partenza: settimana scelta con la valutazione iniziale (1 = da zero)
  let step = Math.min(ultimo, Math.max(0, (CONFIG.settimanaIniziale || 1) - 1));
  let vuoteDiFila = 0;
  // intensità: gradino automatico (-1, 0, +1) sopra la scelta dell'utente
  const baseInt = intensitaScelta();
  const autoOn = true; // la regolazione automatica è sempre attiva
  let auto = 0, ultimaModifica = -99, ultimaModificaInfo = null;
  const segnaliInt = [];
  const intensitaDi = (g) => ({ mult: round(baseInt.mult + g * PASSO_AUTO, 2), rep: baseInt.rep });
  const pctDi = (g) => Math.round((baseInt.mult + g * PASSO_AUTO - 1) * 100);
  // frequenza: livello raggiunto (3-5 sedute), settimane buone di fila e settimane in cui le sedute non entrano
  let livelloFreq = 3, buoneDiFila = 0, scarseDiFila = 0, ultimaFreqInfo = null;
  // giorni obbligatori: al massimo una seduta per giorno; con 1 solo giorno servono 2 settimane per la stessa settimana del piano
  const fissi = giorniFissi();
  const kFissi = fissi ? fissi.length : 7;
  let accum = 0; // sedute gia' fatte della settimana del piano in corso (solo con 1 seduta a settimana)
  // cambio di obiettivo: nella settimana che contiene riparti_data si salta alla settimana scelta del nuovo piano
  const riparti = (da) => {
    const r = CONFIG.ripartiData;
    if (r && CONFIG.ripartiSett && r >= da && r <= addDays(da, 6)) { step = Math.min(ultimo, Math.max(0, CONFIG.ripartiSett - 1)); accum = 0; }
  };
  for (let w = 0; w < settCorrente; w++) {
    const da = addDays(inizio, w * 7);
    const a = addDays(da, 6);
    riparti(da);
    const nSett = Math.min(livelloFreq, frequenzaObiettivo(step), kFissi);
    const turno = accum;
    let fatte = 0;
    for (let d = da; d <= a; d = addDays(d, 1)) if (dati.giorniCorsa.has(d)) fatte++;
    fatte = Math.min(nSett, fatte);

    const corseSett = dati.corse.filter((r) => r.data >= da && r.data <= a && r.fc_media);
    const fcMedia = corseSett.length ? corseSett.reduce((s, r) => s + r.fc_media, 0) / corseSett.length : null;
    const fcAlta = corseSett.length >= 2 && fcMedia != null && indiceZona(fcMedia, soglieZone()) >= 3; // media in Z4-Z5
    let giorniNonRecuperato = 0;
    for (let d = da; d <= a; d = addDays(d, 1)) if (segnaliRecupero(dati.benessere, d).length) giorniNonRecuperato++;
    const recuperoScarso = giorniNonRecuperato >= 3;
    const tsbFine = dati.tsb.get(a);
    const sovraccarico = tsbFine != null && tsbFine < SOGLIE.rossaMax;

    const eseguito = step;
    const motivi = [];
    let esito;
    if (sovraccarico) {
      esito = 'indietro';
      motivi.push(L(`TSB a ${it1(tsbFine)}: sovraccarico`, `TSB at ${round(tsbFine, 1)}: overload`));
    } else if (fatte === 0) {
      vuoteDiFila++;
      esito = vuoteDiFila >= 2 ? 'indietro' : 'ripeti';
      motivi.push(vuoteDiFila >= 2 ? L('due settimane senza sedute: si riparte con calma', 'two weeks without sessions: easing back in') : L('nessuna seduta registrata', 'no sessions recorded'));
    } else if (fatte === 1 && nSett === 1 && accum === 0) {
      esito = 'ripeti';
      accum = 1;
      motivi.push(L('1 seduta su 2 di questa settimana del piano: con un giorno a settimana dura 2 settimane', '1 of 2 sessions of this plan week: with one day a week it lasts 2 weeks'));
    } else if (fatte === 1 && nSett > 1) {
      esito = 'ripeti';
      motivi.push(L(`1 seduta su ${nSett}`, `1 of ${nSett} sessions`));
    } else if (fcAlta) {
      esito = 'ripeti';
      motivi.push(L(`FC media nelle corse ${Math.round(fcMedia)} bpm: troppo alta per corse facili`, `average run HR ${Math.round(fcMedia)} bpm: too high for easy runs`));
    } else if (recuperoScarso) {
      esito = 'ripeti';
      motivi.push(L(`${giorniNonRecuperato} giorni con segnali di recupero incompleto`, `${giorniNonRecuperato} days with signs of incomplete recovery`));
    } else {
      esito = 'avanti';
      if (nSett === 1) motivi.push(L('2 sedute su 2 in due settimane', '2 of 2 sessions over two weeks'));
      else motivi.push(L(`${fatte} sedute su ${nSett}${fcMedia ? `, FC media ${Math.round(fcMedia)} bpm` : ''}`, `${fatte} of ${nSett} sessions${fcMedia ? `, average HR ${Math.round(fcMedia)} bpm` : ''}`));
    }
    if (fatte > 0) vuoteDiFila = 0;
    if (esito === 'avanti' || esito === 'indietro') accum = 0;
    if (esito === 'avanti') step = Math.min(ultimo, step + 1);
    if (esito === 'indietro') step = Math.max(0, step - 1);

    // segnali per l'intensità: settimana "facile" (tutto fatto, FC bassa, recupero buono, sforzo percepito basso) o "dura"
    const rpeSett = corseSett.filter((r) => r.rpe).map((r) => r.rpe);
    const rpeMed = rpeSett.length ? rpeSett.reduce((x, y) => x + y, 0) / rpeSett.length : null;
    const settFacile = fatte >= nSett && esito === 'avanti' && fcMedia != null && indiceZona(fcMedia, soglieZone()) <= 1 && giorniNonRecuperato === 0 && (rpeMed == null || rpeMed <= 4);
    const settDura = sovraccarico || fcAlta || recuperoScarso || (rpeMed != null && rpeMed >= 8);
    segnaliInt.push({ facile: settFacile, dura: settDura });
    const intSett = intensitaDi(auto); // intensità usata in questa settimana
    if (autoOn && w - ultimaModifica >= 3 && segnaliInt.length >= 3) {
      const ult = segnaliInt.slice(-3);
      let motivo = null;
      if (ult.every((x) => x.facile) && auto < 1) {
        auto++;
        motivo = L(`intensità ${pctDi(auto) >= 0 ? '+' : ''}${pctDi(auto)}%: 3 settimane complete con FC bassa e buon recupero`, `intensity ${pctDi(auto) >= 0 ? '+' : ''}${pctDi(auto)}%: 3 complete weeks with low HR and good recovery`);
      } else if (ult.filter((x) => x.dura).length >= 2 && auto > -1) {
        auto--;
        motivo = L(`intensità ${pctDi(auto) >= 0 ? '+' : ''}${pctDi(auto)}%: segnali di fatica in 2 delle ultime 3 settimane`, `intensity ${pctDi(auto) >= 0 ? '+' : ''}${pctDi(auto)}%: signs of fatigue in 2 of the last 3 weeks`);
      }
      if (motivo) { ultimaModifica = w; motivi.push(motivo); ultimaModificaInfo = { settimana: w + 1, data: a, motivo }; }
    }

    // frequenza della settimana dopo: si guadagna con 3 settimane buone, si perde con fatica o sedute che non entrano
    const acwr = dati.acwr.get(a);
    const caricoOk = acwr == null || acwr <= ACWR_MAX;
    const prima = livelloFreq;
    let motivoFreq = null;
    if (settDura || esito === 'indietro') {
      buoneDiFila = 0; scarseDiFila = 0;
      if (livelloFreq > 3) { livelloFreq--; motivoFreq = L(`si torna a ${livelloFreq} sedute: segnali di fatica`, `back to ${livelloFreq} sessions: signs of fatigue`); }
    } else if (nSett > 3 && fatte < nSett - 1) {
      buoneDiFila = 0;
      if (++scarseDiFila >= 2) { livelloFreq = Math.max(3, nSett - 1); scarseDiFila = 0; motivoFreq = L(`si torna a ${livelloFreq} sedute: da 2 settimane non entrano tutte`, `back to ${livelloFreq} sessions: for 2 weeks they did not all fit`); }
    } else {
      scarseDiFila = 0;
      buoneDiFila = esito === 'avanti' && fatte >= nSett && caricoOk ? buoneDiFila + 1 : 0;
      if (buoneDiFila >= 3 && livelloFreq < frequenzaObiettivo(step)) {
        livelloFreq++; buoneDiFila = 0;
        motivoFreq = L(`da ora ${livelloFreq} sedute a settimana: 3 settimane complete senza fatica`, `from now on ${livelloFreq} sessions a week: 3 complete weeks without fatigue`)
          + (acwr != null ? L(`, carico in crescita sicura (${it1(acwr)})`, `, load rising safely (${round(acwr, 1)})`) : '');
      }
    }
    if (motivoFreq) { motivi.push(motivoFreq); if (livelloFreq !== prima) ultimaFreqInfo = { settimana: w + 1, data: a, motivo: motivoFreq }; }
    storia.push({ numero: w + 1, da, a, settimana_piano: eseguito + 1, sedute: nSett, turno, fatte, esito, motivi, intensita: intSett, intensita_pct: Math.round((intSett.mult - 1) * 100) });
  }
  riparti(addDays(inizio, settCorrente * 7));
  const intensitaAttuale = intensitaDi(auto);
  const ultimiSegnali = segnaliInt.slice(-3);
  const suggerimentoInt = auto === 1 && CONFIG.intensita !== 'ambiziosa' && ultimiSegnali.length === 3 && ultimiSegnali.every((x) => x.facile)
    ? L('Sembri pronto per un livello più intenso: puoi sceglierlo in Account → Programma.', 'You look ready for a more intense level: you can choose it in Account → Plan.')
    : auto === -1 && CONFIG.intensita !== 'tranquilla' && ultimiSegnali.filter((x) => x.dura).length >= 2
      ? L('Il piano sembra pesante: valuta l’intensità Tranquilla in Account → Programma.', 'The plan seems heavy: consider the Easy-going intensity in Account → Plan.')
      : null;

  // ---- Calendario: passato reale + futuro proiettato (assumendo progressione regolare) ----
  const calendario = [];
  // seduta fatta: una corsa quel giorno (o segnata a mano); la "Camminata di recupero" si fa camminando
  const fattaIl = (sed, data) => dati.giorniCorsa.has(data) || (sed.tipo === 'recupero' && dati.giorniCamminata.has(data));
  const preferiti = new Set(Array.isArray(CONFIG.giorniSedute) ? CONFIG.giorniSedute : []);
  const descPerData = new Map(); // descrittore di ogni seduta (per alleggerire quella di oggi)
  let prec = { dure: new Set(), corsa: new Set(), dow: new Set() };
  const fissiSet = fissi ? new Set(fissi) : null;
  const settimanaCal = (w, stepIdx, n, intensita, proiezione, turno = 0) => {
    const da = addDays(inizio, w * 7);
    let descs = pianoAttivo()[stepIdx].sedute.map((d) => conIntensita(d, intensita));
    for (let k = descs.length; k < n; k++) descs.push(descExtra(stepIdx, intensita));
    // meno giorni che sedute: si tengono le piu' importanti (gli indici restano quelli del piano)
    const tenute = sceltaSedute(descs, n, turno);
    const ctxG = {
      da, oggi: oggiStr, preferiti, fissi: fissiSet, giorniCorsa: dati.giorniCorsa, maxFila2: faseDi(stepIdx + 1).id <= 2,
      precDure: prec.dure, precCorsa: prec.corsa, precDow: prec.dow,
    };
    const prova = (ds) => { const g = scegliGiorni(tenute.map((i) => ds[i]), ctxG); return g && g.map((x) => ({ off: x.off, i: tenute[x.i] })); };
    let giorni = prova(descs), facilitata = false;
    if (!giorni) {
      // giorni obbligatori attaccati: la qualita' diventa corsa facile, poi i vincoli diventano penalita'
      const facile = descs.find((d) => d[0] === 'facile') || fa(30);
      const ds2 = descs.map((d) => (ruoloSeduta(d) === 'Q' ? ['facile', facile[1], false] : d));
      giorni = prova(ds2);
      if (giorni) { descs = ds2; facilitata = true; } else { ctxG.rilassa = true; giorni = prova(descs) || tenute.map((i, k) => ({ off: [0, 2, 4, 6, 1][k] ?? k, i })); }
    }
    giorni.sort((x, y) => x.off - y.off);
    prec = { dure: new Set(), corsa: new Set(), dow: new Set() };
    const dataGara = (giorni.find(({ i }) => descs[i][0] === 'gara') || {}).off;
    giorni.forEach(({ off, i }, pos) => {
      const data = addDays(da, off);
      // dopo la gara niente allunghi: resta una corsa facile di scarico
      const desc = dataGara != null && off > dataGara && descs[i][0] === 'facile' ? ['facile', descs[i][1], false] : descs[i];
      const extra = i >= 3;
      const sed = sedutaDa(stepIdx, Math.min(i, 2), data, desc, null);
      const dow = new Date(dayMs(data)).getUTCDay();
      let perche = null;
      if (extra) perche = proiezione
        ? L(`Seduta in più prevista: il coach la aggiunge se reggi bene il carico (${n} a settimana).`, `Extra session planned: the coach adds it if you handle the load well (${n} a week).`)
        : L(`Seduta in più (${n} a settimana): la tua forma regge più volume, sempre a ritmo facile.`, `Extra session (${n} a week): your fitness can take more volume, always at an easy pace.`);
      if (facilitata && desc[0] === 'facile' && sedutaDura(pianoAttivo()[stepIdx].sedute[Math.min(i, 2)] || ['facile'])) perche = L('Doveva essere una seduta di qualità: con i tuoi giorni attaccati diventa corsa facile, per non fare due sedute impegnative di fila.', 'This was meant to be a quality session: with your back-to-back days it becomes an easy run, to avoid two hard sessions in a row.');
      if (n < pianoAttivo()[stepIdx].sedute.length && pos === 0 && !perche) perche = n === 1
        ? L('Con un giorno a settimana fai una seduta per volta: questa settimana del piano dura 2 settimane.', 'With one day a week you do one session at a time: this plan week lasts 2 weeks.')
        : L(`Con ${n} giorni a settimana il coach tiene le sedute più importanti e salta una corsa facile.`, `With ${n} days a week the coach keeps the key sessions and skips an easy run.`);
      if (desc[0] === 'gara') perche = L('Data indicativa: le gare si corrono quasi sempre nel weekend.', 'Indicative date: races are almost always at the weekend.');
      else if (!fissi && preferiti.size && !preferiti.has(dow) && !(data <= oggiStr && dati.giorniCorsa.has(data)))
        perche = (perche ? perche + ' ' : '') + L('Fuori dai tuoi giorni preferiti: lì non c’era posto senza due sedute impegnative di fila o senza recuperare quella saltata.', 'Outside your preferred days: there was no room there without two hard sessions back to back or without making up a missed one.');
      descPerData.set(data, desc);
      calendario.push({ ...sed, seduta: pos + 1, sedute_settimana: n, extra, perche_giorno: perche, fatta: fattaIl(sed, data), manuale: dati.manuali.has(data), passata: data < oggiStr });
      prec.corsa.add(data); prec.dow.add(dow);
      if (sedutaDura(desc)) prec.dure.add(data);
    });
  };
  storia.forEach((s, w) => settimanaCal(w, s.settimana_piano - 1, s.sedute, s.intensita, false, s.turno));
  // futuro: la frequenza cresce come da regola (3 settimane buone) fino al tetto dell'obiettivo e dei giorni obbligatori;
  // con 1 seduta a settimana ogni settimana del piano occupa 2 settimane di calendario
  const freqCorrente = Math.min(livelloFreq, frequenzaObiettivo(step), kFissi);
  let livProj = livelloFreq, buoneProj = buoneDiFila, accProj = accum;
  for (let sP = step, w = settCorrente; sP <= ultimo && w < settCorrente + 200; w++) {
    if (w > settCorrente && ++buoneProj >= 3 && livProj < frequenzaObiettivo(sP)) { livProj++; buoneProj = 0; }
    const n = w === settCorrente ? freqCorrente : Math.min(livProj, frequenzaObiettivo(sP), kFissi);
    settimanaCal(w, sP, n, intensitaAttuale, w > settCorrente, accProj);
    if (n === 1 && ++accProj < 2) continue;
    accProj = 0; sP++;
  }
  const gara = calendario.find((s) => s.tipo === 'gara');

  // Stima dai dati: velocita' reale di avanzamento nel piano (dopo almeno 3 settimane)
  const netto = storia.filter((s) => s.esito === 'avanti').length - storia.filter((s) => s.esito === 'indietro').length;
  const ritmoAvanzamento = storia.length >= 3 ? Math.max(0.25, Math.min(1, netto / storia.length)) : 1;
  const settimaneStimate = Math.ceil((ultimo - step) / ritmoAvanzamento);
  const offGara = ((diffDays(calendario.find((c) => c.tipo === 'gara').data, inizio) % 7) + 7) % 7;
  // con meno di 3 settimane di storia vale la proiezione del calendario (che tiene conto dei giorni obbligatori)
  const dataStimata = storia.length >= 3 ? addDays(inizio, (settCorrente + settimaneStimate) * 7 + offGara) : calendario.find((c) => c.tipo === 'gara').data;

  // Tempo indicativo sulla distanza dell'obiettivo (formula di Riegel) dalla migliore corsa >= 20' delle ultime 6 settimane
  let previsione = null;
  for (const r of dati.corse) {
    if (r.data < addDays(oggiStr, -42) || r.tempo < 1200 || !(r.distanza >= 2.5)) continue;
    const t = r.tempo * Math.pow(og.km / r.distanza, 1.06);
    if (!previsione || t < previsione.tempo_sec) previsione = { tempo_sec: Math.round(t), da: { data: r.data, distanza: r.distanza, tempo: r.tempo } };
  }
  const fine = calendario[calendario.length - 1].data;

  // ---- Carico e infortuni (serve anche all'adattamento giornaliero) ----
  const carico = valutaCarico(oggiStr, dati.acwr);

  // ---- Adattamento giornaliero della prossima seduta ----
  const prossime = calendario.filter((s) => s.data > oggiStr || (s.data === oggiStr && !s.fatta)).slice(0, 3);
  let prontezza = { valutata: false, motivi: [] };
  if (prossime.length && diffDays(prossime[0].data, oggiStr) <= 1) {
    const motivi = [];
    // dati di salute piu' recenti (oggi o ieri)
    for (const d of [oggiStr, addDays(oggiStr, -1)]) {
      const r = dati.benessere.get(d);
      const m = segnaliRecupero(dati.benessere, d);
      if (r && (r.fc_riposo != null || r.hrv != null || r.sonno_sec != null)) {
        motivi.push(...m);
        prontezza.valutata = true;
        break;
      }
    }
    const tsbOggi = dati.tsb.get(oggiStr);
    if (tsbOggi != null && tsbOggi < SOGLIE.rossaMax) motivi.push(L(`TSB a ${it1(tsbOggi)}`, `TSB at ${round(tsbOggi, 1)}`));
    if (carico.acwr != null && carico.acwr > CARICO.acwrAlto) motivi.push(L(`carico salito troppo in fretta (${it1(carico.acwr)} volte quello abituale)`, `load rose too fast (${round(carico.acwr, 1)}× your usual)`));
    prontezza.motivi = motivi;
    const p0 = prossime[0];
    if (motivi.length && p0.tipo !== 'gara' && p0.tipo !== 'recupero') {
      const desc = descPerData.get(p0.data);
      const ridotta = sedutaDa(p0.settimana - 1, Math.min(2, p0.seduta - 1), p0.data, riduci(desc));
      delete ridotta.seduta;
      prossime[0] = { ...p0, ...ridotta, adattata: { motivi, originale: `${p0.blocchi} (${p0.durata_min}′)`, originale_min: p0.durata_min, originale_titolo: p0.titolo.replace(/^(Sett\.|Wk) \d+ · /, ''), originale_tipo: p0.tipo } };
      const idx = calendario.findIndex((s) => s.data === p0.data);
      if (idx >= 0) calendario[idx] = { ...calendario[idx], ...prossime[0] };
    }
  }

  // ---- Settimana in corso: quante sedute contano per la decisione di fine settimana ----
  const settDa = addDays(inizio, settCorrente * 7);
  const settA = addDays(settDa, 6);
  const giorniFatti = [];
  for (let d = settDa; d <= settA && d <= oggiStr; d = addDays(d, 1)) if (dati.giorniCorsa.has(d)) giorniFatti.push(d);
  const settimana = {
    da: settDa,
    a: settA,
    fatte: Math.min(freqCorrente, giorniFatti.length),
    sedute: freqCorrente,
    // con 1 seduta a settimana: se e' la prima delle due, a fine settimana il piano non avanza ancora
    una_su_due: freqCorrente === 1 ? accum + 1 : null,
    giorni_fatti: giorniFatti,
    obiettivo: Math.min(2, freqCorrente),
    previste: calendario.filter((c) => c.data >= settDa && c.data <= settA).map((c) => ({ data: c.data, titolo: c.titolo, fatta: c.fatta, passata: c.passata })),
    settimana_piano: step + 1,
    // se la settimana scorsa era vuota, un'altra settimana vuota fa tornare indietro il piano
    rischio_indietro: vuoteDiFila >= 1,
    iniziato: oggiStr >= inizio,
  };

  // ---- Obiettivo e proiezione ----
  // tempi di riferimento dell'obiettivo (es. mezza: in linea entro 6 mesi, al massimo 12)
  const [mesiOk, mesiMax] = og.mesi;
  const entro6 = addDays(inizio, Math.round(mesiOk * 30.4));
  const entro12 = addDays(inizio, Math.round(mesiMax * 30.4));
  const nomeOb = P(og.nome);
  const ritardo = settCorrente - step; // settimane perse rispetto al piano ideale
  const statoObiettivo = dataStimata <= entro6 ? 'in_linea' : dataStimata <= entro12 ? 'ritardo' : 'oltre';
  const passate = calendario.filter((s) => s.data < oggiStr || (s.data === oggiStr && s.fatta));
  const fattePassate = passate.filter((s) => s.fatta).length;
  const faseCorr = faseDi(step + 1);

  // ---- Il coach dice ----
  const consigli = [];
  if (oggiStr < inizio) consigli.push(L(`Il piano parte ${giornoSettimana(inizio)} ${inizio.slice(8)}/${inizio.slice(5, 7)}: preparati con calma.`, `The plan starts on ${giornoSettimana(inizio)} ${inizio.slice(8)}/${inizio.slice(5, 7)}: get ready calmly.`));
  const ultima = storia[storia.length - 1];
  if (ultima) {
    const t = L({ avanti: 'si avanza', ripeti: 'la ripetiamo', indietro: 'torniamo indietro di una settimana' }, { avanti: 'moving forward', ripeti: 'repeating it', indietro: 'stepping back one week' })[ultima.esito];
    consigli.push(L(`Settimana scorsa (piano S${ultima.settimana_piano}): ${ultima.motivi.join(', ')} → ${t}.`, `Last week (plan wk ${ultima.settimana_piano}): ${ultima.motivi.join(', ')} → ${t}.`));
  }
  if (CONFIG.ripartiData && CONFIG.ripartiSett && diffDays(oggiStr, CONFIG.ripartiData) <= 13 && CONFIG.ripartiData >= inizio)
    consigli.push(L(`Nuovo obiettivo (${P(og.nome)}): dalla settimana del ${CONFIG.ripartiData.slice(8)}/${CONFIG.ripartiData.slice(5, 7)} segui la settimana ${CONFIG.ripartiSett} del nuovo piano. Le corse fatte prima restano e contano.`, `New goal (${P(og.nome)}): from the week of ${CONFIG.ripartiData.slice(5, 7)}/${CONFIG.ripartiData.slice(8)} you follow week ${CONFIG.ripartiSett} of the new plan. Earlier runs stay and count.`));
  if (fissi) { const cg = consigliGiorni(fissi, 'fissi', CONFIG.obiettivo || 'mezza'); if (cg.length) consigli.push(cg[0]); }
  if (ultimaFreqInfo && settCorrente - ultimaFreqInfo.settimana <= 1) consigli.push(L(`Frequenza: ${ultimaFreqInfo.motivo}.`, `Frequency: ${ultimaFreqInfo.motivo}.`));
  if (ultimaModificaInfo && settCorrente - ultimaModificaInfo.settimana <= 2) consigli.push(L(`Ho regolato il piano: ${ultimaModificaInfo.motivo}.`, `I adjusted the plan: ${ultimaModificaInfo.motivo}.`));
  if (suggerimentoInt) consigli.push(suggerimentoInt);
  if (carico.livello !== 'ok') consigli.push(L(`Attenzione al carico: ${carico.segnali.join('; ')}. Aumenta gradualmente: è così che si evitano gli infortuni.`, `Watch your load: ${carico.segnali.join('; ')}. Build up gradually: that is how injuries are avoided.`));
  const prossimoLungo = calendario.find((c) => c.tipo === 'lungo' && c.data >= oggiStr && !c.fatta && diffDays(c.data, oggiStr) <= 7);
  if (prossimoLungo && carico.limite_lungo_km) consigli.push(L(`Lungo di ${giornoSettimana(prossimoLungo.data)}: resta entro ${it1(carico.limite_lungo_km)} km (+10% sulla corsa più lunga degli ultimi 30 giorni).`, `Long run on ${giornoSettimana(prossimoLungo.data)}: stay within ${round(carico.limite_lungo_km, 1)} km (+10% over your longest run of the last 30 days).`));
  if (prossime[0] && prossime[0].adattata) {
    consigli.push(L(`Prossima seduta alleggerita: ${prossime[0].adattata.motivi.join(', ')}.`, `Next session lightened: ${prossime[0].adattata.motivi.join(', ')}.`));
  } else if (prontezza.valutata) {
    consigli.push(L('FC a riposo, HRV e sonno nella norma: via libera alla seduta prevista.', 'Resting HR, HRV and sleep look normal: go ahead with the planned session.'));
  } else {
    consigli.push(L('Senza dati di FC a riposo, HRV e sonno adatto il piano solo in base alle sedute fatte: fai arrivare questi dati su Intervals.icu (Apple Watch: app Companion; Garmin e altri: wellness nel collegamento).', 'Without resting HR, HRV and sleep data I can only adapt the plan to the sessions you complete: get this data onto Intervals.icu (Apple Watch: Companion app; Garmin and others: wellness in the connection).'));
  }
  if (statoObiettivo === 'in_linea') {
    consigli.push(ritardo > 0
      ? L(`Sei ${ritardo} settimana/e dietro al piano ideale ma ancora entro i 6 mesi.`, `You are ${ritardo} week(s) behind the ideal plan but still within 6 months.`)
      : L(`Sei in linea per l’obiettivo (${nomeOb}) entro ${mesiOk} mesi.`, `You are on track for your goal (${nomeOb}) within ${mesiOk} months.`));
  } else if (statoObiettivo === 'ritardo') {
    consigli.push(L(`Al ritmo reale (${Math.round(ritmoAvanzamento * 100)}% delle settimane in avanti) l’obiettivo slitta oltre i ${mesiOk} mesi ma resta entro ${mesiMax}. Meglio arrivarci sani che in fretta.`, `At your real pace (${Math.round(ritmoAvanzamento * 100)}% of weeks moving forward) your goal slips past ${mesiOk} months but stays within ${mesiMax}. Better to get there healthy than fast.`));
  } else {
    consigli.push(L(`Al ritmo attuale l’obiettivo va oltre i ${mesiMax} mesi: rivediamo insieme frequenza e orari delle sedute.`, `At the current pace your goal goes beyond ${mesiMax} months: let’s review session frequency and timing.`));
  }

  return {
    attivo: oggiStr <= fine,
    carico,
    inizio,
    fine,
    offset_gara: offGara,
    // sedute a settimana: adesso, tetto previsto dall'obiettivo in questa fase e ultima modifica del coach
    frequenza: {
      attuale: freqCorrente,
      massima: Math.max(...pianoAttivo().map((_, i) => frequenzaObiettivo(i))),
      ultima_modifica: ultimaFreqInfo,
      preferiti: [...preferiti],
      modo: fissi ? 'fissi' : 'preferiti',
      consigli: consigliGiorni(fissi || [...preferiti], fissi ? 'fissi' : 'preferiti', CONFIG.obiettivo || 'mezza'),
    },
    ora: CONFIG.programmaOra,
    obiettivo: {
      nome: nomeOb,
      codice: CONFIG.obiettivo || 'mezza',
      km: og.km,
      mesi_obiettivo: mesiOk,
      mesi_limite: mesiMax,
      data_gara: gara.data,
      data_stimata: dataStimata,
      stima_da_dati: storia.length >= 3,
      ritmo_avanzamento_pct: Math.round(ritmoAvanzamento * 100),
      previsione_tempo: previsione,
      entro_6_mesi: entro6,
      entro_12_mesi: entro12,
      stato: statoObiettivo,
      ritardo_settimane: ritardo,
    },
    intensita: {
      scelta: CONFIG.intensita || 'equilibrata',
      nome: P(baseInt.nome),
      auto,
      percentuale: Math.round((intensitaAttuale.mult - 1) * 100),
      regolazione_auto: autoOn,
      ultima_modifica: ultimaModificaInfo,
      suggerimento: suggerimentoInt,
    },
    settimana_calendario: settCorrente + 1,
    settimana_piano: step + 1,
    totale_settimane: pianoAttivo().length,
    fase_corrente: faseCorr,
    fasi: FASI_L().map((f) => ({ ...f, stato: step + 1 > f.a ? 'completata' : step + 1 >= f.da ? 'in_corso' : 'futura' })),
    sedute_fatte: fattePassate,
    sedute_passate: passate.length,
    aderenza_pct: passate.length ? Math.round((fattePassate / passate.length) * 100) : null,
    prontezza,
    settimana,
    prossime,
    storia: storia.slice().reverse(),
    consigli,
    calendario,
    // corse fatte in giorni senza seduta: compaiono nel calendario con il loro segno
    corse_fuori_piano: (() => {
      const giorniPiano = new Set(calendario.map((c) => c.data));
      return dati.corse.filter((c) => !giorniPiano.has(c.data)).map((c) => ({ data: c.data, id: c.id }));
    })(),
  };
}

// ---------------------------------------------------------------------------
// Esportazione del calendario in formato iCalendar (.ics)
// ---------------------------------------------------------------------------
function icsEscape(t) {
  return String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
function icsFold(riga) {
  // Le righe iCalendar non devono superare 75 ottetti: si spezzano con CRLF + spazio
  const out = [];
  let buf = '';
  for (const ch of riga) {
    if (Buffer.byteLength(buf + ch) > 73) {
      out.push(buf);
      buf = ' ';
    }
    buf += ch;
  }
  out.push(buf);
  return out.join('\r\n');
}

function generaIcs() {
  const p = costruisciProgramma(oggi());
  if (!p) return null;
  const [hh, mm] = CONFIG.programmaOra.split(':').map(Number);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const locale = (data, minuti) => {
    const tot = hh * 60 + mm + minuti;
    return `${data.replace(/-/g, '')}T${pad(Math.floor(tot / 60))}${pad(tot % 60)}00`;
  };

  const righe = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Always Adaptive Coach//Piano di corsa//IT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    L(`X-WR-CALNAME:Corsa · Verso: ${P(obiettivoCorrente().nome)}`, `X-WR-CALNAME:Running · Road to: ${P(obiettivoCorrente().nome)}`), 'X-WR-TIMEZONE:Europe/Rome',
    'BEGIN:VTIMEZONE', 'TZID:Europe/Rome',
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
    'END:VTIMEZONE',
  ];
  for (const s of p.calendario.filter((x) => !x.passata)) {
    const descr =
      `${s.fase} · ${s.titolo} · ${L('seduta', 'session')} ${s.seduta}/${s.sedute_settimana || 3}\n\n` +
      `${s.struttura.map((f) => `${f.fase} ${f.min}': ${f.testo}`).join('\n')}\n\n` +
      `${L('FC', 'HR')}: ${s.fc_target} bpm.\n${s.nota}\n\n` +
      L('Il piano si adatta ai tuoi dati: se cambia, riscarica il calendario dall’app.', 'The plan adapts to your data: if it changes, download the calendar again from the app.');
    righe.push(
      'BEGIN:VEVENT',
      `UID:coach-${s.data}@ai-adaptive-coach`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Europe/Rome:${locale(s.data, 0)}`,
      `DTEND;TZID=Europe/Rome:${locale(s.data, s.durata_min)}`,
      icsFold(`SUMMARY:${icsEscape(`${s.tipo === 'gara' ? '' : '🏃 '}${s.titolo.replace(/^(Sett\.|Wk) \d+ · /, '')} · ${s.durata_min}'`)}`),
      icsFold(`DESCRIPTION:${icsEscape(descr)}`),
      L('CATEGORIES:Allenamento', 'CATEGORIES:Workout'), 'TRANSP:OPAQUE',
      'BEGIN:VALARM', 'ACTION:DISPLAY', L('DESCRIPTION:Allenamento tra 30 minuti', 'DESCRIPTION:Workout in 30 minutes'), 'TRIGGER:-PT30M', 'END:VALARM',
      'END:VEVENT'
    );
  }
  righe.push('END:VCALENDAR');
  return righe.join('\r\n') + '\r\n';
}

function pianificaAllenamenti(righe, stato, oggiStr) {
  const finestra28 = righe.filter((r) => r.data > addDays(oggiStr, -28) && r.data <= oggiStr);
  const finestra21 = finestra28.filter((r) => r.data > addDays(oggiStr, -21));

  // Passo di riferimento: media ponderata sulle ultime 4 settimane
  const kmTot = finestra28.reduce((s, r) => s + r.distanza, 0);
  const tempoTot = finestra28.reduce((s, r) => s + r.tempo, 0);
  const passoBase = kmTot > 0 ? tempoTot / kmTot : 360;

  // Volumi di riferimento: lungo = media delle due uscite piu' lunghe; base = mediana delle altre
  const km21 = finestra21.map((r) => r.distanza).sort((a, b) => b - a);
  let lungoRef;
  let baseRef;
  if (km21.length >= 3) {
    lungoRef = (km21[0] + km21[1]) / 2;
    baseRef = mediana(km21.slice(2)) ;
    if (baseRef == null || baseRef < 2) baseRef = km21[km21.length - 1];
  } else if (km21.length >= 1) {
    lungoRef = km21[0];
    baseRef = km21[km21.length - 1] * (km21.length === 1 ? 0.7 : 1);
  } else {
    lungoRef = 8;
    baseRef = 5;
  }
  const qualitaRef = baseRef * 1.1;

  const haCorsoOggi = righe.some((r) => r.data === oggiStr);
  const partenza = haCorsoOggi ? addDays(oggiStr, 1) : oggiStr;
  const passoGiorni = stato.zona === 'rossa' ? 1 : 2;
  const date = [0, 1, 2].map((i) => addDays(partenza, i * passoGiorni));

  const meta = (n) => ({ numero: n, data: date[n - 1], giorno: giornoSettimana(date[n - 1]) });

  // ---------------- ZONA ROSSA: blocco di scarico ----------------
  if (stato.zona === 'rossa') {
    return [
      {
        ...meta(1),
        tipo: 'camminata',
        titolo: 'Camminata rigenerante',
        distanza_km: 4,
        durata_min: 45,
        passo_target: '11:00–12:30',
        fc_target: sottoZona(2),
        zona_fc: 'Z1',
        variazione_pct: null,
        camminata: true,
        bloccato: true,
        descrizione:
          'Cammina 45 minuti a passo svelto ma rilassato, preferibilmente su terreno morbido. Niente corsa: obiettivo è favorire il recupero.',
      },
      {
        ...meta(2),
        tipo: 'recupero',
        titolo: 'Recupero attivo e mobilità',
        distanza_km: null,
        durata_min: 25,
        passo_target: null,
        fc_target: null,
        zona_fc: null,
        variazione_pct: null,
        camminata: true,
        bloccato: true,
        descrizione:
          '20–25 minuti di mobilità, stretching leggero e foam rolling. Cura sonno e idratazione: sono il vero allenamento di oggi.',
      },
      {
        ...meta(3),
        tipo: 'camminata',
        titolo: 'Camminata di rientro',
        distanza_km: 3.5,
        durata_min: 40,
        passo_target: '11:00–12:30',
        fc_target: sottoZona(2),
        zona_fc: 'Z1',
        variazione_pct: null,
        camminata: true,
        bloccato: true,
        descrizione:
          'Camminata di 40 minuti. Dopo questa sessione sincronizza di nuovo: se il TSB è tornato sopra −10 il coach rimette la corsa in programma.',
      },
    ];
  }

  // ---------------- ZONA VERDE / ARANCIONE ----------------
  const verde = stato.zona === 'verde';
  const f = verde ? { facile: 1.05, qualita: 1.07, lungo: 1.1 } : { facile: 1, qualita: 1, lungo: 1 };
  const pct = (x) => (verde ? Math.round((x - 1) * 100) : 0);

  const kmFacile = Math.max(3, mezzoKm(baseRef * f.facile));
  const kmQualita = Math.max(4, mezzoKm(qualitaRef * f.qualita));
  const kmLungo = Math.min(22, Math.max(6, mezzoKm(lungoRef * f.lungo)));

  const durata = (km, passo) => Math.round((km * passo) / 60);
  const passoFacile = passoBase + 17;
  const passoTempo = passoBase - 17;
  const passoLungo = passoBase + 12;

  const corpoTempo = Math.max(1, mezzoKm(kmQualita - 3));
  const descQualita = verde
    ? `Riscaldamento 1,5 km facile + ${it1(corpoTempo)} km a ritmo mezza maratona/soglia (in 2–3 blocchi, 2' di recupero) + defaticamento 1,5 km.`
    : `Fartlek leggero a volume invariato: dopo 1,5 km di riscaldamento alterna 6 × 2' a ritmo sostenuto (sforzo 7/10) con 2' di corsa facile, poi defaticamento.`;

  return [
    {
      ...meta(1),
      tipo: 'facile',
      titolo: 'Corsa facile di base',
      distanza_km: kmFacile,
      durata_min: durata(kmFacile, passoFacile),
      passo_target: rangePasso(passoBase, 10, 25),
      fc_target: zonaRange(2),
      zona_fc: 'Z2',
      variazione_pct: pct(f.facile),
      camminata: false,
      bloccato: false,
      descrizione: verde
        ? 'Passo conversazionale, respirazione sotto controllo. Chiudi con 4 allunghi da 20" per attivare la gamba.'
        : 'Passo conversazionale, respirazione sotto controllo. Stessi chilometri delle ultime uscite: non spingere.',
    },
    {
      ...meta(2),
      tipo: 'qualita',
      titolo: verde ? 'Qualità: ritmo mezza maratona' : 'Qualità leggera: fartlek',
      distanza_km: kmQualita,
      durata_min: durata(kmQualita, passoBase),
      passo_target: rangePasso(passoBase, -25, -10),
      fc_target: verde ? zonaRange(4) : zonaRange(3),
      zona_fc: verde ? 'Z4' : 'Z3',
      variazione_pct: pct(f.qualita),
      camminata: false,
      bloccato: false,
      descrizione: descQualita,
    },
    {
      ...meta(3),
      tipo: 'lungo',
      titolo: 'Lungo progressivo',
      distanza_km: kmLungo,
      durata_min: durata(kmLungo, passoLungo),
      passo_target: rangePasso(passoBase, 5, 20),
      fc_target: zonaRange(2),
      zona_fc: 'Z2',
      variazione_pct: pct(f.lungo),
      camminata: false,
      bloccato: false,
      descrizione: verde
        ? 'Parti piano e, se le sensazioni sono buone, negli ultimi 2 km avvicinati al ritmo mezza. Porta acqua o gel oltre i 15 km.'
        : 'Lungo a ritmo costante in Z2, senza progressione finale. Obiettivo: tenere il volume, non accumulare fatica.',
    },
  ];
}

function aggregaSettimane(righe, oggiStr, massimo = 12) {
  if (!righe.length) return [];
  const lunediOggi = lunedi(oggiStr);
  const primo = lunedi(righe[0].data);
  const inizio = diffDays(lunediOggi, primo) / 7 >= massimo ? addDays(lunediOggi, -(massimo - 1) * 7) : primo;

  const gruppi = new Map();
  for (const r of righe) {
    const k = lunedi(r.data);
    if (k < inizio) continue;
    const g = gruppi.get(k) || { km: 0, tempo: 0, corse: 0 };
    g.km += r.distanza;
    g.tempo += r.tempo;
    g.corse += 1;
    gruppi.set(k, g);
  }

  const out = [];
  for (let k = inizio; k <= lunediOggi; k = addDays(k, 7)) {
    const g = gruppi.get(k) || { km: 0, tempo: 0, corse: 0 };
    const iso = isoWeek(k);
    out.push({
      settimana: `${iso.anno}-W${pad(iso.settimana)}`,
      etichetta: `S${pad(iso.settimana)}`,
      inizio: k,
      km: round(g.km, 1),
      passo_medio: g.km > 0 ? round(g.tempo / g.km, 1) : null,
      corse: g.corse,
      in_corso: k === lunediOggi,
    });
  }
  return out;
}

// ===========================================================================
// Storico e statistiche di miglioramento
// ===========================================================================

// ---------------------------------------------------------------------------
// Zone cardiache a 5 zone (come Garmin, Polar, Suunto). UNICO punto in cui si calcolano i limiti:
// grafico, barre, tempi, percentuali, sedute e testi li prendono da qui.
//   < Z1 fuori zona < 50% · Z1 50-60% · Z2 60-70% · Z3 70-80% · Z4 80-90% · Z5 90-100%
// Percentuali della RISERVA cardiaca (Karvonen: FC riposo + % x (FC max - FC riposo)) quando c'e' una FC a riposo
// affidabile (mediana di almeno 5 misure negli ultimi 28 giorni, tra 40 e 90 bpm); altrimenti della FC max.
// Protezione: l'inizio di Z3 (tetto della corsa facile) non supera mai l'80% della FC max.
// Limiti interi senza sovrapposizioni: soglia = parte intera, il bpm della soglia sta nella zona sotto.
// Con FC max 185 senza FC a riposo: < 93 · 93-111 · 112-129 · 130-148 · 149-166 · 167-185.
// Con FC max 185 e riposo 70: < 128 · 128-139 · 140-148 · 149-162 · 163-173 · 174-185 (Z2/Z3 dal tetto dell'80%).
// ---------------------------------------------------------------------------
const ZONE_PCT = [50, 60, 70, 80, 90];
const TETTO_FACILE = 0.8; // inizio di Z3 al massimo all'80% della FC max
// FC a riposo usata per le zone (mediana 28 giorni), con una piccola cache per utente (10 minuti)
function fcRiposoZone() {
  const st = contesto.getStore();
  const ora = Date.now();
  if (st && st._fcRip && ora - st._fcRip.t < 600000) return st._fcRip.v;
  let v = null;
  try {
    const fino = oggi();
    const vals = db.prepare("SELECT fc_riposo FROM benessere WHERE fc_riposo BETWEEN 40 AND 90 AND data > date(?, '-28 day') AND data <= ?").all(fino, fino).map((r) => r.fc_riposo);
    if (vals.length >= 5) v = Math.round(mediana(vals));
  } catch (_) { v = null; }
  if (st) st._fcRip = { t: ora, v };
  return v;
}
const ZONE_FC = [
  { z: 'Z1', nome: ['Recupero/Riscaldamento', 'Recovery/Warm-up'] },
  { z: 'Z2', nome: ['Aerobica facile', 'Easy aerobic'] },
  { z: 'Z3', nome: ['Aerobica media', 'Steady aerobic'] },
  { z: 'Z4', nome: ['Soglia', 'Threshold'] },
  { z: 'Z5', nome: ['Massimale', 'Maximal'] },
];
// soglie[k] = ultimo bpm sotto il k-esimo limite (interi, aritmetica intera: niente errori di arrotondamento)
const soglieZone = (fcMax = CONFIG.fcMax, rip = fcRiposoZone()) => {
  if (!rip || rip >= fcMax - 40) return ZONE_PCT.map((p) => Math.floor((fcMax * p) / 100));
  const s = ZONE_PCT.map((p) => Math.floor(rip + ((fcMax - rip) * p) / 100));
  s[2] = Math.min(s[2], Math.floor(fcMax * TETTO_FACILE)); // la corsa facile non sale oltre l'80% della FC max
  if (s[1] >= s[2]) s[1] = s[2] - 1;
  return s;
};
// Metodo in uso per le zone (per i testi e l'export)
const metodoZone = () => { const r = fcRiposoZone(); return r && r < CONFIG.fcMax - 40 ? { metodo: 'riserva', fc_riposo: r } : { metodo: 'fcmax', fc_riposo: null }; };
// Tetto della corsa-cammino: piu' prudente della corsa facile (65% della riserva), mai oltre il tetto della facile
function fcCorsaCammino() {
  const r = metodoZone().fc_riposo;
  const facile = limitiZone()[2].da;
  if (!r) return `< ${facile}`;
  return `< ${Math.min(facile, Math.floor(r + (CONFIG.fcMax - r) * 0.65) + 1)}`;
}
// -1 = fuori zona (< Z1), 0..4 = Z1..Z5 (oltre la FC max resta Z5)
function indiceZona(bpm, soglie) {
  const h = Math.round(bpm);
  if (h <= soglie[0]) return -1;
  for (let i = 1; i < soglie.length; i++) if (h <= soglie[i]) return i - 1;
  return soglie.length - 1;
}
function zonaFc(fc) {
  if (fc == null) return null;
  const i = indiceZona(fc, soglieZone());
  return i < 0 ? null : ZONE_FC[i].z;
}
const limitiZone = (fcMax = CONFIG.fcMax) => {
  const s = soglieZone(fcMax);
  return ZONE_FC.map((z, i) => ({
    z: z.z,
    nome: P(z.nome),
    pct_da: ZONE_PCT[i],
    pct_a: ZONE_PCT[i + 1] || 100,
    da: s[i] + 1,
    a: i < s.length - 1 ? s[i + 1] : fcMax,
  }));
};
// Soglie FC del piano, tutte dalle zone:
//   facile/lungo = Z2 (sotto l'inizio di Z3), qualita' = Z4, recupero = Z1 (sotto l'inizio di Z2)
//   regole settimanali: FC media in Z4-Z5 = settimana troppo dura (si ripete), in Z1-Z2 = facile
const zonaRange = (n) => { const z = limitiZone()[n - 1]; return `${z.da}–${z.a}`; };
const sottoZona = (n) => `< ${limitiZone()[n - 1].da}`;
const soglieFcPiano = () => { const z = limitiZone(); return { facile: z[2].da, recupero: z[1].da, dura: z[3].da, qualita: [z[3].da, z[3].a] }; };
const sottoZone = (fcMax = CONFIG.fcMax) => ({ z: '< Z1', nome: L('Fuori zona', 'Below zones'), a: soglieZone(fcMax)[0] });

// FC max in uso e sua origine: misurata/inserita dall'utente oppure stimata dall'eta' (Tanaka)
function infoFcMax() {
  const misurata = Boolean(CONFIG.fcMaxReale);
  return {
    ...metodoZone(),
    valore: CONFIG.fcMax,
    fonte: misurata ? 'misurata' : 'stimata',
    stimata: fcMaxTanaka(CONFIG.eta),
    eta: CONFIG.etaImpostata || null,
    formula: '208 − 0,7 × ' + L('età', 'age'),
  };
}

// Istogramma ricavato dalla serie a ~5 s (solo se manca quello dai dati grezzi, es. demo o corsa non ancora scaricata)
function istogrammaDaSerie(s) {
  if (!s || !Array.isArray(s.hr) || !Array.isArray(s.t)) return null;
  const sec = new Map();
  for (let i = 0; i < s.hr.length; i++) {
    const h = s.hr[i];
    if (!(h >= 30 && h <= 250)) continue;
    const dt = Math.min(10 + (s.passo || 5), (s.t[i + 1] ?? s.t[i] + (s.passo || 5)) - s.t[i]);
    if (!(dt > 0)) continue;
    sec.set(Math.round(h), (sec.get(Math.round(h)) || 0) + dt);
  }
  return [...sec.entries()];
}

// Tempo in ogni zona per una corsa (riga di attivita): dai dati grezzi se disponibili, altrimenti dalla serie.
// Percentuali sul tempo totale con FC, fuori zona compreso (le righe sommano 100%).
function tempoInZone(r, fcMax = CONFIG.fcMax) {
  let bins = null, fonte = null;
  try {
    const g = r.fc_istogramma ? JSON.parse(r.fc_istogramma) : null;
    if (g && g.length) { bins = g; fonte = 'grezzi'; }
    if (!bins && r.serie) {
      const d = istogrammaDaSerie(typeof r.serie === 'string' ? JSON.parse(r.serie) : r.serie);
      if (d && d.length) { bins = d; fonte = 'serie'; }
    }
  } catch (_) {
    return null;
  }
  if (!bins) return null;
  const soglie = soglieZone(fcMax);
  const sec = ZONE_FC.map(() => 0);
  let sotto = 0;
  for (const [b, t] of bins) {
    const i = indiceZona(b, soglie);
    if (i < 0) sotto += t; else sec[i] += t;
  }
  const tot = sotto + sec.reduce((x, y) => x + y, 0);
  if (!tot) return null;
  const pct = (x) => round((x / tot) * 100, 1);
  return { fonte, totale: Math.round(tot), sotto: { sec: Math.round(sotto), pct: pct(sotto) }, zone: sec.map((x) => ({ sec: Math.round(x), pct: pct(x) })) };
}

const media = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);
const variazionePct = (nuovo, vecchio) => (nuovo != null && vecchio ? round(((nuovo - vecchio) / vecchio) * 100, 1) : null);

// ---------------------------------------------------------------------------
// Approfondimenti: una singola seduta e la storia completa della salute
// ---------------------------------------------------------------------------
function costruisciAttivita(id, oggiStr) {
  const st = costruisciStorico(oggiStr);
  const c = st.corse.find((x) => String(x.id) === String(id));
  if (!c) return null;
  const riga = db.prepare('SELECT serie, giri FROM attivita WHERE id = ?').get(c.id);
  const serie = riga && riga.serie ? JSON.parse(riga.serie) : null;
  const giri = riga && riga.giri ? JSON.parse(riga.giri) : [];
  // seduta prevista dal piano per quel giorno
  let prevista = null;
  const prog = costruisciProgramma(oggiStr);
  if (prog) {
    const s = prog.calendario.find((x) => x.data === c.data);
    if (s) prevista = { titolo: s.titolo, tipo: s.tipo, durata_min: s.durata_min, corsa_min: s.corsa_min, fc_target: s.fc_target, blocchi: s.blocchi, fase: s.fase, segmenti: s.segmenti };
  }
  // confronto con le 5 corse precedenti
  const prec = st.corse.filter((x) => x.data < c.data || (x.data === c.data && String(x.id) < String(c.id))).slice(0, 5);
  const med = (arr) => (arr.length ? arr.reduce((t, x) => t + x, 0) / arr.length : null);
  const passoDi = (x) => x.passo_corsa || x.passo_medio;
  const confronto = prec.length
    ? {
        corse: prec.length,
        passo: round(med(prec.map(passoDi).filter(Boolean)), 1),
        fc: round(med(prec.map((x) => x.fc_corsa || x.fc_media).filter(Boolean)), 1),
        ef: round(med(prec.map((x) => x.efficiency_factor).filter(Boolean)), 4),
        distanza: round(med(prec.map((x) => x.distanza)), 2),
        tempo: Math.round(med(prec.map((x) => x.tempo))),
      }
    : null;
  return { corsa: c, serie, giri, zone: st.zone, sotto_zone: st.sotto_zone, fc_max_info: st.fc_max_info, fc_max_teorica: CONFIG.fcMax, prevista, confronto };
}

function costruisciStoriaSalute(oggiStr) {
  const grezze = db.prepare('SELECT * FROM benessere WHERE data <= ? ORDER BY data ASC').all(oggiStr);
  const mappa = new Map(grezze.map((r) => [r.data, { ...r }]));
  for (const [d, kcal] of caloriePerGiorno('0000-01-01', oggiStr)) {
    if (!mappa.has(d)) mappa.set(d, { data: d });
    mappa.get(d).calorie = kcal;
  }
  const righe = [...mappa.values()].sort((x, y) => (x.data < y.data ? -1 : 1));
  const campi = ['fc_riposo', 'hrv', 'sonno_sec', 'sonno_score', 'passi', 'peso', 'vo2max', 'spo2', 'respirazione', 'fc_sonno', 'grasso', 'pressione_max', 'pressione_min', 'glicemia', 'piani', 'calorie'];
  const giorni = righe
    .filter((r) => campi.some((k) => r[k] != null))
    .map((r) => {
      const o = { data: r.data };
      for (const k of campi) o[k] = r[k];
      o.base_fc_riposo = round(mediaBase(mappa, 'fc_riposo', r.data), 1);
      o.base_hrv = round(mediaBase(mappa, 'hrv', r.data), 1);
      o.segnali = segnaliRecupero(mappa, r.data);
      return o;
    });
  return { oggi: oggiStr, giorni, soglie: { fc_riposo_piu: 5, hrv_meno_pct: 15, sonno_min_sec: 5.5 * 3600, giorni_base: 28, valori_minimi: 5 } };
}

function costruisciStorico(oggiStr) {
  const corse = db
    .prepare("SELECT * FROM attivita WHERE origine = 'intervals' AND data <= ? ORDER BY data DESC, id DESC")
    .all(oggiStr)
    .map((r) => ({
      id: r.id,
      data: r.data,
      nome: r.nome,
      tipo: r.tipo || 'Run',
      distanza: r.distanza,
      tempo: r.tempo,
      passo_medio: r.passo_medio,
      fc_media: r.fc_media,
      fc_max: r.fc_max,
      zona: zonaFc(r.fc_corsa || r.fc_media),
      tempo_zone: tempoInZone(r),
      passo_corsa: r.passo_corsa,
      fc_corsa: r.fc_corsa,
      tempo_corsa: r.tempo_corsa,
      distanza_corsa: r.distanza_corsa,
      parziali: r.parziali ? JSON.parse(r.parziali) : null,
      // alcune sorgenti riportano la cadenza "per gamba": la normalizziamo in passi al minuto
      cadenza: r.cadenza && r.cadenza < 120 ? r.cadenza * 2 : r.cadenza,
      dislivello: r.dislivello,
      carico: r.carico,
      calorie: r.calorie,
      decoupling: r.decoupling ?? r.deriva,
      passo_gap: r.passo_gap,
      fc_recupero: r.fc_recupero,
      rapporto_verticale: r.rapporto_verticale,
      efficiency_factor: r.efficiency_factor,
      tsb: r.tsb,
      zone_fc: r.zone_fc ? JSON.parse(r.zone_fc) : null,
      ha_serie: !!r.serie,
      ora_inizio: r.ora_inizio,
      scarpa_id: r.scarpa_id,
      meteo: r.meteo && r.meteo !== '{}' ? JSON.parse(r.meteo) : null,
      rpe: r.rpe,
      contatto: r.contatto,
      oscillazione: r.oscillazione,
      lung_passo: r.lung_passo,
    }));
  const altre = db.prepare('SELECT * FROM altre_attivita WHERE data <= ? ORDER BY data DESC, id DESC').all(oggiStr);
  const benessere = db.prepare('SELECT * FROM benessere WHERE data <= ? ORDER BY data ASC').all(oggiStr);

  // ---- Aggregati settimanali (dalla prima attivita' a oggi) ----
  const primi = [corse[corse.length - 1], altre[altre.length - 1], benessere[0]].filter(Boolean).map((r) => r.data);
  const settimane = [];
  if (primi.length) {
    const da = lunedi(primi.sort()[0]);
    for (let k = da; k <= lunedi(oggiStr); k = addDays(k, 7)) {
      const fine = addDays(k, 6);
      const cs = corse.filter((r) => r.data >= k && r.data <= fine);
      const as = altre.filter((r) => r.data >= k && r.data <= fine);
      const ws = benessere.filter((r) => r.data >= k && r.data <= fine);
      const km = cs.reduce((t, r) => t + r.distanza, 0);
      const sec = cs.reduce((t, r) => t + r.tempo, 0);
      const conFc = cs.filter((r) => r.fc_media);
      const iso = isoWeek(k);
      settimane.push({
        inizio: k,
        etichetta: `S${pad(iso.settimana)}`,
        km: round(km, 1),
        minuti: Math.round(sec / 60),
        corse: cs.length,
        passo_medio: km > 0 ? round(sec / km, 1) : null,
        fc_media: conFc.length ? round(conFc.reduce((t, r) => t + r.fc_media * r.tempo, 0) / conFc.reduce((t, r) => t + r.tempo, 0), 0) : null,
        ef_medio: round(media(cs.filter((r) => r.efficiency_factor).map((r) => r.efficiency_factor)), 3),
        lungo_km: cs.length ? round(Math.max(...cs.map((r) => r.distanza)), 1) : null,
        altre_minuti: Math.round(as.reduce((t, r) => t + (r.durata || 0), 0) / 60),
        fc_riposo: round(media(ws.filter((r) => r.fc_riposo != null).map((r) => r.fc_riposo)), 0),
        hrv: round(media(ws.filter((r) => r.hrv != null).map((r) => r.hrv)), 0),
        sonno_ore: round(media(ws.filter((r) => r.sonno_sec != null).map((r) => r.sonno_sec / 3600)), 1),
        in_corso: k === lunedi(oggiStr),
      });
    }
  }

  // ---- Statistiche chiave: ultime 4 settimane contro le 4 precedenti ----
  const fin = (giorni) => addDays(oggiStr, -giorni);
  const recenti = corse.filter((r) => r.data > fin(28));
  const prima = corse.filter((r) => r.data > fin(56) && r.data <= fin(28));
  const ef = (arr) => media(arr.filter((r) => r.efficiency_factor).map((r) => r.efficiency_factor));
  const facili = (arr) => arr.filter((r) => r.zona === 'Z1' || r.zona === 'Z2');
  const passoMedio = (arr) => {
    const conCorsa = arr.filter((r) => r.passo_corsa && r.tempo_corsa);
    if (conCorsa.length === arr.length && arr.length) {
      const km = conCorsa.reduce((t, r) => t + r.distanza_corsa, 0);
      return km > 0 ? conCorsa.reduce((t, r) => t + r.tempo_corsa, 0) / km : null;
    }
    const km = arr.reduce((t, r) => t + r.distanza, 0);
    return km > 0 ? arr.reduce((t, r) => t + r.tempo, 0) / km : null;
  };
  // Tempo in Z1-Z2: secondi reali nelle zone (dati FC); per le corse senza dati, la zona della FC media
  const conFc = recenti.filter((r) => r.tempo_zone || r.zona);
  const secFacili = conFc.reduce((t, r) => t + (r.tempo_zone ? r.tempo_zone.zone[0].sec + r.tempo_zone.zone[1].sec : r.zona === 'Z1' || r.zona === 'Z2' ? r.tempo : 0), 0);
  const secTot = conFc.reduce((t, r) => t + (r.tempo_zone ? r.tempo_zone.totale : r.tempo), 0);
  const lunghi = corse.filter((r) => r.data > fin(56) && r.tempo >= 45 * 60 && r.decoupling != null);
  const bw = (campo, da, a) => media(benessere.filter((r) => r.data > fin(da) && r.data <= fin(a) && r[campo] != null).map((r) => r[campo]));
  const lungoMax = corse.reduce((m, r) => (!m || r.distanza > m.distanza ? r : m), null);
  const migliorPasso = corse.filter((r) => r.distanza >= 3).reduce((m, r) => (!m || r.passo_medio < m.passo_medio ? r : m), null);
  const conVo2 = benessere.filter((r) => r.vo2max != null);
  const vo2 = conVo2[conVo2.length - 1];
  // confronto con l'ultimo valore di almeno 4 settimane prima
  const vo2Prima = vo2 ? conVo2.filter((r) => r.data <= addDays(vo2.data, -28)).pop() : null;

  const statistiche = {
    totali: {
      corse: corse.length,
      km: round(corse.reduce((t, r) => t + r.distanza, 0), 1),
      ore: round(corse.reduce((t, r) => t + r.tempo, 0) / 3600, 1),
      lungo: lungoMax ? { data: lungoMax.data, distanza: lungoMax.distanza, tempo: lungoMax.tempo } : null,
      miglior_passo: migliorPasso ? { data: migliorPasso.data, passo: migliorPasso.passo_medio, distanza: migliorPasso.distanza } : null,
    },
    ultime_4_settimane: {
      corse: recenti.length,
      km: round(recenti.reduce((t, r) => t + r.distanza, 0), 1),
      km_var_pct: variazionePct(recenti.reduce((t, r) => t + r.distanza, 0), prima.reduce((t, r) => t + r.distanza, 0)),
    },
    efficienza: { valore: round(ef(recenti), 3), var_pct: variazionePct(ef(recenti), ef(prima)) },
    passo_facile: { valore: round(passoMedio(facili(recenti)), 0), precedente: round(passoMedio(facili(prima)), 0) },
    fc_media_facile: round(media(facili(recenti).map((r) => r.fc_media)), 0),
    tempo_facile_pct: secTot ? Math.round((secFacili / secTot) * 100) : null,
    cadenza: round(media(recenti.filter((r) => r.cadenza).map((r) => r.cadenza)), 0),
    decoupling_lunghi: round(media(lunghi.map((r) => r.decoupling)), 1),
    fc_riposo: { valore: round(bw('fc_riposo', 7, 0), 0), precedente: round(bw('fc_riposo', 35, 7), 0) },
    hrv: { valore: round(bw('hrv', 7, 0), 0), precedente: round(bw('hrv', 35, 7), 0) },
    vo2max: vo2 ? { valore: vo2.vo2max, data: vo2.data, precedente: vo2Prima ? vo2Prima.vo2max : null } : null,
  };

  return { zone: limitiZone(), sotto_zone: sottoZone(), fc_max_info: infoFcMax(), fc_max_stimata: CONFIG.fcMax, corse, altre, settimane, statistiche };
}

// Metriche di salute: ultimo valore, media dei 28 giorni precedenti e serie di 30 giorni
const METRICHE_SALUTE = ['fc_riposo', 'hrv', 'sonno_sec', 'sonno_score', 'passi', 'peso', 'vo2max', 'spo2', 'respirazione', 'fc_sonno', 'grasso', 'pressione_max', 'pressione_min', 'glicemia', 'piani'];

// Calorie attive bruciate negli allenamenti registrati (corse + altre attività), per giorno
function caloriePerGiorno(da, a) {
  const righe = db.prepare(`SELECT data, SUM(calorie) AS kcal FROM (
      SELECT data, calorie FROM attivita WHERE origine = 'intervals' AND calorie > 0
      UNION ALL SELECT data, calorie FROM altre_attivita WHERE calorie > 0
    ) WHERE data >= ? AND data <= ? GROUP BY data`).all(da, a);
  return new Map(righe.map((r) => [r.data, Math.round(r.kcal)]));
}

function costruisciSalute(oggiStr) {
  const grezze = db
    .prepare('SELECT * FROM benessere WHERE data >= ? AND data <= ? ORDER BY data ASC')
    .all(addDays(oggiStr, -60), oggiStr);
  const perGiorno = new Map(grezze.map((r) => [r.data, { ...r }]));
  for (const [d, kcal] of caloriePerGiorno(addDays(oggiStr, -60), oggiStr)) {
    if (!perGiorno.has(d)) perGiorno.set(d, { data: d });
    perGiorno.get(d).calorie = kcal;
  }
  const righe = [...perGiorno.values()].sort((x, y) => (x.data < y.data ? -1 : 1));

  const metriche = {};
  let disponibile = false;
  for (const m of [...METRICHE_SALUTE, 'calorie']) {
    const conValore = righe.filter((r) => r[m] != null);
    const ultimo = conValore[conValore.length - 1];
    if (!ultimo) {
      metriche[m] = null;
      continue;
    }
    disponibile = true;
    const precedenti = conValore.filter((r) => r.data < ultimo.data && r.data >= addDays(ultimo.data, -28)).map((r) => r[m]);
    const media = precedenti.length >= 3 ? precedenti.reduce((s, x) => s + x, 0) / precedenti.length : null;
    metriche[m] = {
      valore: ultimo[m],
      data: ultimo.data,
      media_28g: round(media, 1),
      delta: media != null ? round(ultimo[m] - media, 1) : null,
    };
  }

  const serie = [];
  for (let d = addDays(oggiStr, -29); d <= oggiStr; d = addDays(d, 1)) {
    const r = perGiorno.get(d) || {};
    const punto = { data: d };
    for (const m of [...METRICHE_SALUTE, 'calorie']) punto[m] = r[m] ?? null;
    serie.push(punto);
  }

  // Stato di recupero dell'ultimo giorno con FC a riposo, HRV o sonno (oggi o ieri)
  let recupero = null;
  for (const d of [oggiStr, addDays(oggiStr, -1)]) {
    const r = perGiorno.get(d);
    if (r && (r.fc_riposo != null || r.hrv != null || r.sonno_sec != null)) {
      recupero = {
        data: d,
        segnali: segnaliRecupero(perGiorno, d),
        base_fc_riposo: round(mediaBase(perGiorno, 'fc_riposo', d), 1),
        base_hrv: round(mediaBase(perGiorno, 'hrv', d), 1),
      };
      break;
    }
  }

  // Giorni con recupero incompleto negli ultimi 30 giorni (stesse regole della seduta del giorno)
  const nonRecuperati = [];
  let basePronta = false;
  for (let d = addDays(oggiStr, -29); d <= oggiStr; d = addDays(d, 1)) {
    const r = perGiorno.get(d);
    if (!r || (r.fc_riposo == null && r.hrv == null && r.sonno_sec == null)) continue;
    if (mediaBase(perGiorno, 'fc_riposo', d) != null || mediaBase(perGiorno, 'hrv', d) != null) basePronta = true;
    const sg = segnaliRecupero(perGiorno, d);
    if (sg.length) nonRecuperati.push({ data: d, segnali: sg });
  }
  const recupero_30g = { giorni: nonRecuperati.reverse(), base_pronta: basePronta };

  return { disponibile, metriche, serie_30g: serie, recupero, recupero_30g, corpo: corpoEBmi(oggiStr) };
}

// BMI = peso (kg) / altezza (m)². Peso: sempre il dato piu' recente tra bilancia/Intervals e profilo
// (a parita' di giorno vince la misura). Categorie OMS per adulti.
function corpoEBmi(oggiStr) {
  const altezza = CONFIG.altezza || null;
  const w = db.prepare('SELECT data, peso FROM benessere WHERE peso IS NOT NULL AND data <= ? ORDER BY data DESC LIMIT 1').get(oggiStr);
  let peso = null, fonte = null, data = null;
  const prof = CONFIG.peso ? { peso: CONFIG.peso, data: CONFIG.pesoData || '0000-00-00' } : null;
  if (w && (!prof || w.data >= prof.data)) { peso = w.peso; fonte = 'misurato'; data = w.data; }
  else if (prof) { peso = prof.peso; fonte = 'profilo'; data = CONFIG.pesoData || null; }
  const bmi = altezza && peso ? round(peso / (altezza / 100) ** 2, 1) : null;
  const categoria = bmi == null ? null
    : bmi < 18.5 ? { id: 'sotto', nome: L('Sottopeso', 'Underweight') }
    : bmi < 25 ? { id: 'normo', nome: L('Normopeso', 'Healthy weight') }
    : bmi < 30 ? { id: 'sovra', nome: L('Sovrappeso', 'Overweight') }
    : { id: 'obeso', nome: L('Obesità', 'Obesity') };
  // peso che porterebbe il BMI nell'intervallo 18,5-24,9 per questa altezza
  const intervallo = altezza ? [round(18.5 * (altezza / 100) ** 2, 1), round(24.9 * (altezza / 100) ** 2, 1)] : null;
  return { altezza_cm: altezza, peso_kg: peso, fonte_peso: fonte, data_peso: data, bmi, categoria, peso_normo: intervallo };
}

// ===========================================================================
// Previsioni: forma futura (CTL/ATL/TSB), probabilità della data gara, tempo previsto
// ===========================================================================

// Intensità relativa (IF) per tipo di segmento: carico ≈ ore × IF² × 100 (come il TSS)
const IF_SEGMENTO = { walk: 0.5, cool: 0.5, run: 0.75, fast: 0.9 };
const IF_GARA = 0.82;

function caricoStimato(seduta) {
  let carico = 0;
  for (const s of seduta.segmenti) {
    const f = seduta.tipo === 'gara' && s.tipo === 'run' ? IF_GARA : IF_SEGMENTO[s.tipo] || 0.6;
    carico += (s.min / 60) * f * f * 100;
  }
  return carico;
}

// --- generatori casuali riproducibili (stessi risultati a ogni aggiornamento) ---
function rngNormale(rnd) {
  const u = Math.max(rnd(), 1e-12), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function rngGamma(rnd, k) {
  if (k < 1) return rngGamma(rnd, k + 1) * Math.pow(Math.max(rnd(), 1e-12), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = rngNormale(rnd); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = rnd();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function previsioneCarico(oggiStr, p) {
  // Punto di partenza: ultimo CTL/ATL noto (wellness Intervals o corse), altrimenti 0
  const ultimo = db
    .prepare('SELECT data, ctl, atl FROM benessere WHERE ctl IS NOT NULL AND atl IS NOT NULL AND data <= ? ORDER BY data DESC LIMIT 1')
    .get(oggiStr);
  let ctl = ultimo ? ultimo.ctl : 0;
  let atl = ultimo ? ultimo.atl : 0;
  let da = ultimo ? ultimo.data : oggiStr;
  // decadimento fino a ieri se il dato è vecchio
  for (let d = addDays(da, 1); d < oggiStr; d = addDays(d, 1)) { ctl *= K_CTL; atl *= K_ATL; }

  // Taratura personale: carico reale (Intervals) / carico stimato, sulle sedute già fatte
  const rapporti = [];
  for (const s of p.calendario) {
    if (!s.passata || !s.fatta) continue;
    const r = db.prepare("SELECT SUM(carico) AS c FROM attivita WHERE data = ? AND origine = 'intervals' AND carico IS NOT NULL").get(s.data);
    const stimato = caricoStimato(s);
    if (r && r.c > 0 && stimato > 0) rapporti.push(r.c / stimato);
  }
  const fattore = rapporti.length >= 3 ? Math.min(2, Math.max(0.5, mediana(rapporti))) : 1;

  const futuro = new Map(p.calendario.filter((s) => s.data >= oggiStr && !s.fatta).map((s) => [s.data, s]));
  const gara = p.calendario.find((s) => s.tipo === 'gara');
  const fine = addDays(gara ? gara.data : p.fine, 7);

  // Passato recente (ultime 4 settimane) per contesto
  const passato = db
    .prepare('SELECT data, ctl, atl FROM benessere WHERE ctl IS NOT NULL AND atl IS NOT NULL AND data >= ? AND data < ? ORDER BY data')
    .all(addDays(oggiStr, -28), oggiStr)
    .map((r) => ({ data: r.data, ctl: round(r.ctl, 1), atl: round(r.atl, 1), tsb: round(r.ctl - r.atl, 1), previsto: false }));

  const serie = [];
  for (let d = oggiStr; d <= fine; d = addDays(d, 1)) {
    const tsbMattino = ctl - atl; // forma con cui inizi la giornata
    const s = futuro.get(d);
    const carico = s ? caricoStimato(s) * fattore : 0;
    ctl = ctl * K_CTL + carico * (1 - K_CTL);
    atl = atl * K_ATL + carico * (1 - K_ATL);
    serie.push({ data: d, ctl: round(ctl, 1), atl: round(atl, 1), tsb: round(tsbMattino, 1), carico: round(carico, 0), previsto: true });
  }

  // Settimane con crescita del fitness troppo rapida (CTL +5 in 7 giorni)
  const avvisi = [];
  for (let i = 7; i < serie.length; i += 7) {
    const ramp = serie[i].ctl - serie[i - 7].ctl;
    if (ramp > SOGLIE.rampAttenzione) avvisi.push({ inizio: serie[i - 7].data, ramp: round(ramp, 1) });
  }
  const giornoGara = gara ? serie.find((x) => x.data === gara.data) : null;
  const primaGara = gara ? serie.filter((x) => x.data < gara.data) : serie;
  const picco = primaGara.reduce((m, x) => (!m || x.ctl > m.ctl ? x : m), null);
  const caricoSettimanaMax = (() => {
    let max = 0;
    for (let i = 0; i + 7 <= serie.length; i += 7) max = Math.max(max, serie.slice(i, i + 7).reduce((t, x) => t + x.carico, 0));
    return Math.round(max);
  })();

  return {
    partenza: { data: da, da_dati: Boolean(ultimo) },
    calibrazione: { fattore: round(fattore, 2), sedute: rapporti.length },
    passato,
    serie,
    gara: giornoGara ? { data: giornoGara.data, ctl: giornoGara.ctl, tsb: giornoGara.tsb } : null,
    picco: picco ? { data: picco.data, ctl: picco.ctl } : null,
    carico_settimana_max: caricoSettimanaMax,
    avvisi,
  };
}

function previsioneDataGara(oggiStr, p) {
  const conta = { avanti: 0, ripeti: 0, indietro: 0 };
  p.storia.forEach((w) => { conta[w.esito] += 1; });
  const osservateTot = p.storia.length;
  if (osservateTot < 3) {
    return { disponibile: false, settimane_osservate: osservateTot, richieste: 3, piano: p.obiettivo.data_gara,
      entro_6_mesi: p.obiettivo.entro_6_mesi, entro_12_mesi: p.obiettivo.entro_12_mesi, affidabilita: 'nessuna' };
  }
  // Ipotesi iniziale debole (~70% avanti, ~25% ripeti, ~5% indietro) pesata come ~3 settimane: contano soprattutto i tuoi dati
  const prior = { avanti: 2, ripeti: 0.7, indietro: 0.15 };
  const alfa = { avanti: conta.avanti + prior.avanti, ripeti: conta.ripeti + prior.ripeti, indietro: conta.indietro + prior.indietro };
  const tot = alfa.avanti + alfa.ripeti + alfa.indietro;

  const ultimo = pianoAttivo().length - 1;
  const step0 = p.settimana_piano - 1;
  const w0 = p.settimana_calendario - 1;
  const rnd = mulberry32(424242);
  const N = 4000;
  const offLungo = p.offset_gara;
  const date = [];
  for (let n = 0; n < N; n++) {
    // incertezza sui parametri: probabilità estratte dalla distribuzione a posteriori (Dirichlet)
    const ga = rngGamma(rnd, alfa.avanti), gr = rngGamma(rnd, alfa.ripeti), gi = rngGamma(rnd, alfa.indietro);
    const pa = ga / (ga + gr + gi), pi = gi / (ga + gr + gi);
    let step = step0, w = w0;
    while (step < ultimo && w < w0 + 156) {
      const u = rnd();
      if (u < pa) step += 1;
      else if (u > 1 - pi) step = Math.max(0, step - 1);
      w += 1;
    }
    date.push(addDays(p.inizio, w * 7 + offLungo));
  }
  date.sort();
  const perc = (q) => date[Math.min(N - 1, Math.floor(q * N))];
  const entro = (d) => Math.round((date.filter((x) => x <= d).length / N) * 100);
  const curva = [];
  const dal = date[0], al = perc(0.99);
  for (let d = dal; d <= al; d = addDays(d, 7)) curva.push({ data: d, prob: entro(d) });
  if (!curva.length || curva[curva.length - 1].data < al) curva.push({ data: al, prob: entro(al) });

  const osservate = p.storia.length;
  return {
    disponibile: true,
    p50: perc(0.5),
    p80: perc(0.8),
    p95: perc(0.95),
    piano: p.obiettivo.data_gara,
    prob_piano: entro(p.obiettivo.data_gara),
    prob_6_mesi: entro(p.obiettivo.entro_6_mesi),
    prob_12_mesi: entro(p.obiettivo.entro_12_mesi),
    entro_6_mesi: p.obiettivo.entro_6_mesi,
    entro_12_mesi: p.obiettivo.entro_12_mesi,
    curva,
    settimane_osservate: osservate,
    esiti: conta,
    probabilita_settimana: {
      avanti: Math.round((alfa.avanti / tot) * 100),
      ripeti: Math.round((alfa.ripeti / tot) * 100),
      indietro: Math.round((alfa.indietro / tot) * 100),
    },
    affidabilita: osservate < 3 ? 'bassa' : osservate < 8 ? 'media' : 'alta',
    simulazioni: N,
  };
}

const TIPI_CONTINUI = new Set(['facile', 'lungo', 'qualita', 'gara']);

// Velocità (m/min), FC e durata della parte corsa di un'attività; null se non affidabile.
// Nelle sedute corsa-cammino i tratti corsi sono brevi e la FC non fa in tempo a salire:
// l'efficienza risulta gonfiata, quindi si usano solo se richiesto esplicitamente (ammettiCC).
function corsaEffettiva(r, tipoSeduta, ammettiCC = false) {
  const continua = !tipoSeduta || TIPI_CONTINUI.has(tipoSeduta);
  if (!continua && !ammettiCC) return null;
  if (r.passo_corsa && r.fc_corsa && r.tempo_corsa >= 600) {
    return { v: 60000 / r.passo_corsa, fc: r.fc_corsa, tempo: r.tempo_corsa, solo_corsa: true };
  }
  if (continua && r.fc_media > 0 && r.tempo >= 900 && r.distanza >= 1.5) {
    return { v: (r.distanza * 1000) / (r.tempo / 60), fc: r.fc_media, tempo: r.tempo, solo_corsa: false };
  }
  return null;
}

function previsioneTempo(oggiStr, p, dataGara) {
  const og = obiettivoCorrente();
  const fcRef = Math.round(CONFIG.fcMax * og.fcGara);
  const tipoDi = new Map((p ? p.calendario : []).map((s) => [s.data, s.tipo]));
  const corse = db
    .prepare("SELECT * FROM attivita WHERE origine = 'intervals' AND data <= ? ORDER BY data")
    .all(oggiStr)
    .map((r) => ({ r, c: corsaEffettiva(r, tipoDi.get(r.data)) }))
    .filter((x) => x.c)
    .map(({ r, c }) => {
      const vRef = (c.v / c.fc) * fcRef; // velocità stimata alla FC di riferimento
      return { data: r.data, v_ref: vRef, passo_ref: round(60000 / vRef, 0) };
    });

  const RICHIESTE = 6;
  const finestra = corse.filter((r) => r.data > addDays(oggiStr, -56));
  const base = { fc_ref: fcRef, corse_continue: corse.length, richieste: RICHIESTE, punti: corse.slice(-40) };
  const giorniSpan = finestra.length ? diffDays(finestra[finestra.length - 1].data, finestra[0].data) : 0;
  if (finestra.length < RICHIESTE || giorniSpan < 14) return { ...base, disponibile: false };

  // Regressione lineare velocità_ref ~ giorni
  const x0 = finestra[0].data;
  const xs = finestra.map((r) => diffDays(r.data, x0));
  const ys = finestra.map((r) => r.v_ref);
  const n = xs.length, mx = media(xs), my = media(ys);
  const sxx = xs.reduce((t, x) => t + (x - mx) ** 2, 0);
  const b = sxx ? xs.reduce((t, x, i) => t + (x - mx) * (ys[i] - my), 0) / sxx : 0;
  const a = my - b * mx;
  const res = ys.map((y, i) => y - (a + b * xs[i]));
  const s = Math.sqrt(res.reduce((t, r) => t + r * r, 0) / Math.max(1, n - 2));

  const xOggi = diffDays(oggiStr, x0);
  const vOggi = a + b * xOggi;
  // prudenza: si proietta il ritmo di miglioramento attuale per al massimo 8 settimane, con tetto +10% / −10%
  const giorni = Math.max(0, diffDays(dataGara, oggiStr));
  let vGara = vOggi + b * Math.min(giorni, 56);
  vGara = Math.min(vGara, vOggi * 1.1);
  vGara = Math.max(vGara, vOggi * 0.9);
  const xT = xOggi + Math.min(giorni, 56);
  const se = s * Math.sqrt(1 + 1 / n + ((xT - mx) ** 2) / (sxx || 1));
  const DERIVA = og.deriva; // sulle distanze lunghe la FC sale a parità di passo: si rallenta un po'
  const tempo = (v) => Math.round(((og.km * 1000) / (v * DERIVA)) * 60);

  return {
    ...base,
    disponibile: true,
    data_gara: dataGara,
    tendenza_sett_sec: round((60000 / (vOggi + b * 7) - 60000 / vOggi), 1), // sec/km per settimana (negativo = migliora)
    passo_ref_oggi: round(60000 / vOggi, 0),
    passo_ref_gara: round(60000 / vGara, 0),
    tempo_sec: tempo(vGara),
    tempo_min_sec: tempo(vGara + 1.28 * se),
    tempo_max_sec: tempo(Math.max(vGara - 1.28 * se, vGara * 0.7)),
    trend: [
      { data: x0, passo: round(60000 / a, 0) },
      { data: oggiStr, passo: round(60000 / vOggi, 0) },
    ],
    proiezione: { data: dataGara, passo: round(60000 / vGara, 0) },
    corse_usate: n,
  };
}

// ---------------------------------------------------------------------------
// Il tuo passo: zone di passo personali stimate dall'efficienza (velocità per battito)
// ---------------------------------------------------------------------------
function costruisciPasso(oggiStr, p, previsioni) {
  const tipoDi = new Map((p ? p.calendario : []).map((s) => [s.data, s.tipo]));
  const righe = db
    .prepare("SELECT * FROM attivita WHERE origine = 'intervals' AND data > ? AND data <= ? ORDER BY data")
    .all(addDays(oggiStr, -42), oggiStr);
  let recenti = righe.map((r) => ({ r, c: corsaEffettiva(r, tipoDi.get(r.data)) })).filter((x) => x.c);
  let provvisoria = false;
  if (recenti.length < 3) {
    // non ci sono ancora 3 corse continue: stima provvisoria dai tratti di corsa delle sedute corsa-cammino
    recenti = righe.map((r) => ({ r, c: corsaEffettiva(r, tipoDi.get(r.data), true) })).filter((x) => x.c);
    provvisoria = true;
  }
  const RICHIESTE = 3;
  const ultimaRiga = db.prepare("SELECT * FROM attivita WHERE origine = 'intervals' AND data <= ? ORDER BY data DESC LIMIT 1").get(oggiStr);
  const ultimo = ultimaRiga
    ? { data: ultimaRiga.data, passo: ultimaRiga.passo_corsa || ultimaRiga.passo_medio, solo_corsa: Boolean(ultimaRiga.passo_corsa), distanza: ultimaRiga.distanza }
    : null;
  // minuti di corsa (senza i tratti di cammino) della corsa migliore: spiega perche' il passo non c'e' ancora
  const maxCorsaMin = righe.reduce((m, r) => Math.max(m, (r.tempo_corsa || (r.passo_corsa ? 0 : r.tempo) || 0) / 60), 0);
  if (recenti.length < RICHIESTE) return { disponibile: false, corse: recenti.length, richieste: RICHIESTE, ultimo, corse_totali: righe.length, max_corsa_min: Math.round(maxCorsaMin) };

  const efs = recenti.slice(-8).map((x) => x.c.v / x.c.fc).sort((a, b) => a - b);
  const ef = efs[Math.floor(efs.length / 2)]; // mediana: robusta a una giornata storta
  const passoA = (fc) => round(60000 / (ef * fc), 0);
  const fc = (pct) => Math.round(CONFIG.fcMax * pct);
  const zona = (da, a) => ({ fc_da: fc(da), fc_a: fc(a), passo_lento: passoA(fc(da)), passo_veloce: passoA(fc(a)) });
  const zonaBpm = (n) => { const z = limitiZone()[n - 1]; return { fc_da: z.da, fc_a: z.a, passo_lento: passoA(z.da), passo_veloce: passoA(z.a) }; };

  const og = obiettivoCorrente();
  const t = previsioni && previsioni.tempo;
  const passoGara = t && t.disponibile
    ? { sec: round(t.tempo_sec / og.km, 0), min: round(t.tempo_min_sec / og.km, 0), max: round(t.tempo_max_sec / og.km, 0), da_previsione: true }
    : { sec: round(60000 / (ef * fc(og.fcGara) * og.deriva), 0), min: null, max: null, da_previsione: false };

  return {
    disponibile: true,
    corse: recenti.length,
    richieste: RICHIESTE,
    solo_corsa: recenti.some((x) => x.c.solo_corsa),
    provvisoria,
    efficienza: round(ef, 4),
    zone: { facile: zonaBpm(2), medio: zonaBpm(3), mezza: zona(og.zonaGara[0], og.zonaGara[1]) }, // 'mezza' = zona del ritmo gara dell'obiettivo
    obiettivo: { codice: CONFIG.obiettivo || 'mezza', nome: P(og.nome), ritmo: P(og.titoloRitmo) },
    passo_gara: passoGara,
    tendenza_sett_sec: t && t.disponibile ? t.tendenza_sett_sec : null,
    ultimo,
  };
}

function costruisciPrevisioni(oggiStr, p) {
  if (!p) return null;
  try {
    const data = previsioneDataGara(oggiStr, p);
    return {
      data_gara: data,
      carico: previsioneCarico(oggiStr, p),
      tempo: previsioneTempo(oggiStr, p, data.disponibile ? data.p50 : p.obiettivo.data_stimata),
    };
  } catch (e) {
    console.error('[previsioni]', e);
    return null;
  }
}

// ===========================================================================
// Esportazione di una sessione in Markdown (da incollare in Claude o altra AI)
// ===========================================================================

const NOMI_TIPO_SEDUTA = {
  'corsa-cammino': ['Corsa e cammino', 'Run-walk'],
  facile: ['Corsa facile', 'Easy run'],
  lungo: ['Lungo', 'Long run'],
  qualita: ['Qualità (fartlek / ritmo / 4×4)', 'Quality (fartlek / pace work / 4×4)'],
  gara: ['Gara', 'Race'],
  recupero: ['Recupero', 'Recovery'],
};
const MESI_IT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const MESI_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function markdownSessione(data, perParere = false) {
  const oggiStr = oggi();
  const p = costruisciProgramma(oggiStr);
  const st = costruisciStorico(oggiStr);
  const seduta = p ? p.calendario.find((x) => x.data === data) : null;
  const corse = st.corse.filter((c) => c.data === data);
  const grezze = new Map(
    db.prepare("SELECT id, ctl, atl FROM attivita WHERE data = ? AND origine = 'intervals'").all(data).map((r) => [r.id, r])
  );
  const altre = st.altre.filter((a) => a.data === data);
  if (!seduta && !corse.length && !altre.length) return null;

  const benessere = new Map(
    db.prepare('SELECT * FROM benessere WHERE data >= ? AND data <= ?').all(addDays(data, -35), data).map((r) => [r.data, r])
  );
  const w = benessere.get(data);
  const v = (x, suff = '') => (x == null || x === '' ? 'n/a' : `${x}${suff}`);
  const durata = (sec) => {
    if (sec == null) return 'n/a';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = Math.round(sec % 60);
    return h ? `${h}h ${pad(m)}′ ${pad(x)}″` : `${m}′ ${pad(x)}″`;
  };
  const passo = (sec) => (sec == null ? 'n/a' : `${fmtPasso(sec)} /km`);
  const dataLunga = `${giornoSettimana(data)} ${Number(data.slice(8))}/${data.slice(5, 7)}/${data.slice(0, 4)}`;
  const stato = seduta
    ? seduta.fatta
      ? seduta.manuale ? L('fatta (segnata a mano)', 'done (marked manually)') : L('fatta', 'done')
      : seduta.passata ? L('non fatta', 'missed') : L('in programma', 'planned')
    : L('fuori piano', 'outside the plan');
  const zoneTxt = [`< Z1 ${sottoZone().nome} < ${sottoZone().a + 1}`]
    .concat(limitiZone().map((z) => `${z.z} ${z.nome} ${z.da}–${z.a}`))
    .join('; ');

  const R = [];
  R.push(L(`# Allenamento di ${dataLunga} — ${stato}`, `# Workout on ${dataLunga} — ${stato}`));
  R.push('');
  R.push(L(
    `> Esportato da Always Adaptive Coach il ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Dati dall’orologio via Intervals.icu. "n/a" = dato non disponibile.`,
    `> Exported from Always Adaptive Coach on ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Data from the watch via Intervals.icu. "n/a" = not available.`
  ));
  R.push('');

  R.push(L('## Atleta e obiettivo', '## Athlete and goal'));
  const mese = CONFIG.programmaInizio ? Number(CONFIG.programmaInizio.slice(5, 7)) - 1 : null;
  const anno = CONFIG.programmaInizio ? CONFIG.programmaInizio.slice(0, 4) : '';
  // eta' alla data della seduta se c'e' la data di nascita, altrimenti quella del profilo (o predefinita)
  const nascita = CONFIG.dataNascita;
  const etaSeduta = nascita ? etaDa(nascita, data) : CONFIG.eta;
  const dataIt = (d) => `${Number(d.slice(8))}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  const etaTxt = nascita
    ? L(`${etaSeduta} anni (nato/a il ${dataIt(nascita)})`, `${etaSeduta} (born ${dataIt(nascita)})`)
    : CONFIG.etaImpostata ? L(`${etaSeduta} anni`, `${etaSeduta}`) : L(`${etaSeduta} anni (valore predefinito, non indicato dall'atleta)`, `${etaSeduta} (default value, not entered by the athlete)`);
  R.push(L(
    `- Età ${etaTxt};${mese != null ? ` ha ripreso a correre a ${MESI_IT[mese]} ${anno} dopo anni di inattività.` : ''}`,
    `- Age ${etaTxt};${mese != null ? ` started running again in ${MESI_EN[mese]} ${anno} after years of inactivity.` : ''}`
  ));
  // Corpo: altezza, peso (il piu' recente fino alla data della seduta) e BMI
  const corpo = corpoEBmi(data);
  if (corpo.altezza_cm || corpo.peso_kg != null) {
    const parti = [];
    if (corpo.altezza_cm) parti.push(L(`altezza ${corpo.altezza_cm} cm`, `height ${corpo.altezza_cm} cm`));
    if (corpo.peso_kg != null) {
      const fonte = corpo.fonte_peso === 'misurato' ? L('bilancia', 'scale') : L('profilo', 'profile');
      parti.push(L(`peso ${String(corpo.peso_kg).replace('.', ',')} kg`, `weight ${corpo.peso_kg} kg`) + ` (${fonte}${corpo.data_peso ? `, ${dataIt(corpo.data_peso)}` : ''})`);
    }
    if (corpo.bmi != null) {
      parti.push(L(`BMI ${String(corpo.bmi).replace('.', ',')} (${corpo.categoria.nome.toLowerCase()}; intervallo normopeso per questa altezza ${String(corpo.peso_normo[0]).replace('.', ',')}–${String(corpo.peso_normo[1]).replace('.', ',')} kg)`,
        `BMI ${corpo.bmi} (${corpo.categoria.nome.toLowerCase()}; healthy range for this height ${corpo.peso_normo[0]}–${corpo.peso_normo[1]} kg)`));
    }
    R.push(L(`- Corpo: ${parti.join(', ')}.`, `- Body: ${parti.join(', ')}.`));
    if (corpo.bmi != null) R.push(L(
      '- Nota: il BMI non distingue massa muscolare e grasso; usalo come indicazione per carico e impatto sulle articolazioni, non come diagnosi.',
      '- Note: BMI does not tell muscle from fat; use it as a guide to load and joint impact, not as a diagnosis.'
    ));
  }
  R.push(CONFIG.fcMaxReale
    ? L(`- FC massima **misurata** ${CONFIG.fcMax} bpm (inserita dall'atleta).`, `- **Measured** max HR ${CONFIG.fcMax} bpm (entered by the athlete).`)
    : L(`- FC massima **stimata** ${CONFIG.fcMax} bpm (formula di Tanaka 208 − 0,7 × età, non misurata).`, `- **Estimated** max HR ${CONFIG.fcMax} bpm (Tanaka formula 208 − 0.7 × age, not measured).`));
  const mz = metodoZone();
  R.push(L(`- Zone FC usate dall'app: ${zoneTxt} bpm (${mz.metodo === 'riserva' ? `riserva cardiaca, FC a riposo ${mz.fc_riposo} bpm, corsa facile al massimo all'80% della FC max` : '% della FC max'}).`,
    `- HR zones used by the app: ${zoneTxt} bpm (${mz.metodo === 'riserva' ? `heart-rate reserve, resting HR ${mz.fc_riposo} bpm, easy running capped at 80% of max HR` : '% of max HR'}).`));
  if (p) {
    const o = p.obiettivo;
    const statoOb = { in_linea: L('in linea', 'on track'), ritardo: L(`entro ${o.mesi_limite} mesi`, `within ${o.mesi_limite} months`), oltre: L(`oltre ${o.mesi_limite} mesi`, `beyond ${o.mesi_limite} months`) }[o.stato];
    R.push(L(
      `- Obiettivo: ${o.nome} entro ${o.mesi_obiettivo} mesi (massimo ${o.mesi_limite}). Prima data possibile stimata: ${o.data_stimata}${o.stima_da_dati ? ' (dai dati reali)' : ' (da piano)'}; stato: ${statoOb}.`,
      `- Goal: ${o.nome} within ${o.mesi_obiettivo} months (${o.mesi_limite} at most). Earliest estimated date: ${o.data_stimata}${o.stima_da_dati ? ' (from real data)' : ' (from the plan)'}; status: ${statoOb}.`
    ));
    R.push(L(
      `- Piano: settimana ${p.settimana_piano}/${p.totale_settimane}, fase "${p.fase_corrente.nome}" (${p.fase_corrente.obiettivo}). Aderenza finora: ${v(p.aderenza_pct, '%')}.`,
      `- Plan: week ${p.settimana_piano}/${p.totale_settimane}, phase "${p.fase_corrente.nome}" (${p.fase_corrente.obiettivo}). Adherence so far: ${v(p.aderenza_pct, '%')}.`
    ));
    if (o.previsione_tempo) R.push(L(`- Tempo stimato sull’obiettivo (Riegel): ${durata(o.previsione_tempo.tempo_sec)}.`, `- Estimated goal time (Riegel): ${durata(o.previsione_tempo.tempo_sec)}.`));
  }
  R.push('');

  if (seduta) {
    R.push(L('## Seduta prevista dal piano', '## Planned session'));
    R.push(L(
      `- ${seduta.fase} · ${seduta.titolo} · seduta ${seduta.seduta}/${seduta.sedute_settimana || 3} · tipo: ${P(NOMI_TIPO_SEDUTA[seduta.tipo]) || seduta.tipo}${seduta.scarico ? ' · settimana di scarico' : ''}`,
      `- ${seduta.fase} · ${seduta.titolo} · session ${seduta.seduta}/${seduta.sedute_settimana || 3} · type: ${P(NOMI_TIPO_SEDUTA[seduta.tipo]) || seduta.tipo}${seduta.scarico ? ' · recovery week' : ''}`
    ));
    R.push(L(
      `- Orario previsto ${CONFIG.programmaOra}, durata totale ${seduta.durata_min}′ di cui ${seduta.corsa_min}′ di corsa; FC obiettivo ${seduta.fc_target} bpm.`,
      `- Planned time ${CONFIG.programmaOra}, total duration ${seduta.durata_min}′ of which ${seduta.corsa_min}′ running; target HR ${seduta.fc_target} bpm.`
    ));
    seduta.struttura.forEach((f) => R.push(`  - ${f.fase} ${f.min}′: ${f.testo}`));
    if (seduta.adattata) R.push(L(
      `- **Adattata dal coach**: ${seduta.adattata.motivi.join(', ')}. Originale: ${seduta.adattata.originale}.`,
      `- **Adapted by the coach**: ${seduta.adattata.motivi.join(', ')}. Original: ${seduta.adattata.originale}.`
    ));
    R.push(L(`- Nota del piano: ${seduta.nota}`, `- Plan note: ${seduta.nota}`));
    R.push('');
  }

  R.push(L('## Dati registrati', '## Recorded data'));
  if (!corse.length && !altre.length) R.push(L('- Nessuna attività registrata in questa data.', '- No activity recorded on this date.'));
  corse.forEach((c, i) => {
    const z = limitiZone().find((x) => x.z === c.zona);
    const g = grezze.get(c.id) || {};
    const pct = (x) => Math.round((x / CONFIG.fcMax) * 100);
    R.push(`### ${L('Corsa', 'Run')}${corse.length > 1 ? ` ${i + 1}` : ''}: ${c.nome || L('Corsa', 'Run')} (${c.tipo})`);
    R.push(L('| Metrica | Valore |', '| Metric | Value |'));
    R.push('|---|---|');
    R.push(`| ${L('Distanza', 'Distance')} | ${v(c.distanza, ' km')} |`);
    R.push(`| ${L('Tempo in movimento', 'Moving time')} | ${durata(c.tempo)} |`);
    R.push(`| ${L('Passo medio (camminata compresa)', 'Average pace (incl. walking)')} | ${passo(c.passo_medio)} |`);
    if (c.passo_corsa) {
      R.push(`| ${L('Passo dei soli tratti di corsa', 'Pace of running segments only')} | ${passo(c.passo_corsa)} (${durata(c.tempo_corsa)}, ${v(c.distanza_corsa && round(c.distanza_corsa, 2), ' km')}) |`);
      R.push(`| ${L('FC media in corsa', 'Average HR while running')} | ${v(c.fc_corsa && Math.round(c.fc_corsa), ' bpm')} |`);
    }
    R.push(`| ${L('FC media', 'Average HR')} | ${v(c.fc_media && Math.round(c.fc_media), ' bpm')}${c.fc_media ? ` (${pct(c.fc_media)}% ${L('della max stimata', 'of estimated max')}${z ? `, ${z.z} ${z.nome}` : ''})` : ''} |`);
    R.push(`| ${L('FC massima', 'Max HR')} | ${v(c.fc_max && Math.round(c.fc_max), ' bpm')}${c.fc_max ? ` (${pct(c.fc_max)}%)` : ''} |`);
    R.push(`| ${L('Cadenza', 'Cadence')} | ${v(c.cadenza && Math.round(c.cadenza), L(' passi/min', ' steps/min'))} |`);
    R.push(`| ${L('Dislivello positivo', 'Elevation gain')} | ${v(c.dislivello, ' m')} |`);
    R.push(`| ${L('Efficiency Factor (velocità/FC)', 'Efficiency Factor (speed/HR)')} | ${v(c.efficiency_factor)} |`);
    R.push(`| ${L('Deriva cardiaca (decoupling)', 'Aerobic decoupling')} | ${v(c.decoupling, '%')} |`);
    R.push(`| ${L('Carico (training load)', 'Training load')} | ${v(c.carico)} |`);
    R.push(`| ${L('Calorie', 'Calories')} | ${v(c.calorie, ' kcal')} |`);
    R.push(`| ${L('CTL / ATL / TSB dopo la corsa', 'CTL / ATL / TSB after the run')} | ${v(g.ctl)} / ${v(g.atl)} / ${v(c.tsb)} |`);
    if (c.tempo_zone) {
      const tz = c.tempo_zone, fm = infoFcMax();
      R.push('');
      R.push(`${L('Tempo nelle zone FC', 'Time in HR zones')} (FC max ${fm.valore} bpm, ${fm.fonte === 'misurata' ? L('misurata', 'measured') : L('stimata', 'estimated')}): ` +
        [`< Z1 ${Math.round(tz.sotto.sec / 60)}′ (${Math.round(tz.sotto.pct)}%)`].concat(tz.zone.map((x, k) => `Z${k + 1} ${Math.round(x.sec / 60)}′ (${Math.round(x.pct)}%)`)).join(', ') + '.');
    }
    R.push('');
    if (c.parziali && c.parziali.length) {
      R.push(`${L('Parziali per km', 'Per-km splits')}: ${c.parziali.map((x, k) => `km ${k + 1} ${fmtPasso(x)}`).join(', ')}.`);
    } else {
      R.push(L('_Parziali per km non disponibili per questa attività._', '_Per-km splits not available for this activity._'));
    }
    R.push('');
  });
  if (altre.length) {
    R.push(L('### Altre attività del giorno', '### Other activities that day'));
    altre.forEach((a) => R.push(`- ${a.tipo}${a.nome ? ` "${a.nome}"` : ''}: ${durata(a.durata)}, ${v(a.distanza, ' km')}, ${L('FC media', 'avg HR')} ${v(a.fc_media && Math.round(a.fc_media), ' bpm')}, ${v(a.calorie, ' kcal')}`));
    R.push('');
  }

  R.push(L('## Recupero (dati del giorno)', '## Recovery (that day)'));
  if (w) {
    const base = (campo) => {
      const b = mediaBase(benessere, campo, data);
      return b == null ? '' : L(` (media 28 gg: ${Math.round(b)})`, ` (28-day avg: ${Math.round(b)})`);
    };
    R.push(`- ${L('FC a riposo', 'Resting HR')}: ${v(w.fc_riposo, ' bpm')}${base('fc_riposo')}`);
    R.push(`- HRV (SDNN): ${v(w.hrv, ' ms')}${base('hrv')}`);
    R.push(`- ${L('Sonno', 'Sleep')}: ${w.sonno_sec != null ? durata(w.sonno_sec) : 'n/a'}${w.sonno_score != null ? `, ${L('punteggio', 'score')} ${w.sonno_score}` : ''}`);
    R.push(`- ${L('Passi', 'Steps')}: ${v(w.passi)}${w.peso != null ? ` · ${L('Peso', 'Weight')}: ${w.peso} kg` : ''}${w.vo2max != null ? ` · VO2max: ${w.vo2max}` : ''}`);
  } else {
    R.push(L('- Nessun dato di salute per questo giorno.', '- No health data for this day.'));
  }
  R.push('');

  const s = st.statistiche;
  const segno = (x) => (x > 0 ? '+' : '');
  R.push(L('## Contesto: ultime 4 settimane', '## Context: last 4 weeks'));
  R.push(L(
    `- Corse: ${s.ultime_4_settimane.corse}, km totali: ${s.ultime_4_settimane.km}${s.ultime_4_settimane.km_var_pct != null ? ` (${segno(s.ultime_4_settimane.km_var_pct)}${s.ultime_4_settimane.km_var_pct}% sulle 4 precedenti)` : ''}`,
    `- Runs: ${s.ultime_4_settimane.corse}, total km: ${s.ultime_4_settimane.km}${s.ultime_4_settimane.km_var_pct != null ? ` (${segno(s.ultime_4_settimane.km_var_pct)}${s.ultime_4_settimane.km_var_pct}% vs previous 4)` : ''}`
  ));
  R.push(`- ${L('Efficiency Factor medio', 'Average Efficiency Factor')}: ${v(s.efficienza.valore)}${s.efficienza.var_pct != null ? ` (${segno(s.efficienza.var_pct)}${s.efficienza.var_pct}%)` : ''}`);
  R.push(L(
    `- Passo medio corse facili (Z1–Z2): ${passo(s.passo_facile.valore)}; tempo in Z1–Z2: ${v(s.tempo_facile_pct, '%')}; cadenza media: ${v(s.cadenza, ' ppm')}`,
    `- Average easy-run pace (Z1–Z2): ${passo(s.passo_facile.valore)}; time in Z1–Z2: ${v(s.tempo_facile_pct, '%')}; average cadence: ${v(s.cadenza, ' spm')}`
  ));
  const precedenti = st.corse.filter((c) => c.data < data).slice(0, 5);
  if (precedenti.length) {
    R.push('');
    R.push(L('Corse precedenti:', 'Previous runs:'));
    R.push(L('| Data | Km | Tempo | Passo | FC media | Zona |', '| Date | Km | Time | Pace | Avg HR | Zone |'));
    R.push('|---|---|---|---|---|---|');
    precedenti.forEach((c) => R.push(`| ${c.data} | ${v(c.distanza)} | ${durata(c.tempo)} | ${passo(c.passo_medio)} | ${v(c.fc_media && Math.round(c.fc_media))} | ${v(c.zona)} |`));
  }
  if (p && p.storia.length) {
    const esiti = { avanti: L('avanti', 'forward'), ripeti: L('ripetuta', 'repeated'), indietro: L('indietro', 'back') };
    R.push('');
    R.push(L('Adattamenti del piano più recenti:', 'Most recent plan adaptations:'));
    p.storia.slice(0, 4).forEach((x) => R.push(L(
      `- ${x.da} → ${x.a} (piano sett. ${x.settimana_piano}): ${x.fatte}/3 sedute, ${x.motivi.join(', ')} → ${esiti[x.esito]}`,
      `- ${x.da} → ${x.a} (plan wk ${x.settimana_piano}): ${x.fatte}/3 sessions, ${x.motivi.join(', ')} → ${esiti[x.esito]}`
    )));
  }
  R.push('');

  R.push(L('## Cosa vorrei da te', '## What I would like from you'));
  const haCorpo = corpo.altezza_cm || corpo.peso_kg != null;
  const notaCorpo = L(
    `Nel valutare carico, ritmo e recupero tieni conto anche di età${haCorpo ? ', altezza, peso' : ''}${corpo.bmi != null ? ' e BMI' : ''} riportati sopra (es. impatto sulle articolazioni, FC attesa per l’età).`,
    `When judging load, pace and recovery also take into account the age${haCorpo ? ', height, weight' : ''}${corpo.bmi != null ? ' and BMI' : ''} listed above (e.g. joint impact, expected HR for the age).`
  );
  if (perParere) {
    // formato "parere del coach": breve, concreto, con i numeri
    R.push(L(
      'Sei AAC, un allenatore di corsa esperto e pratico. Dammi un parere su questa seduta basandoti solo sui dati qui sopra (se un dato manca, non inventarlo). Il piano si adatta già da solo: i consigli riguardano come eseguire le sedute, non cambiare il programma. La salute viene prima della prestazione; niente diagnosi mediche.',
      'You are AAC, an experienced, practical running coach. Give me feedback on this session based only on the data above (if something is missing, do not invent it). The plan already adapts by itself: tips are about how to run the sessions, not about changing the programme. Health comes before performance; no medical diagnoses.'
    ));
    R.push(notaCorpo);
    R.push(L('Rispondi in italiano con questa struttura, frasi brevi e i numeri che motivano ogni giudizio:', 'Reply in English with this structure, short sentences and the numbers behind each judgement:'));
    R.push(L('1. **Verdetto** in massimo 8 parole, poi 2-3 frasi su com’è andata rispetto al piano e al recupero.', '1. **Verdict** in at most 8 words, then 2-3 sentences on how it went versus the plan and recovery.'));
    R.push(L('2. **Fatto bene**: 1-3 punti.', '2. **Done well**: 1-3 points.'));
    R.push(L('3. **Da migliorare**: 1-3 punti.', '3. **To improve**: 1-3 points.'));
    R.push(L('4. **Prossima volta**: 1-3 consigli pratici.', '4. **Next time**: 1-3 practical tips.'));
    return R.join('\n') + '\n';
  }
  if (LINGUA === 'en') {
    R.push('You are an experienced running coach for beginners. Analyse this session and answer concretely:');
    R.push('1. How did it go compared with the planned session (intensity, HR, pace, duration)?');
    R.push('2. Are there signs of fatigue, overload or injury risk (HR, decoupling, recovery)?');
    R.push('3. What should I change in the next session and in the week?');
    R.push(`4. Am I on track for my goal (${p ? p.obiettivo.nome : 'race'})? What should I improve first?`);
  } else {
    R.push('Sei un allenatore di corsa esperto con principianti. Analizza questa sessione e rispondi in modo concreto:');
    R.push('1. Com’è andata rispetto alla seduta prevista (intensità, FC, passo, durata)?');
    R.push('2. Ci sono segnali di fatica, sovraccarico o rischio infortunio (FC, deriva cardiaca, recupero)?');
    R.push('3. Cosa devo cambiare nella prossima seduta e nella settimana?');
    R.push(`4. Sono in linea con l’obiettivo (${p ? p.obiettivo.nome : 'gara'})? Cosa migliorare per primo?`);
  }
  R.push('');
  R.push(notaCorpo);
  return R.join('\n') + '\n';
}

function costruisciAltreAttivita(oggiStr) {
  const ultime = db
    .prepare('SELECT * FROM altre_attivita WHERE data <= ? ORDER BY data DESC, id DESC LIMIT 10')
    .all(oggiStr);
  const sett = db
    .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(durata), 0) AS sec FROM altre_attivita WHERE data > ? AND data <= ?')
    .get(addDays(oggiStr, -7), oggiStr);
  return { ultime, ultimi_7g: { attivita: sett.n, minuti: Math.round(sett.sec / 60) } };
}

function costruisciCoachData() {
  const oggiStr = oggi();
  const righe = db.prepare('SELECT * FROM attivita WHERE data <= ? ORDER BY data ASC, id ASC').all(oggiStr);

  const base = {
    generato_il: new Date().toISOString(),
    oggi: oggiStr,
    atleta: { eta: CONFIG.eta, eta_impostata: CONFIG.etaImpostata || null, fc_max_stimata: CONFIG.fcMax, fc_max_info: infoFcMax(), soglie_piano: soglieFcPiano(), obiettivo: P(obiettivoCorrente().nome), codice_obiettivo: CONFIG.obiettivo || 'mezza' },
    soglie: SOGLIE,
    sincronizzazione: statoSync(),
    collegamento: statoCollegamento(oggiStr),
    salute: costruisciSalute(oggiStr),
    altre_attivita: costruisciAltreAttivita(oggiStr),
    programma: costruisciProgramma(oggiStr),
  };
  base.previsioni = costruisciPrevisioni(oggiStr, base.programma);
  base.passo = costruisciPasso(oggiStr, base.programma, base.previsioni);

  if (!righe.length) {
    return {
      ...base,
      vuoto: true,
      sorgente_dati: 'nessuna',
      stato: null,
      tsb_7g: [],
      tsb_serie: [],
      settimane: [],
      prossimi_allenamenti: [],
      ultime_corse: [],
    };
  }

  const soloMock = righe.every((r) => r.origine === 'mock');
  const serie = costruisciSerieGiornaliera(oggiStr, soloMock);
  const stato = valutaStato(serie);

  return {
    ...base,
    vuoto: false,
    sorgente_dati: soloMock ? 'simulati' : 'intervals',
    stato,
    tsb_7g: serie.slice(-7),
    tsb_serie: serie.slice(-42),
    settimane: aggregaSettimane(righe, oggiStr, 12),
    prossimi_allenamenti: pianificaAllenamenti(righe, stato, oggiStr),
    ultime_corse: righe
      .slice(-8)
      .reverse()
      .map((r) => ({
        id: r.id,
        data: r.data,
        distanza: r.distanza,
        tempo: r.tempo,
        passo_medio: r.passo_medio,
        fc_media: r.fc_media,
        tsb: r.tsb,
        efficiency_factor: r.efficiency_factor,
        origine: r.origine,
      })),
  };
}

// ===========================================================================
// Server HTTP
// ===========================================================================

function creaApp() {
  const app = express();
  app.disable('x-powered-by');
  // Davanti c'e' solo il frontend nginx sulla rete interna di Docker: si fidano solo gli indirizzi privati
  app.set('trust proxy', 'uniquelocal');

  // Lingua dei testi generati per questa richiesta
  app.use((req, res, next) => {
    LINGUA = req.query.lang === 'en' ? 'en' : 'it';
    next();
  });

  // Healthcheck interno (prima del controllo identita')
  app.get('/healthz', (req, res) => {
    try {
      account.sistema.prepare('SELECT 1').get();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false });
    }
  });

  // Difesa in profondita': Nginx imposta sempre X-Forwarded-Email dopo l'auth_request.
  // Se ALLOWED_EMAIL e' definita, il backend rifiuta qualunque altra identita'.
  app.use((req, res, next) => {
    if (CONFIG.allowedEmail) {
      const email = String(req.get('x-forwarded-email') || '').trim().toLowerCase();
      if (email !== CONFIG.allowedEmail) return res.status(403).json({ errore: L('Accesso negato', 'Access denied') });
    }
    next();
  });

  // Login con Google, sessioni, profilo e amministrazione utenti; da qui in poi ogni richiesta ha il suo utente
  account.monta(app, { L, demo });
  notifiche.monta(app, { L });
  // Strava: connetti (OAuth), ritorno, scollega. Collegato: prima sincronizzazione subito. Scollegato: via le sue attivita'.
  const utenteAttivo = (id) => account.utentiAttivi().find((x) => x.id === id);
  strava.monta(app, {
    L,
    csrf: (req, res, next) => (req.get('x-requested-with') === 'coach' ? next() : res.status(400).json({ errore: L('Richiesta non valida', 'Invalid request') })),
    quandoCollegato: (id) => { const u = utenteAttivo(id); if (u) contesto.run(account.contestoDi(u), () => avviaSync('strava')).catch(() => {}); },
    quandoScollegato: (id) => {
      const u = utenteAttivo(id);
      if (!u) return;
      const udb = account.contestoDi(u).db;
      const a = udb.prepare("DELETE FROM attivita WHERE id LIKE 's%'").run().changes, b = udb.prepare("DELETE FROM altre_attivita WHERE id LIKE 's%'").run().changes;
      console.log(`[strava] u${id}: cancellate ${a} corse e ${b} altre attivita' arrivate da Strava`);
    },
  });

  // Statistiche di utilizzo di un utente (solo amministratore, non durante il "Vedi come"):
  // ultimi 35 giorni, fascia oraria (30 giorni) e allenamento rispetto al piano (4 settimane).
  app.get('/api/admin/utenti/:id/uso', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.vero || req.vero.ruolo !== 'admin' || req.vero !== req.utente) return res.status(403).json({ errore: L('Solo per l’amministratore', 'Admins only') });
    const sis = account.sistema;
    const u = sis.prepare('SELECT * FROM utenti WHERE id = ?').get(parseInt(req.params.id, 10));
    if (!u) return res.status(404).json({ errore: L('Utente non trovato', 'User not found') });
    const oggiStr = oggi();
    const giorniFa = (n) => addDays(oggiStr, -n);
    const righe = sis.prepare('SELECT giorno, aperture, minuti, prima, ultima, ore FROM uso WHERE utente_id = ? AND giorno >= ? ORDER BY giorno').all(u.id, giorniFa(34));
    const ore = Array(24).fill(0);
    for (const r of righe.filter((x) => x.giorno >= giorniFa(29))) r.ore.split(',').forEach((m, h) => { ore[h] += Number(m) || 0; });
    const ult = sis.prepare('SELECT giorno, ultima FROM uso WHERE utente_id = ? ORDER BY giorno DESC LIMIT 1').get(u.id);
    const r30 = righe.filter((x) => x.giorno >= giorniFa(29));
    // allenamento nelle ultime 4 settimane: corse fatte e sedute del piano gia' passate
    let allenamento = null;
    try {
      contesto.run(account.contestoDi(u), () => {
        const da = giorniFa(27);
        const corse = db.prepare("SELECT COUNT(*) AS n FROM attivita WHERE origine = 'intervals' AND data >= ? AND data <= ?").get(da, oggiStr).n;
        const prog = costruisciProgramma(oggiStr);
        const passate = prog ? prog.calendario.filter((c) => c.data >= da && c.data < oggiStr) : [];
        allenamento = { corse, previste: passate.length, fatte: passate.filter((c) => c.fatta).length, piano: Boolean(prog) };
      });
    } catch (e) {
      console.warn(`[admin] allenamento u${u.id}: ${e.message}`);
    }
    res.json({
      utente: { id: u.id, nome: u.nome, email: u.email, foto: u.foto, creato: u.creato },
      oggi: oggiStr,
      ultima: ult ? `${ult.giorno} ${ult.ultima}` : null,
      giorni30: r30.length,
      minuti_medi: r30.length ? Math.round(r30.reduce((t, x) => t + x.minuti, 0) / r30.length) : 0,
      aperture30: r30.reduce((t, x) => t + x.aperture, 0),
      giorni: righe.map((x) => ({ giorno: x.giorno, minuti: x.minuti, aperture: x.aperture, prima: x.prima, ultima: x.ultima })),
      ore,
      allenamento,
    });
  });

  app.get('/api/diario', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const en = LINGUA === 'en';
    try { res.json({ voci: db.prepare(`SELECT quando, tipo, ${en ? 'COALESCE(titolo_en, titolo)' : 'titolo'} AS titolo, ${en ? 'COALESCE(testo_en, testo)' : 'testo'} AS testo FROM diario ORDER BY quando DESC, id DESC LIMIT 200`).all() }); }
    catch (_) { res.json({ voci: [] }); }
  });

  app.get('/api/coach-data', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    // All'apertura dell'app: se l'ultimo sync ha piu' di 2 minuti, prendo i dati nuovi da Intervals
    // (sonno, FC a riposo, HRV arrivano a orari diversi) aspettando al massimo 4 secondi.
    try {
      // anche un tentativo fallito conta: se Intervals non risponde non lo ritento a ogni apertura
      let ultimo = getMeta('ultimo_sync');
      try { ultimo = JSON.parse(getMeta('ultimo_sync_esito') || 'null')?.quando || ultimo; } catch (_) {}
      if (sincronizzazioneConfigurata() && (!ultimo || Date.now() - Date.parse(ultimo) > 2 * 60 * 1000)) {
        await Promise.race([avviaSync('apertura').catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
      }
    } catch (_) {
      /* i dati gia' salvati restano validi */
    }
    try {
      const cd = costruisciCoachData();
      if (!req.demo) { try { notificaVoci(req.vero && req.vero === req.utente ? req.vero.id : null, registraDiario(cd)); } catch (e) { console.warn('[diario]', e.message); } }
      try { cd.diario_ultimo = db.prepare('SELECT MAX(quando) AS q FROM diario').get().q; } catch (_) { cd.diario_ultimo = null; }
      res.json(cd);
    } catch (e) {
      console.error('[api] coach-data:', e);
      res.status(500).json({ errore: L('Errore interno nel calcolo dei dati del coach', 'Internal error computing coach data') });
    }
  });

  app.post('/api/sync', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    // Protezione CSRF aggiuntiva: un form cross-site non puo' impostare questo header
    if (req.get('x-requested-with') !== 'coach') {
      return res.status(400).json({ ok: false, errore: L('Richiesta non valida', 'Invalid request') });
    }
    try {
      const esito = await avviaSync('manuale');
      res.json(esito);
    } catch (e) {
      res.status(e.status || 502).json({ ok: false, errore: e.message });
    }
  });

  app.get('/api/sessione/:data/markdown', (req, res) => {
    const data = req.params.data;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ errore: L('Data non valida', 'Invalid date') });
    try {
      const md = markdownSessione(data, req.query.per === 'parere');
      if (!md) return res.status(404).json({ errore: L('Nessuna seduta o attività in questa data', 'No session or activity on this date') });
      res.set('Content-Type', 'text/markdown; charset=utf-8');
      res.set('Cache-Control', 'no-store');
      res.send(md);
    } catch (e) {
      console.error('[api] markdown:', e);
      res.status(500).json({ errore: L('Errore nella generazione del testo', 'Error generating the text') });
    }
  });

  app.get('/api/valutazione', (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const ob = String(req.query.obiettivo || '');
      const c = contesto.getStore();
      res.json(OBIETTIVI[ob] && c ? contesto.run({ ...c, cfg: { ...c.cfg, obiettivo: ob } }, () => valutaLivello(oggi())) : valutaLivello(oggi()));
    } catch (e) {
      console.error('[api] valutazione:', e);
      res.status(500).json({ errore: L('Errore interno', 'Internal error') });
    }
  });

  // Anteprima del piano con un altro obiettivo/intensita' (profilo, prima di salvare): stesso motore, niente scritto
  app.get('/api/piano/anteprima', (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const c = contesto.getStore();
      const ob = String(req.query.obiettivo || '');
      const int = String(req.query.intensita || '');
      const gq = req.query.giorni != null ? String(req.query.giorni) : null; // "1,3,5" oppure "" = nessuno
      const modo = req.query.modo != null ? String(req.query.modo) : null;
      const inizioQ = req.query.inizio != null ? String(req.query.inizio) : null; // prima seduta scelta nella guida (piano non ancora iniziato)
      if (inizioQ && !(/^\d{4}-\d{2}-\d{2}$/.test(inizioQ) && !isNaN(Date.parse(inizioQ + 'T00:00:00Z')))) return res.status(400).json({ errore: L('Parametri non validi', 'Invalid parameters') });
      const nonIniziato = !c || !c.cfg.programmaInizio || c.cfg.programmaInizio > oggi();
      const giorniOk = gq === null || gq === '' || (/^[0-6](,[0-6]){0,6}$/.test(gq) && new Set(gq.split(',')).size === gq.split(',').length);
      if (!c || !OBIETTIVI[ob] || (int && !INTENSITA[int]) || !giorniOk || (modo && !['preferiti', 'fissi'].includes(modo))) return res.status(400).json({ errore: L('Parametri non validi', 'Invalid parameters') });
      if (!c.cfg.programmaInizio && !inizioQ) return res.status(404).json({ errore: L('Piano non ancora impostato', 'Plan not set up yet') });
      const cambio = ob !== (c.cfg.obiettivo || 'mezza') ? mappaCambioObiettivo(c, ob) : null;
      const cfg = { ...c.cfg, obiettivo: ob, intensita: int || c.cfg.intensita, ...(cambio ? { ripartiData: cambio.riparti_data, ripartiSett: cambio.riparti_settimana } : {}) };
      if (gq !== null) cfg.giorniSedute = gq === '' ? null : gq.split(',').map(Number);
      if (modo) cfg.giorniModo = modo;
      if (inizioQ && nonIniziato) { cfg.programmaInizio = inizioQ; cfg.ripartiData = null; cfg.ripartiSett = null; }
      const out = contesto.run({ ...c, cfg }, () => {
        const p = costruisciProgramma(oggi());
        if (!p) return null;
        const f = faseDi(p.settimana_piano);
        return {
          obiettivo: p.obiettivo.nome,
          riparte_da_oggi: Boolean(cambio), // dalla settimana in corso, con lo storico che resta
          settimana_piano: p.settimana_piano,
          settimane_totali: pianoAttivo().length,
          fase: f.nome,
          data_gara: p.obiettivo.data_gara,
          frequenza: p.frequenza,
          data_stimata: p.obiettivo.data_stimata,
          // le sedute della prossima settimana del piano: S1, S2, S3… e il tipo, senza minuti
          prossime: p.prossime.slice(0, 5).filter((x, _, arr) => x.settimana === arr[0].settimana).map((x) => ({ data: x.data, giorno: x.giorno, settimana: x.settimana, seduta: x.seduta, tipo: x.tipo, nome: x.titolo.replace(/^(Sett\.|Wk) \d+ · /, ''), extra: x.extra })),
        };
      });
      if (!out) return res.status(404).json({ errore: L('Piano non disponibile', 'Plan not available') });
      res.json(out);
    } catch (e) {
      console.error('[api] anteprima piano:', e);
      res.status(500).json({ errore: L('Errore interno', 'Internal error') });
    }
  });

  app.get('/api/storico', (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.json(costruisciStorico(oggi()));
    } catch (e) {
      console.error('[api] storico:', e);
      res.status(500).json({ errore: L('Errore interno nel calcolo dello storico', 'Internal error computing history') });
    }
  });

  app.get('/api/attivita/:id', (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const a = costruisciAttivita(req.params.id, oggi());
      if (!a) return res.status(404).json({ errore: L('Allenamento non trovato', 'Workout not found') });
      try { a.parere = parereCorsa(req.params.id, oggi(), a); } catch (e) { console.warn('[parere]', e.message); }
      res.json(a);
    } catch (e) {
      console.error('[api] attivita:', e);
      res.status(500).json({ errore: L('Errore interno', 'Internal error') });
    }
  });

  app.get('/api/salute/storia', (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.json(costruisciStoriaSalute(oggi()));
    } catch (e) {
      console.error('[api] salute:', e);
      res.status(500).json({ errore: L('Errore interno', 'Internal error') });
    }
  });

  // Segna / annulla a mano una seduta come fatta (es. orologio dimenticato)
  // ---- Scarpe ----
  const jsonBody = express.json({ limit: '8kb' });
  const soloCoach = (req, res, next) => (req.get('x-requested-with') === 'coach' ? next() : res.status(400).json({ errore: L('Richiesta non valida', 'Invalid request') }));
  // Sedute del piano nel calendario di Intervals.icu (interruttore nel profilo, sezione Intervals).
  // Scrive nel calendario dell'utente: mai in demo (gia' bloccato) ne' durante "Vedi come".
  app.put('/api/intervals/sedute', soloCoach, jsonBody, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.demo || req.vero !== req.utente) return res.status(403).json({ ok: false, errore: L('Non disponibile qui', 'Not available here') });
    const b = req.body || {};
    if (typeof b.attivo !== 'boolean') return res.status(400).json({ ok: false, errore: L('Richiesta non valida', 'Invalid request') });
    if (b.attivo && !intervalsConfigurato()) return res.status(400).json({ ok: false, errore: L('Prima collega Intervals.icu', 'Connect Intervals.icu first') });
    const id = req.utente.id;
    const lingua = b.lingua === 'en' ? 'en' : b.lingua === 'it' ? 'it' : LINGUA === 'en' ? 'en' : 'it';
    account.sistema.prepare('UPDATE utenti SET intervals_sedute = ? WHERE id = ?').run(b.attivo ? lingua : null, id);
    try {
      const r = b.attivo ? await aggiornaSeduteIntervals(true) : { tolte: await togliSeduteIntervals() };
      if (!r) throw new Error('nessun invio');
      res.json({ ok: true, attivo: b.attivo, ...r });
    } catch (e) {
      console.warn(`[intervals:sedute] u${id}: ${e.message}`);
      // la scelta resta salvata: al prossimo sync (ogni 15 minuti) si riprova
      res.status(502).json({ ok: false, attivo: b.attivo, errore: L('Scelta salvata, ma Intervals.icu non ha risposto: riprovo al prossimo aggiornamento.', 'Choice saved, but Intervals.icu didn’t answer: I’ll retry at the next sync.') });
    }
  });

  app.get('/api/scarpe', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ scarpe: elencoScarpe() }); });
  app.post('/api/scarpe', soloCoach, jsonBody, (req, res) => {
    const r = salvaScarpa(null, req.body || {});
    res.status(r.ok ? 200 : 400).json(r.ok ? { ok: true, id: r.id, scarpe: elencoScarpe() } : r);
  });
  app.put('/api/scarpe/:id', soloCoach, jsonBody, (req, res) => {
    const r = salvaScarpa(parseInt(req.params.id, 10), req.body || {});
    res.status(r.ok ? 200 : 400).json(r.ok ? { ok: true, scarpe: elencoScarpe() } : r);
  });
  app.delete('/api/scarpe/:id', soloCoach, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.transaction(() => {
      db.prepare('UPDATE attivita SET scarpa_id = NULL WHERE scarpa_id = ?').run(id);
      db.prepare('DELETE FROM scarpe WHERE id = ?').run(id);
    })();
    res.json({ ok: true, scarpe: elencoScarpe() });
  });
  app.put('/api/attivita/:id/scarpa', soloCoach, jsonBody, (req, res) => {
    const sid = req.body && req.body.scarpa_id != null && req.body.scarpa_id !== '' ? parseInt(req.body.scarpa_id, 10) : null;
    if (sid != null && !db.prepare('SELECT 1 FROM scarpe WHERE id = ?').get(sid)) return res.status(400).json({ errore: L('Scarpa non trovata', 'Shoe not found') });
    const r = db.prepare("UPDATE attivita SET scarpa_id = ? WHERE id = ? AND origine = 'intervals'").run(sid, req.params.id);
    res.status(r.changes ? 200 : 404).json({ ok: Boolean(r.changes), scarpe: elencoScarpe() });
  });

  app.post('/api/seduta/:data/fatta', (req, res) => {
    if (req.get('x-requested-with') !== 'coach') return res.status(400).json({ errore: L('Richiesta non valida', 'Invalid request') });
    const data = req.params.data;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data > oggi()) return res.status(400).json({ errore: L('Data non valida', 'Invalid date') });
    const esiste = db.prepare('SELECT 1 FROM sedute_manuali WHERE data = ?').get(data);
    if (esiste) db.prepare('DELETE FROM sedute_manuali WHERE data = ?').run(data);
    else db.prepare('INSERT INTO sedute_manuali (data, creato) VALUES (?, ?)').run(data, new Date().toISOString());
    res.json({ ok: true, data, fatta: !esiste });
  });

  app.get('/api/programma.ics', (req, res) => {
    const ics = generaIcs();
    if (!ics) return res.status(404).json({ errore: L('Piano non attivo', 'Plan not active') });
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="allenamenti-ripartenza.ics"');
    res.set('Cache-Control', 'no-store');
    res.send(ics);
  });

  app.use('/api', (req, res) => res.status(404).json({ errore: L('Endpoint non trovato', 'Endpoint not found') }));

  // Il frontend e' un servizio separato (container nginx in frontend/). Solo per lo sviluppo locale
  // il backend puo' servire i file statici: PUBLIC_DIR=../frontend/public node server.js
  if (CONFIG.publicDir && fs.existsSync(CONFIG.publicDir)) {
    app.use(
      express.static(CONFIG.publicDir, {
        index: 'index.html',
        etag: true,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) res.set('Cache-Control', 'no-cache');
        },
      })
    );
  }

  // Errori non gestiti: risposta generica, mai lo stack o i dettagli interni al client
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const stato = err.status || err.statusCode || 500;
    if (stato >= 500) console.error(`[api] ${req.method} ${req.path}:`, err);
    if (res.headersSent) return;
    res.status(stato >= 400 && stato < 600 ? stato : 500)
      .json({ errore: stato < 500 ? L('Richiesta non valida', 'Invalid request') : L('Errore interno', 'Internal error') });
  });

  return app;
}

function main() {
  account.inizializza();
  contesto.run(account.contestoDi(account.admin()), seedSeVuoto);
  const app = creaApp();
  const server = app.listen(CONFIG.port, '0.0.0.0', () => {
    console.log(`[server] Always Adaptive Coach in ascolto sulla porta ${CONFIG.port} (db: ${CONFIG.dbPath})`);
  });
  avviaScheduler();

  const chiudi = (segnale) => {
    console.log(`[server] ${segnale} ricevuto, chiusura...`);
    server.close(() => {
      for (const d of dbAperti.values()) {
        try {
          d.close();
        } catch (_) {
          /* gia' chiuso */
        }
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('unhandledRejection', (e) => console.error('[server] promessa rifiutata non gestita:', e));
  process.on('SIGTERM', () => chiudi('SIGTERM'));
  process.on('SIGINT', () => chiudi('SIGINT'));
}

if (require.main === module) {
  main();
}

module.exports = {
  analizzaStream,
  testoNotifica, // testi delle notifiche (verifiche)
  aggiornaDiariTutti, // diario e avvisi dopo la sincronizzazione (verifiche)
  descrizioneIntervals, eventiSeduteIntervals, // sedute inviate a Intervals (verifiche)
  stessaUscita, caricoDaFc, unisciDoppioni, parereCorsa, // verifiche // doppioni Intervals/Strava e carico stimato (verifiche)
  // zone cardiache (usate anche nei test)
  fcMaxTanaka,
  soglieZone,
  indiceZona,
  limitiZone,
  soglieFcPiano,
  metodoZone,
  tempoInZone,
  istogrammaDaStreams,
  creaApp,
  costruisciCoachData,
  costruisciProgramma,
  mappaCambioObiettivo,
  generaDatiSimulati,
  seedSeVuoto,
  eseguiSync,
  normalizzaAttivita,
  valutaStato,
  pianificaAllenamenti,
  db,
  CONFIG,
  account,
  contesto,
};
