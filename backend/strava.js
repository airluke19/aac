'use strict';
/**
 * Strava come seconda fonte di dati (in alternativa o insieme a Intervals.icu).
 *
 * - L'utente tocca "Connetti con Strava" e autorizza: OAuth 2 (authorization code), nessuna chiave da copiare.
 * - Token cifrati in sistema.db (stessa chiave della chiave Intervals), rinnovati da soli quando scadono.
 * - Si leggono solo le attivita' (scope activity:read_all): Strava non fornisce FC a riposo, HRV o sonno.
 * - Le attivita' diventano oggetti nel formato di Intervals.icu, cosi' passano per la stessa normalizzazione.
 * - Scollegando, i token vengono revocati e le attivita' arrivate da Strava cancellate (termini di Strava).
 * - Richiede STRAVA_CLIENT_ID e STRAVA_CLIENT_SECRET (app su strava.com/settings/api); senza, l'opzione non compare.
 */
const crypto = require('crypto');

const API = 'https://www.strava.com/api/v3';
const OAUTH = 'https://www.strava.com/oauth';
// Tipi Strava → tipi Intervals (quelli che il motore conosce: corsa, camminata, altro)
const TIPI = { Run: 'Run', TrailRun: 'TrailRun', VirtualRun: 'VirtualRun', Walk: 'Walk', Hike: 'Hike', Ride: 'Ride', VirtualRide: 'VirtualRide', MountainBikeRide: 'Ride', GravelRide: 'Ride', EBikeRide: 'Ride', Swim: 'Swim', WeightTraining: 'WeightTraining', Workout: 'Workout', Yoga: 'Yoga', Elliptical: 'Elliptical', StairStepper: 'Workout', Rowing: 'Rowing' };

class ErroreStrava extends Error { constructor(m, status = 502) { super(m); this.status = status; } }

