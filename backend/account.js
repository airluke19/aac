'use strict';

/**
 * Account: utenti, sessioni, login con Google (OpenID Connect), inviti e profilo.
 * ---------------------------------------------------------------------------
 * - sistema.db (accanto al database delle corse) contiene utenti, sessioni e impostazioni.
 * - Ogni utente ha il SUO database delle corse: l'amministratore usa il corse.db originale,
 *   quindi i dati esistenti non vengono spostati ne' convertiti.
 * - Senza GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / PUBLIC_URL / ADMIN_EMAIL l'app resta a utente
 *   singolo e senza login (comportamento precedente): ogni richiesta e' dell'amministratore.
 * - La chiave API di Intervals.icu e' salvata cifrata (AES-256-GCM).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

// Ambiente dell'istanza: 'staging' mostra il badge BETA nell'app e nella pagina di login
// colori d'accento ammessi (stessi id di FAMIGLIE in app.js e di css/accenti.css)
const COLORI_AMMESSI = new Set(['verde', 'menta', 'azzurro', 'blu', 'indaco', 'viola', 'ambra', 'arancio', 'mandarino', 'volt', 'cremisi', 'fucsia', 'laser',
  'ghiacciaio', 'salvia', 'rame', 'segnale', 'ardesia', 'ciano', 'magenta', 'elettrico', 'ultravioletto', 'corallo', 'oro', 'smeraldo', 'turchese']);
const AMBIENTE = String(process.env.AAC_AMBIENTE || 'production').trim().toLowerCase() === 'staging' ? 'staging' : 'production';
const COOKIE_SESSIONE_VECCHIO = 'aac_sess'; // fino al 7 nov 2026; ora __Host-aac_sess in HTTPS
const COOKIE_OAUTH = 'aac_oauth';
const DURATA_SESSIONE_GIORNI = 30;
// Data di oggi nel fuso dell'app (AAAA-MM-GG)
const oggiLocale = () => new Date().toLocaleDateString('sv-SE', { timeZone: process.env.TZ || 'Europe/Rome' });
// Eta' compiuta a una data (AAAA-MM-GG) da una data di nascita (AAAA-MM-GG)
const etaDa = (nascita, al = oggiLocale()) => {
  if (!nascita) return null;
  const [a, m, g] = nascita.split('-').map(Number), [a2, m2, g2] = al.split('-').map(Number);
  return a2 - a - (m2 < m || (m2 === m && g2 < g) ? 1 : 0);
};
// "1,3,5" -> [1, 3, 5] (giorni preferiti per le sedute, 0 = domenica; il coach li usa quando puo'); altrimenti null
const giorniDa = (v) => (/^[0-6](,[0-6]){0,6}$/.test(v || '') ? String(v).split(',').map(Number) : null);
const MAX_IN_ATTESA = 50; // richieste di accesso non ancora approvate

function creaAccount({ BASE, dbPer, contesto, cambioObiettivo }) {
  const sis = new Database(path.join(BASE.dataDir, 'sistema.db'));
  sis.pragma('journal_mode = WAL');
  sis.pragma('busy_timeout = 5000');
  sis.exec(`
    CREATE TABLE IF NOT EXISTS utenti (
      id               INTEGER PRIMARY KEY,
      email            TEXT UNIQUE NOT NULL,
      nome             TEXT,
      foto             TEXT,
      ruolo            TEXT NOT NULL DEFAULT 'utente',     -- admin | utente
      stato            TEXT NOT NULL DEFAULT 'in_attesa',  -- attivo | in_attesa | bloccato
      db_file          TEXT,
      intervals_key    TEXT,                               -- cifrata
      athlete_id       TEXT,
      eta              INTEGER,
      programma_inizio TEXT,
      programma_ora    TEXT,
      creato           TEXT NOT NULL,
      ultimo_accesso   TEXT
    );
    CREATE TABLE IF NOT EXISTS sessioni (
      hash      TEXT PRIMARY KEY,
      utente_id INTEGER NOT NULL,
      creata    TEXT NOT NULL,
      scade     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessioni_utente ON sessioni (utente_id);
  `);
  // Livello di partenza e FC massima personale
  {
    const col = new Set(sis.prepare('PRAGMA table_info(utenti)').all().map((c) => c.name));
    if (!col.has('settimana_iniziale')) sis.exec('ALTER TABLE utenti ADD COLUMN settimana_iniziale INTEGER');
    if (!col.has('fc_max')) sis.exec('ALTER TABLE utenti ADD COLUMN fc_max INTEGER');
    if (!col.has('altezza')) sis.exec('ALTER TABLE utenti ADD COLUMN altezza INTEGER'); // cm, per il BMI
    if (!col.has('peso')) sis.exec('ALTER TABLE utenti ADD COLUMN peso REAL'); // kg inserito nel profilo
    if (!col.has('peso_data')) sis.exec('ALTER TABLE utenti ADD COLUMN peso_data TEXT'); // giorno in cui e' stato inserito (per scegliere il dato piu' recente)
    if (!col.has('colore')) sis.exec('ALTER TABLE utenti ADD COLUMN colore TEXT'); // colore principale scelto dall'utente
    if (!col.has('obiettivo')) sis.exec('ALTER TABLE utenti ADD COLUMN obiettivo TEXT'); // 5k | 10k | mezza | maratona (vuoto = mezza)
    if (!col.has('intensita')) sis.exec('ALTER TABLE utenti ADD COLUMN intensita TEXT'); // tranquilla | equilibrata | ambiziosa (vuoto = equilibrata)
    if (!col.has('data_nascita')) sis.exec('ALTER TABLE utenti ADD COLUMN data_nascita TEXT'); // AAAA-MM-GG: se presente l'eta' si calcola da qui
    if (!col.has('intensita_auto')) sis.exec('ALTER TABLE utenti ADD COLUMN intensita_auto INTEGER'); // 0 = bloccata; vuoto/1 = regolata dal coach
    // cambio di obiettivo a piano iniziato: dalla settimana che contiene riparti_data si prosegue dalla
    // settimana riparti_settimana del nuovo piano (data di inizio e storico restano quelli di prima)
    if (!col.has('giorni_modo')) sis.exec('ALTER TABLE utenti ADD COLUMN giorni_modo TEXT'); // preferiti (proposta, default) | fissi (obbligatori)
    if (!col.has('riparti_data')) sis.exec('ALTER TABLE utenti ADD COLUMN riparti_data TEXT');
    if (!col.has('riparti_settimana')) sis.exec('ALTER TABLE utenti ADD COLUMN riparti_settimana INTEGER');
    if (!col.has('giorni_sedute')) sis.exec('ALTER TABLE utenti ADD COLUMN giorni_sedute TEXT'); // giorni preferiti per le sedute, es. "1,3,5" (0 = domenica); vuoto = sceglie il coach
  }
  // Utilizzo dell'app per le statistiche dell'amministratore: un record per utente e giorno (ora locale).
  // Niente IP, dispositivo o pagine viste. Si conserva finche' esiste l'account (si cancella con l'account).
  sis.exec(`
    CREATE TABLE IF NOT EXISTS uso (
      utente_id INTEGER NOT NULL,
      giorno    TEXT NOT NULL,              -- AAAA-MM-GG (fuso dell'app)
      aperture  INTEGER NOT NULL DEFAULT 0, -- volte che l'app e' stata aperta (pausa > 30 min = nuova apertura)
      minuti    INTEGER NOT NULL DEFAULT 0, -- minuti con l'app aperta e in primo piano
      prima     TEXT,                       -- HH:MM primo segnale del giorno
      ultima    TEXT,                       -- HH:MM ultimo segnale del giorno
      ore       TEXT NOT NULL DEFAULT '0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0', -- minuti per ora
      PRIMARY KEY (utente_id, giorno)
    );
  `);
  // Impersonificazione: una sessione dell'amministratore puo' "vedere come" un altro utente
  if (!sis.prepare('PRAGMA table_info(sessioni)').all().some((c) => c.name === 'impersona_id')) {
    sis.exec('ALTER TABLE sessioni ADD COLUMN impersona_id INTEGER');
  }

  // LOGIN_GOOGLE=off spegne il login anche se configurato (es. staging): modalita' utente singolo.
  const loginSpento = String(process.env.LOGIN_GOOGLE || 'on').trim().toLowerCase() === 'off';
  const attivo = !loginSpento && Boolean(BASE.googleClientId && BASE.googleClientSecret && BASE.publicUrl && BASE.adminEmail);
  const sicuro = BASE.publicUrl.startsWith('https://');
  // In HTTPS il cookie di sessione usa il prefisso __Host-: il browser lo accetta solo Secure, Path=/
  // e senza Domain, quindi nessun sottodominio puo' impostarlo o sovrascriverlo.
  const COOKIE_SESSIONE = sicuro ? '__Host-aac_sess' : COOKIE_SESSIONE_VECCHIO;

  // ---- cifratura della chiave Intervals ----
  const chiave = (() => {
    if (BASE.appSecret) return crypto.createHash('sha256').update(BASE.appSecret).digest();
    const f = path.join(BASE.dataDir, '.chiave-app');
    // 'wx': crea il file solo se non esiste, in un'unica operazione (niente race tra controllo e scrittura)
    try { fs.writeFileSync(f, crypto.randomBytes(32).toString('base64'), { mode: 0o600, flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    return Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'base64');
  })();
  const cifra = (testo) => {
    if (!testo) return null;
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', chiave, iv);
    const enc = Buffer.concat([c.update(String(testo), 'utf8'), c.final()]);
    return 'v1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
  };
  const decifra = (v) => {
    if (!v) return '';
    try {
      const b = Buffer.from(String(v).slice(3), 'base64');
      const d = crypto.createDecipheriv('aes-256-gcm', chiave, b.subarray(0, 12));
      d.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
    } catch (_) {
      return '';
    }
  };

  const ora = () => new Date().toISOString();
  const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
  // nome unico: un id riusato dopo una rimozione non deve mai ritrovare il database di un altro utente
  const dbFileNuovo = (id) => path.join(BASE.dataDir, 'utenti', `u${id}-${crypto.randomBytes(6).toString('hex')}.db`);

  // ---- primo avvio: l'amministratore eredita il database e le impostazioni esistenti ----
  function inizializza() {
    const n = sis.prepare('SELECT COUNT(*) AS n FROM utenti').get().n;
    if (!n) {
      if (fs.existsSync(BASE.dbPath)) {
        const copia = path.join(BASE.dataDir, `corse.backup-${ora().slice(0, 10)}.db`);
        if (!fs.existsSync(copia)) {
          dbPer(BASE.dbPath).exec(`VACUUM INTO '${copia.replace(/'/g, "''")}'`);
          console.log(`[account] Backup del database prima della migrazione: ${copia}`);
        }
      }
      sis.prepare(`INSERT INTO utenti (email, ruolo, stato, db_file, intervals_key, athlete_id, eta, programma_inizio, programma_ora, creato)
                   VALUES (?, 'admin', 'attivo', ?, ?, ?, ?, ?, ?, ?)`)
        .run(BASE.adminEmail || 'admin@locale', BASE.dbPath, cifra(BASE.apiKey), BASE.athleteId || null, BASE.eta, BASE.programmaInizio, BASE.programmaOra, ora());
      console.log('[account] Creato l\'account amministratore con i dati esistenti.');
    }
    // l'email dell'amministratore segue ADMIN_EMAIL (es. impostata dopo il primo avvio)
    const adm = admin();
    if (BASE.adminEmail && adm.email !== BASE.adminEmail) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(BASE.adminEmail)) {
        console.error(`[account] ADMIN_EMAIL non e' un indirizzo email valido ("${BASE.adminEmail}"): l'amministratore non potra' accedere.`);
      } else {
        const altro = sis.prepare('SELECT * FROM utenti WHERE email = ? AND id <> ?').get(BASE.adminEmail, adm.id);
        if (altro && !altro.db_file && altro.ruolo !== 'admin') {
          // l'amministratore era entrato prima che ADMIN_EMAIL fosse corretta: unisco la richiesta (senza dati) al suo account
          sis.transaction(() => {
            sis.prepare('UPDATE sessioni SET utente_id = ? WHERE utente_id = ?').run(adm.id, altro.id);
            sis.prepare('DELETE FROM utenti WHERE id = ?').run(altro.id);
            sis.prepare('UPDATE utenti SET email = ?, nome = COALESCE(nome, ?), foto = COALESCE(foto, ?), ultimo_accesso = ? WHERE id = ?')
              .run(BASE.adminEmail, altro.nome, altro.foto, altro.ultimo_accesso, adm.id);
          })();
          console.log(`[account] Unita la richiesta di ${BASE.adminEmail} all'account amministratore.`);
        } else if (!altro) {
          sis.prepare('UPDATE utenti SET email = ? WHERE id = ?').run(BASE.adminEmail, adm.id);
        } else {
          console.warn(`[account] ADMIN_EMAIL ${BASE.adminEmail} appartiene gia' a un altro utente con dati: non la assegno all'amministratore.`);
        }
      }
    }
    sis.prepare('DELETE FROM sessioni WHERE scade < ?').run(ora());
    console.log(attivo
      ? `[account] Login con Google attivo su ${BASE.publicUrl} (amministratore: ${admin().email}).`
      : loginSpento
        ? '[account] Login Google DISATTIVATO (LOGIN_GOOGLE=off): modalita\' utente singolo. Le richieste da internet (Cloudflare) vengono rifiutate.'
        : '[account] Login non configurato: modalita\' utente singolo, nessun accesso richiesto.');
  }

  const admin = () => sis.prepare("SELECT * FROM utenti WHERE ruolo = 'admin' ORDER BY id LIMIT 1").get();
  const perId = (id) => sis.prepare('SELECT * FROM utenti WHERE id = ?').get(id);
  const utentiAttivi = () => sis.prepare("SELECT * FROM utenti WHERE stato = 'attivo' ORDER BY id").all();

  // ---- contesto (database + impostazioni) di un utente, con cache ----
  const cacheCtx = new Map();
  function contestoDi(u) {
    let c = cacheCtx.get(u.id);
    if (!c) {
      if (!u.db_file) {
        sis.prepare('UPDATE utenti SET db_file = ? WHERE id = ?').run(dbFileNuovo(u.id), u.id);
        u = perId(u.id);
      }
      c = {
        utente: { id: u.id, email: u.email, ruolo: u.ruolo },
        db: dbPer(u.db_file),
        cfg: {
          apiKey: decifra(u.intervals_key),
          athleteId: u.athlete_id || '',
          eta: u.eta || 33,
          etaImpostata: u.eta || null,
          dataNascita: u.data_nascita || null,
          altezza: u.altezza || null,
          peso: u.peso || null,
          pesoData: u.peso_data || null,
          programmaInizio: u.programma_inizio || null,
          programmaOra: u.programma_ora || '06:30',
          seedMock: u.ruolo === 'admin' ? BASE.seedMock : false,
          settimanaIniziale: u.settimana_iniziale || 1,
          fcMaxReale: u.fc_max || null,
          obiettivo: u.obiettivo || 'mezza',
          intensita: u.intensita || 'equilibrata',
          giorniSedute: giorniDa(u.giorni_sedute),
          giorniModo: u.giorni_modo === 'fissi' ? 'fissi' : 'preferiti',
          ripartiData: u.riparti_data || null,
          ripartiSett: u.riparti_settimana || null,
        },
      };
      cacheCtx.set(u.id, c);
    }
    return c;
  }
  const dimentica = (id) => cacheCtx.delete(id);

  // ---- cookie ----
  function leggiCookie(req, nome) {
    const h = req.headers.cookie || '';
    for (const parte of h.split(';')) {
      const i = parte.indexOf('=');
      if (i > 0 && parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
    }
    return null;
  }
  function scriviCookie(res, nome, valore, { maxAge, percorso = '/' } = {}) {
    const p = [`${nome}=${encodeURIComponent(valore)}`, `Path=${percorso}`, 'HttpOnly', 'SameSite=Lax'];
    if (sicuro) p.push('Secure');
    if (maxAge != null) p.push(`Max-Age=${maxAge}`);
    res.append('Set-Cookie', p.join('; '));
  }

  // ---- sessioni ----
  function creaSessione(res, utenteId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const scade = new Date(Date.now() + DURATA_SESSIONE_GIORNI * 864e5).toISOString();
    sis.prepare('INSERT INTO sessioni (hash, utente_id, creata, scade) VALUES (?, ?, ?, ?)').run(hash(token), utenteId, ora(), scade);
    scriviCookie(res, COOKIE_SESSIONE, token, { maxAge: DURATA_SESSIONE_GIORNI * 86400 });
  }
  function sessioneDaRichiesta(req) {
    const token = leggiCookie(req, COOKIE_SESSIONE) || (sicuro ? leggiCookie(req, COOKIE_SESSIONE_VECCHIO) : null);
    if (!token) return null;
    const s = sis.prepare('SELECT * FROM sessioni WHERE hash = ?').get(hash(token));
    return s && s.scade >= ora() ? s : null;
  }
  function utenteDaRichiesta(req) {
    if (!attivo) return admin();
    const s = sessioneDaRichiesta(req);
    return s ? perId(s.utente_id) || null : null;
  }

  // ---- Google OpenID Connect (code flow + PKCE) ----
  const redirectUri = () => `${BASE.publicUrl}/auth/google/callback`;

  function avviaLogin(req, res) {
    const state = crypto.randomBytes(16).toString('base64url');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    scriviCookie(res, COOKIE_OAUTH, `${state}.${verifier}`, { maxAge: 600, percorso: '/auth' });
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.search = new URLSearchParams({
      client_id: BASE.googleClientId,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    res.redirect(u.toString());
  }

  async function completaLogin(req, res) {
    const vai = (q) => res.redirect('/login.html' + (q ? '?' + q : ''));
    const salvato = leggiCookie(req, COOKIE_OAUTH) || '';
    scriviCookie(res, COOKIE_OAUTH, '', { maxAge: 0, percorso: '/auth' });
    const [state, verifier] = salvato.split('.');
    if (!state || !verifier || req.query.state !== state || !req.query.code) return vai('errore=richiesta');
    try {
      const tr = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(req.query.code),
          client_id: BASE.googleClientId,
          client_secret: BASE.googleClientSecret,
          redirect_uri: redirectUri(),
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!tr.ok) throw new Error(`token HTTP ${tr.status}`);
      const tok = await tr.json();
      // identita' letta direttamente da Google con il token appena ottenuto (canale TLS + client secret)
      const ur = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${tok.access_token}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!ur.ok) throw new Error(`userinfo HTTP ${ur.status}`);
      const info = await ur.json();
      const email = String(info.email || '').trim().toLowerCase();
      if (!email || info.email_verified !== true) return vai('errore=email');

      let u = sis.prepare('SELECT * FROM utenti WHERE email = ?').get(email);
      if (!u) {
        const inAttesa = sis.prepare("SELECT COUNT(*) AS n FROM utenti WHERE stato = 'in_attesa'").get().n;
        if (inAttesa >= MAX_IN_ATTESA) return vai('errore=pieno');
        const r = sis.prepare("INSERT INTO utenti (email, nome, foto, ruolo, stato, creato) VALUES (?, ?, ?, 'utente', 'in_attesa', ?)")
          .run(email, info.name || null, info.picture || null, ora());
        u = perId(r.lastInsertRowid);
        console.log(`[account] Nuova richiesta di accesso: ${email}`);
      }
      sis.prepare('UPDATE utenti SET nome = COALESCE(?, nome), foto = COALESCE(?, foto), ultimo_accesso = ? WHERE id = ?')
        .run(info.name || null, info.picture || null, ora(), u.id);
      if (u.stato === 'bloccato') { console.warn(`[account] accesso negato a utente bloccato: ${email}`); return vai('stato=bloccato'); }
      creaSessione(res, u.id);
      console.log(`[account] login: ${email} (${u.stato})`);
      return res.redirect(u.stato === 'attivo' ? '/' : '/login.html?stato=attesa');
    } catch (e) {
      console.error(`[account] login Google non riuscito: ${e.message}`);
      return vai('errore=google');
    }
  }

  function esci(req, res) {
    for (const nome of new Set([COOKIE_SESSIONE, COOKIE_SESSIONE_VECCHIO])) {
      const token = leggiCookie(req, nome);
      if (token) sis.prepare('DELETE FROM sessioni WHERE hash = ?').run(hash(token));
      if (token) scriviCookie(res, nome, '', { maxAge: 0 });
    }
  }

  // ---- profilo ----
  function profiloPubblico(u) {
    return {
      email: u.email,
      nome: u.nome,
      foto: u.foto,
      ruolo: u.ruolo,
      stato: u.stato,
      login: attivo,
      profilo: {
        athlete_id: u.athlete_id || '',
        ha_chiave: Boolean(u.intervals_key),
        eta: u.data_nascita ? etaDa(u.data_nascita) : u.eta || null,
        data_nascita: u.data_nascita || null,
        programma_inizio: u.programma_inizio || null,
        programma_ora: u.programma_ora || '06:30',
        settimana_iniziale: u.settimana_iniziale ?? null, // null = non ancora scelta (valutazione da proporre)
        fc_max: u.fc_max ?? null,
        altezza: u.altezza ?? null,
        peso: u.peso ?? null,
        peso_data: u.peso_data ?? null,
        colore: u.colore || null, // null = mai scelto: resta quello del dispositivo
        obiettivo: u.obiettivo || 'mezza',
        intensita: u.intensita || 'equilibrata',
        intensita_auto: u.intensita_auto !== 0,
        giorni_sedute: giorniDa(u.giorni_sedute), // null = sceglie il coach
        giorni_modo: u.giorni_modo === 'fissi' ? 'fissi' : 'preferiti',
      },
      completo: Boolean(u.intervals_key && u.athlete_id && u.programma_inizio),
      // nuovo iscritto: utente (non amministratore) registrato negli ultimi 30 giorni -> domande iniziali sulla corsa
      nuovo: u.ruolo !== 'admin' && Boolean(u.creato) && u.creato >= new Date(Date.now() - 30 * 864e5).toISOString(),
      // per l'amministratore: richieste di accesso da approvare (pallino sull'avatar)
      in_attesa: u.ruolo === 'admin' ? sis.prepare("SELECT COUNT(*) AS n FROM utenti WHERE stato = 'in_attesa'").get().n : 0,
    };
  }

  async function verificaIntervals(apiKey, athleteId) {
    const auth = Buffer.from(`API_KEY:${apiKey}`).toString('base64');
    const r = await fetch(`${BASE.intervalsBase}/api/v1/athlete/${encodeURIComponent(athleteId)}`, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    return r.ok;
  }

  async function aggiornaProfilo(u, b) {
    const errori = [];
    const athlete = b.athlete_id != null ? String(b.athlete_id).trim() : u.athlete_id;
    const nuovaChiave = b.intervals_key ? String(b.intervals_key).trim() : null;
    const nascitaIn = b.data_nascita !== undefined ? (b.data_nascita === null || String(b.data_nascita).trim() === '' ? null : String(b.data_nascita).trim()) : u.data_nascita || null;
    const nascitaOk = nascitaIn == null || (/^\d{4}-\d{2}-\d{2}$/.test(nascitaIn) && !isNaN(Date.parse(nascitaIn + 'T00:00:00Z')));
    // con la data di nascita l'eta' si ricava da li' (resta salvata anche come numero, per chi la legge cosi')
    const eta = nascitaIn && nascitaOk ? etaDa(nascitaIn) : b.eta === '' || b.eta === null ? null : b.eta != null ? parseInt(b.eta, 10) : u.eta;
    if (!nascitaOk) errori.push('data_nascita');
    const inizio = b.programma_inizio != null ? String(b.programma_inizio).trim() : u.programma_inizio;
    const oraP = b.programma_ora != null ? String(b.programma_ora).trim() : u.programma_ora;
    if (athlete && !/^i?\d{1,12}$/.test(athlete)) errori.push('athlete_id');
    if (nuovaChiave && !/^[A-Za-z0-9_-]{8,100}$/.test(nuovaChiave)) errori.push('intervals_key');
    if (eta != null && !(eta >= 14 && eta <= 90)) errori.push(nascitaIn ? 'data_nascita' : 'eta');
    if (inizio && !/^\d{4}-\d{2}-\d{2}$/.test(inizio)) errori.push('programma_inizio');
    if (oraP && !/^\d{2}:\d{2}$/.test(oraP)) errori.push('programma_ora');
    const intONull = (v) => (v === null || v === '' ? null : parseInt(v, 10));
    const settIn = b.settimana_iniziale !== undefined ? intONull(b.settimana_iniziale) : u.settimana_iniziale;
    const fcMaxIn = b.fc_max !== undefined ? intONull(b.fc_max) : u.fc_max;
    if (settIn != null && !(settIn >= 1 && settIn <= 22)) errori.push('settimana_iniziale');
    if (fcMaxIn != null && !(fcMaxIn >= 140 && fcMaxIn <= 220)) errori.push('fc_max');
    const altezzaIn = b.altezza !== undefined ? intONull(b.altezza) : u.altezza;
    const pesoIn = b.peso !== undefined ? (b.peso === null || b.peso === '' ? null : Math.round(parseFloat(String(b.peso).replace(',', '.')) * 10) / 10) : u.peso;
    if (altezzaIn != null && !(altezzaIn >= 100 && altezzaIn <= 230)) errori.push('altezza');
    if (pesoIn != null && !(pesoIn >= 30 && pesoIn <= 250)) errori.push('peso');
    const coloreIn = b.colore !== undefined ? String(b.colore) : u.colore;
    const obiettivoIn = b.obiettivo !== undefined ? String(b.obiettivo) : u.obiettivo;
    if (obiettivoIn && !['5k', '10k', 'mezza', 'maratona'].includes(obiettivoIn)) errori.push('obiettivo');
    const intensitaIn = b.intensita !== undefined ? String(b.intensita) : u.intensita;
    if (intensitaIn && !['tranquilla', 'equilibrata', 'ambiziosa'].includes(intensitaIn)) errori.push('intensita');
    const autoIn = b.intensita_auto !== undefined ? (b.intensita_auto === false || b.intensita_auto === 0 || b.intensita_auto === '0' ? 0 : 1) : u.intensita_auto;
    // giorni preferiti: da 1 a 7 giorni diversi (0 = domenica … 6 = sabato), oppure vuoto = sceglie il coach
    let giorniIn = u.giorni_sedute || null;
    if (b.giorni_sedute !== undefined) {
      const v = b.giorni_sedute == null ? '' : String(b.giorni_sedute).trim();
      if (v === '') giorniIn = null;
      else if (!/^[0-6](,[0-6]){0,6}$/.test(v) || new Set(v.split(',')).size !== v.split(',').length) errori.push('giorni_sedute');
      else giorniIn = v.split(',').map(Number).sort((a, b2) => a - b2).join(',');
    }
    const modoIn = b.giorni_modo !== undefined ? String(b.giorni_modo) : u.giorni_modo || 'preferiti';
    if (!['preferiti', 'fissi'].includes(modoIn)) errori.push('giorni_modo');
    if (coloreIn && !COLORI_AMMESSI.has(coloreIn)) errori.push('colore');
    if (errori.length) return { ok: false, errori };
    const chiaveFinale = nuovaChiave || decifra(u.intervals_key);
    if ((nuovaChiave || athlete !== u.athlete_id) && chiaveFinale && athlete) {
      let ok = false;
      try { ok = await verificaIntervals(chiaveFinale, athlete); } catch (_) { ok = false; }
      if (!ok) return { ok: false, errori: ['intervals'] };
    }
    let settFinale = settIn ?? null, inizioFinale = inizio || null;
    // Intervals collegato ma nessuna data di inizio: il piano parte da solo dal primo giorno utile
    // (oggi, oppure il primo dei giorni scelti), altrimenti il calendario resterebbe vuoto senza spiegazione
    const chiaveC = nuovaChiave || u.intervals_key;
    if (!inizioFinale && chiaveC && athlete) {
      const oggiS = oggiLocale();
      const g = giorniIn ? giorniIn.split(',').map(Number) : [];
      let d = new Date(oggiS + 'T12:00:00Z');
      for (let i = 0; i < 7 && g.length && !g.includes(d.getUTCDay()); i++) d = new Date(d.getTime() + 864e5);
      inizioFinale = d.toISOString().slice(0, 10);
    }
    let ripartiData = u.riparti_data || null, ripartiSett = u.riparti_settimana || null;
    const cambiaObiettivo = obiettivoIn && obiettivoIn !== (u.obiettivo || 'mezza');
    if (cambiaObiettivo && b.settimana_iniziale === undefined && cambioObiettivo) {
      const m = cambioObiettivo(contestoDi(u), obiettivoIn); // stessa fase nel nuovo piano, dalla settimana in corso
      if (m) { ripartiData = m.riparti_data; ripartiSett = m.riparti_settimana; }
    }
    // nuova data di inizio o nuovo livello di partenza scelti a mano: il vecchio punto di ripartenza non vale piu'
    if ((inizioFinale || null) !== (u.programma_inizio || null) || (b.settimana_iniziale !== undefined && settIn !== u.settimana_iniziale)) {
      if (!(cambiaObiettivo && ripartiData)) { ripartiData = null; ripartiSett = null; }
    }
    sis.prepare('UPDATE utenti SET athlete_id = ?, intervals_key = ?, eta = ?, programma_inizio = ?, programma_ora = ?, settimana_iniziale = ?, fc_max = ?, colore = ?, obiettivo = ?, intensita = ?, intensita_auto = ?, altezza = ?, peso = ?, peso_data = ?, data_nascita = ?, giorni_sedute = ?, giorni_modo = ?, riparti_data = ?, riparti_settimana = ? WHERE id = ?')
      .run(athlete || null, nuovaChiave ? cifra(nuovaChiave) : u.intervals_key, eta || null, inizioFinale, oraP || '06:30', settFinale, fcMaxIn ?? null, coloreIn || null, obiettivoIn || null, intensitaIn || null, autoIn ?? null, altezzaIn ?? null, pesoIn ?? null, pesoIn == null ? null : pesoIn !== u.peso ? oggiLocale() : u.peso_data || oggiLocale(), nascitaIn, giorniIn, giorniIn ? modoIn : 'preferiti', ripartiData, ripartiSett, u.id);
    dimentica(u.id);
    return { ok: true, utente: perId(u.id) };
  }

  // ---- amministrazione ----
  function elencoUtenti() {
    return sis.prepare('SELECT id, email, nome, foto, ruolo, stato, creato, ultimo_accesso, athlete_id, intervals_key IS NOT NULL AS ha_chiave, programma_inizio FROM utenti ORDER BY ruolo, stato, email').all()
      .map((u) => ({ ...u, ha_chiave: Boolean(u.ha_chiave) }));
  }
  function invita(email) {
    email = String(email || '').trim().toLowerCase();
    // lunghezza massima RFC 5321 e regex lineare (parti del dominio senza punti: niente backtracking)
    if (email.length > 254 || !/^[^@\s]{1,64}@[^@\s.]+(?:\.[^@\s.]+)+$/.test(email)) return { ok: false, errore: 'email' };
    const u = sis.prepare('SELECT * FROM utenti WHERE email = ?').get(email);
    if (u) {
      if (u.ruolo !== 'admin') sis.prepare("UPDATE utenti SET stato = 'attivo' WHERE id = ?").run(u.id);
      return { ok: true };
    }
    sis.prepare("INSERT INTO utenti (email, ruolo, stato, creato) VALUES (?, 'utente', 'attivo', ?)").run(email, ora());
    return { ok: true };
  }
  function cambiaStato(id, stato) {
    const u = perId(id);
    if (!u || u.ruolo === 'admin' || !['attivo', 'bloccato', 'in_attesa'].includes(stato)) return false;
    sis.prepare('UPDATE utenti SET stato = ? WHERE id = ?').run(stato, id);
    if (stato !== 'attivo') sis.prepare('DELETE FROM sessioni WHERE utente_id = ?').run(id);
    dimentica(id);
    return true;
  }
  function rimuovi(id) {
    // rimuove l'account (accesso e impostazioni); il suo database delle corse resta su disco
    const u = perId(id);
    if (!u || u.ruolo === 'admin') return false;
    sis.prepare('DELETE FROM sessioni WHERE utente_id = ?').run(id);
    sis.prepare('DELETE FROM uso WHERE utente_id = ?').run(id);
    sis.prepare('DELETE FROM utenti WHERE id = ?').run(id);
    dimentica(id);
    return true;
  }

  // ---- rotte e controllo di accesso ----
  const PUBBLICI = new Set(['/login.html', '/logo.svg', '/apple-touch-icon.png', '/favicon.ico', '/manifest.webmanifest']);

  function monta(app, { L, demo }) {
    // Senza login chiunque sarebbe l'amministratore: si accettano solo richieste locali.
    // Tutto cio' che arriva da internet passa da Cloudflare (intestazioni CF-*) e viene rifiutato.
    if (!attivo) {
      app.use((req, res, next) => {
        if (req.get('cf-ray') || req.get('cf-connecting-ip')) {
          return res.status(403).json({ errore: L('Accesso da internet disabilitato: il login non è attivo', 'Internet access disabled: sign-in is not enabled') });
        }
        next();
      });
    }

    const json = require('express').json({ limit: '16kb' });
    const csrf = (req, res, next) => (req.get('x-requested-with') === 'coach' ? next() : res.status(400).json({ errore: L('Richiesta non valida', 'Invalid request') }));

    // Migrazione al cookie __Host-: chi ha ancora il vecchio cookie valido riceve quello nuovo
    // con la stessa scadenza, senza dover rifare il login.
    if (sicuro) {
      app.use((req, res, next) => {
        const vecchio = leggiCookie(req, COOKIE_SESSIONE_VECCHIO);
        if (vecchio && !leggiCookie(req, COOKIE_SESSIONE)) {
          const s = sis.prepare('SELECT scade FROM sessioni WHERE hash = ?').get(hash(vecchio));
          const resto = s ? Math.floor((Date.parse(s.scade) - Date.now()) / 1000) : 0;
          if (resto > 0) scriviCookie(res, COOKIE_SESSIONE, vecchio, { maxAge: resto });
          scriviCookie(res, COOKIE_SESSIONE_VECCHIO, '', { maxAge: 0 });
        }
        next();
      });
    }

    app.get('/auth/google', (req, res) => (attivo ? avviaLogin(req, res) : res.redirect('/')));
    app.get('/auth/google/callback', (req, res) => (attivo ? completaLogin(req, res) : res.redirect('/')));
    app.post('/auth/logout', csrf, (req, res) => { esci(req, res); res.json({ ok: true }); });
    app.get('/auth/stato', (req, res) => {
      res.set('Cache-Control', 'no-store');
      const u = utenteDaRichiesta(req);
      res.json({ login: attivo, ambiente: AMBIENTE, utente: u ? { email: u.email, nome: u.nome, stato: u.stato } : null });
    });

    // Controllo d'accesso per il frontend (nginx auth_request) prima di servire l'app:
    //   204 = puo' entrare (utente attivo, demo o modalita' utente singolo)
    //   401 = deve fare il login; X-Aac-Vai indica dove mandarlo (login o dominio pubblico)
    //   403 = account non attivo; X-Aac-Stato = attesa | bloccato
    app.get('/auth/verifica', (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (attivo) {
        const host = String(req.get('host') || '');
        const pub = new URL(BASE.publicUrl);
        if (host && host !== pub.host) {
          res.set('X-Aac-Vai', BASE.publicUrl + String(req.get('x-original-uri') || '/'));
          return res.status(401).end();
        }
      }
      if (demo && leggiCookie(req, 'aac_demo') === '1') return res.status(204).end();
      const u = utenteDaRichiesta(req);
      if (!u) { res.set('X-Aac-Vai', '/login.html'); return res.status(401).end(); }
      if (u.stato !== 'attivo') { res.set('X-Aac-Stato', u.stato === 'bloccato' ? 'bloccato' : 'attesa'); return res.status(403).end(); }
      res.status(204).end();
    });

    // Con il login attivo, chi arriva dall'indirizzo di rete locale viene portato sul dominio pubblico
    // (il cookie di sessione e il ritorno da Google valgono solo li').
    app.use((req, res, next) => {
      if (!attivo || req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      const host = String(req.get('host') || '');
      const pub = new URL(BASE.publicUrl).host;
      if (host && host !== pub) return res.redirect(BASE.publicUrl + req.originalUrl);
      next();
    });

    // Demo con dati simulati: /demo entra, /demo/esci esce (cookie dedicato, nessun account)
    app.get('/demo', (req, res) => { scriviCookie(res, 'aac_demo', '1', {}); res.redirect('/'); });
    app.get('/demo/esci', (req, res) => { scriviCookie(res, 'aac_demo', '', { maxAge: 0 }); res.redirect('/login.html'); });

    // Identita' della richiesta -> contesto dell'utente
    app.use((req, res, next) => {
      if (PUBBLICI.has(req.path) || req.path.startsWith('/auth/')) return next();
      if (demo && leggiCookie(req, 'aac_demo') === '1') {
        // sola lettura: nessuna scrittura, sincronizzazione o modifica del profilo
        if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(403).json({ errore: L('Nella demo non si possono fare modifiche', 'Changes are disabled in the demo'), demo: true });
        req.demo = true;
        req.vero = req.utente = demo.utente;
        return contesto.run(demo.contestoDemo(), next);
      }
      const u = utenteDaRichiesta(req);
      const api = req.path.startsWith('/api/');
      if (!u) return api ? res.status(401).json({ errore: L('Accesso richiesto', 'Sign-in required') }) : res.redirect('/login.html');
      if (u.stato !== 'attivo') {
        return api ? res.status(403).json({ errore: L('Account in attesa di approvazione', 'Account awaiting approval'), stato: u.stato })
          : res.redirect('/login.html?stato=' + (u.stato === 'bloccato' ? 'bloccato' : 'attesa'));
      }
      req.vero = u; // chi ha fatto davvero l'accesso
      req.utente = u; // per conto di chi gira la richiesta
      // amministratore che sta impersonando un utente: dati e impostazioni sono quelli dell'utente
      if (u.ruolo === 'admin' && attivo) {
        const s = sessioneDaRichiesta(req);
        const t = s && s.impersona_id ? perId(s.impersona_id) : null;
        if (t && t.ruolo !== 'admin') req.utente = t;
      }
      contesto.run(contestoDi(req.utente), next);
    });

    app.get('/api/me', (req, res) => {
      res.set('Cache-Control', 'no-store');
      const p = profiloPubblico(req.utente);
      p.ambiente = AMBIENTE;
      if (req.utente !== req.vero) { p.impersonato_da = req.vero.email; p.in_attesa = 0; }
      if (req.demo) { p.demo = true; p.completo = true; p.in_attesa = 0; }
      res.json(p);
    });

    // Impersonificazione (solo amministratore, solo con il login attivo)
    app.post('/api/admin/impersona/:id', csrf, (req, res) => {
      if (req.vero.ruolo !== 'admin' || !attivo) return res.status(403).json({ errore: L('Solo per l’amministratore', 'Admins only') });
      const t = perId(parseInt(req.params.id, 10));
      if (!t || t.ruolo === 'admin') return res.status(400).json({ errore: L('Utente non valido', 'Invalid user') });
      const s = sessioneDaRichiesta(req);
      sis.prepare('UPDATE sessioni SET impersona_id = ? WHERE hash = ?').run(t.id, s.hash);
      console.log(`[account] ${req.vero.email} impersona ${t.email}`);
      res.json({ ok: true });
    });
    app.post('/api/admin/impersona-fine', csrf, (req, res) => {
      const s = sessioneDaRichiesta(req);
      if (s) sis.prepare('UPDATE sessioni SET impersona_id = NULL WHERE hash = ?').run(s.hash);
      if (req.vero !== req.utente) console.log(`[account] ${req.vero.email} smette di impersonare ${req.utente.email}`);
      res.json({ ok: true });
    });
    app.put('/api/profilo', csrf, json, async (req, res) => {
      const r = await aggiornaProfilo(req.utente, req.body || {});
      if (!r.ok) return res.status(400).json({ ok: false, errori: r.errori });
      res.json({ ok: true, ...profiloPubblico(r.utente) });
    });

    // ---- Utilizzo dell'app ----
    // L'app manda un segnale al minuto mentre e' aperta e in primo piano. Non si contano la demo e il "Vedi come".
    // Un segnale ogni 50 s al massimo per utente (niente minuti gonfiati); pausa > 30 min = nuova apertura.
    const ultimoSegnale = new Map();
    const oraLocale = () => {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ || 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date()).map((x) => [x.type, x.value]));
      return { giorno: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}`, ora: Number(p.hour) };
    };
    app.post('/api/uso/battito', csrf, (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (req.demo || req.vero !== req.utente || !req.vero || !req.vero.id) return res.status(204).end();
      const id = req.vero.id, ora = Date.now(), prec = ultimoSegnale.get(id) || 0;
      if (ora - prec < 50e3) return res.status(204).end();
      ultimoSegnale.set(id, ora);
      const t = oraLocale();
      const nuovaApertura = ora - prec > 30 * 60e3 ? 1 : 0;
      const riga = sis.prepare('SELECT ore FROM uso WHERE utente_id = ? AND giorno = ?').get(id, t.giorno);
      const ore = (riga ? riga.ore : '0,'.repeat(23) + '0').split(',').map(Number);
      ore[t.ora] = Math.min(60, (ore[t.ora] || 0) + 1);
      sis.prepare(`INSERT INTO uso (utente_id, giorno, aperture, minuti, prima, ultima, ore) VALUES (?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(utente_id, giorno) DO UPDATE SET aperture = aperture + excluded.aperture, minuti = minuti + 1, ultima = excluded.ultima, ore = excluded.ore`)
        .run(id, t.giorno, Math.max(nuovaApertura, riga ? 0 : 1), t.hhmm, t.hhmm, ore.join(','));
      res.status(204).end();
    });

    const soloAdmin = (req, res, next) => (req.utente.ruolo === 'admin' ? next() : res.status(403).json({ errore: L('Solo per l’amministratore', 'Admins only') }));
    app.get('/api/admin/utenti', soloAdmin, (req, res) => {
      res.set('Cache-Control', 'no-store');
      const oggi = oraLocale().giorno;
      const giorniFa = (n) => new Date(Date.parse(oggi + 'T12:00:00Z') - n * 864e5).toISOString().slice(0, 10);
      const righe = sis.prepare('SELECT utente_id, giorno, minuti, ultima FROM uso WHERE giorno >= ? ORDER BY giorno').all(giorniFa(29));
      const per = new Map();
      for (const r of righe) { if (!per.has(r.utente_id)) per.set(r.utente_id, []); per.get(r.utente_id).push(r); }
      const ultimi7 = Array.from({ length: 7 }, (_, i) => giorniFa(6 - i));
      const utenti = elencoUtenti().map((u) => {
        const g = per.get(u.id) || [];
        const ult = sis.prepare('SELECT giorno, ultima FROM uso WHERE utente_id = ? ORDER BY giorno DESC LIMIT 1').get(u.id);
        return { ...u, uso: {
          ultima: ult ? `${ult.giorno} ${ult.ultima}` : null,
          giorni7: ultimi7.map((d) => (g.find((r) => r.giorno === d) || { minuti: 0 }).minuti),
          giorni30: g.length,
          minuti_medi: g.length ? Math.round(g.reduce((t, r) => t + r.minuti, 0) / g.length) : 0,
        } };
      });
      const attiviDa = (n) => new Set(righe.filter((r) => r.giorno >= giorniFa(n - 1)).map((r) => r.utente_id)).size;
      res.json({ login: attivo, utenti, uso: { oggi: attiviDa(1), sette: attiviDa(7), trenta: attiviDa(30) } });
    });
    app.post('/api/admin/utenti', csrf, soloAdmin, json, (req, res) => {
      const r = invita(req.body && req.body.email);
      if (r.ok) console.log(`[admin] ${req.vero.email} invita/attiva ${String(req.body.email).trim().toLowerCase()}`);
      res.status(r.ok ? 200 : 400).json(r);
    });
    app.post('/api/admin/utenti/:id/stato', csrf, soloAdmin, json, (req, res) => {
      const id = parseInt(req.params.id, 10), stato = req.body && req.body.stato;
      const t = perId(id), ok = cambiaStato(id, stato);
      if (ok) console.log(`[admin] ${req.vero.email} imposta ${t.email} a ${stato}`);
      res.json({ ok });
    });
    app.delete('/api/admin/utenti/:id', csrf, soloAdmin, (req, res) => {
      const id = parseInt(req.params.id, 10), t = perId(id), ok = rimuovi(id);
      if (ok) console.log(`[admin] ${req.vero.email} rimuove l'account ${t.email}`);
      res.json({ ok });
    });
  }

  return { attivo, inizializza, admin, utentiAttivi, contestoDi, monta, sistema: sis };
}

module.exports = { creaAccount, etaDa };
