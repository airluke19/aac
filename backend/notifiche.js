'use strict';
/**
 * Notifiche push (Web Push, standard W3C): funzionano nel browser e, su iPhone, con l'app aggiunta
 * alla schermata Home (iOS 16.4+). Nessun account Apple/Google: le chiavi VAPID sono nostre.
 *
 * - Chiavi VAPID generate al primo avvio e salvate cifrate in sistema.db (niente .env da toccare).
 * - Un'iscrizione per dispositivo (endpoint del servizio push del browser), legata all'utente.
 * - Solo endpoint dei servizi push noti (Apple, Google, Mozilla, Microsoft): niente SSRF.
 * - Due notifiche, scelte dall'utente: la seduta del mattino e il riepilogo della domenica sera.
 *   Contenuto: solo testo della seduta o della settimana, niente dati di salute.
 */
const webpush = require('web-push');

const HOST_PUSH = /^(web\.push\.apple\.com|fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)$/;
const B64URL = /^[A-Za-z0-9_-]{16,200}={0,2}$/;
const ORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function creaNotifiche({ sis, cifra, decifra, soggetto, testo, oraLocale }) {
  sis.exec(`
    CREATE TABLE IF NOT EXISTS chiavi_sistema (nome TEXT PRIMARY KEY, valore TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS push_iscrizioni (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      utente_id INTEGER NOT NULL,
      endpoint  TEXT NOT NULL UNIQUE,
      p256dh    TEXT NOT NULL,
      auth      TEXT NOT NULL,
      lingua    TEXT NOT NULL DEFAULT 'it',
      creata    TEXT NOT NULL,
      errori    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_push_utente ON push_iscrizioni (utente_id);
  `);
  const col = new Set(sis.prepare('PRAGMA table_info(utenti)').all().map((c) => c.name));
  if (!col.has('notifica_mattina')) sis.exec('ALTER TABLE utenti ADD COLUMN notifica_mattina INTEGER'); // 1 = seduta del mattino
  if (!col.has('notifica_domenica')) sis.exec('ALTER TABLE utenti ADD COLUMN notifica_domenica INTEGER'); // 1 = riepilogo della domenica
  if (!col.has('notifica_ora')) sis.exec('ALTER TABLE utenti ADD COLUMN notifica_ora TEXT'); // HH:MM della seduta del mattino
  if (!col.has('notifica_ultima')) sis.exec('ALTER TABLE utenti ADD COLUMN notifica_ultima TEXT'); // "mattina:AAAA-MM-GG|domenica:AAAA-MM-GG"

  // ---- chiavi VAPID ----
  const leggiChiave = (n) => { const r = sis.prepare('SELECT valore FROM chiavi_sistema WHERE nome = ?').get(n); return r ? r.valore : null; };
  let pub = leggiChiave('vapid_pubblica');
  let priv = decifra(leggiChiave('vapid_privata'));
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    pub = k.publicKey; priv = k.privateKey;
    const s = sis.prepare('INSERT INTO chiavi_sistema (nome, valore) VALUES (?, ?) ON CONFLICT(nome) DO UPDATE SET valore = excluded.valore');
    sis.transaction(() => { s.run('vapid_pubblica', pub); s.run('vapid_privata', cifra(priv)); })();
    console.log('[notifiche] Chiavi VAPID create');
  }
  webpush.setVapidDetails(soggetto, pub, priv);

  const preferenze = (u) => ({
    mattina: u.notifica_mattina !== 0,
    domenica: u.notifica_domenica !== 0,
    ora: ORA.test(u.notifica_ora || '') ? u.notifica_ora : '07:00',
  });
  const iscrizioni = (id) => sis.prepare('SELECT * FROM push_iscrizioni WHERE utente_id = ?').all(id);

  async function inviaA(utenteId, crea) {
    let inviate = 0;
    for (const s of iscrizioni(utenteId)) {
      const dati = crea(s.lingua);
      if (!dati) continue;
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(dati), { TTL: 6 * 3600, urgency: 'normal' });
        if (s.errori) sis.prepare('UPDATE push_iscrizioni SET errori = 0 WHERE id = ?').run(s.id);
        inviate++;
      } catch (e) {
        const codice = e && e.statusCode;
        // 404/410: il dispositivo ha revocato l'iscrizione; dopo 5 errori di fila la togliamo comunque
        if (codice === 404 || codice === 410 || s.errori >= 4) sis.prepare('DELETE FROM push_iscrizioni WHERE id = ?').run(s.id);
        else sis.prepare('UPDATE push_iscrizioni SET errori = errori + 1 WHERE id = ?').run(s.id);
        console.warn(`[notifiche] u${utenteId} invio non riuscito (${codice || (e && e.message) || 'errore'})`);
      }
    }
    return inviate;
  }

  // Giro programmato (ogni 5 minuti): mattina all'ora scelta, domenica alle 19:00. Una volta al giorno al massimo.
  async function giro(utenti) {
    const { giorno, hhmm, giornoSett } = oraLocale();
    for (const u of utenti) {
      if (!sis.prepare('SELECT 1 FROM push_iscrizioni WHERE utente_id = ? LIMIT 1').get(u.id)) continue;
      const p = preferenze(u);
      const ultime = String(u.notifica_ultima || '');
      const segna = (tipo) => {
        const resto = ultime.split('|').filter((x) => x && !x.startsWith(tipo + ':'));
        sis.prepare('UPDATE utenti SET notifica_ultima = ? WHERE id = ?').run([...resto, `${tipo}:${giorno}`].join('|'), u.id);
      };
      const dentro = (da, finestraMin) => { const [h, m] = da.split(':').map(Number), [hh, mm] = hhmm.split(':').map(Number); const d = hh * 60 + mm - (h * 60 + m); return d >= 0 && d < finestraMin; };
      if (p.mattina && dentro(p.ora, 180) && !ultime.includes(`mattina:${giorno}`)) {
        segna('mattina');
        try { await inviaA(u.id, (lingua) => testo(u, 'mattina', lingua)); } catch (e) { console.warn('[notifiche] mattina', e.message); }
      }
      if (p.domenica && giornoSett === 0 && dentro('19:00', 180) && !ultime.includes(`domenica:${giorno}`)) {
        segna('domenica');
        try { await inviaA(u.id, (lingua) => testo(u, 'domenica', lingua)); } catch (e) { console.warn('[notifiche] domenica', e.message); }
      }
    }
  }

  function monta(app, { L }) {
    const json = require('express').json({ limit: '4kb' });
    const csrf = (req, res, next) => (req.get('x-requested-with') === 'coach' ? next() : res.status(400).json({ errore: L('Richiesta non valida', 'Invalid request') }));
    // solo l'utente vero, non in demo e non durante "Vedi come"
    const proprio = (req, res, next) => {
      if (req.demo || !req.vero || req.vero !== req.utente) return res.status(403).json({ errore: L('Non disponibile qui', 'Not available here') });
      next();
    };
    const ultimaProva = new Map();

    app.get('/api/push/stato', (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (req.demo || !req.vero) return res.json({ disponibile: false });
      const u = sis.prepare('SELECT * FROM utenti WHERE id = ?').get(req.vero.id);
      res.json({ disponibile: req.vero === req.utente, chiave: pub, dispositivi: iscrizioni(u.id).length, ...preferenze(u) });
    });

    app.post('/api/push/iscrizione', csrf, json, proprio, (req, res) => {
      const b = req.body || {}, s = b.iscrizione || {}, k = s.keys || {};
      let url;
      try { url = new URL(String(s.endpoint || '')); } catch (_) { url = null; }
      if (!url || url.protocol !== 'https:' || !HOST_PUSH.test(url.hostname) || String(s.endpoint).length > 1024 || !B64URL.test(String(k.p256dh || '')) || !B64URL.test(String(k.auth || ''))) {
        return res.status(400).json({ errore: L('Iscrizione non valida', 'Invalid subscription') });
      }
      const lingua = b.lingua === 'en' ? 'en' : 'it';
      sis.prepare(`INSERT INTO push_iscrizioni (utente_id, endpoint, p256dh, auth, lingua, creata) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET utente_id = excluded.utente_id, p256dh = excluded.p256dh, auth = excluded.auth, lingua = excluded.lingua, errori = 0`)
        .run(req.vero.id, String(s.endpoint), String(k.p256dh), String(k.auth), lingua, new Date().toISOString());
      // al massimo 10 dispositivi per utente: si tengono i piu' recenti
      sis.prepare('DELETE FROM push_iscrizioni WHERE utente_id = ? AND id NOT IN (SELECT id FROM push_iscrizioni WHERE utente_id = ? ORDER BY id DESC LIMIT 10)').run(req.vero.id, req.vero.id);
      res.json({ ok: true });
    });

    app.delete('/api/push/iscrizione', csrf, json, proprio, (req, res) => {
      const endpoint = String((req.body || {}).endpoint || '').slice(0, 1024);
      sis.prepare('DELETE FROM push_iscrizioni WHERE utente_id = ? AND endpoint = ?').run(req.vero.id, endpoint);
      res.json({ ok: true });
    });

    app.put('/api/push/preferenze', csrf, json, proprio, (req, res) => {
      const b = req.body || {};
      if (typeof b.mattina !== 'boolean' || typeof b.domenica !== 'boolean' || !ORA.test(String(b.ora || ''))) return res.status(400).json({ errore: L('Valori non validi', 'Invalid values') });
      sis.prepare('UPDATE utenti SET notifica_mattina = ?, notifica_domenica = ?, notifica_ora = ? WHERE id = ?').run(b.mattina ? 1 : 0, b.domenica ? 1 : 0, b.ora, req.vero.id);
      res.json({ ok: true });
    });

    app.post('/api/push/prova', csrf, proprio, async (req, res) => {
      const id = req.vero.id, ora = Date.now();
      if (ora - (ultimaProva.get(id) || 0) < 20000) return res.status(429).json({ errore: L('Aspetta qualche secondo', 'Wait a few seconds') });
      ultimaProva.set(id, ora);
      const u = sis.prepare('SELECT * FROM utenti WHERE id = ?').get(id);
      const n = await inviaA(id, (lingua) => testo(u, 'prova', lingua));
      res.json({ ok: n > 0, inviate: n });
    });
  }

  // all'eliminazione dell'account
  const rimuoviUtente = (id) => sis.prepare('DELETE FROM push_iscrizioni WHERE utente_id = ?').run(id);

  return { monta, giro, rimuoviUtente };
}

module.exports = { creaNotifiche };