function creaStrava({ sis, cifra, decifra, publicUrl, clientId, clientSecret }) {
  const attivo = Boolean(clientId && clientSecret && /^https?:\/\//.test(publicUrl || ''));
  const col = new Set(sis.prepare('PRAGMA table_info(utenti)').all().map((c) => c.name));
  for (const [c, t] of [['strava_atleta', 'TEXT'], ['strava_nome', 'TEXT'], ['strava_access', 'TEXT'], ['strava_refresh', 'TEXT'], ['strava_scade', 'INTEGER'], ['strava_collegato', 'TEXT']]) {
    if (!col.has(c)) sis.exec(`ALTER TABLE utenti ADD COLUMN ${c} ${t}`);
  }
  const redirect = `${String(publicUrl || '').replace(/\/$/, '')}/api/strava/callback`;
  const stati = new Map(); // state OAuth -> { utente, scade }
  const riga = (id) => sis.prepare('SELECT id, strava_atleta, strava_nome, strava_access, strava_refresh, strava_scade, strava_collegato FROM utenti WHERE id = ?').get(id);
  const collegato = (id) => { const r = riga(id); return Boolean(r && r.strava_refresh); };
  const pulisci = (id) => sis.prepare('UPDATE utenti SET strava_atleta = NULL, strava_nome = NULL, strava_access = NULL, strava_refresh = NULL, strava_scade = NULL, strava_collegato = NULL WHERE id = ?').run(id);

  async function postToken(corpo) {
    const res = await fetch(`${OAUTH}/token`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, ...corpo }), signal: AbortSignal.timeout(20000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new ErroreStrava(`Strava: autorizzazione non riuscita (${res.status})`, res.status === 400 || res.status === 401 ? 401 : 502);
    return j;
  }
  function salvaToken(id, j) {
    sis.prepare('UPDATE utenti SET strava_access = ?, strava_refresh = ?, strava_scade = ? WHERE id = ?')
      .run(cifra(j.access_token), cifra(j.refresh_token), Number(j.expires_at) || 0, id);
  }
  // Token valido: si rinnova da solo se scade entro 2 minuti; se Strava lo rifiuta, il collegamento si chiude
  async function token(id) {
    const r = riga(id);
    if (!r || !r.strava_refresh) throw new ErroreStrava('Strava non collegato', 409);
    if (r.strava_access && Number(r.strava_scade) > Date.now() / 1000 + 120) return decifra(r.strava_access);
    try {
      const j = await postToken({ grant_type: 'refresh_token', refresh_token: decifra(r.strava_refresh) });
      salvaToken(id, j);
      return j.access_token;
    } catch (e) {
      if (e.status === 401) { pulisci(id); console.warn(`[strava] u${id}: autorizzazione revocata, collegamento chiuso`); }
      throw e;
    }
  }
  async function get(id, percorso, params) {
    const url = new URL(API + percorso);
    Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await token(id)}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    if (res.status === 429) throw new ErroreStrava('Strava: troppe richieste, riprovo alla prossima sincronizzazione', 429);
    if (res.status === 401) { throw new ErroreStrava('Strava: autorizzazione non valida, ricollega Strava dal profilo', 401); }
    if (res.status === 404) return null;
    if (!res.ok) throw new ErroreStrava(`Strava ha risposto con errore ${res.status}`);
    return res.json();
  }

  // Attivita' dal giorno "da" (AAAA-MM-GG) a oggi, nel formato di Intervals.icu. caricoDi(durataSec, fcMedia) stima il carico.
  async function attivita(id, da, caricoDi) {
    const dopo = Math.floor(Date.parse(da + 'T00:00:00Z') / 1000) - 86400;
    const out = [];
    for (let pagina = 1; pagina <= 10; pagina++) {
      const lista = await get(id, '/athlete/activities', { after: dopo, page: pagina, per_page: 100 });
      if (!Array.isArray(lista) || !lista.length) break;
      for (const a of lista) {
        const tipo = TIPI[a.sport_type] || TIPI[a.type] || 'Other';
        const durata = Number(a.moving_time) || Number(a.elapsed_time) || 0;
        const corsa = tipo === 'Run' || tipo === 'TrailRun' || tipo === 'VirtualRun';
        out.push({
          id: 's' + a.id,
          type: tipo,
          name: a.name || null,
          start_date_local: String(a.start_date_local || '').replace(/Z$/, ''), // Strava mette la Z anche sull'ora locale
          distance: Number(a.distance) || 0,
          moving_time: Number(a.moving_time) || null,
          elapsed_time: Number(a.elapsed_time) || null,
          average_heartrate: a.has_heartrate ? Number(a.average_heartrate) || null : null,
          max_heartrate: a.has_heartrate ? Number(a.max_heartrate) || null : null,
          // Strava da' la cadenza "per gamba" (giri al minuto): nella corsa si raddoppia
          average_cadence: a.average_cadence ? (corsa ? Number(a.average_cadence) * 2 : Number(a.average_cadence)) : null,
          total_elevation_gain: Number(a.total_elevation_gain) || null,
          calories: Number(a.calories) || null,
          icu_training_load: durata > 0 ? caricoDi(durata, a.has_heartrate ? Number(a.average_heartrate) : null) : null,
          fonte: 'strava',
        });
      }
      if (lista.length < 100) break;
    }
    return out;
  }

  // Dati secondo per secondo di un'attivita' Strava, nel formato degli stream di Intervals
  async function stream(id, attivitaId, tipi) {
    const sid = String(attivitaId).replace(/^s/, '');
    if (!/^\d+$/.test(sid)) return null;
    const st = await get(id, `/activities/${sid}/streams`, { keys: tipi || 'time,distance,heartrate,velocity_smooth,cadence,altitude,latlng,watts', key_by_type: 'true' });
    if (!st || typeof st !== 'object') return null;
    const out = [];
    for (const [k, v] of Object.entries(st)) {
      if (!v || !Array.isArray(v.data)) continue;
      if (k === 'latlng') out.push({ type: 'latlng', data: v.data.map((p) => (p ? p[0] : null)), data2: v.data.map((p) => (p ? p[1] : null)) });
      else out.push({ type: k, data: v.data });
    }
    return out;
  }

  function stato(id) {
    const r = riga(id);
    return { disponibile: attivo, collegato: Boolean(r && r.strava_refresh), nome: r && r.strava_refresh ? r.strava_nome : null, dal: r && r.strava_refresh ? r.strava_collegato : null };
  }

  function monta(app, { L, csrf, quandoCollegato, quandoScollegato }) {
    const proprio = (req) => !req.demo && req.vero && req.vero === req.utente;
    // 1. Connetti: si va su Strava con uno "state" legato all'utente (protezione CSRF del ritorno)
    app.get('/api/strava/collega', (req, res) => {
      if (!attivo || !proprio(req)) return res.redirect('/#account');
      const state = crypto.randomBytes(24).toString('base64url');
      stati.set(state, { utente: req.vero.id, scade: Date.now() + 10 * 60 * 1000 });
      for (const [k, v] of stati) if (v.scade < Date.now()) stati.delete(k);
      const u = new URL(`${OAUTH}/authorize`);
      u.searchParams.set('client_id', clientId);
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('redirect_uri', redirect);
      u.searchParams.set('approval_prompt', 'auto');
      u.searchParams.set('scope', 'read,activity:read_all');
      u.searchParams.set('state', state);
      res.redirect(u.toString());
    });
    // 2. Ritorno da Strava: si verifica lo state, si scambia il codice con i token e si salvano cifrati
    app.get('/api/strava/callback', async (req, res) => {
      const st = stati.get(String(req.query.state || ''));
      stati.delete(String(req.query.state || ''));
      if (!attivo || !st || st.scade < Date.now() || !proprio(req) || st.utente !== req.vero.id) return res.redirect('/?strava=errore#account');
      if (req.query.error) return res.redirect('/?strava=annullato#account');
      const scope = String(req.query.scope || '');
      if (!/activity:read/.test(scope)) return res.redirect('/?strava=permessi#account');
      try {
        const j = await postToken({ grant_type: 'authorization_code', code: String(req.query.code || '').slice(0, 200) });
        const nome = j.athlete ? [j.athlete.firstname, j.athlete.lastname].filter(Boolean).join(' ').slice(0, 80) : null;
        salvaToken(req.vero.id, j);
        sis.prepare('UPDATE utenti SET strava_atleta = ?, strava_nome = ?, strava_collegato = ? WHERE id = ?')
          .run(j.athlete ? String(j.athlete.id) : null, nome, new Date().toISOString(), req.vero.id);
        console.log(`[strava] u${req.vero.id} collegato`);
        if (quandoCollegato) quandoCollegato(req.vero.id);
        res.redirect('/?strava=ok#account');
      } catch (e) {
        console.warn(`[strava] u${req.vero.id} collegamento non riuscito: ${e.message}`);
        res.redirect('/?strava=errore#account');
      }
    });
    // 3. Scollega: si revoca l'accesso su Strava e si cancellano le attivita' arrivate da li'
    app.post('/api/strava/scollega', csrf, async (req, res) => {
      if (!proprio(req)) return res.status(403).json({ errore: L('Non disponibile qui', 'Not available here') });
      const id = req.vero.id;
      try {
        const t = collegato(id) ? await token(id) : null;
        if (t) await fetch(`${OAUTH}/deauthorize`, { method: 'POST', headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(15000) }).catch(() => {});
      } catch (_) { /* gia' revocato: si pulisce comunque */ }
      pulisci(id);
      if (quandoScollegato) quandoScollegato(id);
      console.log(`[strava] u${id} scollegato`);
      res.json({ ok: true });
    });
  }

  return { attivo, collegato, stato, attivita, stream, monta, pulisci };
}

module.exports = { creaStrava, ErroreStrava };
