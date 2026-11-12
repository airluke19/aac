(function () {
  'use strict';

  /* ---------------------------------------------------------------------- */
  /* Utility                                                                */
  /* ---------------------------------------------------------------------- */
  const $ = (s) => document.querySelector(s);

  /* Lingua: 'it' | 'en' (salvata nel browser) */
  let LANG = (() => { try { const v = localStorage.getItem('coach-lingua'); if (v === 'it' || v === 'en') return v; } catch (_) {} return 'it'; })();
  let LOC = LANG === 'en' ? 'en-GB' : 'it-IT';
  const T = (it, en) => (LANG === 'en' ? en : it);
  const conLang = (url) => url + (url.indexOf('?') === -1 ? '?' : '&') + 'lang=' + LANG;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let nf1 = new Intl.NumberFormat(LOC, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  let nf0 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 0 });
  const fmt1 = (x) => (x == null ? '–' : nf1.format(x));
  const fmt0 = (x) => (x == null ? '–' : nf0.format(x));
  const fmtSigned = (x) => (x == null ? '–' : (x > 0 ? '+' : x < 0 ? '−' : '') + nf1.format(Math.abs(x)));
  const fmtPasso = (sec) => {
    if (sec == null || !isFinite(sec)) return '–';
    let m = Math.floor(sec / 60), s = Math.round(sec % 60);
    if (s === 60) { m += 1; s = 0; }
    return m + ':' + String(s).padStart(2, '0');
  };
  const fmtOre = (sec) => (sec == null ? '–' : Math.floor(sec / 3600) + 'h ' + String(Math.round((sec % 3600) / 60)).padStart(2, '0') + '′');
  const fmtDurata = (sec) => {
    if (sec == null) return '–';
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
    return h > 0 ? h + ':' + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0') : m + ':' + String(x).padStart(2, '0');
  };
  const fmtDataBreve = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString(LOC, { day: 'numeric', month: 'short', year: 'numeric' });
  const fmtMin = (sec) => (sec == null ? '–' : Math.round(sec / 60) + ' min');
  const fmtData = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString(LOC, { day: '2-digit', month: 'short' });
  const fmtDataLunga = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtQuando = (isoTs) => new Date(isoTs).toLocaleString(LOC, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const giorniDa = (oggi, data) => Math.round((new Date(data + 'T12:00:00') - new Date(oggi + 'T12:00:00')) / 86400000);
  const quando = (oggi, data) => {
    const g = giorniDa(oggi, data);
    if (g < 0) return g === -1 ? T('Ieri', 'Yesterday') : fmtData(data);
    return g === 0 ? T('Oggi', 'Today') : g === 1 ? T('Domani', 'Tomorrow') : g === 2 ? T('Dopodomani', 'In 2 days') : T('Tra ' + g + ' giorni', 'In ' + g + ' days');
  };

  const TIPI = {
    Walk: 'Camminata', Hike: 'Escursione', Ride: 'Bici', VirtualRide: 'Bici indoor', EBikeRide: 'E-bike',
    WeightTraining: 'Pesi', Workout: 'Allenamento', Yoga: 'Yoga', Pilates: 'Pilates', Swim: 'Nuoto',
    Elliptical: 'Ellittica', Rowing: 'Vogatore', HighIntensityIntervalTraining: 'HIIT', Crossfit: 'Crossfit',
    Soccer: 'Calcio', Tennis: 'Tennis', Padel: 'Padel', StairStepper: 'Scale', Other: 'Altro'
  };
  const TIPI_EN = { Walk: 'Walk', Hike: 'Hike', Ride: 'Ride', VirtualRide: 'Indoor ride', WeightTraining: 'Weights', StairStepper: 'Stairs', HighIntensityIntervalTraining: 'HIIT', Other: 'Other' };
  const nomeTipo = (t) => (LANG === 'en' ? TIPI_EN[t] || t : TIPI[t] || t);

  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const alpha = (hex, a) => {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  };

  let toastTimer = null;
  function toast(msg, tipo) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show ' + (tipo || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast ' + (tipo || ''); }, 4200);
  }
  function vaiAlLogin() { window.location.href = '/login.html'; }

  const charts = [];
  let ultimiDati = null;

  /* ---------------------------------------------------------------------- */
  /* Tema chiaro / scuro                                                    */
  /* ---------------------------------------------------------------------- */
  function applicaTema(t, salva) {
    document.documentElement.setAttribute('data-theme', t);
    document.querySelector('meta[name="theme-color"]').setAttribute('content', t === 'light' ? '#f3f5f8' : '#0b0d10');
    if (salva) { try { localStorage.setItem('coach-tema', t); } catch (e) {} }
    if (window.aacFavicon) window.aacFavicon();
    if (ultimiDati) disegnaGrafici(ultimiDati);
  }
  // Suono da tasto di tastiera meccanica ("thock"): pressione piena e sorda + rilascio più leggero.
  // Più chiaro quando accendi (tema chiaro), più grave quando spegni (tema scuro). Sintetizzato, nessun file.
  let audioCtx = null;
  function suonoInterruttore(acceso) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtx, t0 = ctx.currentTime + 0.005;
      const uscita = ctx.createGain(); uscita.gain.value = 0.35; uscita.connect(ctx.destination); // volume discreto
      const rumore = (t, dur, passaBasso, passaAlto, vol) => {
        const n = Math.max(1, Math.round(ctx.sampleRate * dur)), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
        for (let k = 0; k < n; k++) d[k] = (Math.random() * 2 - 1) * Math.exp(-6 * k / n);
        const src = ctx.createBufferSource(); src.buffer = buf;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = passaAlto;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = passaBasso; lp.Q.value = 0.7;
        const g = ctx.createGain(); g.gain.value = vol;
        src.connect(hp).connect(lp).connect(g).connect(uscita); src.start(t);
      };
      const corpo = (t, f, vol, dur) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'triangle'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.7, t + dur);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(uscita); o.start(t); o.stop(t + dur + 0.01);
      };
      const f = acceso ? 1 : 0.82; // spegnere suona un po' più grave
      // pressione: il tasto tocca il fondo
      rumore(t0, 0.032, 2300 * f, 140, 0.85);
      corpo(t0, 260 * f, 0.4, 0.055);
      rumore(t0, 0.006, 4200 * f, 2000, 0.16); // clic del tasto, presente ma morbido
      // rilascio: il tasto risale
      const t1 = t0 + 0.085;
      rumore(t1, 0.016, 2600 * f, 220, 0.2);
      corpo(t1, 360 * f, 0.08, 0.028);
    } catch (_) { /* audio non disponibile: nessun suono */ }
  }
  $('#btn-tema').addEventListener('click', () => {
    const nuovo = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    suonoInterruttore(nuovo === 'light');
    applicaTema(nuovo, true);
  });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
    let scelto = null;
    try { scelto = localStorage.getItem('coach-tema'); } catch (_) {}
    if (!scelto) applicaTema(e.matches ? 'light' : 'dark', false);
  });
  applicaTema(document.documentElement.getAttribute('data-theme') || 'dark', false);

  /* ---------------------------------------------------------------------- */
  /* Rendering                                                              */
  /* ---------------------------------------------------------------------- */

  const ICO = {
    flame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c4 0 7-2.8 7-6.8 0-3.6-2.4-5.6-3.6-8.2-.4 1.8-1.3 3-2.6 3.6C13.2 7 11.6 4.2 9 2c.3 3.4-1.4 5.4-2.9 7.4C5 10.8 5 12.6 5 15.2 5 19.2 8 22 12 22z"/></svg>',
    body: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4.5" r="2.2"/><path d="M6 9.5h12M12 9.5v5.5M12 15l-3 6M12 15l3 6"/></svg>',
    o2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5s-6 6.6-6 11.1a6 6 0 0 0 12 0C18 9.1 12 2.5 12 2.5z"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r="0.6" fill="currentColor"/></svg>',
    dati: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 20v-7M12 20V5M19 20v-10"/></svg>',
    spunta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
    indietro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    logo: '<svg viewBox="4 6 56 52" aria-hidden="true"><g stroke="currentColor" stroke-width="4.8" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M13.6 26.5A19 19 0 1 1 13.6 37.5"/><path d="M8 32h14l3.5-8 5 16 3.5-8h4"/></g></svg>',
    campana: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.2 5.6c-.8-.5-1.7.1-1.7 1v10.8c0 .9.9 1.5 1.7 1l8.6-5.4c.7-.4.7-1.5 0-1.9z" transform="translate(.9 0)"/></svg>',
    pausa: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>',
    sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18M12 14v5M9.5 16.5 12 19l2.5-2.5"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    wave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    steps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v-2.4C4 11.5 3 10.5 3 8c0-2.7 1.5-6 4.5-6C9.4 2 10 3.8 10 5.5c0 3.1-2 5.7-2 8.7V16a2 2 0 1 1-4 0z"/><path d="M20 20v-2.4c0-2.1 1-3.1 1-5.6 0-2.7-1.5-6-4.5-6C14.6 6 14 7.8 14 9.5c0 3.1 2 5.7 2 8.7V20a2 2 0 1 0 4 0z"/></svg>'
  };

  function renderBadge(d) {
    const b = $('#badge-dati');
    if (d.sorgente_dati === 'simulati') { b.textContent = T('Dati simulati', 'Sample data'); b.className = 'badge sim'; b.hidden = false; }

    else { b.hidden = true; }
  }

  // Stato della sincronizzazione: si mostra nel profilo, accanto a Intervals.icu (il pulsante non e' piu' nell'intestazione)
  let statoSyncHtml = '', syncInCorso = false;
  function renderSyncInfo(d) {
    const s = d.sincronizzazione || {};
    const e = s.ultimo_esito;
    if (!s.configurata) statoSyncHtml = T('<span class="err">Nessuna fonte collegata</span>: collega Strava o Intervals.icu qui sotto', '<span class="err">No data source connected</span>: connect Strava or Intervals.icu below');
    else if (e && e.ok === false) statoSyncHtml = T('<span class="err">Ultima sincronizzazione fallita:</span> ', '<span class="err">Last sync failed:</span> ') + esc(e.errore);
    else if (s.ultimo_sync) statoSyncHtml = T('Ultima sincronizzazione <b>', 'Last sync <b>') + esc(fmtQuando(s.ultimo_sync)) + '</b>' + T(' · automatica ogni 15 minuti', ' · automatic every 15 minutes');
    else statoSyncHtml = T('Nessuna sincronizzazione ancora eseguita', 'No sync yet');
    const el = $('#acc-sync-stato');
    if (el) el.innerHTML = statoSyncHtml;
  }


  /* ---- Calendario delle sedute ---- */
  let meseCal = null;       // 'YYYY-MM' mostrato
  let giornoSel = null;     // 'YYYY-MM-DD' selezionato

  const TIPI_SEDUTA_DEF = [
    { tipo: 'corsa-cammino', sigla: ['CC', 'RW'], nome: ['Corsa e cammino', 'Run-walk'], testo: ['Brevi frazioni di corsa lenta alternate a camminata. Abitua cuore, muscoli e tendini a correre senza sovraccaricarli: è la base della ripartenza.', 'Short bouts of slow running alternated with walking. It gets heart, muscles and tendons used to running without overloading them: the foundation of your comeback.'] },
    { tipo: 'facile', sigla: ['F', 'E'], nome: ['Corsa facile', 'Easy run'], testo: ['Corsa continua a ritmo da conversazione (Z2). È l’80% del lavoro: costruisce la resistenza aerobica. Con “allunghi” chiudi con 4 accelerazioni da 20″ per la tecnica.', 'Continuous running at conversational pace (Z2). It is 80% of the work: it builds aerobic endurance. With “strides” you finish with 4 × 20″ accelerations for technique.'] },
    { tipo: 'lungo', sigla: ['L', 'L'], nome: ['Lungo', 'Long run'], testo: ['La seduta chiave, di preferenza nel weekend: corsa lenta e costante che cresce di settimana in settimana fino a quasi 2 ore. Prepara il corpo a durare 21 km.', 'The key session, preferably at the weekend: slow, steady running that grows week by week up to almost 2 hours. It prepares your body to last 21 km.'] },
    { tipo: 'qualita', sigla: ['Q', 'Q'], nome: ['Qualità', 'Quality'], testo: ['Fartlek (tratti brillanti liberi), 4×4 norvegese (4 blocchi da 4′ all’85–95% della FC max con 3′ di corsetta: alza il VO₂max) o frazioni a ritmo medio / ritmo gara. Insegnano a tenere un passo più sostenuto senza andare in crisi. Solo dalla fase 2.', 'Fartlek (free lively bursts), Norwegian 4×4 (four 4′ blocks at 85–95% of max HR with 3′ jogging: raises VO₂max) or reps at steady / race pace. They teach you to hold a faster pace without blowing up. Only from phase 2.'] },
    { tipo: 'recupero', sigla: ['R', 'R'], nome: ['Recupero', 'Recovery'], testo: ['Camminata tranquilla: aiuta a smaltire la fatica senza aggiungere carico.', 'Easy walk: helps clear fatigue without adding load.'] },
    { tipo: 'gara', sigla: ['🏁', '🏁'], nome: ['Gara', 'Race'], testo: ['La gara del tuo obiettivo, a ritmo costante: 5 km, 10 km, mezza o maratona.', 'The race of your goal, at a steady pace: 5K, 10K, half or marathon.'] },
  ];
  const pick = (c) => c[LANG === 'en' ? 1 : 0];
  const tipiSeduta = () => TIPI_SEDUTA_DEF.map((t) => ({ tipo: t.tipo, sigla: pick(t.sigla), nome: pick(t.nome), testo: pick(t.testo) }));
  const tipiChiusi = () => { let v = null; try { v = localStorage.getItem('coach-tipi-chiusi'); } catch (_) {} return v == null ? window.innerWidth < 600 : v === '1'; };
  const siglaTipo = (t) => (tipiSeduta().find((x) => x.tipo === t) || { sigla: '?' }).sigla;

  function renderCalendario(d) {
    const p = d.programma;
    const perData = new Map(p.calendario.map((x) => [x.data, x]));
    const fuoriPiano = new Set((p.corse_fuori_piano || []).map((c) => c.data)); // corse in giorni senza seduta
    if (!meseCal) meseCal = (d.oggi < p.inizio ? p.inizio : d.oggi).slice(0, 7);
    if (!giornoSel || !perData.has(giornoSel)) giornoSel = (p.prossime[0] || p.calendario[0]).data;

    const [y, m] = meseCal.split('-').map(Number);
    const primo = new Date(Date.UTC(y, m - 1, 1));
    const giorniMese = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const offset = (primo.getUTCDay() + 6) % 7; // lunedì = 0
    const titolo = primo.toLocaleDateString(LOC, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const minMese = p.inizio.slice(0, 7), maxMese = p.fine.slice(0, 7);

    let celle = '';
    for (let i = 0; i < offset; i++) celle += '<div class="cd vuoto"></div>';
    for (let g = 1; g <= giorniMese; g++) {
      const iso = y + '-' + String(m).padStart(2, '0') + '-' + String(g).padStart(2, '0');
      const x = perData.get(iso);
      const cls = ['cd'];
      if (iso === d.oggi) cls.push('oggi');
      if (x) cls.push('seduta', x.fatta ? 'fatta' : x.passata ? 'saltata' : 'futura');
      if (x && x.tipo === 'gara') cls.push('gara');
      if (x && x.adattata) cls.push('adattata');
      if (x && iso === giornoSel) cls.push('sel');
      const stato = x ? (x.fatta ? T(' · fatta', ' · done') : x.passata ? T(' · saltata', ' · missed') : '') : '';
      celle += x
        ? '<button type="button" class="' + cls.join(' ') + '" data-giorno="' + iso + '" aria-label="' + esc(fmtDataLunga(iso) + ': ' + x.blocchi + stato) + '">' +
            '<span class="g">' + g + '</span><span class="m"><i>' + siglaTipo(x.tipo) + '</i>' + (x.tipo === 'gara' ? '' : x.durata_min + '′') + '</span></button>'
        : fuoriPiano.has(iso)
          ? '<button type="button" class="' + cls.concat('fuori').join(' ') + '" data-apri-corsa="' + iso + '" aria-label="' + esc(fmtDataLunga(iso)) + T(': corsa fuori piano', ': unscheduled run') + '"><span class="g">' + g + '</span><span class="fp-dot" aria-hidden="true"></span></button>'
          : '<div class="' + cls.join(' ') + '"><span class="g">' + g + '</span></div>';
    }

    const x = perData.get(giornoSel);
    let det = '<div class="empty">' + T('Tocca un giorno colorato per vedere la seduta.', 'Tap a coloured day to see the session.') + '</div>';
    if (x) {
      const stato = x.fatta ? ['fatta', x.manuale ? T('✓ Fatta (a mano)', '✓ Done (manual)') : T('✓ Fatta', '✓ Done')] : x.passata ? ['saltata', T('Saltata', 'Missed')] : x.data === d.oggi ? ['oggi', T('Oggi', 'Today')] : ['futura', quando(d.oggi, x.data)];
      const tipo = tipiSeduta().find((t) => t.tipo === x.tipo);
      // Copia per AI solo per le sedute fatte: prima non ci sono dati da commentare
      const az = (attr, ico, txt) => '<button type="button" class="az" ' + attr + '="' + x.data + '">' + ico + '<span>' + txt + '</span></button>';
      let azioni = x.fatta ? az('data-copia', ICO.copy, T('Copia per AI', 'Copy for AI')) : '';
      if (x.fatta && ultimoStorico && ultimoStorico.corse.some((c) => c.data === x.data)) {
        azioni += az('data-apri-corsa', ICO.dati, T('Dettagli', 'Details'));
      }
      if (x.data <= d.oggi && (!x.fatta || x.manuale)) {
        azioni += az('data-segna', ICO.spunta, x.manuale ? T('Annulla “fatta”', 'Undo “done”') : T('Segna come fatta', 'Mark as done'));
      }
      det = '<div class="cal-det" id="cal-det">' +
        '<div class="cal-det-head"><div><b>' + esc(fmtDataLunga(x.data)) + ' · ' + esc(p.ora) + '</b>' +
        '<span>' + esc(x.fase) + T(' · sett. ' + x.settimana, ' · wk ' + x.settimana) + (x.scarico ? T(' · scarico', ' · recovery week') : '') + '</span></div>' +
        '<span class="stato ' + stato[0] + '">' + esc(stato[1]) + '</span></div>' +
        '<h4 class="det-title"><span class="sig">' + siglaTipo(x.tipo) + '</span>' + esc(x.titolo.replace(/^(Sett\.|Wk) \d+ · /, '')) + (x.extra ? '<em class="det-extra">' + T('in più', 'extra') + '</em>' : '') + '</h4>' +
        (x.perche_giorno ? '<p class="det-giorno">' + esc(x.perche_giorno) + '</p>' : '') +
        bannerAdattata(x) + confrontoPasso(x) + corpoSeduta(x, true, tipo ? '<p class="det-why">' + esc(tipo.testo) + '</p>' : '') + '<div class="az-row">' + azioni + '</div></div>';
    }

    const tipiUsati = new Set(p.calendario.map((c) => c.tipo));
    const tipi = tipiSeduta().filter((t) => tipiUsati.has(t.tipo)).map((t) =>
      '<div class="tipo-s' + (x && x.tipo === t.tipo ? ' on' : '') + '"><span class="sig">' + t.sigla + '</span><div><b>' + esc(t.nome) + '</b><p>' + esc(t.testo) + '</p></div></div>').join('');

    return '<section class="card cal" id="cal">' +
      '<div class="cal-top"><div><h3>' + T('Calendario allenamenti', 'Training calendar') + '</h3><p class="sub" style="margin:0">' + p.calendario.length + T(' sedute alla gara · ' + ((p.frequenza && p.frequenza.attuale) || 3) + ' a settimana', ' sessions to race day · ' + ((p.frequenza && p.frequenza.attuale) || 3) + ' a week') + '</p></div>' +
        '<a class="btn-mini" href="' + conLang('/api/programma.ics') + '" download title="' + T('Scarica le sedute in programma per Calendario iPhone/Mac, Google o Outlook', 'Download planned sessions for iPhone/Mac Calendar, Google or Outlook') + '">' + ICO.cal + T('Esporta', 'Export') + '</a></div>' +
      '<div class="cal-layout"><div class="cal-left">' +
        '<div class="cal-head"><button type="button" class="icon-btn sm" data-mese="-1" aria-label="' + T('Mese precedente', 'Previous month') + '"' + (meseCal <= minMese ? ' disabled' : '') + '>‹</button>' +
          '<h3>' + esc(titolo) + '</h3>' +
          '<button type="button" class="icon-btn sm" data-mese="1" aria-label="' + T('Mese successivo', 'Next month') + '"' + (meseCal >= maxMese ? ' disabled' : '') + '>›</button></div>' +
        '<div class="cal-grid cal-dow">' + T('LMMGVSD', 'MTWTFSS').split('').map((c) => '<span>' + c + '</span>').join('') + '</div>' +
        '<div class="cal-grid">' + celle + '</div>' +
        '<div class="legend-inline" style="margin-top:12px"><span><i style="background:var(--accent)"></i>' + T('Fatta', 'Done') + '</span>' +
          '<span><i style="background:color-mix(in srgb, var(--accent-2) 22%, transparent);outline:1.5px solid var(--accent-2)"></i>' + T('In programma', 'Planned') + '</span>' +
          '<span><i style="outline:1.5px dashed var(--muted)"></i>' + T('Saltata', 'Missed') + '</span>' +
          '<span><i style="outline:1.5px solid var(--warn)"></i>' + T('Adattata ai tuoi dati', 'Adapted to your data') + '</span>' +
          '<span><i class="fp-leg"></i>' + T('Corsa fuori piano', 'Unscheduled run') + '</span></div>' +
      '</div><div class="cal-right">' + det + '</div></div>' +
    '</section>';
  }

  async function copiaPerAI(data, btn) {
    try {
      const res = await fetch(conLang('/api/sessione/' + data + '/markdown'), { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.errore || T('Errore ', 'Error ') + res.status); }
      const md = await res.text();
      try {
        await navigator.clipboard.writeText(md);
      } catch (_) {
        // Fallback per contesti non sicuri (http su rete locale)
        const ta = document.createElement('textarea');
        ta.value = md; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      if (btn) { const t = btn.innerHTML; btn.innerHTML = btn.classList.contains('az') ? ICO.spunta + '<span>' + T('Copiato', 'Copied') + '</span>' : T('✓ Copiato', '✓ Copied'); setTimeout(() => { btn.innerHTML = t; }, 1800); }
      toast(T('Copiato in Markdown: incollalo in Claude o in un’altra AI', 'Copied as Markdown: paste it into Claude or another AI'), 'ok');
    } catch (e) { toast(e.message, 'err'); }
  }

  async function segnaFatta(data) {
    try {
      const res = await fetch(conLang('/api/seduta/' + data + '/fatta'), { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'coach' } });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.errore || T('Operazione non riuscita', 'Operation failed'));
      toast(out.fatta ? T('Seduta segnata come fatta', 'Session marked as done') : T('Segnatura annullata', 'Mark removed'), 'ok');
      await caricaDati(true);
    } catch (e) { toast(e.message, 'err'); }
  }

  document.addEventListener('click', (e) => {
    const copia = e.target.closest('[data-copia]');
    if (copia) { copiaPerAI(copia.dataset.copia, copia); return; }
    const segna = e.target.closest('[data-segna]');
    if (segna) { segnaFatta(segna.dataset.segna); return; }
    const apri = e.target.closest('[data-apri-corsa]');
    if (apri) { apriCorsaDelGiorno(apri.dataset.apriCorsa); return; }
    const sw = e.target.closest('[data-cg]');
    if (sw) {
      const d = sw.dataset.cg, n = corseDelGiorno(d).length;
      corsaSel.set(d, Math.max(0, Math.min(n - 1, (corsaSel.get(d) || 0) + Number(sw.dataset.cgDir))));
      const v = $('#cal');
      if (v && ultimiDati) { v.outerHTML = renderCalendario(ultimiDati); const b = $('#cal-det [data-cg-dir="' + sw.dataset.cgDir + '"]:not([disabled])') || $('#cal-det [data-cg]:not([disabled])'); if (b) b.focus(); }
      return;
    }
    const nav = e.target.closest('[data-mese]');
    const day = e.target.closest('[data-giorno]');
    if (!nav && !day) return;
    if (nav) {
      const [y, m] = meseCal.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1 + Number(nav.dataset.mese), 1));
      meseCal = dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0');
    } else {
      giornoSel = day.dataset.giorno;
      meseCal = giornoSel.slice(0, 7);
    }
    const vecchio = $('#cal');
    if (!vecchio || !ultimiDati) return;
    vecchio.outerHTML = renderCalendario(ultimiDati);
    if (day) {
      const det = $('#cal-det');
      const r = det && det.getBoundingClientRect();
      if (r && (r.top < 80 || r.bottom > window.innerHeight)) det.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  /* ---- Seduta: struttura ---- */
  function timelineSeduta(s) {
    const tot = s.segmenti.reduce((t, x) => t + x.min, 0);
    const nomi = { walk: T('Camminata', 'Walk'), run: T('Corsa', 'Run'), fast: T('Ritmo', 'Pace'), cool: T('Defaticamento', 'Cool-down') };
    const segs = s.segmenti.map((x) => '<div class="seg ' + x.tipo + '" style="width:' + (x.min / tot * 100).toFixed(2) + '%" title="' + nomi[x.tipo] + ' ' + x.min + '′"></div>').join('');
    const usati = new Set(s.segmenti.map((x) => x.tipo));
    const leg = [['run', nomi.run, 'var(--accent)'], ['fast', nomi.fast, 'var(--orange)'], ['walk', nomi.walk, 'color-mix(in srgb, var(--muted) 45%, transparent)'], ['cool', nomi.cool, 'color-mix(in srgb, var(--accent-2) 55%, transparent)']]
      .filter((l) => usati.has(l[0])).map((l) => '<span><i style="background:' + l[2] + '"></i>' + l[1] + '</span>').join('');
    return '<div class="timeline" role="img" aria-label="' + T('Struttura della seduta', 'Session structure') + '">' + segs + '</div><div class="legend-inline">' + leg + '</div>';
  }

  // compatto (scheda Oggi): un numero grande, struttura e consigli si aprono con un tocco
  function corpoSeduta(s, compatto, intro) {
    const pi = passoIndicativo(s);
    const fasi = s.struttura.map((f) => '<li><span class="m">' + f.min + '′</span><span><b>' + esc(f.fase) + '</b> · ' + esc(f.testo) + '</span></li>').join('');
    const st = (v, l) => '<div><b class="num">' + v + '</b><span>' + l + '</span></div>';
    const notaPasso = pi ? '<p class="pi-nota">' + T('Passo ', 'Pace ') + '<b>' + pi.valore + '/km</b> · ' + esc(pi.nota) + '</p>' : '';
    const fcSicN = ultimiDati && ultimiDati.atleta ? ultimiDati.atleta.fc_max_stimata : null;
    const tip = '<div class="tip">' + esc(s.nota) + (s.tipo === 'gara' ? '' : T(' Se senti dolore (non semplice fatica), fermati e cammina.', ' If you feel pain (not just fatigue), stop and walk.')) +
      (fcSicN && !(s.tipo === 'qualita' || s.tipo === 'gara') ? ' ' + T('FC di sicurezza: non superare mai ' + fcSicN + ' bpm.', 'Safety HR: never exceed ' + fcSicN + ' bpm.') : '') + '</div>';
    // FC: il limite consigliato della seduta e il tetto di sicurezza (FC max personale) da non superare mai
    const fcSic = ultimiDati && ultimiDati.atleta ? ultimiDati.atleta.fc_max_stimata : null;
    // "< 130" = fino a 129 bpm: si mostra l'ultimo battito consentito
    const fcT = String(s.fc_target || '').trim();
    const tetto = fcT.startsWith('<'); // un solo numero = limite da non superare; altrimenti intervallo
    // il tetto di sicurezza conta dove si sale verso il limite (qualita' e gara); nelle sedute facili resta nella nota
    const intensa = s.tipo === 'qualita' || s.tipo === 'gara';
    return '<div class="hero-main"><b class="hero-big num">' + s.durata_min + '<small>min</small></b>' +
      '<div class="hero-stats">' +
        st(s.corsa_min + '′', T('di corsa', 'running')) +
        st(esc(tetto ? String(parseInt(fcT.replace(/[^\d]/g, ''), 10) - 1) : fcT), tetto ? T('FC max consigliata', 'Max suggested HR') : T('FC consigliata', 'Suggested HR')) +
        (fcSic && intensa ? '<div class="fc-sic"><b class="num">' + fcSic + '</b><span>' + T('FC sicurezza', 'Safety HR') + '</span></div>' : '') +
        (pi ? st(pi.valore, T('passo /km', 'pace /km')) : '') +
      '</div></div>' +
      timelineSeduta(s) +
      (compatto
        ? '<details class="more"><summary>' + T('Come si svolge', 'How it goes') + '</summary>' + (intro || '') + notaPasso + fcPerche(s) + '<ul class="phases">' + fasi + '</ul>' + tip + '</details>'
        : notaPasso + fcPerche(s) + '<ul class="phases">' + fasi + '</ul>' + tip);
  }

  // Perche' quel limite di FC: da dove viene il numero (FC a riposo, FC max, metodo)
  function fcPerche(s) {
    const fmi = ultimiDati && ultimiDati.atleta && ultimiDati.atleta.fc_max_info;
    if (!fmi || !s.fc_target || s.tipo === 'gara') return '';
    const max = fmi.valore, orig = fmi.fonte === 'misurata' ? T('misurata', 'measured') : T('stimata dall’età', 'age-based estimate');
    let txt;
    if (/4×4/.test(s.titolo || '')) txt = T('85–95% della tua FC max (' + max + ' bpm, ' + orig + '), come nel protocollo originale del 4×4.', '85–95% of your max HR (' + max + ' bpm, ' + orig + '), as in the original 4×4 protocol.');
    else if (s.tipo === 'qualita' && !/[<]/.test(s.fc_target) && /ritmo (5|10) km|ritmo mezza|ritmo maratona|race pace|5K pace|10K pace|marathon pace|half-marathon pace/i.test(s.titolo || '')) return '';
    else {
      const pct = s.tipo === 'corsa-cammino' ? '65%' : s.tipo === 'qualita' ? '80–90%' : '70%';
      txt = fmi.metodo === 'riserva'
        ? T('Il limite viene dalla tua FC a riposo (' + fmi.fc_riposo + ' bpm, mediana degli ultimi 28 giorni) e dalla FC max (' + max + ' bpm, ' + orig + '): ' + pct + ' della riserva cardiaca' + (s.tipo === 'qualita' ? '' : ', mai oltre l’80% della FC max') + '. Si aggiorna da solo quando cambiano i tuoi dati.',
          'The limit comes from your resting HR (' + fmi.fc_riposo + ' bpm, median of the last 28 days) and max HR (' + max + ' bpm, ' + orig + '): ' + pct + ' of your heart-rate reserve' + (s.tipo === 'qualita' ? '' : ', never above 80% of max HR') + '. It updates by itself as your data changes.')
        : T('Il limite è il ' + (s.tipo === 'qualita' ? '80–90%' : '70%') + ' della tua FC max (' + max + ' bpm, ' + orig + '). Con almeno 5 misure di FC a riposo dall’orologio diventa più personale.',
          'The limit is ' + (s.tipo === 'qualita' ? '80–90%' : '70%') + ' of your max HR (' + max + ' bpm, ' + orig + '). With at least 5 resting HR readings from your watch it becomes more personal.');
    }
    return '<p class="fc-perche"><b>' + T('Perché questa FC', 'Why this HR') + '</b> · ' + esc(txt) + (s.tipo === 'qualita' ? '' : ' ' + esc(T('Se riesci a parlare a frasi intere va bene anche qualche battito sopra.', 'If you can speak in full sentences, a few beats above is fine.'))) + '</p>';
  }

  // Seduta alleggerita: perche' (in base a quali dati), cosa cambia rispetto alla prevista e cosa resta uguale nel piano
  function bannerAdattata(s) {
    if (!s.adattata) return '';
    const a = s.adattata;
    const qualita = a.originale_tipo === 'qualita';
    const pct = a.originale_min ? Math.round(s.durata_min / a.originale_min * 100) : null;
    const cosa = qualita
      ? T('La seduta intensa diventa <b>' + s.durata_min + '′ di corsa facile</b>: niente lavoro di qualità con il corpo non recuperato.', 'The hard session becomes <b>' + s.durata_min + '′ of easy running</b>: no quality work while your body is not recovered.')
      : T('Stessa seduta, più corta: <b>' + s.durata_min + '′</b> invece di ' + (a.originale_min || '') + '′' + (pct ? ' (circa il ' + pct + '%)' : '') + ', allo stesso ritmo tranquillo.', 'Same session, shorter: <b>' + s.durata_min + '′</b> instead of ' + (a.originale_min || '') + '′' + (pct ? ' (about ' + pct + '%)' : '') + ', at the same easy pace.');
    // compatto: una riga con il pallino che pulsa ("ti ho ascoltato"), il dettaglio si apre con un tocco
    const breve = qualita ? T(s.durata_min + '′ facili', s.durata_min + '′ easy') : T(s.durata_min + '′ invece di ' + (a.originale_min || '') + '′', s.durata_min + '′ instead of ' + (a.originale_min || '') + '′');
    return '<details class="adapt adapt-x"><summary><span class="ax-dot" aria-hidden="true"></span><b>' + T('Seduta alleggerita', 'Session eased') + '</b><span class="ax-breve">' + breve + '</span></summary>' +
      '<div class="ax-body">' +
        '<div class="ax-r"><span>' + T('Perché', 'Why') + '</span><p>' + esc(a.motivi.join(' · ')) + '</p></div>' +
        '<div class="ax-r"><span>' + T('Prevista', 'Planned') + '</span><p>' + esc((a.originale_titolo ? a.originale_titolo + ': ' : '') + a.originale) + '</p></div>' +
        '<div class="ax-r"><span>' + T('Oggi', 'Today') + '</span><p>' + cosa + '</p></div>' +
        '<button type="button" class="link-btn ax-info" data-vai-info>' + T('Come ragiona il coach ›', 'How the coach thinks ›') + '</button>' +
      '</div></details>';
  }


  /* ---- Info: come funziona AAC (regole reali del motore) ---- */
  function renderInfo(d) {
    const fcMax = d.atleta ? d.atleta.fc_max_stimata : 185;
    // soglie del piano dalle zone (calcolate dal server): facile = Z2, settimana troppo dura = media in Z4
    const sp = d.atleta && d.atleta.soglie_piano;
    const facile = sp ? sp.facile : Math.floor(fcMax * 0.7) + 1, soglia = sp ? sp.dura : Math.floor(fcMax * 0.8) + 1;
    const ora = d.programma ? d.programma.ora : '06:30';
    const settAtt = d.programma ? d.programma.settimana_piano : null;
    const tot = d.programma ? d.programma.totale_settimane : 26;
    const li = (righe) => '<ul class="in-list">' + righe.map((r) => '<li>' + r + '</li>').join('') + '</ul>';
    const svg = (p) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
    const G = {
      target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
      run: svg('<circle cx="15" cy="4.2" r="2"/><path d="M8.5 8.5 12 7l3 2.2-2 4 3.5 2.5-1.5 5"/><path d="M13 13.2 9.5 17 5 18"/><path d="M15 9.2l3 1.8 2-1"/>'),
      wave: svg('<path d="M3 12h4l2-5 4 10 2-5h6"/>'),
      adapt: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
      flag: svg('<path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/>'),
      heart: svg('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>'),
      trend: svg('<path d="M4 16l5-5 4 3 7-8"/><path d="M15 6h5v5"/>'),
      cal: svg('<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>'),
      list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
      sync: svg('<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>'),
      grid: svg('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
      shield: svg('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>'),
      star: svg('<path d="M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z"/>')
    };

    // ---- il ciclo in 4 passi ----
    const step = (ico, t, s) => '<li><span class="nf-ic">' + ico + '</span><b>' + t + '</b><small>' + s + '</small></li>';
    const hero = '<section class="nf-hero">' +
      '<h2>' + T('Un piano che si adatta a te', 'A plan that adapts to you') + '</h2>' +
      '<p>' + T('Una tabella non sa come hai dormito, quanto sei allenato o se la settimana è andata storta. AAC sì: ogni giorno guarda cosa fai e come stai, e cambia il piano per te.', 'A fixed plan doesn’t know how you slept, how fit you are or whether your week went wrong. AAC does: every day it looks at what you do and how you feel, and changes the plan for you.') + '</p>' +
      '<ol class="nf-loop">' +
        step(G.target, T('Valuta', 'Assess'), T('da dove parti', 'where you start')) +
        step(G.run, T('Allena', 'Train'), T('3 sedute a settimana', '3 sessions a week')) +
        step(G.wave, T('Ascolta', 'Listen'), T('FC, HRV e sonno', 'HR, HRV and sleep')) +
        step(G.adapt, T('Adatta', 'Adapt'), T('giorno e settimana', 'day and week')) +
      '</ol></section>';

    // ---- 1. il tuo cuore: FC max (misurata o Tanaka) + FC a riposo (Karvonen) = i tuoi limiti ----
    const fmiC = d.atleta && d.atleta.fc_max_info;
    const eta = d.atleta && d.atleta.eta;
    const riposo = fmiC && fmiC.metodo === 'riserva' ? fmiC.fc_riposo : null;
    const generico = Math.round(fcMax * 0.7);
    const nCuore = (v, l, n) => '<div class="nf-hc"><b>' + v + '</b><span>' + l + '</span>' + (n ? '<small>' + n + '</small>' : '') + '</div>';
    const cuore = '<section class="card nf-card nf-cuore"><div class="nf-when">' + T('Prima di tutto', 'First of all') + '</div>' +
      '<h3>' + T('Il tuo cuore, non una tabella', 'Your heart, not a table') + '</h3>' +
      '<p class="nf-lead">' + T('Ogni seduta ha un limite di battiti da rispettare. Non lo prendiamo da una tabella uguale per l’età: lo costruiamo sul <b>tuo</b> cuore, con due numeri.', 'Every session has a heart-rate limit to respect. We don’t take it from a one-size-fits-all age table: we build it on <b>your</b> heart, from two numbers.') + '</p>' +
      '<div class="nf-hcs">' +
        nCuore(fcMax, T('FC massima', 'Max HR'), fmiC && fmiC.fonte === 'misurata' ? T('misurata da te', 'measured by you') : T('Tanaka: 208 − 0,7 × ', 'Tanaka: 208 − 0.7 × ') + (eta || 33)) +
        nCuore(riposo || '–', T('FC a riposo', 'Resting HR'), riposo ? T('mediana di 28 giorni', '28-day median') : T('in arrivo dall’orologio', 'coming from your watch')) +
        nCuore('&lt; ' + facile, T('il tuo limite facile', 'your easy limit'), riposo ? T('riposo + 70% della riserva', 'resting + 70% of reserve') : T('70% della FC max', '70% of max HR')) +
      '</div>' +
      (riposo
        ? '<div class="nf-formula">' + riposo + ' + 70% × (' + fcMax + ' − ' + riposo + ') → <b>' + facile + ' bpm</b></div>' +
          '<p class="nf-foot">' + T('Una tabella generica ti darebbe il 70% della FC max, <b>' + generico + ' bpm</b>, uguale per tutti quelli della tua età. Ma un cuore allenato batte più piano a riposo e ha più margine: con il metodo di <b>Karvonen</b> (la riserva cardiaca, la differenza tra massima e riposo) le zone si spostano con la tua forma. Più ti alleni, più la FC a riposo scende, e il coach lo vede da solo.', 'A generic table would give you 70% of max HR, <b>' + generico + ' bpm</b>, the same for everyone your age. But a trained heart beats slower at rest and has more room: with the <b>Karvonen</b> method (heart-rate reserve, the gap between max and resting) your zones move with your fitness. The fitter you get, the lower your resting HR, and the coach sees it on its own.') + '</p>'
        : '<p class="nf-foot">' + T('Per ora le zone sono in % della FC max. Appena l’orologio registra almeno 5 valori di FC a riposo in 28 giorni, passano alla tua <b>riserva cardiaca</b> (metodo di <b>Karvonen</b>): limiti costruiti sul tuo cuore, che si spostano con la tua forma.', 'For now zones are a % of max HR. As soon as your watch records at least 5 resting HR values in 28 days, they switch to your <b>heart-rate reserve</b> (the <b>Karvonen</b> method): limits built on your heart, moving with your fitness.') + '</p>') +
      '<ul class="nf-garanzie">' +
        '<li>' + T('<b>Tanaka</b> (208 − 0,7 × età) è più precisa del vecchio 220 − età, che sottostima la FC max dopo i 40 anni. Se fai un test, inserisci il valore nel profilo: tutto si ricalcola, anche le corse passate.', '<b>Tanaka</b> (208 − 0.7 × age) is more accurate than the old 220 − age, which underestimates max HR after 40. If you do a test, enter it in your profile: everything updates, past runs included.') + '</li>' +
        '<li>' + T('Protezione: la corsa facile non supera mai l’80% della FC max; nella corsa-cammino il limite è più basso.', 'Safety net: easy running never goes above 80% of max HR; run-walk has a lower limit.') + '</li>' +
        '<li>' + T('Verifica da strada: se riesci a parlare a frasi intere, sei nella zona giusta.', 'Road check: if you can talk in full sentences, you’re in the right zone.') + '</li>' +
      '</ul></section>';

    // ---- 2-4. le regole dell'adattamento, con i numeri ----
    const sig = (v, l, cat) => '<div class="nf-sig cat-' + cat + '"><b>' + v + '</b><span>' + l + '</span></div>';
    const esito = (cls, ico, tit, v) => '<li class="' + cls + '"><span class="nf-e">' + ico + '</span><b>' + tit + '</b><small>' + v + '</small></li>';
    const regole = '<div class="nf-grid">' +
      '<section class="card nf-card"><div class="nf-when">' + T('Ogni mattina', 'Every morning') + '</div><h3>' + T('La seduta segue come stai', 'The session follows how you feel') + '</h3>' +
        '<div class="nf-sigs">' + sig('+5', T('FC riposo', 'Resting HR'), 'cuore') + sig('−15%', 'HRV', 'cuore') + sig('&lt;5h30′', T('Sonno', 'Sleep'), 'sonno') + sig('&lt;−25', T('Forma', 'Form'), 'attivita') + '</div>' +
        '<div class="nf-then"><span>' + T('Basta un segnale', 'One signal is enough') + '</span><b>60%</b></div>' +
        '<p class="nf-foot">' + T('Confronto con la <b>tua</b> media di 28 giorni, non con quella di altri. La qualità diventa 25′ facili; il piano non cambia: è solo oggi.', 'Compared with <b>your</b> 28-day average, not anyone else’s. Quality becomes 25′ easy; the plan doesn’t change: it’s just today.') + '</p></section>' +
      '<section class="card nf-card"><div class="nf-when">' + T('Ogni settimana', 'Every week') + '</div><h3>' + T('Il piano decide il passo successivo', 'The plan picks the next step') + '</h3>' +
        '<ul class="nf-esiti">' +
          esito('ok', '↗', T('Avanza', 'Forward'), T('2 corse su 3, nessun allarme', '2 runs of 3, no warnings')) +
          esito('warn', '↻', T('Ripete', 'Repeat'), T('0–1 corse o FC media in Z4 (≥ ' + soglia + ' bpm)', '0–1 runs or avg HR in Z4 (≥ ' + soglia + ' bpm)')) +
          esito('bad', '↙', T('Indietro', 'Back'), T('2 settimane vuote o forma &lt; −25', '2 empty weeks or form &lt; −25')) +
        '</ul></section>' +
      '<section class="card nf-card"><div class="nf-when">' + T('Ogni 3 settimane', 'Every 3 weeks') + '</div><h3>' + T('L’intensità si regola da sola', 'Intensity tunes itself') + '</h3>' +
        '<div class="nf-int"><b>±10%</b><span>' + T('3 settimane troppo facili o 2 su 3 troppo dure', '3 weeks too easy or 2 of 3 too hard') + '</span></div>' +
        '<div class="in-int">' + [['Tranquilla', 'Easy-going', '−15%'], ['Equilibrata', 'Balanced', '0%'], ['Ambiziosa', 'Ambitious', '+15%']].map((x) => '<div><b>' + T(x[0], x[1]) + '</b><span>' + x[2] + '</span></div>').join('') + '</div></section>' +
    '</div>' +
    '<section class="card nf-diario"><div><b>' + T('Ogni decisione ha un motivo scritto', 'Every decision comes with a written reason') + '</b><p>' + T('Nessuna scatola nera: ogni volta che il coach cambia qualcosa te lo dice, con i dati che l’hanno convinto. Ricevi una notifica e trovi tutto in “Cosa ha fatto il coach”, l’icona con l’orologio in alto.', 'No black box: every time the coach changes something it tells you, with the data behind it. You get a notification and find it all in “What the coach did”, the clock icon at the top.') + '</p></div>' +
      '<button type="button" class="gc-cta" data-apri-sheet="#diario"><span>' + T('Apri il diario', 'Open the log') + '</span>' + FRECCIA + '</button></section>';

    // ---- approfondimenti: elenco stile Impostazioni, si apre con un tocco ----
    const voce = (id, ico, col, tit, sotto, corpo) => '<details class="nf-row" id="info-' + id + '"><summary><span class="nf-sq' + (col === 'var(--accent)' ? ' acc' : '') + '" style="--c:' + col + '">' + ico + '</span><span class="nf-t"><b>' + tit + '</b><small>' + sotto + '</small></span></summary><div class="nf-body">' + corpo + '</div></details>';
    const kv = (k, v) => '<div class="nf-kv"><b>' + k + '</b><span>' + v + '</span></div>';

    const vs = (cosa, fisso, aac) => '<div class="in-vs-r"><b>' + cosa + '</b><span class="in-vs-f">' + fisso + '</span><span class="in-vs-a">' + aac + '</span></div>';
    const perche = '<div class="in-vs"><div class="in-vs-r in-vs-h"><span></span><span>' + T('Tabella fissa', 'Fixed plan') + '</span><span>AAC</span></div>' +
      vs(T('Partenza', 'Start'), T('uguale per tutti', 'same for all'), T('dalle tue corse', 'from your runs')) +
      vs(T('Giorno storto', 'Off day'), T('seduta uguale', 'same session'), T('ridotta al 60%', 'cut to 60%')) +
      vs(T('Settimana saltata', 'Missed week'), T('vai avanti', 'move on'), T('la ripeti', 'repeat it')) +
      vs(T('Zone cardiache', 'HR zones'), T('% dell’età', '% of age'), T('sul tuo cuore', 'on your heart')) +
      vs(T('Passo', 'Pace'), T('generico', 'generic'), T('dalle tue corse', 'from your runs')) +
      vs(T('Data gara', 'Race date'), T('fissa', 'fixed'), T('ricalcolata', 'recalculated')) + '</div>';

    const partenza = '<p>' + T('Dalla tua corsa continua più lunga delle ultime 6 settimane:', 'From your longest continuous run in the last 6 weeks:') + '</p>' +
      '<div class="in-map">' + [['< 10′', 1], ['10′', 6], ['20′', 8], ['30′', 9], ['45′', 14], ['60′', 17], ['95′', 22]].map((x) => '<div><b>' + x[0] + '</b><span>' + T('sett. ', 'wk ') + x[1] + '</span></div>').join('') + '</div>' +
      '<p class="nf-foot">' + T('Puoi sceglierla a mano in Piano → Rivedi il piano con il coach, all’ultimo passo.', 'You can pick it by hand in Plan → Review the plan with the coach, at the last step.') + '</p>';

    const fasiTesti = d.programma && d.programma.fasi ? d.programma.fasi.map((f) => [f.nome, f.obiettivo + '.']) : T([
      ['Ripartenza', 'Fino a 20–25′ di corsa continua.'], ['Base aerobica', '45–50′ senza fermarsi.'], ['Costruzione', 'Lungo fino a 1h35, primi ritmi.'], ['Mezza maratona', 'Picco, scarico e gara.']
    ], [
      ['Restart', 'Up to 20–25′ of continuous running.'], ['Aerobic base', '45–50′ non-stop.'], ['Build', 'Long run up to 1h35, first paces.'], ['Half marathon', 'Peak, taper and race.']
    ]);
    const intervalli = d.programma && d.programma.fasi ? d.programma.fasi.map((f) => [f.da, f.a]) : [[1, 8], [9, 16], [17, 22], [23, 26]];
    const fasi = '<ol class="in-phases">' + fasiTesti.map((f, i) => {
      const [da, a] = intervalli[i];
      const qui = settAtt && settAtt >= da && settAtt <= a;
      return '<li class="' + (qui ? 'qui' : settAtt && settAtt > a ? 'fatta' : '') + '"><span class="in-ph-n">' + (i + 1) + '</span><div><b>' + f[0] + (qui ? '<em>' + T('sei qui', 'you are here') + '</em>' : '') + '</b><small>' + T('settimane ', 'weeks ') + da + '–' + a + '</small><p>' + f[1] + '</p></div></li>';
    }).join('') + '</ol>' +
      '<h4 class="in-h">' + T('Quante sedute e in che giorni', 'How many sessions, on which days') + '</h4>' +
      '<ul class="in-list">' +
        '<li>' + T('Si parte con <b>3 sedute</b> a settimana. La 4ª (e la 5ª per mezza e maratona) si guadagna: 3 settimane di fila tutte fatte, senza fatica e con il carico che cresce in modo sicuro (rapporto carico acuto/cronico ≤ 1,3). Il tetto dipende da obiettivo, fase e intensità: “Ambiziosa” una in più, “Tranquilla” una in meno.', 'You start with <b>3 sessions</b> a week. The 4th (and the 5th for half and marathon) is earned: 3 weeks in a row all done, without fatigue and with load rising safely (acute/chronic load ratio ≤ 1.3). The cap depends on goal, phase and intensity: “Ambitious” one more, “Easy-going” one fewer.') + '</li>' +
        '<li>' + T('Le sedute in più sono corse facili in Z2: più volume, non più intensità (principio 80/20). Con segnali di fatica, o se per 2 settimane non entrano, il coach la toglie. Scarico, gara e corsa-cammino restano a 3.', 'Extra sessions are easy Z2 runs: more volume, not more intensity (80/20 principle). With signs of fatigue, or if they do not fit for 2 weeks, the coach removes one. Recovery, race and run-walk weeks stay at 3.') + '</li>' +
        '<li>' + T('I giorni li sceglie il coach: mai due sedute impegnative (lungo, ritmo, gara) in giorni di fila, il lungo di preferenza nel weekend, i tuoi giorni preferiti (Piano → Rivedi il piano con il coach) quando possibile. Se corri in un altro giorno la seduta va lì; se ne salti una, passa ai giorni che restano della settimana.', 'The coach picks the days: never two hard sessions (long, pace, race) on consecutive days, the long run preferably at the weekend, your preferred days (Plan → Review the plan with the coach) whenever possible. If you run on another day the session moves there; if you miss one, it moves to the remaining days of the week.') + '</li>' +
        '<li>' + T('Giorni <b>obbligatori</b> (Piano → Rivedi il piano con il coach): il coach usa solo quelli, una seduta per giorno. Con 2 giorni tiene le sedute più importanti (lungo e qualità) e salta una corsa facile; se sono attaccati, il secondo è sempre facile. Con 1 giorno fai una seduta per volta e ogni settimana del piano dura 2 settimane: l’obiettivo slitta, e la data stimata lo mostra.', '<b>Fixed</b> days (Plan → Review the plan with the coach): the coach only uses those, one session per day. With 2 days it keeps the key sessions (long run and quality) and skips an easy run; if they are back to back, the second is always easy. With 1 day you do one session at a time and each plan week lasts 2 weeks: your goal moves later, and the estimated date shows it.') + '</li>' +
        '<li>' + T('Per avanzare contano le corse fatte nella settimana, in qualunque giorno.', 'To move forward, the runs done during the week count, on any day.') + '</li>' +
      '</ul>' +
      '<p class="in-p">' + T('Fonti: progressione di frequenza dei piani di Daniels, Pfitzinger e Higdon; carico acuto/cronico (Gabbett, 2016); distribuzione 80/20 (Seiler).', 'Sources: frequency progression from the Daniels, Pfitzinger and Higdon plans; acute/chronic load (Gabbett, 2016); 80/20 distribution (Seiler).') + '</p>';

    const fmi = d.atleta && d.atleta.fc_max_info;
    const zone = '<div class="in-zones">' + [['&lt; Z1', '&lt; 50%', 'z0'], ['Z1', '50–60%'], ['Z2', '60–70%'], ['Z3', '70–80%'], ['Z4', '80–90%'], ['Z5', '90–100%']].map((z, i) => '<div><span class="zchip ' + (z[2] || 'z' + i) + '">' + z[0] + '</span><small>' + z[1] + '</small></div>').join('') + '</div>' +
      (fmi && fmi.metodo === 'riserva'
        ? kv(T('Modello', 'Model'), T('5 zone in % della riserva cardiaca (Karvonen), come Garmin e Polar', '5 zones as % of heart-rate reserve (Karvonen), like Garmin and Polar')) +
          kv(T('FC a riposo', 'Resting HR'), fmi.fc_riposo + T(' bpm · mediana degli ultimi 28 giorni', ' bpm · median of the last 28 days'))
        : kv(T('Modello', 'Model'), T('5 zone in % della FC max, come Garmin, Polar e Suunto', '5 zones as % of max HR, like Garmin, Polar and Suunto'))) +
      kv(T('FC massima', 'Max HR'), fcMax + ' bpm · ' + (fmi && fmi.fonte === 'misurata' ? T('misurata', 'measured') : T('stimata dall’età', 'age-based estimate'))) +
      kv(T('FC di sicurezza', 'Safety HR'), T('non superare ', 'do not exceed ') + fcMax + ' bpm') +
      kv(T('Corse facili', 'Easy runs'), T('sotto ', 'below ') + facile + ' bpm') + kv(T('Passo indicativo', 'Guide pace'), T('dopo 3 corse, dalla tua efficienza', 'after 3 runs, from your efficiency')) +
      '<p class="in-p">' + T('Come nascono questi numeri (Tanaka e Karvonen) è spiegato in alto, in “Il tuo cuore, non una tabella”. La stima dall’età può sbagliare di ±10 bpm: con un test sul campo inserisci la FC max nel profilo. Il tempo nelle zone viene dai battiti secondo per secondo dell’orologio; sotto il 50% è “fuori zona”.',
        'How these numbers are built (Tanaka and Karvonen) is explained above, in “Your heart, not a table”. The age estimate can be off by ±10 bpm: after a field test, enter your max HR in your profile. Time in zones comes from your watch’s second-by-second heart rate; below 50% is “below zones”.') + '</p>';

    const bmi = '<div class="in-zones">' + [['&lt; 18,5', T('sottopeso', 'underweight')], ['18,5–24,9', T('normopeso', 'healthy')], ['25–29,9', T('sovrappeso', 'overweight')], ['≥ 30', T('obesità', 'obesity')]].map((z) => '<div><b>' + z[0] + '</b><small>' + z[1] + '</small></div>').join('') + '</div>' +
      kv(T('Formula', 'Formula'), T('peso (kg) ÷ altezza (m)²', 'weight (kg) ÷ height (m)²')) +
      kv(T('Peso', 'Weight'), T('il dato più recente tra bilancia (via Intervals.icu) e profilo', 'the most recent of scale (via Intervals.icu) and profile')) +
      '<p class="in-p">' + T('Categorie OMS per adulti. Il BMI non distingue muscoli e grasso: chi corre molto può avere un BMI alto senza eccesso di grasso. È un’indicazione, non una diagnosi.',
        'WHO adult categories. BMI does not tell muscle from fat: active runners can have a high BMI without excess fat. It is a guide, not a diagnosis.') + '</p>';

    const previsioni = kv(T('Data della gara', 'Race date'), T('dal tuo ritmo di avanzamento, dopo 3 settimane', 'from your progress rate, after 3 weeks')) +
      kv(T('Tempo di gara', 'Race time'), T('formula di Riegel sulla tua corsa migliore', 'Riegel formula on your best run')) +
      kv(T('Forma il giorno della gara', 'Race-day form'), T('proiezione di fitness e fatica', 'fitness and fatigue projection'));

    const dati = '<div class="in-flow"><span>⌚ ' + T('Orologio', 'Watch') + '</span><i></i><span>☁️ Intervals.icu</span><i></i><span>🏃 AAC</span></div>' +
      kv('Apple Watch', T('app Intervals.icu Companion', 'Intervals.icu Companion app')) +
      kv('Garmin, Coros, Polar, Suunto', T('collegamento diretto in Intervals.icu', 'direct link in Intervals.icu')) +
      kv(T('Nel profilo', 'In your profile'), T('API key e Athlete ID', 'API key and Athlete ID')) +
      kv(T('Sincronizzazione', 'Sync'), T('automatica ogni 15′ e all’apertura; a richiesta dal profilo', 'automatic every 15′ and on open; on demand from your profile')) +
      kv('Strava', T('le attività importate da Strava non arrivano ad AAC', 'activities imported from Strava do not reach AAC')) +
      '<button type="button" class="gc-cta" data-apri-sheet="#collega"><span>' + T('Guida: collega l’orologio', 'Guide: connect your watch') + '</span>' + FRECCIA + '</button>';

    const carico = kv(T('Carico recente', 'Recent load'), T('ultimi 7 giorni ÷ ultime 6 settimane (ACWR): sicuro 0,8–1,3', 'last 7 days ÷ last 6 weeks (ACWR): safe 0.8–1.3')) +
      kv(T('Oltre 1,5', 'Above 1.5'), T('la prossima seduta viene alleggerita', 'your next session is lightened')) +
      kv(T('Km settimanali', 'Weekly km'), T('avviso oltre +30% sulla media delle 4 settimane prima', 'warning above +30% over the previous 4 weeks’ average')) +
      kv(T('Corsa più lunga', 'Longest run'), T('avviso oltre +10% sulla più lunga dei 30 giorni prima', 'warning above +10% over the longest of the previous 30 days')) +
      kv(T('Prossimo lungo', 'Next long run'), T('al massimo +10% sulla corsa più lunga del mese', 'at most +10% over the month’s longest run')) +
      '<p class="in-p">' + T('La maggior parte degli infortuni da corsa nasce da aumenti troppo rapidi di volume o di una singola uscita. Uno studio su oltre 5.000 runner (Frandsen e colleghi, BJSM 2025) ha visto che il rischio sale quando una corsa supera di oltre il 10% la più lunga del mese precedente. Sono indicazioni, non una diagnosi: se senti dolore, fermati.',
        'Most running injuries come from increasing volume, or a single run, too quickly. A study of over 5,000 runners (Frandsen et al., BJSM 2025) found risk rises when one run exceeds the longest of the previous month by more than 10%. These are guidelines, not a diagnosis: if you feel pain, stop.') + '</p>';

    const strumenti = kv(T('Calendario', 'Calendar'), T('tocca un giorno per la seduta', 'tap a day for the session')) +
      kv(T('Esporta', 'Export'), T('.ics per il tuo calendario', '.ics for your calendar')) +
      kv(T('Segna come fatta', 'Mark as done'), T('per le sedute senza orologio', 'for sessions without a watch')) +
      kv(T('Condividi', 'Share'), T('immagine di una seduta fatta, per post o storie', 'image of a completed session, for posts or stories')) +
      kv(T('Copia per AI', 'Copy for AI'), T('i dati di una seduta fatta, con età, altezza, peso e BMI se presenti', 'data of a completed session, with age, height, weight and BMI when available'));

    const limiti = li(T([
      '<b>Piano su misura</b>: si adatta ai tuoi dati e ogni cambiamento ha un motivo scritto.',
      'Senza la tua FC massima usa la stima dall’età.',
      'Non sostituisce il medico: se senti dolore, fermati.',
      'Dati su un server privato, un database per utente, chiave Intervals cifrata.',
      'L’amministratore vede quando usi l’app (giorni e minuti, finché hai l’account), mai cosa guardi.',
      'Notifiche (se le attivi): solo la seduta del giorno e il riepilogo della settimana, niente dati di salute. Passano dal servizio di notifiche del tuo telefono (Apple o Google).'
    ], [
      '<b>Tailored plan</b>: it adapts to your data and every change comes with a written reason.',
      'Without your max HR it uses the age-based estimate.',
      'It does not replace a doctor: if you feel pain, stop.',
      'Data on a private server, one database per user, encrypted Intervals key.',
      'The administrator sees when you use the app (days and minutes, while you have an account), never what you look at.',
      'Notifications (if you turn them on): only your session for the day and your weekly recap, no health data. They go through your phone’s notification service (Apple or Google).'
    ]));

    const elenco = '<div class="sec-title"><h2>' + T('Approfondisci', 'Learn more') + '</h2></div><section class="nf-list">' +
      voce('vantaggio', G.star, 'var(--accent)', T('Perché AAC', 'Why AAC'), T('Rispetto a una tabella fissa', 'Compared with a fixed plan'), perche) +
      voce('partenza', G.flag, '#ff9500', T('Punto di partenza', 'Starting point'), T('La settimana da cui parti', 'The week you start from'), partenza) +
      voce('piano', G.cal, '#5856d6', T('Il piano', 'The plan'), tot + T(' settimane · 3 sedute alle ', ' weeks · 3 sessions at ') + esc(ora), fasi) +
      voce('sedute', G.list, '#007aff', T('Le sedute', 'Sessions'), T('Cosa significano le sigle', 'What the codes mean'), '<div class="in-tipi">' + tipiSeduta().map((t) => '<div class="in-tipo"><span class="sig">' + esc(t.sigla) + '</span><div><b>' + esc(t.nome) + '</b><p>' + esc(t.testo) + '</p></div></div>').join('') + '</div>') +
      voce('zone', G.heart, '#ff3b30', T('Zone e passo', 'Zones and pace'), T('Dalla tua FC a riposo e massima', 'From your resting and max HR'), zone) +
      voce('bmi', G.heart, '#ff2d55', 'BMI', T('Peso e altezza, in Salute', 'Weight and height, in Health'), bmi) +
      voce('carico', G.shield, '#ff9500', T('Carico e infortuni', 'Load and injuries'), T('Crescere senza farsi male', 'Build up without getting hurt'), carico) +
      voce('previsioni', G.trend, '#30b0c7', T('Previsioni', 'Forecasts'), T('Data, tempo e forma per la gara', 'Race date, time and form'), previsioni) +
      voce('dati', G.sync, '#8e8e93', T('I tuoi dati', 'Your data'), T('Orologio, Intervals.icu, AAC', 'Watch, Intervals.icu, AAC'), dati) +
      voce('strumenti', G.grid, '#af52de', T('Strumenti', 'Tools'), T('Calendario, export, Copia per AI', 'Calendar, export, Copy for AI'), strumenti) +
      voce('limiti', G.shield, '#a2845e', T('Limiti e privacy', 'Limits and privacy'), T('Cosa non fa, dove stanno i dati', 'What it does not do, where data lives'), limiti) +
    '</section>';

    return hero + '<div class="sec-title" id="info-come"><h2>' + T('Come ti segue il coach', 'How the coach follows you') + '</h2></div>' + cuore + regole + elenco;
  }

  /* ---- Guida: come funziona (solo ciò che l'app fa davvero) ---- */
  const leggiPref = (k, def) => { try { const v = localStorage.getItem(k); return v == null ? def : v === '1'; } catch (_) { return def; } };
  const scriviPref = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch (_) {} };

  document.addEventListener('toggle', (e) => {
    const el = e.target;
    if (el.id === 'previsioni' && el.open) requestAnimationFrame(() => charts.forEach((c) => c.resize()));
    if (el.dataset && el.dataset.pref) scriviPref(el.dataset.pref, el.open);
  }, true);

  /* ---- Il tuo passo ---- */
  const rangePasso = (z) => fmtPasso(z.passo_veloce) + '–' + fmtPasso(z.passo_lento);

  // Passo indicativo di una seduta, dalle zone personali (null se non ancora stimabile)
  function passoIndicativo(s) {
    const ps = ultimiDati && ultimiDati.passo;
    if (!ps || !ps.disponibile || s.tipo === 'recupero') return null;
    const z = ps.zone;
    if (s.tipo === 'gara') return { valore: fmtPasso(ps.passo_gara.sec), nota: T('passo gara previsto', 'predicted race pace') };
    if (s.tipo === 'qualita') {
      const mezza = /mezza|half|ritmo 5|ritmo 10|maratona|5K pace|10K pace|marathon/i.test(s.blocchi);
      return { valore: rangePasso(z.facile), nota: T('tratti facili · veloci ', 'easy parts · fast parts ') + rangePasso(mezza ? z.mezza : z.medio) };
    }
    return { valore: rangePasso(z.facile), nota: s.tipo === 'corsa-cammino' ? T('nei tratti di corsa', 'in the running parts') : T('passo facile', 'easy pace') };
  }

  // Confronto dopo la corsa: passo reale (tratti di corsa) vs indicativo
  // Piu' corse nello stesso giorno (es. orologio interrotto): si scorrono con le frecce, la seduta conta una volta
  const corsaSel = new Map();
  const corseDelGiorno = (data) => (ultimoStorico ? ultimoStorico.corse.filter((x) => x.data === data).sort((a, b) => String(a.ora_inizio || '').localeCompare(String(b.ora_inizio || ''))) : []);
  const corsaDelGiorno = (data) => { const l = corseDelGiorno(data); if (!l.length) return null; const i = Math.min(l.length - 1, corsaSel.get(data) || 0); return l[i]; };
  function selettoreCorse(data) {
    const l = corseDelGiorno(data);
    if (l.length < 2) return '';
    const i = Math.min(l.length - 1, corsaSel.get(data) || 0), c = l[i];
    const km = l.reduce((t, x) => t + (x.distanza || 0), 0), sec = l.reduce((t, x) => t + (x.tempo || 0), 0);
    return '<div class="cg-switch" role="group" aria-label="' + T('Corse del giorno', 'Runs of the day') + '">' +
      '<button type="button" class="cg-freccia" data-cg="' + data + '" data-cg-dir="-1" aria-label="' + T('Corsa precedente', 'Previous run') + '"' + (i === 0 ? ' disabled' : '') + '>‹</button>' +
      '<div class="cg-info"><b>' + T('Corsa ', 'Run ') + (i + 1) + T(' di ', ' of ') + l.length + '</b><span>' + (c.ora_inizio ? esc(c.ora_inizio) + ' · ' : '') + fmt1(c.distanza) + ' km · ' + fmtDurata(c.tempo) + '</span>' +
        '<small>' + T('Totale del giorno: ', 'Day total: ') + fmt1(km) + ' km · ' + fmtDurata(sec) + '</small></div>' +
      '<button type="button" class="cg-freccia" data-cg="' + data + '" data-cg-dir="1" aria-label="' + T('Corsa successiva', 'Next run') + '"' + (i === l.length - 1 ? ' disabled' : '') + '>›</button></div>';
  }

  function confrontoPasso(s) {
    if (!ultimoStorico || !s.fatta) return '';
    const c = corsaDelGiorno(s.data);
    const ps = ultimiDati && ultimiDati.passo;
    if (!c) return '';
    const reale = c.passo_corsa || c.passo_medio;
    let giudizio = '';
    if (ps && ps.disponibile && s.tipo !== 'qualita' && s.tipo !== 'gara') {
      const z = ps.zone.facile;
      giudizio = reale < z.passo_veloce - 5 ? ['warn', T('più veloce del passo facile: la prossima volta rallenta', 'faster than easy pace: slow down next time')]
        : reale > z.passo_lento + 20 ? ['ok', T('più lento del previsto: va benissimo se la FC era bassa', 'slower than expected: perfectly fine if HR was low')]
        : ['ok', T('nel passo facile previsto ✓', 'within the expected easy pace ✓')];
    }
    return selettoreCorse(s.data) + '<div class="pace-real"><div><small>' + T('Passo reale', 'Actual pace') + (c.passo_corsa ? T(' · tratti di corsa', ' · running parts') : '') + '</small><b>' + fmtPasso(reale) + '/km</b></div>' +
      (c.fc_corsa || c.fc_media ? '<div><small>' + T('FC in corsa', 'HR while running') + '</small><b>' + fmt0(c.fc_corsa || c.fc_media) + ' bpm</b></div>' : '') +
      (giudizio ? '<p class="' + giudizio[0] + '">' + giudizio[1] + '</p>' : '') + '</div>';
  }

  function renderPasso(d) {
    const ps = d.passo;
    if (!ps) return '';
    const how = comeCalcolo(T(
      'Per ogni corsa delle ultime 6 settimane calcolo l’<b>efficienza</b>: velocità ÷ battiti (nelle sedute corsa-cammino uso <b>solo i tratti di corsa</b>, riconosciuti dalla cadenza o dalla velocità). Prendo la mediana delle ultime 8 corse e la trasformo in passo per ogni fascia di frequenza: ' +
      '<b>facile</b> Z2 (60–70% della riserva cardiaca, o della FC max se mancano i dati a riposo), <b>ritmo medio</b> Z3 (70–80%), <b>ritmo gara</b> (la zona del tuo obiettivo). Il <b>passo gara</b> viene dalla previsione del tempo (se disponibile) oppure dall’80% della FC con un 4% di margine per la fatica. ' +
      'È un’indicazione: se il cuore supera la soglia della seduta, conta il cuore.',
      'For each run in the last 6 weeks I compute <b>efficiency</b>: speed ÷ heart rate (in run-walk sessions I use <b>only the running parts</b>, detected from cadence or speed). I take the median of the last 8 runs and turn it into a pace for each heart-rate band: ' +
      '<b>easy</b> Z2 (60–70% of heart-rate reserve, or of max HR without resting data), <b>steady</b> Z3 (70–80%), <b>race pace</b> (your goal’s zone). <b>Race pace</b> comes from the time forecast (when available) or from 80% HR with a 4% fatigue margin. ' +
      'It is a guide: if your heart goes above the session threshold, your heart wins.'));
    if (!ps.disponibile && !ps.ultimo) return '';
    if (!ps.disponibile) {
      return '<section class="card pace-card"><div class="pv-head"><div><h3>⏱️ ' + T('Il tuo passo', 'Your pace') + '</h3><p class="sub">' + T('Quanto tempo impieghi per fare 1 km', 'How long you take to run 1 km') + '</p></div>' + pillAff('nessuna') + '</div>' +
        (ps.ultimo ? '<div class="pace-last"><small>' + T('Ultima corsa', 'Last run') + ' · ' + esc(fmtData(ps.ultimo.data)) + '</small><b>' + fmtPasso(ps.ultimo.passo) + '/km</b><span>' + (ps.ultimo.solo_corsa ? T('solo tratti di corsa', 'running parts only') : T('camminata compresa', 'walking included')) + '</span></div>' : '') +
        dots(Math.min(ps.corse, ps.richieste), ps.richieste) +
        semplice(T('Dopo <b>' + ps.richieste + ' corse</b> (anche corsa-cammino, purché con almeno 10′ di corsa effettiva) stimo il tuo passo facile, il ritmo medio e il passo gara, e li mostro in ogni seduta come indicazione. Nelle prime settimane conta soprattutto restare a ritmo da conversazione.',
          'After <b>' + ps.richieste + ' runs</b> (run-walk counts too, with at least 10′ of actual running) I estimate your easy pace, steady pace and race pace, and show them in every session as a guide. In the first weeks what matters most is staying at conversational pace.')) + how + '</section>';
    }
    const z = ps.zone;
    const riga = (nome, zz, nota) => '<div class="pace-z"><b>' + nome + '</b><span class="pace-v">' + rangePasso(zz) + '<small>/km</small></span><span class="pace-hr">' + zz.fc_da + '–' + zz.fc_a + ' bpm</span><em>' + nota + '</em></div>';
    const tend = ps.tendenza_sett_sec;
    return '<section class="card pace-card"><div class="pv-head"><div><h3>⏱️ ' + T('Il tuo passo', 'Your pace') + '</h3><p class="sub">' + T('Quanto tempo impieghi per fare 1 km · stimato sulle tue ultime ' + ps.corse + ' corse', 'How long you take to run 1 km · estimated from your last ' + ps.corse + ' runs') + '</p></div>' +
        pillAff(ps.provvisoria || ps.corse < 6 ? 'bassa' : ps.corse < 12 ? 'media' : 'alta') + '</div>' +
      (ps.provvisoria ? '<div class="pv-warn">⚠️ ' + T('<b>Stima provvisoria</b>, un po’ ottimistica: diventa affidabile con 3 corse continue.', '<b>Provisional estimate</b>, a bit optimistic: it becomes reliable with 3 continuous runs.') + '</div>' : '') +
      '<div class="pace-top">' +
        '<div><small>' + T('Passo facile', 'Easy pace') + '</small><b>' + rangePasso(z.facile) + '</b><span>' + T('a ritmo conversazione', 'at conversational pace') + '</span></div>' +
        '<div><small>' + T('Passo gara previsto', 'Predicted race pace') + '</small><b>' + fmtPasso(ps.passo_gara.sec) + '</b><span>' + (ps.passo_gara.min ? fmtPasso(ps.passo_gara.min) + '–' + fmtPasso(ps.passo_gara.max) + T(' · dalla previsione', ' · from forecast') : T('stima dalla tua efficienza', 'estimated from your efficiency')) + '</span></div>' +
        '<div><small>' + T('Tendenza', 'Trend') + '</small><b>' + (tend == null ? '–' : (tend < 0 ? '−' : '+') + fmt0(Math.abs(tend)) + '″') + '</b><span>' + (tend == null ? T('da gennaio, con più corse', 'from January, with more runs') : tend < 0 ? T('al km ogni settimana · migliori', 'per km each week · improving') : T('al km ogni settimana', 'per km each week')) + '</span></div>' +
      '</div>' +
      '<div class="pace-zones">' +
        riga(T('Facile', 'Easy'), z.facile, T('corse facili, lungo, tratti di corsa', 'easy runs, long run, running parts')) +
        riga(T('Ritmo medio', 'Steady'), z.medio, T('frazioni “ritmo medio” (fase 3)', '“steady pace” reps (phase 3)')) +
        riga(ps.obiettivo ? esc(ps.obiettivo.ritmo) : T('Ritmo gara', 'Race pace'), z.mezza, T('frazioni a ritmo gara e gara', 'race-pace reps and race')) +
      '</div>' +
      semplice(T('Il passo è quanto tempo impieghi per fare 1 km: più è basso, più vai veloce. Oggi a ritmo facile corri tra <b>' + rangePasso(z.facile) + '</b> al km. In ogni seduta trovi il passo indicativo, ma <b>comanda il cuore</b>: se la FC supera la soglia, rallenta anche se sei “in passo”.',
        'Pace is how long you take to run 1 km: the lower, the faster. Today at easy effort you run between <b>' + rangePasso(z.facile) + '</b> per km. Every session shows a guide pace, but <b>your heart is in charge</b>: if HR goes above the threshold, slow down even if you are “on pace”.')) +
      how + '</section>';
  }

  /* ---- Obiettivo ---- */
  function renderObiettivo(d) {
    const p = d.programma;
    if (!p) return '';
    const o = p.obiettivo;
    const mo = o.mesi_obiettivo || 6, ml = o.mesi_limite || 12;
    const statoTxt = { in_linea: ['ok', T('In linea · entro ' + mo + ' mesi', 'On track · within ' + mo + ' months')], ritardo: ['warn', T('Entro ' + ml + ' mesi', 'Within ' + ml + ' months')], oltre: ['bad', T('Oltre ' + ml + ' mesi', 'Beyond ' + ml + ' months')] }[o.stato];
    const giorni = giorniDa(d.oggi, o.data_stimata);
    const notaPrev = o.previsione_tempo
      ? T('* Stima indicativa dalla corsa del ', '* Rough estimate from the run on ') + esc(fmtData(o.previsione_tempo.da.data)) + ' (' + fmt1(o.previsione_tempo.da.distanza) + T(' km): migliorerà con l’allenamento.', ' km): it will improve with training.')
      : T('* Il tempo sulla gara verrà stimato dalle tue corse appena ne registrerai una da almeno 20 minuti.', '* Your race time will be estimated as soon as you record a run of at least 20 minutes.');
    const tot = p.totale_settimane, sett = p.settimana_piano;
    const it = p.intensita;
    const rigaInt = it ? '<p class="g-int">' + T('Intensità ', 'Intensity ') + '<b>' + esc(it.nome) + '</b>' + (it.percentuale ? ' · ' + T('oggi ', 'now ') + (it.percentuale > 0 ? '+' : '') + it.percentuale + '%' : '') +
      (it.percentuale !== Math.round((({ tranquilla: 0.85, ambiziosa: 1.15 })[it.scelta] || 1) * 100 - 100) ? T(' · ritoccata dal coach', ' · fine-tuned by the coach') : '') + '</p>' : '';
    const fasi = '<div class="g-fasi">' + p.fasi.map((f) => {
      const n = f.a - f.da + 1;
      const pct = f.stato === 'completata' ? 100 : f.stato === 'in_corso' ? Math.max(6, Math.round((sett - f.da) / n * 100)) : 0;
      return '<div class="g-fase ' + f.stato + '" style="flex:' + n + '"><i><b style="width:' + pct + '%"></b></i><span>' + esc(f.nome) + '</span></div>';
    }).join('') + '</div>';
    return '<section class="goal">' +
      '<div class="goal-top"><div><div class="eyebrow">' + T('Obiettivo', 'Goal') + '</div><h2>' + esc(o.nome) + '</h2></div>' +
        '<span class="pill ' + statoTxt[0] + '">' + esc(statoTxt[1]) + '</span></div>' +
      '<div class="goal-line">' +
        '<div><b class="num">' + esc(fmtDataBreve(o.data_stimata)) + '</b><span>' + T('prima data possibile', 'earliest date') + '</span></div>' +
        '<div><b class="num">' + (giorni > 0 ? giorni : 0) + '</b><span>' + T('giorni', 'days') + '</span></div>' +
        '<div><b class="num">' + sett + '<small>/' + tot + '</small></b><span>' + T('settimana', 'week') + '</span></div>' +
        (o.previsione_tempo ? '<div><b class="num">' + fmtDurata(o.previsione_tempo.tempo_sec) + '</b><span>' + T('tempo stimato*', 'estimated time*') + '</span></div>' : '') +
      '</div>' + fasi + rigaInt +
      '<details class="more"><summary>' + T('Come si calcola', 'How it is calculated') + '</summary><p class="fine">' + (o.previsione_tempo ? notaPrev + ' ' : '') + T('Data e piano si ricalcolano ogni settimana in base a sedute fatte, frequenza cardiaca e recupero', 'Date and plan are recalculated every week from completed sessions, heart rate and recovery') +
        (o.stima_da_dati ? T(' (stai avanzando nel ' + o.ritmo_avanzamento_pct + '% delle settimane).', ' (you are moving forward in ' + o.ritmo_avanzamento_pct + '% of weeks).') : T('; dalla 3ª settimana la data sarà stimata dai tuoi dati reali.', '; from week 3 the date will be estimated from your real data.')) + '</p></details>' +
    '</section>';
  }

  /* ---- Oggi: prossima seduta + anello della settimana ---- */
  function anello(fatte, tot) {
    const r = 42, C = 2 * Math.PI * r, gap = 7, seg = C / tot - gap;
    let archi = '';
    for (let i = 0; i < tot; i++) {
      archi += '<circle cx="50" cy="50" r="' + r + '" class="' + (i < fatte ? 'on' : '') + '" stroke-dasharray="' + seg.toFixed(2) + ' ' + (C - seg).toFixed(2) + '" stroke-dashoffset="' + (-(i * C / tot) - gap / 2).toFixed(2) + '"/>';
    }
    return '<svg class="ring" viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(-90 50 50)">' + archi + '</g>' +
      '<text x="50" y="49" class="ring-n">' + fatte + '<tspan class="ring-t">/' + tot + '</tspan></text><text x="50" y="66" class="ring-l">' + T('sedute', 'sessions') + '</text></svg>';
  }

  function renderSettimana(d) {
    const p = d.programma;
    if (!p || !p.settimana) return '';
    const w = p.settimana;
    const decide = fmtDataLunga(w.a);
    const prossima = w.settimana_piano + 1;
    let msg;
    if (!w.iniziato) msg = T('Il piano parte ' + fmtDataLunga(p.inizio) + '.', 'The plan starts on ' + fmtDataLunga(p.inizio) + '.');
    else if (w.sedute === 1) msg = w.fatte >= 1
      ? (w.una_su_due === 2 ? T('Fatta: dalla prossima settimana passi alla settimana ' + prossima + '.', 'Done: next week you move on to week ' + prossima + '.') : T('Fatta: la prossima settimana fai l’altra seduta di questa settimana del piano.', 'Done: next week you do the other session of this plan week.'))
      : T('Una seduta entro ' + decide + (w.una_su_due === 2 ? ' per passare alla settimana ' + prossima + '.' : ': è la ' + w.una_su_due + 'ª di 2 di questa settimana del piano.'), 'One session by ' + decide + (w.una_su_due === 2 ? ' to move on to week ' + prossima + '.' : ': it is #' + w.una_su_due + ' of 2 in this plan week.'));
    else if (w.fatte >= 2) msg = T('Settimana ' + prossima + ' da ' + decide + (w.fatte === 2 && (w.sedute || 3) > 2 ? '. Le altre sono un di più.' : '.'), 'Week ' + prossima + ' from ' + decide + (w.fatte === 2 && (w.sedute || 3) > 2 ? '. The rest are a bonus.' : '.'));
    else if (w.fatte === 1) msg = T('Ancora <b>1</b> entro ' + decide + ' per la settimana ' + prossima + '.', '<b>1 more</b> by ' + decide + ' for week ' + prossima + '.');
    else msg = T('<b>2</b> entro ' + decide + ' per la settimana ' + prossima + '.', '<b>2</b> by ' + decide + ' for week ' + prossima + '.');
    if (w.iniziato && w.fatte === 0 && w.rischio_indietro) msg += T(' Se resta vuota, il piano torna indietro.', ' If it stays empty, the plan steps back.');
    const giorni = w.previste.map((c) => {
      const st = c.fatta ? 'fatta' : c.passata ? 'saltata' : c.data === d.oggi ? 'oggi' : '';
      return '<li class="' + st + '"><span>' + esc(fmtData(c.data)) + '</span>' + (c.fatta ? '✓' : st === 'saltata' ? T('non fatta', 'missed') : st === 'oggi' ? T('oggi', 'today') : '') + '</li>';
    }).join('');
    const extra = w.giorni_fatti.filter((g) => !w.previste.some((c) => c.data === g)).length;
    return '<section class="card week-card">' +
      '<div class="wk-top">' + anello(w.fatte, w.sedute || 3) +
        '<div class="wk-txt"><h3>' + T('Questa settimana', 'This week') + '</h3><p>' + msg + '</p>' +
          '<ul class="wk-days">' + giorni + '</ul>' +
          (extra ? '<small class="wk-extra">' + T('+ ' + extra + ' corsa fuori piano, conta lo stesso', '+ ' + extra + ' unscheduled run, it still counts') + '</small>' : '') +
        '</div></div>' +
      (p.consigli.length ? '<details class="more coach-more"><summary>' + T('Note del coach', 'Coach notes') + '</summary><ul>' + p.consigli.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul></details>' : '') +
    '</section>';
  }

  function renderOggi(d) {
    const p = d.programma;
    if (!p || !p.attivo || !p.prossime.length) return '';
    const s = p.prossime[0];
    return '<section class="hero">' +
      '<div class="eyebrow">' + esc(quando(d.oggi, s.data)).replace(/^./, (c) => c.toUpperCase()) + ' · ' + esc(p.ora) + '<span class="fase-tag">' + esc(s.fase) + '</span></div>' +
      '<h2>' + esc(s.titolo) + '</h2>' +
      bannerAdattata(s) + corpoSeduta(s, true) +
    '</section>';
  }

  /* ---- Avvisi in Oggi: corse da Strava e carico in crescita troppo rapida ---- */
  function renderAvvisi(d) {
    let h = '';
    if (d.collegamento && d.collegamento.avviso && !(ME && ME.demo)) {
      h += '<section class="avviso warn"><div class="av-h">' + ICO.sync + '<h3>' + T('Le tue corse arrivano da Strava', 'Your runs come from Strava') + '</h3></div>' +
        (ME && ME.profilo && ME.profilo.strava && ME.profilo.strava.disponibile
          ? '<p>' + T('Intervals.icu non può passare ad AAC le attività importate da Strava: lo vietano i termini di Strava. Puoi collegare Strava direttamente ad AAC, oppure l’orologio direttamente a Intervals.icu.', 'Intervals.icu cannot pass activities imported from Strava to AAC: Strava’s terms forbid it. You can connect Strava directly to AAC, or your watch directly to Intervals.icu.') + '</p>'
          : '<p>' + T('Intervals.icu non può passare ad AAC le attività importate da Strava: lo vietano i termini di Strava. Collega lo stesso orologio anche direttamente a Intervals.icu: bastano due minuti e Strava continua a funzionare come prima.', 'Intervals.icu cannot pass activities imported from Strava to AAC: Strava’s terms forbid it. Connect the same watch directly to Intervals.icu too: it takes two minutes and Strava keeps working as before.') + '</p>') +
        (ME && ME.profilo && ME.profilo.strava && ME.profilo.strava.disponibile
          ? '<a class="btn-strava av-strava" href="/api/strava/collega">' + T('Connetti Strava direttamente: un tocco', 'Connect Strava directly: one tap') + '</a>' : '') +
        '<button type="button" class="gc-cta" data-apri-sheet="#collega"><span>' + T('Oppure collega l’orologio a Intervals', 'Or connect your watch to Intervals') + '</span>' + FRECCIA + '</button></section>';
    }
    const c = d.programma && d.programma.carico;
    if (c && c.livello !== 'ok') {
      const alto = c.livello === 'alto';
      h += '<section class="avviso ' + (alto ? 'bad' : 'warn') + '"><div class="av-h">' + ICO.flame + '<h3>' + (alto ? T('Carico troppo alto', 'Load too high') : T('Carico in crescita rapida', 'Load rising fast')) + '</h3></div>' +
        '<ul>' + c.segnali.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' +
        '<p class="g-note">' + (alto && d.programma.prossime[0] && d.programma.prossime[0].adattata
          ? T('Ho già alleggerito la prossima seduta. ', 'I have already lightened your next session. ') : '') +
          T('Gli infortuni da corsa arrivano quasi sempre da aumenti troppo rapidi. Se senti dolore, fermati.', 'Running injuries almost always come from building up too fast. If you feel pain, stop.') + '</p></section>';
    }
    return h;
  }

  /* ---- Progressi: carico e infortuni ---- */
  function renderCarico(d) {
    const c = d.programma && d.programma.carico;
    if (!c || (c.acwr == null && !c.km_7 && c.lungo_max_30 == null)) return '';
    const t = (l, v, n) => '<div class="tile"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="n">' + n + '</div></div>';
    const stato = { ok: ['ok', T('Crescita sicura', 'Safe build-up')], attenzione: ['warn', T('Attenzione', 'Caution')], alto: ['bad', T('Troppo in fretta', 'Too fast')] }[c.livello];
    // barra ACWR: 0–2, zona sicura 0,8–1,3, attenzione fino a 1,5
    const pos = c.acwr != null ? Math.max(0, Math.min(100, c.acwr / 2 * 100)) : null;
    const barra = pos != null ? '<div class="acwr" role="img" aria-label="ACWR ' + fmt1(c.acwr) + '"><div class="acwr-bar"><i class="z-basso"></i><i class="z-ok"></i><i class="z-att"></i><i class="z-alto"></i></div>' +
      '<b style="left:' + pos.toFixed(1) + '%"></b><div class="acwr-lab"><span style="left:40%">0,8</span><span style="left:65%">1,3</span><span style="left:75%">1,5</span></div></div>' : '';
    return '<div class="sec-title" id="carico"><h2>' + T('Carico e infortuni', 'Load and injuries') + '</h2><span class="pill ' + stato[0] + '">' + esc(stato[1]) + '</span></div>' +
      (c.acwr != null ? '<section class="card"><h3>' + T('Carico recente su carico abituale', 'Recent vs usual load') + '</h3><p class="sub">' + T('ACWR: ultimi 7 giorni rispetto alle ultime 6 settimane · sicuro tra 0,8 e 1,3', 'ACWR: last 7 days vs last 6 weeks · safe between 0.8 and 1.3') + '</p>' +
        '<div class="acwr-v"><b class="num">' + fmt1(c.acwr) + '</b></div>' + barra + '</section>' : '') +
      '<section class="tiles">' +
        t(T('Km in 7 giorni', 'Km in 7 days'), fmt1(c.km_7) + '<small>km</small>', c.media_settimanale ? (c.aumento_pct != null ? (c.aumento_pct > 0 ? '+' : '') + c.aumento_pct + T('% sulla media di ', '% vs average of ') : T('media ', 'average ')) + fmt1(c.media_settimanale) + ' km' : T('media non ancora disponibile', 'average not available yet')) +
        t(T('Prossimo lungo, al massimo', 'Next long run, at most'), c.limite_lungo_km != null ? fmt1(c.limite_lungo_km) + '<small>km</small>' : '–', c.lungo_max_30 != null ? T('+10% sulla più lunga del mese (', '+10% over the month’s longest (') + fmt1(c.lungo_max_30) + ' km)' : T('dopo la prima corsa', 'after your first run')) +
      '</section>' +
      (c.segnali.length ? '<div class="chips">' + c.segnali.map((x) => '<span class="chip">' + esc(x) + '</span>').join('') + '</div>' : '');
  }

  /* ---- Guida: collegare l'orologio a Intervals.icu (non tramite Strava) ---- */
  let collegaDisp = 'garmin';
  const DISPOSITIVI = [
    { id: 'garmin', nome: 'Garmin', passi: () => [
      T('Apri <b>intervals.icu</b> e accedi.', 'Open <b>intervals.icu</b> and sign in.'),
      T('Vai in <b>Settings</b> (in basso a sinistra) e cerca la sezione <b>Garmin</b>.', 'Go to <b>Settings</b> (bottom left) and find the <b>Garmin</b> section.'),
      T('Tocca <b>Connect</b>, accedi con il tuo account Garmin Connect e autorizza tutte le voci (attività e dati di salute).', 'Tap <b>Connect</b>, sign in with your Garmin Connect account and allow everything (activities and health data).'),
      T('Lascia attivo lo scaricamento dei dati <b>wellness</b>: servono FC a riposo, HRV e sonno.', 'Keep <b>wellness</b> download on: resting HR, HRV and sleep come from there.'),
    ] },
    { id: 'apple', nome: 'Apple Watch', passi: () => [
      T('Su iPhone installa dall’App Store l’app <b>Intervals.icu Companion</b>.', 'On your iPhone install the <b>Intervals.icu Companion</b> app from the App Store.'),
      T('Aprila, accedi con il tuo account Intervals.icu e concedi l’accesso a <b>Salute</b> (allenamenti, frequenza cardiaca, HRV, sonno).', 'Open it, sign in with your Intervals.icu account and allow access to <b>Health</b> (workouts, heart rate, HRV, sleep).'),
      T('Le corse registrate con l’app Allenamento arrivano da sole. FC a riposo e HRV possono arrivare qualche ora dopo: è normale.', 'Runs recorded with the Workout app arrive on their own. Resting HR and HRV may arrive a few hours later: that is normal.'),
    ] },
    { id: 'coros', nome: 'Coros', passi: () => [
      T('Apri <b>intervals.icu</b> → <b>Settings</b> e cerca <b>Coros</b>.', 'Open <b>intervals.icu</b> → <b>Settings</b> and find <b>Coros</b>.'),
      T('Tocca <b>Connect</b>, accedi con l’account Coros e autorizza.', 'Tap <b>Connect</b>, sign in with your Coros account and allow access.'),
    ] },
    { id: 'polar', nome: 'Polar', passi: () => [
      T('Apri <b>intervals.icu</b> → <b>Settings</b> e cerca <b>Polar</b>.', 'Open <b>intervals.icu</b> → <b>Settings</b> and find <b>Polar</b>.'),
      T('Tocca <b>Connect</b>, accedi con l’account Polar Flow e autorizza (anche sonno e ricarica notturna).', 'Tap <b>Connect</b>, sign in with your Polar Flow account and allow access (including sleep and Nightly Recharge).'),
    ] },
    { id: 'suunto', nome: 'Suunto', passi: () => [
      T('Apri <b>intervals.icu</b> → <b>Settings</b> e cerca <b>Suunto</b>.', 'Open <b>intervals.icu</b> → <b>Settings</b> and find <b>Suunto</b>.'),
      T('Tocca <b>Connect</b>, accedi con l’account Suunto e autorizza.', 'Tap <b>Connect</b>, sign in with your Suunto account and allow access.'),
    ] },
    { id: 'altro', nome: T('Altro', 'Other'), passi: () => [
      T('In <b>intervals.icu</b> → <b>Settings</b> guarda l’elenco dei collegamenti diretti: se c’è il tuo orologio, collegalo da lì.', 'In <b>intervals.icu</b> → <b>Settings</b> check the list of direct connections: if your watch is there, connect it from there.'),
      T('Se non c’è, cerca nell’app del tuo orologio l’esportazione verso Intervals.icu o il caricamento automatico dei file <b>.FIT</b>.', 'If it is not, look in your watch app for an export to Intervals.icu or automatic upload of <b>.FIT</b> files.'),
      T('In alternativa puoi caricare a mano il file .FIT di ogni corsa su intervals.icu.', 'Otherwise you can upload each run’s .FIT file to intervals.icu by hand.'),
    ] },
  ];
  function apriCollega() {
    const disp = DISPOSITIVI.find((x) => x.id === collegaDisp) || DISPOSITIVI[0];
    const c = ultimiDati && ultimiDati.collegamento;
    mostraSheet(T('Collega l’orologio', 'Connect your watch'),
      '<section class="collega">' +
        '<div class="in-flow"><span>⌚ ' + T('Orologio', 'Watch') + '</span><i></i><span>☁️ Intervals.icu</span><i></i><span>🏃 AAC</span></div>' +
        '<p class="cl-intro">' + T('AAC legge i dati da Intervals.icu. Le attività devono arrivare a Intervals <b>direttamente dall’orologio</b>: quelle importate da Strava restano invisibili ad AAC.', 'AAC reads your data from Intervals.icu. Activities must reach Intervals <b>directly from your watch</b>: those imported from Strava stay invisible to AAC.') + '</p>' +
        (c && c.avviso ? '<p class="cl-alert">' + T('Dal tuo account vediamo attività arrivate solo da Strava (l’ultima il ', 'We see activities arriving only from Strava on your account (the latest on ') + esc(fmtData(c.strava_ultima)) + ').</p>' : '') +
        '<div class="cl-disp" role="group" aria-label="' + T('Il tuo orologio', 'Your watch') + '">' + DISPOSITIVI.map((x) => '<button type="button" data-collega="' + x.id + '" aria-pressed="' + (x.id === disp.id) + '">' + esc(x.nome) + '</button>').join('') + '</div>' +
        '<ol class="cl-passi">' + disp.passi().map((p) => '<li>' + p + '</li>').join('') + '</ol>' +
        '<div class="cl-note"><h4>' + T('Da sapere', 'Good to know') + '</h4><ul>' +
          '<li>' + T('Strava può restare collegato: Intervals unisce i doppioni, ma per AAC contano solo le attività arrivate direttamente.', 'Strava can stay connected: Intervals merges duplicates, but AAC only uses activities that arrive directly.') + '</li>' +
          '<li>' + T('Le corse vecchie arrivate solo da Strava non si recuperano da lì: se Intervals.icu te lo propone, importa lo storico direttamente dall’orologio.', 'Old runs that came only from Strava cannot be recovered that way: if Intervals.icu offers it, import your history directly from the watch.') + '</li>' +
          '<li>' + T('Dopo il collegamento tocca <b>Sincronizza ora</b> nel profilo, accanto a Intervals.icu: le nuove corse compaiono subito (in automatico arrivano ogni 15 minuti).', 'After connecting, tap <b>Sync now</b> in your profile, next to Intervals.icu: new runs show up right away (automatically they arrive every 15 minutes).') + '</li>' +
          '<li>' + T('API key e Athlete ID restano quelli del tuo profilo AAC: non cambiano.', 'The API key and Athlete ID in your AAC profile stay the same.') + '</li>' +
        '</ul></div>' +
        '<a class="btn-primary cl-go" href="https://intervals.icu/settings" target="_blank" rel="noopener">' + T('Apri le impostazioni di Intervals.icu', 'Open Intervals.icu settings') + '</a>' +
      '</section>');
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-collega]');
    if (b) { collegaDisp = b.dataset.collega; apriCollega(); return; }
    const s = e.target.closest('[data-apri-sheet]');
    if (s) apriSheet(s.dataset.apriSheet);
  });

  /* ---- Schede (Oggi / Piano / Progressi / Salute) ---- */
  let tabAttiva = (() => { try { const t = localStorage.getItem('coach-tab'); if (['oggi', 'salute', 'piano', 'corse', 'progressi', 'info'].includes(t)) return t; } catch (_) {} return 'oggi'; })();
  function aggiornaTabbar() {
    const nomi = { oggi: T('Oggi', 'Today'), corse: T('Corse', 'Runs'), piano: T('Piano', 'Plan'), progressi: T('Progressi', 'Progress'), salute: T('Salute', 'Health'), info: 'Info' };
    document.querySelectorAll('#tabbar button').forEach((b) => {
      b.classList.toggle('on', b.dataset.tab === tabAttiva);
      b.setAttribute('aria-current', b.dataset.tab === tabAttiva ? 'page' : 'false');
      b.querySelector('span').textContent = nomi[b.dataset.tab];
    });
  }
  function vaiTab(t) {
    if (!t) return;
    // se è aperto un dettaglio (corsa, salute, account), toccare una scheda lo chiude
    const sh = document.getElementById('sheet');
    if (sh && !sh.hidden) { history.replaceState(null, '', location.pathname + location.search); rotta(); }
    const cambia = t !== tabAttiva;
    tabAttiva = t;
    try { localStorage.setItem('coach-tab', t); } catch (_) {}
    document.querySelectorAll('.tab-pane').forEach((x) => { x.hidden = x.dataset.pane !== t; });
    aggiornaTabbar();
    if (cambia) window.scrollTo({ top: 0 });
    // i grafici disegnati in una scheda nascosta vanno ridimensionati quando diventa visibile
    if (typeof Chart !== 'undefined') Object.values(Chart.instances || {}).forEach((c) => { try { c.resize(); } catch (_) {} });
  }
  document.getElementById('tabbar').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) vaiTab(b.dataset.tab); });
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-vai-tab]'); if (b) vaiTab(b.dataset.vaiTab); });

  // Obiettivo in una riga, per la scheda Oggi (il dettaglio completo è in Progressi)
  function renderObiettivoBreve(d) {
    const p = d.programma;
    if (!p) return '';
    const o = p.obiettivo, sett = p.settimana_piano;
    const fasi = '<div class="g-fasi">' + p.fasi.map((f) => {
      const n = f.a - f.da + 1;
      const pct = f.stato === 'completata' ? 100 : f.stato === 'in_corso' ? Math.max(6, Math.round((sett - f.da) / n * 100)) : 0;
      return '<div class="g-fase ' + f.stato + '" style="flex:' + n + '"><i><b style="width:' + pct + '%"></b></i></div>';
    }).join('') + '</div>';
    const fase = p.fasi.find((f) => f.stato === 'in_corso');
    return '<button type="button" class="goal-mini" data-vai-tab="progressi">' +
      '<div class="gm-top"><b>' + esc(o.nome) + '</b><span>' + esc(fmtDataBreve(o.data_stimata)) + ' · ' + T('sett. ', 'wk ') + sett + '/' + p.totale_settimane + (fase ? ' · ' + esc(fase.nome) : '') + '</span><i class="chev">›</i></div>' +
      fasi + '</button>';
  }

  // Come stai oggi: FC a riposo, HRV e sonno rispetto alla tua media, e cosa ne fa il coach
  function renderComeStai(d) {
    const s = d.salute;
    if (!s) return '';
    const m = s.metriche, r = s.recupero;
    const segnali = r ? r.segnali : [];
    let cls, titolo, testo;
    if (!r) { cls = ''; titolo = T('Dati di recupero in arrivo', 'Recovery data on its way'); testo = T('Per ora il piano segue le sedute fatte.', 'For now the plan follows completed sessions.'); }
    else if (segnali.length) { cls = 'warn'; titolo = T('Seduta alleggerita', 'Session eased'); testo = esc(segnali.join(' · ')); }
    else if (r.base_fc_riposo == null && r.base_hrv == null) { cls = ''; titolo = T('Sto imparando i tuoi valori', 'Learning your baseline'); testo = T('Servono 5 giorni di dati.', '5 days of data needed.'); }
    else {
      // recupero ok, ma la seduta puo' essere alleggerita per altri motivi (carico, forma): niente "seduta piena"
      const s0 = d.programma && d.programma.prossime && d.programma.prossime[0];
      cls = 'ok'; titolo = T('Recuperato', 'Recovered');
      testo = s0 && s0.adattata ? T('Seduta alleggerita per il carico', 'Session eased for load') : T('Seduta piena', 'Full session');
    }
    const val = (k, ico, nome, v, un) => '<button type="button" class="cs-v cat-' + METRICHE[k].cat + '" data-salute="' + k + '"' + (m[k] ? ' title="' + esc(quando(d.oggi, m[k].data)) + '"' : '') + '><span class="cs-l"><i>' + ico + '</i>' + nome + '</span><b>' + v + (v !== '–' && un ? '<small>' + un + '</small>' : '') + '</b>' + (m[k] && giorniDa(m[k].data, d.oggi) > 1 ? '<span class="cs-q">' + esc(quando(d.oggi, m[k].data)) + '</span>' : '') + '</button>';
    return '<section class="card come-stai ' + cls + '">' +
      '<div class="cs-head"><span class="cs-dot"></span><div><h3>' + titolo + '</h3><p>' + testo + '</p></div></div>' +
      '<div class="cs-vals">' +
        val('fc_riposo', ICO.heart, T('FC riposo', 'Resting HR'), m.fc_riposo ? fmt0(m.fc_riposo.valore) : '–', 'bpm') +
        val('hrv', ICO.wave, 'HRV', m.hrv ? fmt0(m.hrv.valore) : '–', 'ms') +
        val('sonno_sec', ICO.moon, T('Sonno', 'Sleep'), m.sonno_sec ? fmtOre(m.sonno_sec.valore) : '–', '') +
      '</div></section>';
  }

  // Ultima corsa: sagoma del percorso, numeri chiave e confronto col piano; apre la scheda completa
  const cacheAttivita = {};
  function sagomaPercorso(s, w, h) {
    if (!s || !s.lat) return '';
    const pts = [];
    s.lat.forEach((la, i) => { if (la != null) pts.push([s.lng[i], la, s.c[i]]); });
    if (pts.length < 2) return '';
    const k = Math.cos(pts[0][1] * Math.PI / 180);
    const xs = pts.map((p) => p[0] * k), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const pad = 8, sc = Math.min((w - 2 * pad) / ((x1 - x0) || 1e-9), (h - 2 * pad) / ((y1 - y0) || 1e-9));
    const ox = (w - (x1 - x0) * sc) / 2, oy = (h - (y1 - y0) * sc) / 2;
    const P = (i) => (ox + (xs[i] - x0) * sc).toFixed(1) + ',' + (h - oy - (ys[i] - y0) * sc).toFixed(1);
    let corsa = '', cammino = '';
    for (let i = 1; i < pts.length; i++) {
      const seg = 'M' + P(i - 1) + 'L' + P(i);
      if (pts[i][2]) corsa += seg; else cammino += seg;
    }
    return '<svg class="ul-route" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><path d="' + cammino + '" class="walk"/><path d="' + corsa + '" class="run"/>' +
      '<circle cx="' + P(0).split(',')[0] + '" cy="' + P(0).split(',')[1] + '" r="4.5" class="start"/></svg>';
  }
  async function renderUltimaCorsa() {
    const box = $('#ultima-wrap');
    if (!box || !ultimoStorico || !ultimiDati) return;
    const c = ultimoStorico.corse[0];
    if (!c) { box.innerHTML = ''; return; }
    let a = cacheAttivita[c.id];
    const disegna = () => {
      const pr = a && a.prevista;
      const lim = pr && pr.fc_target ? Number(String(pr.fc_target).replace(/[^\d]/g, '')) || null : null;
      let verdetto = '';
      if (pr && pr.corsa_min && c.tempo_corsa) {
        const fatti = Math.round(c.tempo_corsa / 60);
        const ok = fatti >= pr.corsa_min - 1 && (!lim || !c.fc_corsa || c.fc_corsa < lim);
        verdetto = '<p class="ul-verdict ' + (ok ? 'ok' : 'warn') + '">' + (ok ? '✓ ' : '') + fatti + '′ ' + T('di corsa su ', 'running of ') + pr.corsa_min + '′ ' + T('previsti', 'planned') +
          (lim && c.fc_corsa ? ' · FC ' + fmt0(c.fc_corsa) + (c.fc_corsa < lim ? T(' sotto ', ' under ') : T(' sopra ', ' over ')) + lim : '') + '</p>';
      }
      const kpi = (v, l) => '<div><b>' + v + '</b><span>' + l + '</span></div>';
      box.innerHTML = '<div class="sec-title"><h2>' + T('Ultima corsa', 'Latest run') + '</h2><span>' + esc(quando(ultimiDati.oggi, c.data)) + '</span></div>' +
        '<button type="button" class="card ultima" data-seduta="' + esc(c.id) + '">' +
          '<div class="ul-top">' + (a && a.serie && a.serie.lat ? '<div class="ul-map">' + sagomaPercorso(a.serie, 120, 120) + '</div>' : '') +
            '<div class="ul-body"><span class="ul-tag">' + esc(pr ? pr.titolo : (c.nome || T('Corsa', 'Run'))) + '</span>' + (c.meteo ? ' ' + meteoBreve(c.meteo) : '') +
              '<div class="ul-kpi">' + kpi(fmt1(c.distanza) + '<small>km</small>', T('distanza', 'distance')) + kpi(fmtDurata(c.tempo), T('durata', 'time')) +
                kpi(fmtPasso(c.passo_corsa || c.passo_medio) + '<small>/km</small>', c.passo_corsa ? T('passo corsa', 'run pace') : T('passo', 'pace')) + kpi(c.fc_media ? fmt0(c.fc_media) + '<small>bpm</small>' : '–', T('FC media', 'avg HR')) + '</div>' +
            '</div><i class="chev">›</i></div>' + verdetto +
        '</button>';
    };
    disegna();
    if (!a && c.ha_serie) {
      try { a = cacheAttivita[c.id] = await caricaJson('/api/attivita/' + encodeURIComponent(c.id)); disegna(); } catch (_) {}
    }
  }

  /* ---- Cosa sbloccherai: un solo posto per tutti gli stati vuoti ---- */
  function renderSblocchi(d) {
    const items = [];
    const ps = d.passo, p = d.programma, t = d.previsioni && d.previsioni.tempo;
    // il passo si stima solo da corse con almeno 10′ di corsa vera (anche a tratti): con meno la FC non si stabilizza
    if (ps && !ps.disponibile) items.push([T('Il tuo passo al km', 'Your pace per km'),
      T('passo facile, ritmo medio e passo gara, in ogni seduta. Conta solo una corsa con almeno 10′ di corsa (anche a tratti, senza la camminata): con meno la FC non fa in tempo a stabilizzarsi e il passo sarebbe sbagliato.', 'easy, steady and race pace, in every session. Only a run with at least 10′ of actual running counts (intervals too, walking excluded): with less, heart rate has no time to settle and the pace would be wrong.') +
        (ps.corse_totali > ps.corse && ps.max_corsa_min != null ? ' <b>' + T('Finora la tua corsa più lunga ha ' + ps.max_corsa_min + '′ di corsa: arriverà quando i tratti si allungano.', 'So far your longest run has ' + ps.max_corsa_min + '′ of running: it will come as the running parts get longer.') + '</b>' : ''),
      Math.min(ps.corse, ps.richieste), ps.richieste, T('corse da 10′', '10′ runs')]);
    if (t && !t.disponibile) items.push([T('Tempo previsto · ', 'Predicted time · ') + esc(obNome()), T('con una fascia di affidabilità', 'with a confidence range'), Math.min(t.corse_continue, t.richieste), t.richieste, T('corse continue', 'continuous runs')]);
    if (p && !p.obiettivo.stima_da_dati) items.push([T('Data della gara dai tuoi dati', 'Race date from your data'), T('e la probabilità di farcela entro ' + mesiOk() + ' mesi', 'and the chance of making it within ' + mesiOk() + ' months'), Math.min(p.storia.length, 3), 3, T('settimane', 'weeks')]);
    if (ps && ps.corse === 0 && !(ultimoStorico && ultimoStorico.corse.length)) items.push([T('Statistiche e progressi', 'Stats and progress'), T('volume, efficienza, zone cardiache, cadenza', 'volume, efficiency, heart-rate zones, cadence'), 0, 1, T('corsa', 'run')]);
    if (!items.length) return '';
    return '<section class="card unlock"><h3>' + T('Cosa sbloccherai', 'What you will unlock') + '</h3><p class="sub">' + T('Compaiono da sole con più dati.', 'They appear on their own with more data.') + '</p>' +
      '<ul>' + items.map((it) => '<li><div><b>' + it[0] + '</b><small>' + it[1] + '</small></div><div class="u-prog"><i><b style="width:' + Math.round(it[2] / it[3] * 100) + '%"></b></i><span>' + it[2] + '/' + it[3] + ' ' + it[4] + '</span></div></li>').join('') + '</ul></section>';
  }

  /* ---- Programma: prossima seduta, calendario, adattamenti ---- */
  function renderProgramma(d) {
    const p = d.programma;
    if (!p || !p.attivo || !p.prossime.length) return '';
    const icona = { avanti: ['ok', T('↗ Avanti', '↗ Forward')], ripeti: ['warn', T('↻ Ripetuta', '↻ Repeated')], indietro: ['bad', T('↙ Indietro', '↙ Back')] };
    const storia = p.storia.length
      ? p.storia.map((w) => '<div class="week"><div class="wn">S' + w.numero + '</div><div><h4>' + esc(fmtData(w.da)) + ' – ' + esc(fmtData(w.a)) + '</h4><p>' +
          (w.settimana_piano !== w.numero ? T('piano sett. ', 'plan wk ') + w.settimana_piano + ' · ' : '') + esc(w.motivi.join(', ')) + '</p></div><span class="pill ' + icona[w.esito][0] + '">' + icona[w.esito][1] + '</span></div>').join('')
      : '<div class="empty" style="padding:14px">' + T('Il primo adattamento arriva a fine della prima settimana: in base a sedute fatte, FC e recupero il coach decide se avanzare, ripetere o alleggerire.', 'The first adaptation comes at the end of week one: based on completed sessions, HR and recovery the coach decides whether to move forward, repeat or ease off.') + '</div>';

    return renderCalendario(d) +
      '<div class="sec-title"><h2>' + T('Adattamenti', 'Adaptations') + '</h2><span>' + p.sedute_fatte + '/' + p.sedute_passate + (p.aderenza_pct != null ? ' · ' + p.aderenza_pct + '%' : '') + '</span></div>' +
      '<section class="card"><div class="weeks">' + storia + '</div></section>';
  }

  /* ---- Previsioni ---- */
  const AFF = {
    bassa: ['bad', () => T('Affidabilità bassa', 'Low confidence')],
    media: ['warn', () => T('Affidabilità media', 'Medium confidence')],
    alta: ['ok', () => T('Affidabilità alta', 'High confidence')],
    modello: ['', () => T('Stima da modello', 'Model estimate')],
    nessuna: ['', () => T('In attesa di dati', 'Waiting for data')],
  };
  const pillAff = (k) => '<span class="pill ' + AFF[k][0] + '">' + AFF[k][1]() + '</span>';
  const fmtDurataHM = (sec) => { const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h + 'h' + String(m).padStart(2, '0') + '′'; };
  // spiegazioni: sempre disponibili ma chiuse, così in primo piano restano i numeri
  const comeCalcolo = (html) => '<details class="pv-how"><summary>' + T('Come lo calcolo', 'How I calculate it') + '</summary><div>' + html + '</div></details>';
  const semplice = (html) => '<details class="pv-how"><summary>' + T('Cosa significa', 'What it means') + '</summary><div>' + html + '</div></details>';
  const dots = (n, tot) => '<div class="pv-dots">' + Array.from({ length: tot }).map((_, i) => '<i class="' + (i < n ? 'on' : '') + '"></i>').join('') + '<span>' + n + '/' + tot + '</span></div>';

  function statoForma(tsb) {
    if (tsb == null) return ['', '–'];
    if (tsb > 25) return ['warn', T('molto fresco (forse troppo riposo)', 'very fresh (maybe too rested)')];
    if (tsb >= 0) return ['ok', T('fresco e pronto', 'fresh and ready')];
    if (tsb >= -10) return ['ok', T('leggermente affaticato, ok', 'slightly tired, fine')];
    return ['bad', T('affaticato', 'tired')];
  }

  function renderPrevisioni(d) {
    const pv = d.previsioni;
    if (!pv) return '';
    const dg = pv.data_gara, c = pv.carico, t = pv.tempo;
    const oggiCtl = c.serie.length ? c.serie[0].ctl : null;
    const forma = statoForma(c.gara ? c.gara.tsb : null);

    // ---------- riepilogo ----------
    const sum = (ico, label, valore, nota) => '<div class="pv-sum"><span class="pv-ico">' + ico + '</span><div><small>' + label + '</small><b>' + valore + '</b><em>' + nota + '</em></div></div>';
    const riepilogo = '<div class="pv-summary">' +
      sum('🏁', esc(obNome()),
        dg.disponibile ? esc(fmtDataBreve(dg.p50)) : esc(fmtDataBreve(dg.piano)),
        dg.disponibile ? T('data più probabile · ' + dg.prob_6_mesi + '% entro ' + mesiOk() + ' mesi', 'most likely date · ' + dg.prob_6_mesi + '% within ' + mesiOk() + ' months')
          : T('data del piano · probabilità dalla 3ª settimana', 'plan date · probability from week 3')) +
      sum('📈', T('Forma il giorno della gara', 'Form on race day'),
        c.gara ? fmtSigned(c.gara.tsb) + ' <small>TSB</small>' : '–', c.gara ? esc(forma[1]) + ' · ' + T('fitness ', 'fitness ') + fmt1(c.gara.ctl) : '') +
      sum('⏱️', T('Tempo previsto', 'Predicted time'),
        t.disponibile ? fmtDurataHM(t.tempo_sec) : '–',
        t.disponibile ? fmtPasso(t.tempo_sec / 21.0975) + T('/km · fascia ', '/km · range ') + fmtDurataHM(t.tempo_min_sec) + '–' + fmtDurataHM(t.tempo_max_sec)
          : T('servono corse continue: ', 'needs continuous runs: ') + t.corse_continue + '/' + t.richieste) +
    '</div>';

    // ---------- 1. data della gara ----------
    let card1;
    if (dg.disponibile) {
      card1 = '<section class="card pv-card"><div class="pv-head"><div><h3>' + T('Quando potrai correre: ', 'When you can race: ') + esc(obNome()) + '</h3>' +
          '<p class="sub">' + T('Probabilità di essere pronto entro ogni data', 'Probability of being ready by each date') + '</p></div>' + pillAff(dg.affidabilita) + '</div>' +
        '<div class="pv-chips">' +
          '<span class="pv-chip"><b>' + esc(fmtDataBreve(dg.p50)) + '</b>' + T('1 volta su 2 prima di questa data', '1 in 2 chance before this date') + '</span>' +
          '<span class="pv-chip"><b>' + esc(fmtDataBreve(dg.p80)) + '</b>' + T('4 volte su 5', '4 in 5 chance') + '</span>' +
          '<span class="pv-chip"><b>' + esc(fmtDataBreve(dg.p95)) + '</b>' + T('quasi certamente', 'almost certainly') + '</span>' +
        '</div>' +
        '<div class="chart-box"><canvas id="chart-pv-data" role="img" aria-label="' + T('Probabilità per data', 'Probability by date') + '"></canvas></div>' +
        semplice(T(
          'Ho simulato ' + nf0.format(dg.simulazioni) + ' volte le prossime settimane usando il tuo andamento reale (' + dg.settimane_osservate + ' settimane: ' + dg.esiti.avanti + ' avanti, ' + dg.esiti.ripeti + ' ripetute, ' + dg.esiti.indietro + ' indietro). ' +
          'Risultato: la data più probabile è il <b>' + esc(fmtDataBreve(dg.p50)) + '</b>. Hai il <b>' + dg.prob_6_mesi + '%</b> di probabilità di arrivarci entro ' + mesiOk() + ' mesi e il <b>' + dg.prob_12_mesi + '%</b> entro ' + mesiMax() + '. ' +
          'La data del piano (' + esc(fmtDataBreve(dg.piano)) + ') richiede di non ripetere mai una settimana: probabilità ' + dg.prob_piano + '%.',
          'I simulated the coming weeks ' + nf0.format(dg.simulazioni) + ' times using your real progress (' + dg.settimane_osservate + ' weeks: ' + dg.esiti.avanti + ' forward, ' + dg.esiti.ripeti + ' repeated, ' + dg.esiti.indietro + ' back). ' +
          'Result: the most likely date is <b>' + esc(fmtDataBreve(dg.p50)) + '</b>. You have a <b>' + dg.prob_6_mesi + '%</b> chance of getting there within ' + mesiOk() + ' months and <b>' + dg.prob_12_mesi + '%</b> within ' + mesiMax() + '. ' +
          'The plan date (' + esc(fmtDataBreve(dg.piano)) + ') requires never repeating a week: probability ' + dg.prob_piano + '%.')) +
        comeCalcolo(T(
          'Ogni settimana il coach decide: avanti, ripeti o indietro. Dalle tue settimane stimo la probabilità di ciascun esito (ora circa <b>' + dg.probabilita_settimana.avanti + '% avanti, ' + dg.probabilita_settimana.ripeti + '% ripeti, ' + dg.probabilita_settimana.indietro + '% indietro</b>), partendo da un’ipotesi iniziale leggera che pesa come 3 settimane. ' +
          'Poi simulo ' + nf0.format(dg.simulazioni) + ' percorsi casuali fino all’ultima settimana del piano (metodo Monte Carlo), includendo anche l’incertezza su quelle probabilità. La curva mostra la percentuale di percorsi che arrivano alla gara entro ogni data. Più settimane registri, più la previsione diventa stretta e affidabile.',
          'Each week the coach decides: forward, repeat or back. From your weeks I estimate the probability of each outcome (now about <b>' + dg.probabilita_settimana.avanti + '% forward, ' + dg.probabilita_settimana.ripeti + '% repeat, ' + dg.probabilita_settimana.indietro + '% back</b>), starting from a light initial assumption worth 3 weeks. ' +
          'Then I simulate ' + nf0.format(dg.simulazioni) + ' random paths to the last plan week (Monte Carlo method), including the uncertainty on those probabilities. The curve shows the share of paths reaching race day by each date. The more weeks you record, the tighter and more reliable it gets.')) +
      '</section>';
    } else {
      card1 = '<section class="card pv-card"><div class="pv-head"><div><h3>' + T('Quando potrai correre: ', 'When you can race: ') + esc(obNome()) + '</h3>' +
          '<p class="sub">' + T('Probabilità per data', 'Probability by date') + '</p></div>' + pillAff('nessuna') + '</div>' +
        dots(dg.settimane_osservate, dg.richieste) +
        semplice(T(
          'Per stimare una probabilità seria mi servono almeno <b>3 settimane reali</b> di allenamento: devo vedere quanto spesso avanzi o ripeti una settimana. Per ora vale la data del piano, <b>' + esc(fmtDataBreve(dg.piano)) + '</b>, che presuppone di avanzare ogni settimana.',
          'To estimate a meaningful probability I need at least <b>3 real weeks</b> of training: I have to see how often you move forward or repeat a week. For now the plan date applies, <b>' + esc(fmtDataBreve(dg.piano)) + '</b>, which assumes you move forward every week.')) +
        comeCalcolo(T('Dalla 3ª settimana simulerò migliaia di possibili andamenti futuri (metodo Monte Carlo) usando la tua percentuale reale di settimane avanti, ripetute e indietro, e ti mostrerò la probabilità di essere pronto entro ogni data.',
          'From week 3 I will simulate thousands of possible future paths (Monte Carlo method) using your real share of forward, repeated and backward weeks, and show the probability of being ready by each date.')) +
      '</section>';
    }

    // ---------- 2. forma ----------
    const avvisi = c.avvisi.length
      ? '<div class="pv-warn">⚠️ ' + T('Settimane con crescita rapida del fitness (oltre +5 in 7 giorni): ', 'Weeks with fast fitness growth (over +5 in 7 days): ') + c.avvisi.map((a) => esc(fmtData(a.inizio)) + ' (+' + fmt1(a.ramp) + ')').join(', ') + T('. Lì il coach farà più attenzione ai segnali di fatica.', '. There the coach will watch fatigue signals more closely.') + '</div>'
      : '<div class="pv-ok">✓ ' + T('Nessuna settimana con crescita troppo rapida del carico.', 'No week with an overly fast load increase.') + '</div>';
    const card2 = '<section class="card pv-card"><div class="pv-head"><div><h3>' + T('Come crescerà la tua forma', 'How your fitness will grow') + '</h3>' +
        '<p class="sub">' + T('Proiezione seduta per seduta fino alla gara · tratteggiato = previsto', 'Session-by-session projection to race day · dashed = projected') + '</p></div>' + pillAff('modello') + '</div>' +
      '<div class="grid-2 pv-charts"><div><div class="pv-lbl">' + T('Fitness (CTL)', 'Fitness (CTL)') + '</div><div class="chart-box sm"><canvas id="chart-pv-ctl" role="img" aria-label="CTL"></canvas></div></div>' +
        '<div><div class="pv-lbl">' + T('Forma (TSB) ogni mattina', 'Form (TSB) each morning') + '</div><div class="chart-box sm"><canvas id="chart-pv-tsb" role="img" aria-label="TSB"></canvas></div></div></div>' +
      avvisi +
      semplice(T(
        'Il <b>fitness</b> è quanto allenamento hai accumulato nelle ultime ~6 settimane: oggi ' + fmt1(oggiCtl) + ', il giorno della gara circa <b>' + fmt1(c.gara && c.gara.ctl) + '</b>' + (c.picco ? ' (massimo ' + fmt1(c.picco.ctl) + ' il ' + esc(fmtData(c.picco.data)) + ')' : '') + '. ' +
        'La <b>forma</b> è il fitness meno la fatica dell’ultima settimana: la mattina della gara è prevista a <b>' + fmtSigned(c.gara && c.gara.tsb) + '</b>, cioè ' + esc(forma[1]) + '. È l’effetto delle settimane di scarico prima della gara.',
        '<b>Fitness</b> is how much training you have built over the last ~6 weeks: today ' + fmt1(oggiCtl) + ', on race day about <b>' + fmt1(c.gara && c.gara.ctl) + '</b>' + (c.picco ? ' (peak ' + fmt1(c.picco.ctl) + ' on ' + esc(fmtData(c.picco.data)) + ')' : '') + '. ' +
        '<b>Form</b> is fitness minus last week’s fatigue: on race morning it is projected at <b>' + fmtSigned(c.gara && c.gara.tsb) + '</b>, meaning ' + esc(forma[1]) + '. That is the effect of the lighter weeks before the race.')) +
      comeCalcolo(T(
        'Stimo il carico di ogni seduta futura come nel TSS: ore × intensità² × 100, con intensità 0,5 camminata, 0,75 corsa facile, 0,9 tratti veloci, 0,82 gara. ' +
        'Il fitness è una media che “dimentica” in 42 giorni, la fatica in 7 (lo stesso modello di Intervals.icu). Parto dal tuo ultimo valore reale' + (c.partenza.da_dati ? '' : ' (ora 0, perché non ci sono ancora dati di carico)') + '. ' +
        (c.calibrazione.sedute >= 3 ? 'Taratura personale: le tue sedute reali pesano ' + fmt1(c.calibrazione.fattore) + '× la mia stima (su ' + c.calibrazione.sedute + ' sedute), e correggo il futuro di conseguenza.' : 'Dopo 3 sedute registrate confronterò il carico reale con la mia stima e la tarerò su di te.') +
        ' La proiezione presume che tu segua il piano senza ripetere settimane.',
        'I estimate each future session’s load like TSS: hours × intensity² × 100, with intensity 0.5 walking, 0.75 easy running, 0.9 fast bits, 0.82 race. ' +
        'Fitness is an average that “forgets” over 42 days, fatigue over 7 (the same model as Intervals.icu). I start from your latest real value' + (c.partenza.da_dati ? '' : ' (0 for now, as there is no load data yet)') + '. ' +
        (c.calibrazione.sedute >= 3 ? 'Personal calibration: your real sessions weigh ' + fmt1(c.calibrazione.fattore) + '× my estimate (over ' + c.calibrazione.sedute + ' sessions), and I correct the future accordingly.' : 'After 3 recorded sessions I will compare real load with my estimate and calibrate it to you.') +
        ' The projection assumes you follow the plan without repeating weeks.')) +
    '</section>';

    // ---------- 3. tempo ----------
    let card3;
    const nCorse = t.corse_usate || t.corse_continue;
    const affT = !t.disponibile ? 'nessuna' : nCorse < 10 ? 'bassa' : nCorse < 20 ? 'media' : 'alta';
    if (t.disponibile) {
      const migliora = t.tendenza_sett_sec < 0;
      card3 = '<section class="card pv-card"><div class="pv-head"><div><h3>' + T('Tempo previsto · ', 'Predicted time · ') + esc(obNome()) + '</h3>' +
          '<p class="sub">' + T('Passo a ', 'Pace at ') + t.fc_ref + ' bpm · ' + T('più in alto = più veloce', 'higher = faster') + '</p></div>' + pillAff(affT) + '</div>' +
        '<div class="pv-big"><b>' + fmtDurataHM(t.tempo_sec) + '</b><b class="pv-pace">' + fmtPasso(t.tempo_sec / 21.0975) + '<small>/km</small></b><span>' + T('fascia probabile ', 'likely range ') + fmtDurataHM(t.tempo_min_sec) + ' – ' + fmtDurataHM(t.tempo_max_sec) + '</span></div>' +
        '<div class="chart-box"><canvas id="chart-pv-tempo" role="img" aria-label="' + T('Passo a parità di battiti', 'Pace at equal heart rate') + '"></canvas></div>' +
        semplice(T(
          'Guardo quanto vai veloce <b>a parità di battiti</b> (' + t.fc_ref + ' bpm, l’80% della tua FC max stimata). Oggi a quella frequenza corri a circa <b>' + fmtPasso(t.passo_ref_oggi) + '/km</b> e ' +
          (migliora ? 'stai migliorando di ' + fmt0(Math.abs(t.tendenza_sett_sec)) + '″/km a settimana. ' : 'non stai ancora migliorando. ') +
          'Proiettando con prudenza alla gara arrivi a ' + fmtPasso(t.passo_ref_gara) + '/km: tempo stimato <b>' + fmtDurataHM(t.tempo_sec) + '</b>, con 8 probabilità su 10 tra ' + fmtDurataHM(t.tempo_min_sec) + ' e ' + fmtDurataHM(t.tempo_max_sec) + '.',
          'I look at how fast you run <b>at the same heart rate</b> (' + t.fc_ref + ' bpm, 80% of your estimated max HR). Today at that heart rate you run at about <b>' + fmtPasso(t.passo_ref_oggi) + '/km</b> and ' +
          (migliora ? 'you are improving by ' + fmt0(Math.abs(t.tendenza_sett_sec)) + '″/km per week. ' : 'you are not improving yet. ') +
          'Projecting cautiously to race day you reach ' + fmtPasso(t.passo_ref_gara) + '/km: estimated time <b>' + fmtDurataHM(t.tempo_sec) + '</b>, with an 8 in 10 chance between ' + fmtDurataHM(t.tempo_min_sec) + ' and ' + fmtDurataHM(t.tempo_max_sec) + '.')) +
        comeCalcolo(T(
          'Per ogni corsa continua (almeno 15′, sedute corsa-cammino escluse) calcolo l’efficienza: velocità ÷ battiti. Moltiplicata per ' + t.fc_ref + ' bpm dà il passo che terresti a quella frequenza. ' +
          'Sulle ultime 8 settimane traccio una retta di tendenza (' + t.corse_usate + ' corse) e la proietto in avanti per al massimo 8 settimane, con un tetto del +10%: oltre, assumo che il miglioramento si stabilizzi. ' +
          'Tolgo il 4% per la deriva cardiaca di una gara lunga. La fascia viene dalla dispersione delle tue corse attorno alla tendenza. FC max stimata, caldo e salite possono spostare il risultato.',
          'For each continuous run (at least 15′, run-walk sessions excluded) I compute efficiency: speed ÷ heart rate. Multiplied by ' + t.fc_ref + ' bpm it gives the pace you would hold at that heart rate. ' +
          'Over the last 8 weeks I fit a trend line (' + t.corse_usate + ' runs) and project it forward for at most 8 weeks, capped at +10%: beyond that I assume improvement levels off. ' +
          'I subtract 4% for cardiac drift in a long race. The range comes from how your runs scatter around the trend. Estimated max HR, heat and hills can shift the result.')) +
      '</section>';
    } else {
      const riegel = d.programma && d.programma.obiettivo.previsione_tempo;
      card3 = '<section class="card pv-card"><div class="pv-head"><div><h3>' + T('Tempo previsto · ', 'Predicted time · ') + esc(obNome()) + '</h3>' +
          '<p class="sub">' + T('Dalla tendenza del passo a parità di battiti', 'From the trend of pace at equal heart rate') + '</p></div>' + pillAff('nessuna') + '</div>' +
        dots(Math.min(t.corse_continue, t.richieste), t.richieste) +
        semplice(T(
          'Si attiva con <b>' + t.richieste + ' corse continue</b> (almeno 15′, con frequenza cardiaca) distribuite su almeno 2 settimane. Le sedute corsa-cammino non contano: il loro passo medio include la camminata. ' +
          'Con il piano attuale succederà intorno a <b>gennaio</b>, quando inizieranno le corse continue.' + (riegel ? ' Nel frattempo la stima indicativa dalla tua corsa migliore è ' + fmtDurataHM(riegel.tempo_sec) + '.' : ''),
          'It activates with <b>' + t.richieste + ' continuous runs</b> (at least 15′, with heart rate) spread over at least 2 weeks. Run-walk sessions do not count: their average pace includes walking. ' +
          'With the current plan this will happen around <b>January</b>, when continuous runs start.' + (riegel ? ' Meanwhile the rough estimate from your best run is ' + fmtDurataHM(riegel.tempo_sec) + '.' : ''))) +
        comeCalcolo(T('Misurerò quanto vai veloce a parità di battiti (' + t.fc_ref + ' bpm) in ogni corsa continua, ne seguirò la tendenza settimana per settimana e la proietterò con prudenza fino alla gara, mostrando anche una fascia di incertezza.',
          'I will measure how fast you run at the same heart rate (' + t.fc_ref + ' bpm) in each continuous run, follow the trend week by week and project it cautiously to race day, with an uncertainty range.')) +
      '</section>';
    }

    return '<details class="pv-wrap" id="previsioni" data-pref="coach-previsioni"' + (leggiPref('coach-previsioni', false) ? ' open' : '') + '>' +
      '<summary><div class="pv-top"><div><h2>' + T('Previsioni', 'Forecasts') + '</h2><span>' + T('si aggiornano a ogni sincronizzazione', 'updated at every sync') + '</span></div>' +
        '<span class="pv-toggle"><em class="pv-apri">' + T('Mostra dettagli', 'Show details') + '</em><em class="pv-chiudi">' + T('Nascondi', 'Hide') + '</em><i aria-hidden="true"></i></span></div>' +
        riepilogo + '</summary>' +
      '<div class="pv-body">' + card1 + card2 + card3 + '</div></details>';
  }

  // Linee verticali (scadenze, giorno gara) sui grafici a categorie
  const lineeVerticali = {
    id: 'lineeV',
    afterDatasetsDraw(chart, args, opts) {
      const linee = (opts && opts.linee) || [];
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !linee.length) return;
      ctx.save();
      linee.forEach((l) => {
        if (l.i == null || l.i < 0) return;
        const x = scales.x.getPixelForValue(l.i);
        ctx.strokeStyle = l.colore; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = l.colore; ctx.font = '700 10px -apple-system, Segoe UI, sans-serif';
        ctx.textAlign = x > chartArea.right - 60 ? 'right' : 'left';
        ctx.fillText(l.testo, x + (ctx.textAlign === 'right' ? -4 : 4), chartArea.top + 10 + (l.riga || 0) * 12);
      });
      ctx.restore();
    }
  };

  function disegnaPrevisioni(d) {
    const pv = d.previsioni;
    if (!pv) return;
    const accent = cssVar('--accent'), accent2 = cssVar('--accent-2'), muted = cssVar('--muted'), warn = cssVar('--warn'), orange = cssVar('--orange');
    const idx = (arr, data) => { let k = -1; arr.forEach((x, i) => { if (x.data <= data) k = i; }); return k; };

    // 1. probabilità per data
    if ($('#chart-pv-data') && pv.data_gara.disponibile) {
      const cv = pv.data_gara.curva;
      const o = opzioniBase((c) => ' ' + c.parsed.y + T('% di probabilità', '% probability'), (it) => T('Pronto entro il ', 'Ready by ') + fmtDataLunga(cv[it[0].dataIndex].data));
      o.scales.y.min = 0; o.scales.y.max = 100; o.scales.y.ticks.callback = (v) => v + '%';
      o.plugins.lineeV = { linee: [
        { i: idx(cv, pv.data_gara.entro_6_mesi), testo: T(mesiOk() + ' mesi', mesiOk() + ' months'), colore: accent },
        { i: idx(cv, pv.data_gara.entro_12_mesi), testo: T(mesiMax() + ' mesi', mesiMax() + ' months'), colore: muted, riga: 1 },
      ] };
      charts.push(new Chart($('#chart-pv-data'), {
        type: 'line',
        data: { labels: cv.map((x) => fmtData(x.data)), datasets: [{ data: cv.map((x) => x.prob), borderColor: accent2, borderWidth: 2, tension: 0.3,
          fill: { target: 'origin' }, backgroundColor: alpha(accent2, 0.12), pointRadius: 0, pointHoverRadius: 5 }] },
        options: o, plugins: [lineeVerticali]
      }));
    }

    // 2. fitness e forma
    const c = pv.carico;
    if ($('#chart-pv-ctl')) {
      const tutte = c.passato.concat(c.serie);
      const split = c.passato.length;
      const iGara = c.gara ? tutte.findIndex((x) => x.data === c.gara.data) : -1;
      const o = opzioniBase((x) => ' ' + T('Fitness ', 'Fitness ') + fmt1(x.parsed.y) + (x.dataIndex >= split ? T(' (previsto)', ' (projected)') : ''), (it) => fmtDataLunga(tutte[it[0].dataIndex].data));
      o.scales.y.beginAtZero = true;
      o.plugins.lineeV = { linee: [{ i: iGara, testo: T('gara', 'race'), colore: accent }] };
      charts.push(new Chart($('#chart-pv-ctl'), {
        type: 'line',
        data: { labels: tutte.map((x) => fmtData(x.data)), datasets: [{ data: tutte.map((x) => x.ctl), borderColor: accent2, borderWidth: 2, tension: 0.3, pointRadius: 0, pointHoverRadius: 5,
          segment: { borderDash: (s) => (s.p0DataIndex >= split - 1 && split > 0) || split === 0 ? [5, 4] : undefined } }] },
        options: o, plugins: [lineeVerticali]
      }));
    }
    if ($('#chart-pv-tsb')) {
      // un punto a settimana (più la mattina della gara): si legge la tendenza, non l'alternanza seduta/riposo
      const s = c.serie.filter((x, i) => i % 7 === 0 || (c.gara && x.data === c.gara.data));
      const iGara = c.gara ? s.findIndex((x) => x.data === c.gara.data) : -1;
      const o = opzioniBase((x) => ' TSB ' + fmtSigned(x.parsed.y), (it) => fmtDataLunga(s[it[0].dataIndex].data));
      o.plugins.lineeV = { linee: [{ i: iGara, testo: T('gara', 'race'), colore: accent }] };
      charts.push(new Chart($('#chart-pv-tsb'), {
        type: 'line',
        data: { labels: s.map((x) => fmtData(x.data)), datasets: [{ data: s.map((x) => x.tsb), borderColor: accent2, borderWidth: 2, borderDash: [5, 4], tension: 0.3, pointRadius: 0, pointHoverRadius: 5,
          fill: { target: { value: d.soglie.verdeMin }, above: alpha(accent, 0.12), below: alpha(orange, 0.14) } }] },
        options: o, plugins: [lineeVerticali]
      }));
    }

    // 3. tempo: passo a parità di battiti
    const t = pv.tempo;
    if ($('#chart-pv-tempo') && t.disponibile) {
      const date = Array.from(new Set(t.punti.map((x) => x.data).concat([t.trend[0].data, t.trend[1].data, t.proiezione.data]))).sort();
      const at = (arr, k) => date.map((dd) => { const x = arr.find((y) => y.data === dd); return x ? x[k] : null; });
      const proie = date.map((dd) => (dd === t.trend[1].data ? t.trend[1].passo : dd === t.proiezione.data ? t.proiezione.passo : null));
      const o = opzioniBase((x) => ' ' + x.dataset.label + ': ' + fmtPasso(x.parsed.y) + '/km', (it) => fmtDataLunga(date[it[0].dataIndex]));
      o.interaction = { mode: 'nearest', intersect: false };
      o.scales.y.reverse = true; o.scales.y.ticks.callback = (v) => fmtPasso(v);
      o.plugins.legend = { display: true, position: 'bottom', labels: { color: muted, boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 11 } } };
      charts.push(new Chart($('#chart-pv-tempo'), {
        type: 'line',
        data: { labels: date.map((x) => fmtData(x)), datasets: [
          { label: T('Corse', 'Runs'), data: at(t.punti, 'passo_ref'), showLine: false, pointRadius: 4, pointHoverRadius: 6, borderColor: accent2, backgroundColor: accent2 },
          { label: T('Tendenza', 'Trend'), data: at(t.trend, 'passo'), spanGaps: true, borderColor: accent, borderWidth: 2, pointRadius: 0 },
          { label: T('Proiezione', 'Projection'), data: proie, spanGaps: true, borderColor: accent, borderWidth: 2, borderDash: [5, 4], pointRadius: (x) => (x.dataIndex === date.length - 1 ? 5 : 0), pointBackgroundColor: accent },
        ] },
        options: o
      }));
    }
  }

  /* ---- Corsa: stato di forma (solo con corse registrate) ---- */
  function renderCorsa(d) {
    if (d.vuoto || !d.stato || d.sorgente_dati !== 'intervals') return '';
    const s = d.stato;
    const chips = s.motivazioni.map((m) => '<span class="chip">' + esc(m) + '</span>').join('');
    return '<div class="sec-title"><h2>' + T('Carico e forma', 'Load and form') + '</h2><span>' + T('da Intervals.icu', 'from Intervals.icu') + '</span></div>' +
      '<section class="zona ' + esc(s.zona) + '"><div class="zona-top"><span class="zona-dot"></span><h3>' + esc(s.titolo.split(' · ')[0]) + '</h3></div>' +
      '<div class="chips">' + chips + '</div></section>' +
      '<section class="tiles">' +
        '<div class="tile"><div class="l">' + T('Forma · TSB', 'Form · TSB') + '</div><div class="v">' + fmtSigned(s.tsb) + '</div><div class="n">' + T('sopra −10 sei fresco', 'above −10 you are fresh') + '</div></div>' +
        '<div class="tile"><div class="l">Fitness · CTL</div><div class="v">' + fmt1(s.ctl) + '</div><div class="n">' + T('carico degli ultimi 42 gg', 'load over the last 42 days') + '</div></div>' +
        '<div class="tile"><div class="l">' + T('Fatica · ATL', 'Fatigue · ATL') + '</div><div class="v">' + fmt1(s.atl) + '</div><div class="n">' + T('carico degli ultimi 7 gg', 'load over the last 7 days') + '</div></div>' +
        '<div class="tile"><div class="l">Ramp rate</div><div class="v">' + fmtSigned(s.ramp_rate) + '</div><div class="n">' + T('crescita CTL in 7 gg (≤ 5 ok)', 'CTL growth in 7 days (≤ 5 ok)') + '</div></div>' +
      '</section>' +
      '<section class="card"><h3>' + T('Stato di forma (TSB)', 'Form (TSB)') + '</h3><p class="sub">' + T('Ultime 6 settimane · area verde sopra −10 = fresco, arancione = carico', 'Last 6 weeks · green above −10 = fresh, orange = loading') + '</p>' +
      '<div class="chart-box"><canvas id="chart-tsb" role="img" aria-label="TSB"></canvas></div></section>';
  }

  /* ---- Storico: statistiche, tendenze, elenco allenamenti ---- */
  let ultimoStorico = null;
  let filtroMese = 'tutti';
  let filtroScarpa = 'tutte'; // 'tutte' | 'nessuna' | id scarpa
  // Obiettivo dell'utente (dal piano calcolato dal server)
  const OBIETTIVI_UI = [['5k', '5 km', '5K', '16'], ['10k', '10 km', '10K', '22'], ['mezza', 'Mezza maratona', 'Half marathon', '26'], ['maratona', 'Maratona', 'Marathon', '36']];
  const INTENSITA_UI = () => [['tranquilla', 'Tranquilla', 'Easy-going', '−15%'], ['equilibrata', 'Equilibrata', 'Balanced', T('come da piano', 'as planned')], ['ambiziosa', 'Ambiziosa', 'Ambitious', '+15%']];
  const OB = () => (ultimiDati && ultimiDati.programma && ultimiDati.programma.obiettivo) || { nome: T('Mezza maratona', 'Half marathon'), mesi_obiettivo: 6, mesi_limite: 12, codice: 'mezza' };
  const obNome = () => OB().nome;
  const mesiOk = () => OB().mesi_obiettivo || 6;
  const mesiMax = () => OB().mesi_limite || 12;
  let SCARPE = [];

  // Meteo (codici WMO di Open-Meteo)
  const METEO_ICONE = [[0, '☀️', 'Sereno', 'Clear'], [1, '🌤️', 'Poco nuvoloso', 'Mostly clear'], [2, '⛅', 'Parzialmente nuvoloso', 'Partly cloudy'], [3, '☁️', 'Nuvoloso', 'Cloudy'],
    [45, '🌫️', 'Nebbia', 'Fog'], [51, '🌦️', 'Pioviggine', 'Drizzle'], [61, '🌧️', 'Pioggia', 'Rain'], [66, '🌧️', 'Pioggia gelata', 'Freezing rain'], [71, '🌨️', 'Neve', 'Snow'],
    [80, '🌦️', 'Rovesci', 'Showers'], [85, '🌨️', 'Rovesci di neve', 'Snow showers'], [95, '⛈️', 'Temporale', 'Thunderstorm']];
  const meteoInfo = (cod) => { let r = METEO_ICONE[0]; for (const x of METEO_ICONE) if (cod >= x[0]) r = x; return r; };
  const meteoBreve = (m) => { if (!m || m.codice == null) return ''; const i = meteoInfo(m.codice); return '<span class="meteo" title="' + esc(T(i[2], i[3])) + '">' + i[1] + ' ' + m.temp + '°</span>'; };
  const meteoLungo = (m) => {
    if (!m || m.codice == null) return '';
    const i = meteoInfo(m.codice);
    return i[1] + ' ' + T(i[2], i[3]) + ' · ' + m.temp + '°' + (m.percepita != null && Math.abs(m.percepita - m.temp) >= 2 ? T(' (percepiti ', ' (feels ') + m.percepita + '°)' : '') +
      T(' · vento ', ' · wind ') + m.vento + ' km/h · ' + T('umidità ', 'humidity ') + m.umidita + '%';
  };
  const nomeScarpa = (id) => { const x = SCARPE.find((s) => s.id === id); return x ? x.nome : null; };
  const filtraScarpa = (corse) => (filtroScarpa === 'tutte' ? corse : corse.filter((c) => (filtroScarpa === 'nessuna' ? !c.scarpa_id : String(c.scarpa_id) === filtroScarpa)));
  async function caricaScarpe() { try { SCARPE = (await caricaJson('/api/scarpe')).scarpe; } catch (_) { /* demo o errore: elenco vuoto */ } }
  let apertaId = null;

  function frecciaVar(v, megliosu) {
    if (v == null) return '';
    const buono = megliosu ? v > 0 : v < 0;
    return '<b>' + (v > 0 ? '▲ ' : v < 0 ? '▼ ' : '＝ ') + fmt1(Math.abs(v)) + '%</b> ' + (v === 0 ? '' : buono ? T('(meglio)', '(better)') : T('(peggio)', '(worse)'));
  }

  function renderStatistiche(st) {
    const s = st.statistiche;
    const t = (l, v, n) => '<div class="tile"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="n">' + n + '</div></div>';
    const pf = s.passo_facile;
    const pfDelta = pf.valore != null && pf.precedente != null ? pf.valore - pf.precedente : null;
    return '<section class="tiles">' +
      t(T('Totale', 'Total'), fmt1(s.totali.km) + '<small>km</small>', s.totali.corse + T(' corse · ', ' runs · ') + fmt1(s.totali.ore) + T(' ore', ' hours')) +
      t(T('Ultime 4 sett.', 'Last 4 weeks'), fmt1(s.ultime_4_settimane.km) + '<small>km</small>', s.ultime_4_settimane.km_var_pct != null ? frecciaVar(s.ultime_4_settimane.km_var_pct, true) + T(' vs 4 prima', ' vs previous 4') : s.ultime_4_settimane.corse + T(' corse', ' runs')) +
      t(T('Efficienza aerobica', 'Aerobic efficiency'), s.efficienza.valore != null ? fmt0(s.efficienza.valore * 1000) : '–', s.efficienza.var_pct != null ? frecciaVar(s.efficienza.var_pct, true) + T(' in 4 sett.', ' in 4 weeks') : T('velocità per battito: più alta = meglio', 'speed per heartbeat: higher = better')) +
      t(T('Passo corse facili', 'Easy-run pace'), pf.valore != null ? fmtPasso(pf.valore) + '<small>/km</small>' : '–', pfDelta != null ? '<b>' + (pfDelta < 0 ? '▲ ' : '▼ ') + Math.abs(Math.round(pfDelta)) + '″/km</b> ' + (pfDelta < 0 ? T('più veloce', 'faster') : T('più lento', 'slower')) + T(' a parità di sforzo', ' at the same effort') : T('in zona Z1–Z2', 'in zones Z1–Z2')) +
      t(T('Tempo in Z1–Z2', 'Time in Z1–Z2'), s.tempo_facile_pct != null ? s.tempo_facile_pct + '<small>%</small>' : '–', T('ideale ≥ 80% per costruire la base', 'aim for ≥ 80% to build your base')) +
      t(T('Cadenza', 'Cadence'), s.cadenza != null ? fmt0(s.cadenza) + '<small>' + T('ppm', 'spm') + '</small>' : '–', T('passi al minuto · 165–180 riduce gli impatti', 'steps per minute · 165–180 reduces impact')) +
      t(T('Deriva cardiaca lunghi', 'Long-run decoupling'), s.decoupling_lunghi != null ? fmt1(s.decoupling_lunghi) + '<small>%</small>' : '–', T('sotto il 5% = base aerobica solida', 'below 5% = solid aerobic base')) +
      t(T('FC a riposo', 'Resting HR'), s.fc_riposo.valore != null ? fmt0(s.fc_riposo.valore) + '<small>bpm</small>' : '–', s.fc_riposo.valore != null && s.fc_riposo.precedente != null
        ? '<b>' + (s.fc_riposo.valore <= s.fc_riposo.precedente ? '▼ ' : '▲ ') + Math.abs(s.fc_riposo.valore - s.fc_riposo.precedente) + '</b>' + T(' vs mese prima', ' vs previous month') + (s.vo2max ? ' · VO₂max ' + fmt1(s.vo2max.valore) : '')
        : (s.vo2max ? 'VO₂max ' + fmt1(s.vo2max.valore) : T('scende con l’allenamento', 'drops as you get fitter'))) +
    '</section>';
  }

  // FC max in uso: "185 bpm · stimata dall'età" oppure "· misurata"
  function testoFcMax(fm) {
    if (!fm) return '';
    return 'FC max ' + fm.valore + ' bpm · ' + (fm.fonte === 'misurata' ? T('misurata', 'measured')
      : T('stimata dall’età', 'age-based estimate') + (fm.eta ? '' : T(' (età non impostata)', ' (age not set)')));
  }

  // Barra del tempo nelle zone (elenco corse): stessi limiti del dettaglio, calcolati dal server
  function zoneBar(c) {
    const tz = c.tempo_zone;
    if (!tz || !tz.totale) return '';
    const parti = [{ n: '< Z1', sec: tz.sotto.sec, pct: tz.sotto.pct, col: 'var(--zone-0)' }]
      .concat(tz.zone.map((x, i) => ({ n: 'Z' + (i + 1), sec: x.sec, pct: x.pct, col: 'var(--zone-' + (i + 1) + ')' })));
    return '<div class="det-sub">' + T('Tempo nelle zone cardiache', 'Time in heart-rate zones') + '</div><div class="timeline zone">' +
      parti.map((x) => x.sec ? '<div class="seg" style="width:' + x.pct.toFixed(2) + '%;background:' + x.col + '" title="' + x.n + ' · ' + Math.round(x.sec / 60) + '′"></div>' : '').join('') +
      '</div><div class="legend-inline">' + parti.map((x) => x.sec ? '<span><i style="background:' + x.col + '"></i>' + x.n + ' ' + Math.round(x.pct) + '%</span>' : '').join('') + '</div>';
  }

  function parziali(c) {
    if (!c.parziali || !c.parziali.length) return '';
    const max = Math.max.apply(null, c.parziali), min = Math.min.apply(null, c.parziali);
    return '<div class="det-sub">' + T('Parziali per km (camminata compresa)', 'Per-km splits (walking included)') + '</div><div class="splits">' +
      c.parziali.map((x, k) => '<div class="split"><span>km ' + (k + 1) + '</span><i style="width:' + Math.round(40 + 60 * (max === min ? 1 : (max - x) / (max - min))) + '%"></i><b>' + fmtPasso(x) + '</b></div>').join('') + '</div>';
  }

  function dettaglioCorsa(c, st) {
    const z = st.zone.find((x) => x.z === c.zona);
    const m = (l, v, n) => '<div class="met"><span>' + l + '</span><b>' + v + '</b>' + (n ? '<small>' + n + '</small>' : '') + '</div>';
    return '<div class="det">' +
      '<div class="mets">' +
        m(T('Distanza', 'Distance'), fmt1(c.distanza) + ' km') +
        m(T('Tempo', 'Time'), fmtDurata(c.tempo)) +
        m(T('Passo medio', 'Avg pace'), fmtPasso(c.passo_medio) + ' /km', c.passo_corsa ? T('camminata compresa', 'walking included') : '') +
        (c.passo_corsa ? m(T('Passo di corsa', 'Running pace'), fmtPasso(c.passo_corsa) + ' /km', fmtDurata(c.tempo_corsa) + T(' di corsa', ' running')) : '') +
        (c.fc_corsa ? m(T('FC in corsa', 'HR while running'), fmt0(c.fc_corsa) + ' bpm') : '') +
        m(T('FC media', 'Avg HR'), c.fc_media ? fmt0(c.fc_media) + ' bpm' : '–', z ? z.z + ' · ' + z.nome : '') +
        m(T('FC max', 'Max HR'), c.fc_max ? fmt0(c.fc_max) + ' bpm' : '–', c.fc_max ? Math.round(c.fc_max / st.fc_max_stimata * 100) + T('% della FC max', '% of max HR') : '') +
        m(T('Cadenza', 'Cadence'), c.cadenza ? fmt0(c.cadenza) + T(' ppm', ' spm') : '–') +
        m(T('Dislivello', 'Elevation'), c.dislivello != null ? fmt0(c.dislivello) + ' m' : '–') +
        m(T('Efficienza', 'Efficiency'), c.efficiency_factor ? fmt0(c.efficiency_factor * 1000) : '–', T('più alta = meglio', 'higher = better')) +
        m(T('Deriva cardiaca', 'Decoupling'), c.decoupling != null ? fmt1(c.decoupling) + '%' : '–', T('sotto 5% = ottimo', 'below 5% = great')) +
        m(T('Carico', 'Load'), c.carico != null ? fmt0(c.carico) : '–', 'training load') +
        m(T('Calorie', 'Calories'), c.calorie ? fmt0(c.calorie) + ' kcal' : '–') +
        m(T('Forma (TSB)', 'Form (TSB)'), fmtSigned(c.tsb)) +
      '</div>' + zoneBar(c) + parziali(c) +
      '<div class="azioni"><button type="button" class="btn-mini primary" data-copia="' + c.data + '">' + ICO.copy + 'Copia per AI</button></div>' +
    '</div>';
  }

  function renderStorico(st) {
    if (!st) return '';
    const corse = st.corse.map((c) => ({ ...c, _tipo: 'corsa' }));
    const tutte = filtraScarpa(corse).sort((a, b) => (a.data < b.data ? 1 : (a.data > b.data ? -1 : String(b.ora_inizio || '').localeCompare(String(a.ora_inizio || '')))));
    const mesi = Array.from(new Set(corse.map((x) => x.data.slice(0, 7)))).sort().reverse();
    const lista = tutte.filter((x) => filtroMese === 'tutti' || x.data.startsWith(filtroMese));
    const nomeMese = (k) => new Date(k + '-15T12:00:00').toLocaleDateString(LOC, { month: 'long', year: 'numeric' });

    // Elenco in stile app: un gruppo arrotondato per mese, righe separate da una linea sottile
    const giornoSett = (d) => new Date(d + 'T12:00:00').toLocaleDateString(LOC, { weekday: 'short' }).replace('.', '');
    const riga = (x) => {
      const id = 'corsa:' + x.id;
      const aperta = apertaId === id;
      const zn = x.zona ? x.zona.slice(1) : '';
      const info = [x.ora_inizio ? esc(x.ora_inizio) : '', x.tempo ? fmtDurata(x.tempo) : ''].filter(Boolean).join(' · ');
      return '<div class="run' + (aperta ? ' open' : '') + '">' +
        '<button type="button" class="rc" data-corsa="' + esc(id) + '" aria-expanded="' + aperta + '">' +
          '<span class="rc-g"><b>' + Number(x.data.slice(8)) + '</b><small>' + esc(giornoSett(x.data)) + '</small></span>' +
          '<span class="rc-m"><span class="rc-t"><b>' + esc(x.nome || T('Corsa', 'Run')) + '</b>' + (x.meteo ? meteoBreve(x.meteo) : '') + '</span><small>' + (info || '&nbsp;') + '</small></span>' +
          '<span class="rc-n"><b>' + (x.distanza ? fmt1(x.distanza) + '<small>km</small>' : (x.tempo ? fmtDurata(x.tempo) : '–')) + '</b>' +
            '<small>' + fmtPasso(x.passo_corsa || x.passo_medio) + '/km' + (zn ? '<i class="rc-z" style="--zc:var(--zone-' + zn + ')">' + esc(x.zona) + '</i>' : '') + '</small></span>' +
        '</button></div>';
    };
    let righe = '';
    for (const k of Array.from(new Set(lista.map((x) => x.data.slice(0, 7))))) {
      const cm = lista.filter((y) => y.data.startsWith(k));
      righe += '<div class="rl-mese"><b>' + esc(nomeMese(k)) + '</b><span>' + cm.length + T(cm.length === 1 ? ' corsa' : ' corse', cm.length === 1 ? ' run' : ' runs') +
        ' · ' + fmt1(cm.reduce((t, y) => t + (y.distanza || 0), 0)) + ' km</span></div>' +
        '<div class="rl-grp">' + cm.map(riga).join('') + '</div>';
    }

    const stats = st.corse.length ? '<div class="sec-title" id="storico"><h2>' + T('Andamento', 'Trends') + '</h2></div>' + renderStatistiche(st) +
      '<div class="grid-3">' +
        '<section class="card"><h3>' + T('Volume settimanale', 'Weekly volume') + '</h3><p class="sub">' + T('Km di corsa per settimana', 'Running km per week') + '</p><div class="chart-box sm" id="box-chart-vol"><canvas id="chart-vol" role="img" aria-label="km"></canvas></div></section>' +
        '<section class="card"><h3>' + T('Efficienza aerobica', 'Aerobic efficiency') + '</h3><p class="sub">' + T('Velocità per battito · in salita = stai migliorando', 'Speed per heartbeat · rising = you are improving') + '</p><div class="chart-box sm" id="box-chart-ef"><canvas id="chart-ef" role="img" aria-label="EF"></canvas></div></section>' +
        '<section class="card"><h3>' + T('Passo medio', 'Average pace') + '</h3><p class="sub">' + T('Per settimana · più in alto = più veloce', 'Per week · higher = faster') + '</p><div class="chart-box sm" id="box-chart-passo"><canvas id="chart-passo" role="img" aria-label="pace"></canvas></div></section>' +
      '</div>' : '';
    const elenco = '<section class="card elenco" id="elenco">' +
        '<div class="list-head"><h2>' + T('I tuoi allenamenti', 'Your workouts') + '</h2><div class="filtri">' +
          '<select id="f-mese" aria-label="' + T('Mese', 'Month') + '"><option value="tutti">' + T('Tutti i mesi', 'All months') + '</option>' + mesi.map((k) => '<option value="' + k + '"' + (filtroMese === k ? ' selected' : '') + '>' + esc(nomeMese(k)) + '</option>').join('') + '</select>' +
        (SCARPE.length ? '<select id="f-scarpa" aria-label="' + T('Scarpa', 'Shoe') + '"><option value="tutte">' + T('Tutte le scarpe', 'All shoes') + '</option>' +
          SCARPE.map((x) => '<option value="' + x.id + '"' + (filtroScarpa === String(x.id) ? ' selected' : '') + '>👟 ' + esc(x.nome) + '</option>').join('') +
          '<option value="nessuna"' + (filtroScarpa === 'nessuna' ? ' selected' : '') + '>' + T('Senza scarpa', 'No shoe') + '</option></select>' : '') +
        '</div></div>' +
        (righe
          ? '<div class="rl">' + righe + '</div>'
          : '<div class="empty">' + T('Nessun allenamento registrato', 'No workouts recorded') + (filtroMese !== 'tutti' ? T(' in questo mese', ' this month') : T(' ancora', ' yet')) + T('.<br>Le corse del tuo orologio compariranno qui con passo, frequenza, zona, cadenza e dislivello.', '.<br>Runs from your watch will appear here with pace, heart rate, zone, cadence and elevation.') + '</div>') +
      '</section>';
    return { stats, elenco };
  }

  // Riepilogo in cima alla scheda Corse
  function riepilogoCorse(st) {
    if (!st || !st.corse.length) return '';
    const lista = filtraScarpa(st.corse);
    const km = lista.reduce((t, c) => t + (c.distanza || 0), 0), sec = lista.reduce((t, c) => t + (c.tempo || 0), 0);
    const mese = (ultimiDati ? ultimiDati.oggi : new Date().toISOString()).slice(0, 7);
    const cm = lista.filter((c) => c.data.startsWith(mese));
    const kpi = (v, l) => '<div><b>' + v + '</b><span>' + l + '</span></div>';
    const titolo = filtroScarpa === 'tutte' ? '' : '<p class="corse-filtro">' + T('Solo le corse con ', 'Only runs with ') + '<b>' + esc(filtroScarpa === 'nessuna' ? T('nessuna scarpa', 'no shoe') : '👟 ' + (nomeScarpa(+filtroScarpa) || '')) + '</b> · <button type="button" class="link-btn" data-filtro-scarpa="tutte">' + T('mostra tutte', 'show all') + '</button></p>';
    // VO2max: stima dell'orologio, aggiornata dopo corse e camminate all'aperto (non dipende dal filtro scarpe)
    const v = st.statistiche && st.statistiche.vo2max;
    const kpiVo2 = v ? '<div><b>' + fmt1(v.valore) + (v.precedente != null && Math.abs(v.valore - v.precedente) >= 0.1
      ? '<small class="' + (v.valore > v.precedente ? 'su' : 'giu') + '">' + (v.valore > v.precedente ? '▲' : '▼') + fmt1(Math.abs(v.valore - v.precedente)) + '</small>' : '') +
      '</b><span>VO₂max · ' + esc(fmtData(v.data)) + '</span></div>' : '';
    return titolo + '<section class="corse-kpi' + (v ? ' k5' : '') + '">' + kpi(lista.length, T('corse', 'runs')) + kpi(fmt1(km) + '<small>km</small>', T('in totale', 'in total')) +
      kpi(fmtDurata(sec), T('di corsa', 'running')) + kpi(cm.length + '<small> · ' + fmt1(cm.reduce((t, c) => t + (c.distanza || 0), 0)) + ' km</small>', T('questo mese', 'this month')) + kpiVo2 + '</section>';
  }
  // Le tue scarpe: km fatti rispetto al limite consigliato; un tocco filtra le corse
  function cardScarpe() {
    if (ME && ME.demo === undefined && !SCARPE.length && !ultimoStorico) return '';
    const attive = SCARPE.filter((x) => x.attiva);
    if (!attive.length) {
      return '<section class="card scarpe-vuoto"><span class="sc-ic">👟</span><div><b>' + T('Le tue scarpe', 'Your shoes') + '</b><p>' + T('Aggiungi le scarpe che usi: saprai quanti km hanno fatto e quando cambiarle.', 'Add the shoes you run in: you will know how many km they have done and when to replace them.') + '</p></div>' +
        (ME && !ME.demo ? '<button type="button" class="btn-mini" data-apri-account="1">' + T('Aggiungi', 'Add') + '</button>' : '') + '</section>';
    }
    return '<section class="card scarpe"><div class="sc-head"><h3>👟 ' + T('Le tue scarpe', 'Your shoes') + '</h3>' + (ME && !ME.demo ? '<button type="button" class="link-btn" data-apri-account="1">' + T('Gestisci', 'Manage') + ' ›</button>' : '') + '</div>' +
      attive.map((x) => {
        const pct = Math.min(100, Math.round(x.km / x.limite_km * 100));
        return '<button type="button" class="sc-row' + (filtroScarpa === String(x.id) ? ' on' : '') + '" data-filtro-scarpa="' + x.id + '">' +
          '<span class="sc-n"><b>' + esc(x.nome) + '</b><small>' + x.corse + T(' corse', ' runs') + (x.predefinita ? T(' · predefinita', ' · default') : '') + '</small></span>' +
          '<span class="sc-km"><b>' + fmt0(x.km) + '</b><small> / ' + fmt0(x.limite_km) + ' km</small></span>' +
          '<i class="sc-bar"><b class="' + (pct >= 100 ? 'bad' : pct >= 85 ? 'warn' : '') + '" style="width:' + pct + '%"></b></i></button>';
      }).join('') + '</section>';
  }
  document.addEventListener('click', (e) => {
    const f = e.target.closest('[data-filtro-scarpa]');
    if (f) { const v = f.dataset.filtroScarpa; filtroScarpa = v === 'tutte' || filtroScarpa === v ? 'tutte' : v; apertaId = null; aggiornaStorico(); return; }
    if (e.target.closest('[data-apri-account]')) apriSheet('#account');
  });

  function aggiornaStorico() {
    const box = $('#storico-wrap');
    if (!box || !ultimoStorico) return;
    const r = renderStorico(ultimoStorico);
    box.innerHTML = r.stats;
    const cw = $('#corse-wrap');
    if (cw) cw.innerHTML = riepilogoCorse(ultimoStorico) + r.elenco + cardScarpe();
    disegnaGraficiStorico(ultimoStorico);
    renderUltimaCorsa();
  }

  function apriCorsaDelGiorno(data) {
    const c = corsaDelGiorno(data)
      || (ultimiDati && ultimiDati.programma && (ultimiDati.programma.corse_fuori_piano || []).find((x) => x.data === data));
    if (c) apriSheet('#seduta/' + encodeURIComponent(c.id));
  }


  document.addEventListener('click', (e) => {
    const r = e.target.closest('[data-corsa]');
    if (!r) return;
    if (r.dataset.corsa.startsWith('corsa:')) { apriSheet('#seduta/' + encodeURIComponent(r.dataset.corsa.slice(6))); return; }
    apertaId = apertaId === r.dataset.corsa ? null : r.dataset.corsa;
    const y = window.scrollY;
    aggiornaStorico();
    window.scrollTo(0, y);
  });
  document.addEventListener('toggle', (e) => {
    if (e.target.classList && e.target.classList.contains('tipi')) {
      try { localStorage.setItem('coach-tipi-chiusi', e.target.open ? '0' : '1'); } catch (_) {}
    }
  }, true);
  document.addEventListener('change', (e) => {
    if (e.target.id === 'f-mese') { filtroMese = e.target.value; apertaId = null; aggiornaStorico(); }
    if (e.target.id === 'f-scarpa') { filtroScarpa = e.target.value; apertaId = null; aggiornaStorico(); }
  });

  async function caricaStorico() {
    try {
      const res = await fetch(conLang('/api/storico'), { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('storico ' + res.status);
      ultimoStorico = await res.json();
      await caricaScarpe();
      aggiornaStorico();
      if ($('#cal') && ultimiDati) $('#cal').outerHTML = renderCalendario(ultimiDati);
    } catch (e) { console.warn(e); }
  }

  /* ---- Salute e recupero ---- */
  function delta(m, unita, decimali) {
    if (!m || m.delta == null) return T('media 28 gg non ancora disponibile', '28-day average not available yet');
    const f = decimali ? fmt1 : fmt0;
    const freccia = m.delta > 0 ? '▲' : m.delta < 0 ? '▼' : '＝';
    return '<b>' + freccia + ' ' + f(Math.abs(m.delta)) + (unita ? ' ' + unita : '') + '</b>' + T(' vs media', ' vs avg');
  }
  function quandoValore(d, m) {
    if (!m) return '';
    const g = giorniDa(m.data, d.oggi);
    return g === 0 ? T('oggi', 'today') : g === 1 ? T('ieri', 'yesterday') : esc(fmtData(m.data));
  }

  function renderSalute(d) {
    const s = d.salute;
    if (!s) return '';
    const m = s.metriche;
    const tile = (ico, label, valore, unita, metrica, extra, chiave) =>
      '<button type="button" class="tile tile-btn cat-' + METRICHE[chiave].cat + '" data-salute="' + chiave + '"><div class="l">' + ico + label + '<span class="chev">›</span></div>' +
      '<div class="v">' + valore + (valore !== '–' && unita ? '<small>' + unita + '</small>' : '') + '</div>' +
      '<div class="n">' + (metrica ? quandoValore(d, metrica) + ' · ' + extra : T('nessun dato ancora', 'no data yet')) + '</div></button>';

    const tiles = '<section class="tiles tiles-6">' +
      tile(ICO.heart, T('FC a riposo', 'Resting HR'), m.fc_riposo ? fmt0(m.fc_riposo.valore) : '–', 'bpm', m.fc_riposo, delta(m.fc_riposo, 'bpm'), 'fc_riposo') +
      tile(ICO.wave, 'HRV', m.hrv ? fmt0(m.hrv.valore) : '–', 'ms', m.hrv, delta(m.hrv, 'ms'), 'hrv') +
      tile(ICO.moon, T('Sonno', 'Sleep'), m.sonno_sec ? fmtOre(m.sonno_sec.valore) : '–', '', m.sonno_sec,
        m.sonno_sec && m.sonno_sec.delta != null ? '<b>' + (m.sonno_sec.delta >= 0 ? '▲ ' : '▼ ') + Math.round(Math.abs(m.sonno_sec.delta) / 60) + ' min</b>' + T(' vs media', ' vs avg') : T('media in arrivo', 'average coming soon'), 'sonno_sec') +
      tile(ICO.steps, T('Passi', 'Steps'), m.passi ? fmt0(m.passi.valore) : '–', '', m.passi, delta(m.passi, ''), 'passi') +
      tile(ICO.flame, T('Calorie', 'Calories'), m.calorie ? fmt0(m.calorie.valore) : '–', 'kcal', m.calorie, T('attive', 'active'), 'calorie') +
      tile(ICO.o2, T('Ossigeno', 'Blood oxygen'), m.spo2 ? fmt1(m.spo2.valore) : '–', '%', m.spo2, 'SpO2', 'spo2');

    // Valori in più: compaiono da soli, nella stessa griglia, quando Intervals.icu li riceve (bilancia, misuratore, app di salute...)
    const icoCat = { cuore: ICO.heart, sonno: ICO.moon, respiro: ICO.o2, attivita: ICO.flame, corpo: ICO.body };
    const altri = ['peso', 'grasso', 'vo2max', 'fc_sonno', 'respirazione', 'sonno_score', 'piani', 'pressione_max', 'glicemia'].filter((k) => m[k]).map((k) => {
      const M = METRICHE[k];
      let v = M.fmt(m[k].valore), nome = M.nome(), extra = delta(m[k], M.u, M.fmt === fmt1 || k === 'peso' || k === 'grasso' || k === 'glicemia' || k === 'respirazione' || k === 'vo2max');
      if (k === 'pressione_max' && m.pressione_min) { v = fmt0(m.pressione_max.valore) + '/' + fmt0(m.pressione_min.valore); nome = T('Pressione', 'Blood pressure'); }
      return tile(icoCat[M.cat] || '', nome, v, M.u, m[k], extra, k);
    });
    const tilesTutti = tiles + altri.join('') + '</section>';

    // BMI: peso (bilancia/Intervals o profilo) e altezza dal profilo
    const cb = s.corpo || {};
    const bmiCard = (() => {
      if (cb.bmi == null) {
        return '<section class="card bmi-card"><h3>BMI</h3><p class="sub">' +
          (cb.altezza_cm ? T('Manca il peso: aggiungilo nel profilo o collega una bilancia a Intervals.icu.', 'Weight missing: add it in your profile or connect a scale to Intervals.icu.')
            : T('Aggiungi altezza e peso nel profilo per vedere il tuo BMI.', 'Add your height and weight in your profile to see your BMI.')) +
          ' <a href="#account">' + T('Apri il profilo', 'Open profile') + '</a></p></section>';
      }
      const min = 15, max = 40, pos = Math.min(100, Math.max(0, (cb.bmi - min) / (max - min) * 100));
      const w = (a, b) => ((Math.min(b, max) - Math.max(a, min)) / (max - min) * 100).toFixed(2);
      const fontePeso = (cb.fonte_peso === 'misurato' ? T('bilancia', 'scale') : T('profilo', 'profile')) + (cb.data_peso ? ' · ' + fmtData(cb.data_peso) : '');
      return '<section class="card bmi-card"><h3>BMI</h3>' +
        '<div class="bmi-top"><div class="bmi-v">' + fmt1(cb.bmi) + '</div><span class="bmi-cat ' + cb.categoria.id + '">' + esc(cb.categoria.nome) + '</span></div>' +
        '<div class="bmi-scala" aria-hidden="true"><i class="sotto" style="width:' + w(min, 18.5) + '%"></i><i class="normo" style="width:' + w(18.5, 25) + '%"></i><i class="sovra" style="width:' + w(25, 30) + '%"></i><i class="obeso" style="width:' + w(30, max) + '%"></i><b style="left:' + pos.toFixed(1) + '%"></b></div>' +
        '<p class="sub">' + fmt1(cb.peso_kg) + ' kg (' + fontePeso + ') · ' + cb.altezza_cm + ' cm' +
          (cb.peso_normo ? ' · ' + T('normopeso per la tua altezza: ', 'healthy range for your height: ') + fmt1(cb.peso_normo[0]) + '–' + fmt1(cb.peso_normo[1]) + ' kg' : '') + '</p></section>';
    })();

    // niente grafici qui: ogni valore ha il suo grafico nel dettaglio (tocca una scheda)
    const nota = s.disponibile ? '' :
      '<section class="card empty">' + T('Ancora nessun dato di salute: controlla che <b>FC a riposo, HRV e sonno</b> arrivino su Intervals.icu (Apple Watch: consenti l’accesso all’app Companion in Salute; Garmin e altri: attiva il wellness nel collegamento con Intervals.icu).', 'No health data yet: check that <b>resting HR, HRV and sleep</b> reach Intervals.icu (Apple Watch: allow the Companion app in Apple Health; Garmin and others: enable wellness in the Intervals.icu connection).') + '</section>';

    // Giorni con recupero incompleto (30 giorni): stesse regole che alleggeriscono la seduta
    const rc = s.recupero_30g;
    const recCard = !rc || !s.disponibile ? '' : (() => {
      const g = rc.giorni || [], primi = g.slice(0, 4), altri = g.slice(4);
      const riga = (x) => '<div class="dd-li"><b>' + esc(fmtDataLunga(x.data)) + '</b><span>' + x.segnali.map(esc).join(' · ') + '</span></div>';
      return '<section class="card rec-card"><div class="rec-top"><h3>' + T('Giorni con recupero incompleto', 'Days with incomplete recovery') + '</h3><b class="rec-n' + (g.length ? ' warn' : '') + '">' + g.length + '<small>/30</small></b></div>' +
        '<p class="sub">' + T('Ultimi 30 giorni. In questi giorni il coach ha alleggerito la seduta.', 'Last 30 days. On these days the coach eased your session.') + '</p>' +
        (g.length ? '<div class="dd-list">' + primi.map(riga).join('') + '</div>' +
            (altri.length ? '<details class="more"><summary>' + T('Altri ' + altri.length + ' giorni', altri.length + ' more days') + '</summary><div class="dd-list">' + altri.map(riga).join('') + '</div></details>' : '')
          : '<p class="dd-p">' + (rc.base_pronta ? T('Nessuno: il recupero è sempre stato nella norma. 💪', 'None: recovery has always been normal. 💪') : T('Il coach confronta ogni giorno con la tua media delle 4 settimane precedenti: servono almeno 5 giorni di dati per iniziare.', 'The coach compares each day with your average of the previous 4 weeks: at least 5 days of data are needed to start.')) + '</p>') +
        '<details class="more"><summary>' + T('Quando il recupero è incompleto', 'When recovery is incomplete') + '</summary><p class="dd-p">' + T('Basta un segnale rispetto alla tua media dei 28 giorni prima: FC a riposo ≥ +5 bpm, HRV ≤ −15%, sonno sotto 5h30′.', 'One signal against your average of the previous 28 days is enough: resting HR ≥ +5 bpm, HRV ≤ −15%, sleep under 5h30′.') + '</p></details>' +
      '</section>';
    })();

    return '<div class="sec-title"><h2>' + T('Ultimi valori', 'Latest values') + '</h2><button type="button" class="link-btn" data-salute="fc_riposo">' + T('Tutti i dati', 'All data') + ' ›</button></div>' + tilesTutti + bmiCard + nota + recCard;
  }

  /* ---------------------------------------------------------------------- */
  /* Grafici (una scala per grafico, una serie per grafico)                 */
  /* ---------------------------------------------------------------------- */
  function opzioniBase(tooltipLabel, tooltipTitle) {
    const muted = cssVar('--muted'), grid = cssVar('--chart-grid');
    return {
      responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cssVar('--surface'), titleColor: cssVar('--text'), bodyColor: cssVar('--text-2'),
          borderColor: cssVar('--line-strong'), borderWidth: 1, padding: 10, displayColors: false,
          callbacks: { title: tooltipTitle, label: tooltipLabel }
        }
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: muted, maxTicksLimit: 6, maxRotation: 0, font: { size: 10 } } },
        y: { grid: { color: grid }, border: { display: false }, ticks: { color: muted, maxTicksLimit: 4, font: { size: 10 } } }
      }
    };
  }

  function disegnaGrafici(d) {
    charts.splice(0).forEach((c) => c.destroy());
    if (typeof Chart === 'undefined') {
      document.querySelectorAll('.chart-box').forEach((b) => { b.innerHTML = '<div class="chart-empty">' + T('Grafici non disponibili: Chart.js non raggiungibile', 'Charts unavailable: Chart.js could not be loaded') + '</div>'; });
      return;
    }
    Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';
    const accent = cssVar('--accent'), accent2 = cssVar('--accent-2');

    if ($('#chart-tsb')) {
      const serie = d.tsb_serie;
      const ot = opzioniBase((c) => ' TSB ' + fmtSigned(c.parsed.y), (it) => fmtDataLunga(serie[it[0].dataIndex].data));
      charts.push(new Chart($('#chart-tsb'), {
        type: 'line',
        data: { labels: serie.map((p) => fmtData(p.data)), datasets: [{ data: serie.map((p) => p.tsb), borderColor: accent2, borderWidth: 2,
          tension: 0.35, pointRadius: 0, pointHoverRadius: 5, fill: { target: { value: d.soglie.verdeMin }, above: alpha(accent, 0.14), below: alpha(cssVar('--orange'), 0.14) } }] },
        options: ot
      }));
    }
    disegnaPrevisioni(d);
    if (ultimoStorico) disegnaGraficiStorico(ultimoStorico);
  }

  const chartsStorico = [];
  function graficoSettimanale(id, sett, valori, tipo, fmt, opz) {
    const el = document.getElementById(id);
    if (!el) return;
    if (valori.filter((v) => v != null && v !== 0).length < (tipo === 'bar' ? 1 : 2)) {
      document.getElementById('box-' + id).innerHTML = '<div class="chart-empty">' + (tipo === 'bar' ? T('Nessuna corsa registrata', 'No runs recorded') : T('Servono almeno 2 settimane con corse', 'At least 2 weeks with runs needed')) + '</div>';
      return;
    }
    const o = opzioniBase((c) => ' ' + fmt(c.parsed.y), (it) => { const w = sett[it[0].dataIndex]; return T('Settimana dal ', 'Week of ') + fmtData(w.inizio) + (w.in_corso ? T(' (in corso)', ' (in progress)') : ''); });
    if (tipo === 'bar') o.scales.y.beginAtZero = true;
    if (opz && opz.reverse) { o.scales.y.reverse = true; o.scales.y.ticks.callback = (v) => fmtPasso(v); }
    if (opz && opz.tick) o.scales.y.ticks.callback = opz.tick;
    const col = cssVar('--accent-2');
    chartsStorico.push(new Chart(el, {
      type: tipo,
      data: { labels: sett.map((w) => w.etichetta), datasets: [{ data: valori, borderColor: col, backgroundColor: tipo === 'bar' ? sett.map((w) => (w.in_corso ? alpha(col, 0.45) : col)) : col,
        borderWidth: 2, borderRadius: 4, maxBarThickness: 22, tension: 0.35, spanGaps: true, pointRadius: 3, pointHoverRadius: 6 }] },
      options: o
    }));
  }

  function disegnaGraficiStorico(st) {
    chartsStorico.splice(0).forEach((c) => c.destroy());
    if (typeof Chart === 'undefined') return;
    const sett = st.settimane.slice(-26);
    graficoSettimanale('chart-vol', sett, sett.map((w) => w.km), 'bar', (v) => fmt1(v) + ' km');
    graficoSettimanale('chart-ef', sett, sett.map((w) => (w.ef_medio != null ? Math.round(w.ef_medio * 1000) : null)), 'line', (v) => T('Efficienza ', 'Efficiency ') + fmt0(v));
    graficoSettimanale('chart-passo', sett, sett.map((w) => w.passo_medio), 'line', (v) => fmtPasso(v) + ' /km', { reverse: true });
  }

  /* ---------------------------------------------------------------------- */
  /* Caricamento dati                                                       */
  /* ---------------------------------------------------------------------- */
  /* ====================================================================== */
  /* Approfondimenti: pannello a schermo intero (seduta e salute)           */
  /* ====================================================================== */
  const sheetCharts = [];
  let storiaSalute = null;
  let saluteMetrica = 'fc_riposo';
  let saluteGiorni = 30;

  function apriSheet(hash) {
    if (location.hash !== hash) history.pushState({ sheet: 1 }, '', hash);
    rotta();
  }
  function chiudiSheet() {
    if (history.state && history.state.sheet) history.back();
    else { history.replaceState(null, '', location.pathname + location.search); rotta(); }
  }
  function mostraSheet(titolo, html) {
    const sh = $('#sheet');
    sheetCharts.splice(0).forEach((c) => c.destroy());
    $('#sheet-title').textContent = titolo;
    $('#sheet-body').innerHTML = html;
    if (sh.hidden) { sh.hidden = false; sh.scrollTop = 0; document.body.classList.add('sheet-open'); }
  }
  let chiudiRivivi = null; // replay aperto: "Indietro" lo chiude invece di uscire dal dettaglio corsa
  function rotta() {
    if (chiudiRivivi) { const f = chiudiRivivi; chiudiRivivi = null; f(); return; }
    document.body.classList.toggle('chat-open', location.hash === '#coach');
    const sh = $('#sheet');
    if (location.hash === '#account') { apriAccount(); return; }
    if (location.hash === '#admin') { apriAdmin(); return; }
    if (location.hash === '#collega') { apriCollega(); return; }
    if (location.hash === '#guida-strava') { apriGuidaStrava(); return; }
    if (location.hash === '#diario') { apriDiario(); return; }
    if (location.hash === '#coach') { apriChat(); return; }
    const mu = location.hash.match(/^#uso\/(\d+)$/);
    if (mu) { apriUso(mu[1]); return; }
    const mc = location.hash.match(/^#condividi\/(.+)$/);
    if (mc) { apriCondividi(decodeURIComponent(mc[1])); return; }
    const m = location.hash.match(/^#(seduta|salute)\/(.+)$/);
    if (!m) {
      if (!sh.hidden) { sheetCharts.splice(0).forEach((c) => c.destroy()); sh.hidden = true; document.body.classList.remove('sheet-open'); }
      return;
    }
    if (m[1] === 'seduta') apriSeduta(decodeURIComponent(m[2]));
    else { saluteMetrica = decodeURIComponent(m[2]); apriSalute(); }
  }
  window.addEventListener('hashchange', rotta);
  window.addEventListener('popstate', rotta);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) chiudiSheet(); });

  // Grafici con il mirino sincronizzato: passando sopra uno, gli altri mostrano lo stesso istante
  function syncHover(gruppo, suIndice) {
    return {
      id: 'syncHover',
      afterEvent(chart, args) {
        const ev = args.event;
        if (ev.type === 'mouseout') { if (suIndice) suIndice(null); gruppo.forEach((c) => { if (c !== chart) { c.setActiveElements([]); c.tooltip.setActiveElements([], { x: 0, y: 0 }); c.update('none'); } }); return; }
        if (ev.type !== 'mousemove') return;
        const el = chart.getElementsAtEventForMode(ev, 'index', { intersect: false }, false)[0];
        if (!el) return;
        if (suIndice) suIndice(el.index);
        gruppo.forEach((c) => {
          if (c === chart) return;
          const act = c.data.datasets.map((d, i) => ({ datasetIndex: i, index: el.index })).filter((a) => c.data.datasets[a.datasetIndex].data[a.index] != null);
          c.setActiveElements(act);
          const meta = act[0] && c.getDatasetMeta(act[0].datasetIndex).data[el.index];
          c.tooltip.setActiveElements(act, meta ? { x: meta.x, y: meta.y } : { x: 0, y: 0 });
          c.update('none');
        });
      },
    };
  }
  // Fasce colorate di sfondo (zone cardiache) e linee orizzontali di riferimento
  const fascePlugin = {
    id: 'fasce',
    beforeDatasetsDraw(chart, _a, opt) {
      const { ctx, chartArea: ca, scales: { y } } = chart;
      if (!opt || !y) return;
      ctx.save();
      (opt.fasce || []).forEach((f) => {
        const y1 = y.getPixelForValue(Math.min(f.a, y.max)), y0 = y.getPixelForValue(Math.max(f.da, y.min));
        if (y0 <= ca.top || y1 >= ca.bottom) return;
        ctx.fillStyle = f.colore;
        ctx.fillRect(ca.left, Math.max(ca.top, y1), ca.right - ca.left, Math.min(ca.bottom, y0) - Math.max(ca.top, y1));
      });
      (opt.linee || []).forEach((l) => {
        if (l.v == null || l.v < y.min || l.v > y.max) return;
        const py = y.getPixelForValue(l.v);
        ctx.strokeStyle = l.colore; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(ca.left, py); ctx.lineTo(ca.right, py); ctx.stroke();
        if (l.testo) { ctx.setLineDash([]); ctx.fillStyle = l.colore; ctx.font = '600 10px -apple-system, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(l.testo, ca.right - 4, py - 4); }
      });
      ctx.restore();
    },
  };

  const caricaJson = async (url) => {
    const r = await fetch(conLang(url), { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).errore || 'HTTP ' + r.status);
    return r.json();
  };
  const mmss = (sec) => Math.floor(sec / 60) + ':' + String(Math.round(sec % 60)).padStart(2, '0');
  const stat = (l, v, n) => '<div class="dd-stat"><span>' + l + '</span><b>' + v + '</b>' + (n ? '<small>' + n + '</small>' : '') + '</div>';

  /* ---------------------------- Account --------------------------------- */
  let ME = null;
  const iniziali = (u) => ((u.nome || u.email || '?').trim().split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('') || '?').toUpperCase();
  const avatar = (u, cls) => (u.foto ? '<img class="' + cls + '" src="' + esc(u.foto) + '" alt="" referrerpolicy="no-referrer">' : '<span class="' + cls + ' av-ini">' + esc(iniziali(u)) + '</span>');
  // Ambiente di staging: badge BETA accanto al logo e "BETA ·" nel titolo della scheda
  function segnaAmbiente(amb) {
    if (amb !== 'staging') return;
    document.documentElement.classList.add('env-staging');
    if (!document.title.startsWith('BETA')) document.title = 'BETA · ' + document.title;
    const h = document.querySelector('.brand h1');
    if (h && !h.querySelector('.env-badge')) h.insertAdjacentHTML('beforeend', '<b class="env-badge" title="' + T('Ambiente di prova (staging)', 'Test environment (staging)') + '">BETA</b>');
  }

  // Utilizzo dell'app (statistiche per l'amministratore): un segnale al minuto con la pagina visibile.
  // Il server conta i minuti e le aperture (pausa > 30 minuti = nuova apertura).
  function battito() {
    if (!ME || ME.demo || ME.impersonato_da || document.visibilityState !== 'visible') return;
    fetch('/api/uso/battito', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'X-Requested-With': 'coach' } }).catch(() => {});
  }
  setInterval(battito, 60e3);
  document.addEventListener('visibilitychange', battito);

  async function caricaMe() {
    try { ME = await caricaJson('/api/me'); } catch (_) { return; }
    segnaAmbiente(ME.ambiente);
    battito();
    if (!ME.demo) { registraSW(); rinnovaIscrizione(); } // app installabile e notifiche push
    if (ME.profilo && ME.profilo.colore && ME.profilo.colore !== document.documentElement.getAttribute('data-accent')) applicaColore(ME.profilo.colore);
    // i dati arrivano prima del profilo: si ridisegna per mostrare cio' che dipende da ME (es. la card "Il tuo piano" sotto Adattamenti)
    if (ultimiDati) render(ultimiDati);
    aggiornaAvatar();
    caricaValutazione();
    // nuovo utente: prima di tutto il collegamento con Intervals.icu e la data di inizio
    const pr = ME.profilo || {};
    if (!ME.completo && !pr.ha_fonte && !location.hash) apriSheet('#account');
    else if (!chiediInizio()) chiediCorpo();
  }

  // Popup obbligatorio: Intervals collegato ma nessuna data di inizio = niente piano. Si sceglie la prima seduta
  // (proposta: oggi o il primo dei giorni scelti). Non si rimanda: senza data il calendario resta vuoto.
  function chiediInizio() {
    const pr = ME && ME.profilo;
    if (!pr || ME.demo || ME.impersonato_da || !pr.ha_fonte || pr.programma_inizio) return false;
    if ($('#inizio-dlg')) return true;
    const oggiS = (ultimiDati && ultimiDati.oggi) || new Date().toLocaleDateString('sv-SE');
    const proposta = primoGiornoUtile({ oggi: oggiS, giorni: new Set(pr.giorni_sedute || []) });
    document.body.insertAdjacentHTML('beforeend',
      '<dialog id="inizio-dlg" class="corpo-dlg" aria-labelledby="inizio-t"><form method="dialog" class="acc-form" id="inizio-form" novalidate>' +
        '<h3 id="inizio-t">' + T('Quando inizi?', 'When do you start?') + '</h3>' +
        '<p class="sub">' + T('Scegli il giorno della prima seduta: da lì il coach costruisce il tuo calendario. Ti propongo il primo giorno utile.', 'Pick the day of your first session: the coach builds your calendar from there. I suggest the first suitable day.') + '</p>' +
        '<label class="acc-f"><span>' + T('Prima seduta', 'First session') + '</span><input name="programma_inizio" type="date" min="' + esc(oggiS) + '" value="' + esc(proposta) + '" required></label>' +
        '<p id="inizio-err" class="acc-err" hidden></p>' +
        '<div class="corpo-az"><span></span><button type="submit" class="btn-primary">' + T('Inizia il piano', 'Start the plan') + '</button></div>' +
      '</form></dialog>');
    const dlg = $('#inizio-dlg');
    let salvato = false;
    dlg.addEventListener('cancel', (e) => e.preventDefault()); // la data serve: Esc non chiude
    dlg.addEventListener('close', () => { if (!salvato && dlg.isConnected) dlg.showModal(); }); // alcuni browser chiudono lo stesso: si riapre
    $('#inizio-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = String(new FormData(e.target).get('programma_inizio') || '').trim(), err = $('#inizio-err');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { err.textContent = T('Scegli una data.', 'Pick a date.'); err.hidden = false; return; }
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        const { ok, out } = await inviaJson('PUT', '/api/profilo', { programma_inizio: v });
        if (!ok) { err.textContent = T('Data non valida.', 'Invalid date.'); err.hidden = false; return; }
        ME = out;
        salvato = true; dlg.close(); dlg.remove();
        toast(T('Piano pronto: ecco il calendario', 'Plan ready: here is your calendar'), 'ok');
        await caricaDati(true);
        vaiTab('piano');
      } catch (_) { /* errore gia' segnalato */ } finally { btn.disabled = false; }
    });
    dlg.showModal();
    return true;
  }

  // Popup: altezza e peso mancanti, servono per il BMI. Chiede solo cio' che manca
  // (il peso solo se non arriva gia' da una bilancia); "Piu' tardi" lo rimanda di 7 giorni.
  const CORPO_DOPO = 'coach-corpo-dopo';
  function chiediCorpo() {
    if (!ME || ME.demo || ME.impersonato_da || !ME.completo || location.hash || $('#corpo-dlg')) return;
    const cb = ultimiDati && ultimiDati.salute && ultimiDati.salute.corpo;
    if (!cb || cb.bmi != null) return;
    try { if (Date.now() < Number(localStorage.getItem(CORPO_DOPO) || 0)) return; } catch (_) { /* senza storage si chiede a ogni apertura */ }
    const serveAltezza = !cb.altezza_cm, servePeso = cb.peso_kg == null;
    if (!serveAltezza && !servePeso) return;
    document.body.insertAdjacentHTML('beforeend',
      '<dialog id="corpo-dlg" class="corpo-dlg" aria-labelledby="corpo-t"><form method="dialog" class="acc-form" id="corpo-form" novalidate>' +
        '<h3 id="corpo-t">' + (serveAltezza && servePeso ? T('Altezza e peso', 'Height and weight') : serveAltezza ? T('La tua altezza', 'Your height') : T('Il tuo peso', 'Your weight')) + '</h3>' +
        '<p class="sub">' + (serveAltezza && servePeso
          ? T('Servono per calcolare il tuo BMI in Salute. Puoi cambiarli quando vuoi nel profilo.', 'Needed to work out your BMI in Health. You can change them any time in your profile.')
          : T('Serve per calcolare il tuo BMI in Salute. Puoi cambiarla quando vuoi nel profilo.'.replace('cambiarla', serveAltezza ? 'cambiarla' : 'cambiarlo'), 'Needed to work out your BMI in Health. You can change it any time in your profile.')) + '</p>' +
        '<div class="acc-row' + (serveAltezza && servePeso ? ' acc-row2 corpo-2' : '') + '">' +
          (serveAltezza ? '<label class="acc-f"><span>' + T('Altezza (cm)', 'Height (cm)') + '</span><input name="altezza" type="number" inputmode="numeric" min="100" max="230" required autocomplete="off"></label>' : '') +
          (servePeso ? '<label class="acc-f"><span>' + T('Peso (kg)', 'Weight (kg)') + '</span><input name="peso" type="text" inputmode="decimal" pattern="[0-9]{2,3}([.,][0-9])?" maxlength="5" required autocomplete="off" placeholder="70,5"></label>' : '') +
        '</div>' +
        '<p id="corpo-err" class="acc-err" hidden></p>' +
        '<div class="corpo-az"><button type="button" class="link-btn" id="corpo-dopo">' + T('Più tardi', 'Later') + '</button><button type="submit" class="btn-primary">' + T('Salva', 'Save') + '</button></div>' +
      '</form></dialog>');
    const dlg = $('#corpo-dlg');
    const chiudi = (rimanda) => {
      if (rimanda) { try { localStorage.setItem(CORPO_DOPO, String(Date.now() + 7 * 864e5)); } catch (_) { /* ignora */ } }
      dlg.close(); dlg.remove();
    };
    $('#corpo-dopo').addEventListener('click', () => chiudi(true));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); chiudi(true); }); // tasto Esc
    $('#corpo-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target), corpo = {}, err = $('#corpo-err');
      for (const [k, v] of f.entries()) corpo[k] = String(v).trim().replace(',', '.');
      const fuori = (k, a, b) => corpo[k] !== undefined && !(Number(corpo[k]) >= a && Number(corpo[k]) <= b);
      if (fuori('altezza', 100, 230) || fuori('peso', 30, 250)) {
        err.textContent = T('Altezza tra 100 e 230 cm, peso tra 30 e 250 kg.', 'Height between 100 and 230 cm, weight between 30 and 250 kg.'); err.hidden = false; return;
      }
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        const { ok, out } = await inviaJson('PUT', '/api/profilo', corpo);
        if (!ok) { err.textContent = T('Salvataggio non riuscito: controlla i valori.', 'Could not save: check the values.'); err.hidden = false; return; }
        ME = out;
        chiudi(false);
        toast(T('Salvato: il BMI è in Salute', 'Saved: your BMI is in Health'), 'ok');
        await caricaDati(true);
      } catch (_) { /* errore gia' segnalato */ } finally { btn.disabled = false; }
    });
    dlg.showModal();
    const primo = dlg.querySelector('input'); if (primo) primo.focus();
  }
  function bannerImpersona() {
    $('#imp-bar')?.remove();
    document.body.classList.toggle('impersona', Boolean(ME && ME.impersonato_da));
    document.body.classList.toggle('demo', Boolean(ME && ME.demo));
    if (ME && ME.demo) {
      document.body.insertAdjacentHTML('afterbegin', '<div id="imp-bar" class="imp-bar demo-bar" role="status"><span>' + T('<b>Demo</b> · dati simulati di un atleta alla 6ª settimana', '<b>Demo</b> · simulated data of an athlete in week 6') + '</span><a href="/demo/esci">' + T('Accedi', 'Sign in') + '</a></div>');
      return;
    }
    if (!ME || !ME.impersonato_da) return;
    document.body.insertAdjacentHTML('afterbegin', '<div id="imp-bar" class="imp-bar" role="status"><span>' + T('Stai vedendo l’app come ', 'Viewing the app as ') + '<b>' + esc(ME.nome || ME.email) + '</b></span><button type="button" id="imp-fine">' + T('Torna al tuo account', 'Back to your account') + '</button></div>');
    $('#imp-fine').addEventListener('click', async () => { await inviaJson('POST', '/api/admin/impersona-fine'); location.href = '/'; });
  }
  function aggiornaAvatar() {
    bannerImpersona();
    const b = $('#btn-account');
    if (ME.demo) { b.hidden = true; return; }
    const n = ME.in_attesa || 0;
    b.innerHTML = avatar(ME, 'av-sm');
    b.hidden = false;
    b.setAttribute('aria-label', 'Account');
    // Ingranaggio dell'amministrazione: solo per l'amministratore, con il pallino delle richieste di accesso in attesa
    const aw = $('#admin-wrap'), ab = $('#btn-admin');
    aw.hidden = !(ME.ruolo === 'admin' && !ME.impersonato_da);
    aw.querySelector('.av-badge')?.remove();
    if (n && !aw.hidden) aw.insertAdjacentHTML('beforeend', '<span class="av-badge">' + (n > 9 ? '9+' : n) + '</span>');
    const nome = T('Amministrazione', 'Admin');
    ab.setAttribute('aria-label', nome + (n ? T(' · ' + n + ' richieste di accesso in attesa', ' · ' + n + ' pending access requests') : ''));
    ab.title = nome;
  }
  $('#btn-account').addEventListener('click', () => apriSheet('#account'));
  $('#btn-diario').addEventListener('click', () => apriSheet('#diario'));
  $('#btn-chat').addEventListener('click', () => apriSheet('#coach'));
  $('#btn-admin').addEventListener('click', () => apriSheet('#admin'));
  // il conteggio si aggiorna quando torni sull'app
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ME) caricaJson('/api/me').then((m) => { ME = m; aggiornaAvatar(); }).catch(() => {}); });

  // ---- Livello di partenza (valutazione iniziale dalle corse già su Intervals.icu) ----
  let VALUTAZIONE = null;
  async function caricaValutazione() {
    // solo per i nuovi iscritti che non hanno ancora scelto da dove partire
    if (!ME || ME.demo || !ME.nuovo || ME.profilo.settimana_iniziale != null) { VALUTAZIONE = null; return; }
    obiettivoScelto = obiettivoScelto || (ME.profilo.obiettivo || 'mezza');
    try { VALUTAZIONE = await caricaJson('/api/valutazione?obiettivo=' + encodeURIComponent(obiettivoScelto)); } catch (_) { VALUTAZIONE = null; }
    const box = $('#livello-wrap');
    if (box) { box.outerHTML = renderLivello(); aggiornaLivello(); }
  }
  // Stima della settimana di partenza dalle risposte (stessa regola del server)
  function settimanaDa(min, volte, soglie) {
    if (volte < 1 || min < 10) return 1;
    let sett = 1;
    for (const [m, w] of soglie) if (min >= m) { sett = w; break; }
    if (volte < 2 && sett > 8) sett = 8;
    return Math.min(22, sett);
  }
  const testoMinuti = (m) => (m === 0 ? T('non corro ancora', 'I don’t run yet') : m < 10 ? T('qualche minuto', 'a few minutes') : m >= 120 ? T('2 ore o più', '2 hours or more') : T('circa ', 'about ') + m + '′');
  const testoVolte = (v) => (v === 0 ? T('per ora nessuna', 'none for now') : v === 1 ? T('1 volta', 'once') : v + T(' volte', ' times'));
  let livelloScelto = null; // settimana scelta a mano dal menu
  let obiettivoScelto = null; // obiettivo scelto nella card (prima della conferma)
  let intensitaScelta = 'equilibrata';
  function renderLivello() {
    const v = VALUTAZIONE;
    if (!v || !ME || ME.demo || ME.profilo.settimana_iniziale != null) return '<div id="livello-wrap"></div>';
    try { if (sessionStorage.getItem('coach-livello-dopo') === '1') return '<div id="livello-wrap"></div>'; } catch (_) {}
    const dt = v.dati;
    const min0 = Math.min(120, Math.round((dt.corsa_continua_max_min || 0) / 5) * 5);
    const volte0 = Math.min(7, Math.round(dt.per_settimana || 0));
    let opz = '', fase = null;
    v.settimane.forEach((w) => {
      if (w.fase !== fase) { if (fase !== null) opz += '</optgroup>'; opz += '<optgroup label="' + esc(w.fase) + '">'; fase = w.fase; }
      opz += '<option value="' + w.n + '">' + T('Sett. ', 'Wk ') + w.n + ' · ' + esc(w.desc) + '</option>';
    });
    return '<section id="livello-wrap" class="card livello">' +
      '<div class="lv-top"><span class="lv-ic">🏃</span><div><h3>' + T('Raccontami la tua corsa', 'Tell me about your running') + '</h3>' +
        '<p>' + T('Due domande per partire dal livello giusto. Rispondi a occhio: puoi cambiare tutto quando vuoi.', 'Two questions to start at the right level. A rough answer is fine: you can change everything later.') + '</p></div></div>' +
      '<div class="lv-q lv-ob"><span>' + T('Qual è il tuo obiettivo?', 'What is your goal?') + '</span><div class="lv-ob-scelte" role="radiogroup">' +
        OBIETTIVI_UI.map((o) => '<button type="button" role="radio" aria-checked="' + (obiettivoScelto === o[0]) + '" class="' + (obiettivoScelto === o[0] ? 'on' : '') + '" data-ob="' + o[0] + '"><b>' + (LANG === 'en' ? o[2] : o[1]) + '</b><small>' + o[3] + T(' sett.', ' wks') + '</small></button>').join('') + '</div>' +
        (obiettivoScelto === 'maratona' ? '<small class="lv-avviso">' + T('Impegnativa: consigliata se corri già da almeno 6 mesi. Puoi sempre partire da una distanza più corta.', 'Demanding: recommended if you have been running for at least 6 months. You can always start with a shorter distance.') + '</small>' : '') + '</div>' +
      '<div class="lv-q lv-ob"><span>' + T('Con che intensità?', 'How intense?') + '</span><div class="lv-ob-scelte lv-int" role="radiogroup">' +
        INTENSITA_UI().map((o) => '<button type="button" role="radio" aria-checked="' + (intensitaScelta === o[0]) + '" class="' + (intensitaScelta === o[0] ? 'on' : '') + '" data-int="' + o[0] + '"><b>' + (LANG === 'en' ? o[2] : o[1]) + '</b><small>' + o[3] + '</small></button>').join('') + '</div>' +
        '<small class="lv-nota">' + T('Il coach la regola da solo di ±10% se il piano risulta troppo facile o troppo duro.', 'The coach adjusts it by ±10% on its own if the plan proves too easy or too hard.') + '</small></div>' +
      (dt.corse ? '<p class="lv-dati">' + T('Dalle tue corse su Intervals.icu: ', 'From your runs on Intervals.icu: ') + esc(v.motivo.split(/(?<=\.)\s/)[0]) + '</p>' : '') +
      '<label class="lv-q"><span>' + T('Quanto riesci a correre senza fermarti, oggi?', 'How long can you run without stopping, today?') + '</span><output id="lv-min-o">' + testoMinuti(min0) + '</output>' +
        '<input type="range" id="lv-min" min="0" max="120" step="5" value="' + min0 + '"></label>' +
      '<label class="lv-q"><span>' + T('Quante volte corri in una settimana tipo?', 'How many times do you run in a typical week?') + '</span><output id="lv-volte-o">' + testoVolte(volte0) + '</output>' +
        '<input type="range" id="lv-volte" min="0" max="7" step="1" value="' + volte0 + '"></label>' +
      '<div class="lv-sug"><small>' + T('Partirai da', 'You will start from') + '</small><b id="lv-sett"></b><span id="lv-desc"></span></div>' +
      '<details class="lv-altro"><summary>' + T('Preferisci scegliere tu?', 'Rather choose yourself?') + '</summary><select id="lv-sel">' + opz + '</optgroup></select></details>' +
      '<div class="lv-act"><button type="button" class="btn-primary" id="lv-ok">' + T('Inizia da qui', 'Start here') + '</button>' +
        '<button type="button" class="pill-btn" id="lv-dopo">' + T('Più tardi', 'Later') + '</button></div>' +
    '</section>';
  }
  function aggiornaLivello() {
    const v = VALUTAZIONE, box = $('#livello-wrap');
    if (!v || !box || !$('#lv-min')) return;
    const min = +$('#lv-min').value, volte = +$('#lv-volte').value;
    $('#lv-min-o').textContent = testoMinuti(min);
    $('#lv-volte-o').textContent = testoVolte(volte);
    const n = livelloScelto || settimanaDa(min, volte, v.soglie);
    const w = v.settimane[n - 1];
    $('#lv-sett').textContent = T('Settimana ', 'Week ') + n + ' · ' + w.fase;
    $('#lv-desc').textContent = w.desc + (livelloScelto ? T(' · scelta da te', ' · your choice') : '');
    $('#lv-sel').value = String(n);
  }
  document.addEventListener('input', (e) => {
    if (e.target.id === 'lv-min' || e.target.id === 'lv-volte') { livelloScelto = null; aggiornaLivello(); }
  });
  document.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-scarpa-att]');
    if (sel) {
      const { ok, out } = await inviaJson('PUT', '/api/attivita/' + encodeURIComponent(sel.dataset.scarpaAtt) + '/scarpa', { scarpa_id: sel.value || null }).catch(() => ({ ok: false }));
      if (ok) { SCARPE = out.scarpe; toast(T('Scarpa aggiornata', 'Shoe updated'), 'ok'); caricaStorico(); } else toast(T('Non riesco a salvare la scarpa', 'Could not save the shoe'), 'err');
      return;
    }
    if (e.target.id === 'lv-sel') { livelloScelto = +e.target.value; aggiornaLivello(); }
  });
  async function applicaLivello(sett, fcMax, obiettivo, intensita) {
    const corpo = { settimana_iniziale: sett };
    if (obiettivo) corpo.obiettivo = obiettivo;
    if (intensita) corpo.intensita = intensita;
    if (fcMax !== undefined) corpo.fc_max = fcMax;
    const { ok, out } = await inviaJson('PUT', '/api/profilo', corpo);
    if (!ok) { toast(T('Non riesco a salvare il livello', 'Could not save the level'), 'err'); return false; }
    ME = out; VALUTAZIONE = null;
    toast(T('Piano aggiornato: si parte dalla settimana ', 'Plan updated: starting from week ') + sett, 'ok');
    await caricaDati(true);
    return true;
  }
  document.addEventListener('click', async (e) => {
    const ib = e.target.closest('[data-int]');
    if (ib) {
      intensitaScelta = ib.dataset.int;
      document.querySelectorAll('[data-int]').forEach((x) => { x.classList.toggle('on', x === ib); x.setAttribute('aria-checked', String(x === ib)); });
      return;
    }
    const obb = e.target.closest('[data-ob]');
    if (obb) {
      const min = $('#lv-min') ? $('#lv-min').value : null, volte = $('#lv-volte') ? $('#lv-volte').value : null;
      obiettivoScelto = obb.dataset.ob; livelloScelto = null;
      try { VALUTAZIONE = await caricaJson('/api/valutazione?obiettivo=' + encodeURIComponent(obiettivoScelto)); } catch (_) { return; }
      $('#livello-wrap').outerHTML = renderLivello();
      if (min != null) { $('#lv-min').value = min; $('#lv-volte').value = volte; }
      aggiornaLivello();
      return;
    }
    if (e.target.closest('#lv-dopo')) {
      try { sessionStorage.setItem('coach-livello-dopo', '1'); } catch (_) {}
      $('#livello-wrap').outerHTML = '<div id="livello-wrap"></div>';
      return;
    }
    const ok = e.target.closest('#lv-ok');
    if (!ok) return;
    const v = VALUTAZIONE;
    const min = +$('#lv-min').value, volte = +$('#lv-volte').value;
    const sett = livelloScelto || settimanaDa(min, volte, v.soglie);
    const fc = sett > 1 && v.fc_max_consigliata ? v.fc_max_consigliata : undefined;
    ok.disabled = true;
    await applicaLivello(sett, fc, obiettivoScelto, intensitaScelta);
  });

  // Scelta manuale della settimana di partenza, dentro la guida del piano (passo "Piano"): alternativa a quella del coach
  async function riempiLivelloGuida() {
    const box = $('#gd-liv-box');
    if (!box || box.dataset.pronto) return;
    box.dataset.pronto = '1';
    if (guida && ME.profilo.obiettivo && guida.obiettivo !== ME.profilo.obiettivo) {
      box.innerHTML = '<p class="gd-nota">' + T('Hai scelto un nuovo obiettivo: conferma prima il piano, poi potrai scegliere da quale settimana partire.', 'You picked a new goal: confirm the plan first, then you can choose which week to start from.') + '</p>';
      return;
    }
    let v;
    try { v = await caricaJson('/api/valutazione'); } catch (e) { box.innerHTML = '<p class="gd-nota">' + esc(e.message) + '</p>'; return; }
    const att = ME.profilo.settimana_iniziale || 1;
    let opz = '', fase = null;
    v.settimane.forEach((w) => {
      if (w.fase !== fase) { if (fase !== null) opz += '</optgroup>'; opz += '<optgroup label="' + esc(w.fase) + '">'; fase = w.fase; }
      opz += '<option value="' + w.n + '"' + (w.n === att ? ' selected' : '') + '>' + T('Sett. ', 'Wk ') + w.n + ' · ' + esc(w.desc) + (w.n === v.settimana_consigliata ? T(' (consigliata)', ' (suggested)') : '') + '</option>';
    });
    opz += '</optgroup>';
    box.innerHTML = '<p class="gd-nota">' + esc(v.motivo) + '</p>' +
      '<label class="acc-f"><span>' + T('Il piano parte dalla settimana', 'The plan starts from week') + '</span><select id="gd-liv-sel">' + opz + '</select>' +
        '<small>' + T('Cambiarla ricalcola il piano dalla data della prima seduta.', 'Changing it recalculates the plan from the first-session date.') + '</small></label>' +
      '<button type="button" class="pill-btn" data-gd-livello' + (ME.demo ? ' disabled' : '') + '>' + T('Parti da questa settimana', 'Start from this week') + '</button>';
  }
  document.addEventListener('toggle', (e) => { if (e.target && e.target.id === 'gd-livello' && e.target.open) riempiLivelloGuida(); }, true);
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-gd-livello]');
    if (!b) return;
    b.disabled = true;
    const n = parseInt($('#gd-liv-sel').value, 10);
    guida = null;
    if (!(await applicaLivello(n))) b.disabled = false;
  });


  /* ---- Colore principale ---- */
  // Colori d'accento in ordine di tinta: [id, nome IT, nome EN, tema scuro, tema chiaro] (stessi id di css/accenti.css e COLORI_AMMESSI)
  const COLORI = [
    ['cremisi', 'Cremisi', 'Crimson', '#ff3b4f', '#c8102e'], ['segnale', 'Rosso segnale', 'Signal red', '#ff5a4a', '#c41e1e'], ['corallo', 'Corallo', 'Coral', '#ff7f6e', '#c2412f'],
    ['mandarino', 'Mandarino', 'Tangerine', '#ff7a45', '#c2410c'], ['rame', 'Rame', 'Copper', '#e8894a', '#a8521a'], ['arancio', 'Arancio', 'Orange', '#ff9f0a', '#c24e00'],
    ['ambra', 'Ambra', 'Amber', '#ffb340', '#a15c00'], ['oro', 'Oro', 'Gold', '#ffcc33', '#8a6400'], ['elettrico', 'Giallo elettrico', 'Electric yellow', '#ffe600', '#806b00'],
    ['volt', 'Volt', 'Volt', '#d4ff1f', '#5c7300'], ['verde', 'Verde', 'Green', '#30d158', '#248a3d'], ['smeraldo', 'Smeraldo', 'Emerald', '#1fd59a', '#047857'],
    ['salvia', 'Salvia', 'Sage', '#9ccc9c', '#4a7a4a'], ['menta', 'Menta', 'Mint', '#63e6e2', '#0c817b'], ['turchese', 'Turchese', 'Turquoise', '#2fd8c8', '#0f766e'],
    ['ciano', 'Ciano', 'Cyan', '#00ecff', '#007a85'], ['azzurro', 'Azzurro', 'Sky', '#64d2ff', '#0071a4'], ['ghiacciaio', 'Ghiacciaio', 'Glacier', '#1fb2ec', '#0072a3'],
    ['blu', 'Blu', 'Blue', '#0a84ff', '#0066cc'], ['laser', 'Blu laser', 'Laser blue', '#4d7cff', '#1d4ed8'], ['indaco', 'Indaco', 'Indigo', '#7d7aff', '#3634a3'],
    ['ultravioletto', 'Ultravioletto', 'Ultraviolet', '#a46bff', '#6b21d8'], ['viola', 'Viola', 'Purple', '#bf5af2', '#8944ab'], ['magenta', 'Magenta', 'Magenta', '#ff3ddc', '#b0119a'],
    ['fucsia', 'Fucsia', 'Fuchsia', '#ff4fa3', '#c2185b'], ['ardesia', 'Ardesia', 'Slate', '#a9bdd2', '#4a6178']];
  let coloriAperti = false; // tavolozza aperta nel profilo (solo vista)
  function applicaColore(c) {
    if (!COLORI.some((x) => x[0] === c)) c = 'verde';
    document.documentElement.setAttribute('data-accent', c);
    try { localStorage.setItem('coach-colore', c); } catch (_) {}
    if (window.aacFavicon) window.aacFavicon();
  }
  // riga minimale con il colore attuale; al tocco si apre la tavolozza
  function renderColori() {
    const att = document.documentElement.getAttribute('data-accent') || 'verde';
    const scuro = document.documentElement.getAttribute('data-theme') !== 'light';
    const x0 = COLORI.find((x) => x[0] === att) || COLORI.find((x) => x[0] === 'verde');
    const nome = (x) => (LANG === 'en' ? x[2] : x[1]);
    const sw = (x) => (scuro ? x[3] : x[4]);
    return '<section class="card acc-col" id="acc-aspetto">' +
      '<button type="button" class="acc-col-riga" data-colori-apri aria-expanded="' + coloriAperti + '" aria-controls="acc-tavolozza">' +
        '<span class="acc-col-sw" style="--sw:' + sw(x0) + '"></span><span class="acc-col-t"><b>' + T('Colore', 'Colour') + '</b><small>' + esc(nome(x0)) + '</small></span>' +
        '<svg class="acc-col-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>' +
      '<div id="acc-tavolozza" class="acc-tavolozza"' + (coloriAperti ? '' : ' hidden') + '><div class="acc-colori" role="radiogroup" aria-label="' + T('Colore principale', 'Accent colour') + '">' +
        COLORI.map((x) => '<button type="button" role="radio" aria-checked="' + (x[0] === att) + '" aria-label="' + nome(x) + '" title="' + nome(x) + '" data-colore="' + x[0] + '" class="' + (x[0] === att ? 'on' : '') + '" style="--sw:' + sw(x) + '"></button>').join('') +
      '</div><p class="acc-colori-nomi">' + T('Pulsanti, grafici e zone cardiache. Si salva nel tuo account.', 'Buttons, charts and heart-rate zones. Saved to your account.') + '</p></div></section>';
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-colori-apri]')) return;
    coloriAperti = !coloriAperti;
    const box = $('#acc-aspetto');
    if (box) box.outerHTML = renderColori();
  });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-colore]');
    if (!b) return;
    applicaColore(b.dataset.colore);
    const box = $('#acc-aspetto');
    if (box) box.outerHTML = renderColori();
    if (ultimiDati) render(ultimiDati); // ridisegna i grafici con il nuovo colore
    if (ME && !ME.demo) {
      const { ok, out } = await inviaJson('PUT', '/api/profilo', { colore: b.dataset.colore }).catch(() => ({ ok: false }));
      if (ok) ME = out;
    }
  });

  async function riempiScarpeAccount() {
    await caricaScarpe();
    const box = $('#acc-scarpe');
    if (!box) return;
    const riga = (x) => '<li class="' + (x.attiva ? '' : 'ritirata') + '"><div class="as-top"><div><b>' + esc(x.nome) + '</b>' + (x.predefinita ? ' <span class="pill ok">' + T('predefinita', 'default') + '</span>' : '') + (x.attiva ? '' : ' <span class="pill">' + T('ritirata', 'retired') + '</span>') +
        '<small>' + fmt0(x.km) + ' / ' + fmt0(x.limite_km) + ' km · ' + x.corse + T(' corse', ' runs') + (x.km_iniziali ? T(' · ' + fmt0(x.km_iniziali) + ' km prima dell’app', ' · ' + fmt0(x.km_iniziali) + ' km before the app') : '') + '</small></div></div>' +
      '<div class="acc-act">' + (x.attiva && !x.predefinita ? '<button type="button" class="pill-btn ok" data-scarpa-az="predefinita" data-id="' + x.id + '">' + T('Predefinita', 'Make default') + '</button>' : '') +
        '<button type="button" class="pill-btn" data-scarpa-az="' + (x.attiva ? 'ritira' : 'riattiva') + '" data-id="' + x.id + '">' + (x.attiva ? T('Ritira', 'Retire') : T('Riattiva', 'Reactivate')) + '</button>' +
        '<button type="button" class="pill-btn" data-scarpa-az="modifica" data-id="' + x.id + '">' + T('Modifica', 'Edit') + '</button>' +
        '<button type="button" class="pill-btn bad" data-scarpa-az="elimina" data-id="' + x.id + '">' + T('Elimina', 'Delete') + '</button></div>' +
      '<form class="acc-form scarpa-mod" data-id="' + x.id + '" hidden><div class="acc-row2"><label class="acc-f"><span>' + T('Nome', 'Name') + '</span><input name="nome" value="' + esc(x.nome) + '"></label>' +
        '<label class="acc-f"><span>' + T('Km prima dell’app', 'Km before the app') + '</span><input name="km_iniziali" type="number" min="0" max="5000" value="' + (x.km_iniziali || 0) + '"></label>' +
        '<label class="acc-f"><span>' + T('Da cambiare a', 'Replace at') + '</span><input name="limite_km" type="number" min="100" max="3000" value="' + x.limite_km + '"></label></div>' +
        '<button type="submit" class="btn-primary">' + T('Salva', 'Save') + '</button></form></li>';
    box.innerHTML = '<h3>👟 ' + T('Le tue scarpe', 'Your shoes') + '</h3><p class="sub">' + T('La scarpa predefinita viene assegnata da sola alle nuove corse; puoi cambiarla in ogni allenamento.', 'The default shoe is assigned automatically to new runs; you can change it on each workout.') + '</p>' +
      (SCARPE.length ? '<ul class="acc-scarpe">' + SCARPE.map(riga).join('') + '</ul>' : '') +
      '<form id="scarpa-nuova" class="acc-form"><div class="acc-row2"><label class="acc-f"><span>' + T('Nuova scarpa', 'New shoe') + '</span><input name="nome" required maxlength="60" placeholder="' + T('es. Pegasus 41', 'e.g. Pegasus 41') + '"></label>' +
        '<label class="acc-f"><span>' + T('Km già fatti', 'Km already done') + '</span><input name="km_iniziali" type="number" min="0" max="5000" placeholder="0"></label>' +
        '<label class="acc-f"><span>' + T('Da cambiare a', 'Replace at') + '</span><input name="limite_km" type="number" min="100" max="3000" placeholder="700"></label></div>' +
        '<button type="submit" class="btn-primary">' + T('Aggiungi', 'Add') + '</button></form>';
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-scarpa-az]');
    if (!b) return;
    const id = b.dataset.id, az = b.dataset.scarpaAz;
    if (az === 'modifica') { const f = document.querySelector('.scarpa-mod[data-id="' + id + '"]'); if (f) f.hidden = !f.hidden; return; }
    if (az === 'elimina' && !confirm(T('Eliminare la scarpa? Le corse restano, senza scarpa assegnata.', 'Delete this shoe? Runs stay, without a shoe.'))) return;
    const r = az === 'elimina' ? await inviaJson('DELETE', '/api/scarpe/' + id)
      : await inviaJson('PUT', '/api/scarpe/' + id, az === 'predefinita' ? { predefinita: true } : { attiva: az === 'riattiva' });
    if (!r.ok) { toast(T('Operazione non riuscita', 'Action failed'), 'err'); return; }
    await riempiScarpeAccount(); caricaStorico();
  });
  document.addEventListener('submit', async (e) => {
    const f = e.target;
    if (f.id !== 'scarpa-nuova' && !f.classList.contains('scarpa-mod')) return;
    e.preventDefault();
    const corpo = Object.fromEntries(new FormData(f).entries());
    const r = f.id === 'scarpa-nuova' ? await inviaJson('POST', '/api/scarpe', corpo) : await inviaJson('PUT', '/api/scarpe/' + f.dataset.id, corpo);
    if (!r.ok) { toast(r.out && r.out.errore === 'nome' ? T('Scrivi il nome della scarpa', 'Enter the shoe name') : T('Controlla i valori', 'Check the values'), 'err'); return; }
    toast(T('Scarpe aggiornate', 'Shoes updated'), 'ok');
    await riempiScarpeAccount(); caricaStorico();
  });

  function renderAccount() {
    const u = ME, p = u.profilo;
    const campo = (id, label, input, nota) => '<label class="acc-f" for="' + id + '"><span>' + label + '</span>' + input + (nota ? '<small>' + nota + '</small>' : '') + '</label>';
    let html = '<section class="acc-head">' + avatar(u, 'av-lg') + '<div><h1>' + esc(u.nome || u.email) + '</h1><p>' + esc(u.email) + (u.ruolo === 'admin' ? ' · <b>' + T('amministratore', 'administrator') + '</b>' : '') + '</p></div></section>';
    const sv = p.strava || {}, haInt = Boolean(p.ha_chiave && p.athlete_id);
    const nonIniziato = !p.programma_inizio || p.programma_inizio > ((ultimiDati && ultimiDati.oggi) || new Date().toISOString().slice(0, 10));
    if (!u.completo) {
      html += '<section class="card acc-welcome"><h3>' + T('Benvenuto! Due passi per iniziare', 'Welcome! Two steps to get started') + '</h3><ol>' +
        '<li>' + T('<b>Collega una fonte dei dati</b> qui sotto: ' + (sv.disponibile ? 'Strava è la più veloce (un tocco), Intervals.icu porta anche FC a riposo, HRV e sonno.' : 'Intervals.icu, con il tuo orologio collegato.'), '<b>Connect a data source</b> below: ' + (sv.disponibile ? 'Strava is the quickest (one tap), Intervals.icu also brings resting HR, HRV and sleep.' : 'Intervals.icu, with your watch connected.')) + '</li>' +
        '<li>' + T('<b>Scegli il giorno della prima seduta</b> nella sezione Il tuo piano.', '<b>Pick the day of your first session</b> in the Your plan section.') + '</li></ol></section>';
    }
    const statoF = (on, txt) => '<span class="fonte-st' + (on ? ' on' : '') + '">' + (on ? '✓ ' : '') + txt + '</span>';
    // ---- 1. da dove arrivano i dati: Strava e/o Intervals.icu ----
    html += '<section class="card acc-fonti">' +
      '<div class="acc-h3row"><h3>' + T('Da dove arrivano i tuoi dati', 'Where your data comes from') + '</h3>' +
        (p.ha_fonte ? '<button type="button" class="acc-guida" id="acc-sync"' + (syncInCorso ? ' disabled' : '') + '>' + ICO.sync + '<span>' + (syncInCorso ? T('Sincronizzo…', 'Syncing…') : T('Sincronizza ora', 'Sync now')) + '</span></button>' : '') + '</div>' +
      '<p class="sub">' + T('Puoi usare una fonte o entrambe: se la stessa corsa arriva da tutte e due, la teniamo una volta sola.', 'Use one source or both: if the same run arrives from both, we keep it only once.') + '</p>' +
      '<p class="acc-sync-stato" id="acc-sync-stato">' + statoSyncHtml + '</p>' +
      (sv.disponibile
        ? '<div class="fonte fonte-strava"><div class="fonte-top"><b>Strava</b>' + statoF(sv.collegato, sv.collegato ? T('collegato', 'connected') + (sv.nome ? ' · ' + esc(sv.nome) : '') : T('non collegato', 'not connected')) + '</div>' +
            '<p>' + T('Le tue corse con mappa, cardio, passo e dislivello. <b>Un tocco</b> e hai finito: niente chiavi da copiare.', 'Your runs with map, heart rate, pace and elevation. <b>One tap</b> and you’re done: no keys to copy.') + '</p>' +
            '<p class="fonte-no">' + T('Non porta FC a riposo, HRV e sonno: per adattare la seduta ogni mattina serve Intervals.icu.', 'It doesn’t bring resting HR, HRV and sleep: to adapt the session every morning you need Intervals.icu.') + '</p>' +
            '<div class="fonte-az">' + (sv.collegato
              ? '<button type="button" class="link-btn" id="strava-scollega">' + T('Scollega Strava', 'Disconnect Strava') + '</button>'
              : '<a class="btn-strava" href="/api/strava/collega">' + T('Connetti con Strava', 'Connect with Strava') + '</a>') +
              '<button type="button" class="link-btn" data-apri-sheet="#guida-strava">' + T('Come funziona', 'How it works') + '</button></div></div>'
        : '') +
      '<div class="fonte fonte-int"><div class="fonte-top"><b>Intervals.icu</b>' + statoF(haInt, haInt ? T('collegato', 'connected') : T('non collegato', 'not connected')) + (sv.disponibile ? '<span class="fonte-cons">' + T('consigliato', 'recommended') + '</span>' : '') + '</div>' +
        '<p>' + T('Corse <b>e dati di salute</b>: FC a riposo, HRV e sonno. Servono al coach per adattare la seduta ogni mattina e per le tue zone cardiache personali.', 'Runs <b>and health data</b>: resting HR, HRV and sleep. The coach uses them to adapt your session every morning and for your personal heart-rate zones.') + '</p>' +
        (sv.disponibile ? '' : '<p class="fonte-no">' + T('Usi Strava? Collega lo stesso orologio anche a Intervals.icu: le corse arrivano a tutti e due e Strava non cambia. Le corse che Intervals importa da Strava, invece, ad AAC non arrivano (regole di Strava).', 'Using Strava? Connect the same watch to Intervals.icu too: runs reach both and Strava doesn’t change. Runs that Intervals imports from Strava, though, don’t reach AAC (Strava’s rules).') + '</p>') +
        '<div class="fonte-az"><button type="button" class="acc-guida" data-apri-sheet="#collega">' + ICO.share + '<span>' + T('Collega l’orologio a Intervals', 'Connect your watch to Intervals') + '</span></button></div>' +
        '<details class="more fonte-chiave"' + (haInt ? '' : ' open') + '><summary>' + (haInt ? T('Athlete ID e API key', 'Athlete ID and API key') : T('Inserisci Athlete ID e API key', 'Enter Athlete ID and API key')) + '</summary>' +
          '<form id="acc-int-form" class="acc-form" autocomplete="off">' +
            '<p class="fine">' + T('Su intervals.icu apri <b>Settings → Developer Settings</b>: copia l’Athlete ID e genera una API key.', 'On intervals.icu open <b>Settings → Developer Settings</b>: copy the Athlete ID and generate an API key.') + '</p>' +
            campo('acc-ath', 'Athlete ID', '<input id="acc-ath" name="athlete_id" inputmode="text" placeholder="i123456" value="' + esc(p.athlete_id) + '">') +
            campo('acc-key', 'API key', '<input id="acc-key" name="intervals_key" type="password" placeholder="' + (p.ha_chiave ? T('già impostata · lascia vuoto per non cambiarla', 'already set · leave empty to keep it') : T('incolla la chiave', 'paste the key')) + '">', T('Salvata cifrata, usata solo per leggere i tuoi dati.', 'Stored encrypted, used only to read your data.')) +
            '<p class="acc-err" hidden></p><button type="submit" class="btn-primary">' + T('Salva Intervals.icu', 'Save Intervals.icu') + '</button>' +
          '</form></details></div>' +
    '</section>';
    // ---- 2. il piano ----
    html += '<section class="card"><h3>' + T('Il tuo piano', 'Your plan') + '</h3>' +
      '<p class="sub">' + T('Obiettivo, intensità, giorni e settimana di partenza si scelgono con il coach nel tab Piano.', 'Goal, intensity, days and starting week are chosen with the coach in the Plan tab.') + '</p>' +
      '<button type="button" class="gc-cta" data-vai-piano><span>' + T('Rivedi il tuo piano', 'Review your plan') + '</span>' + FRECCIA + '</button>' +
      (nonIniziato
        ? '<form id="acc-piano-form" class="acc-form" autocomplete="off"><div class="acc-row acc-row2">' +
            campo('acc-ini', T('Prima seduta', 'First session'), '<input id="acc-ini" name="programma_inizio" type="date" value="' + esc(p.programma_inizio || '') + '">') +
            campo('acc-ora', T('Orario', 'Time'), '<input id="acc-ora" name="programma_ora" type="time" value="' + esc(p.programma_ora || '06:30') + '">') +
          '</div><p class="acc-err" hidden></p><button type="submit" class="btn-primary">' + T('Salva', 'Save') + '</button></form>'
        : '') +
    '</section>';
    // ---- 3. il corpo ----
    html += '<form id="acc-form" class="card acc-form" autocomplete="off">' +
      '<h3>' + T('Il tuo corpo', 'Your body') + '</h3>' +
      '<div class="acc-row acc-row2">' +
        campo('acc-nascita', T('Data di nascita', 'Date of birth'), '<input id="acc-nascita" name="data_nascita" type="date" min="1930-01-01" max="' + new Date().toISOString().slice(0, 10) + '" value="' + esc(p.data_nascita || '') + '">') +
        // con la data di nascita l'eta' si calcola da sola
        campo('acc-eta', T('Età', 'Age'), '<input id="acc-eta" name="eta" type="number" inputmode="numeric" min="14" max="90" placeholder="33" value="' + esc(p.eta || '') + '"' + (p.data_nascita ? ' disabled title="' + T('Calcolata dalla data di nascita', 'Worked out from the date of birth') + '"' : '') + '>') +
      '</div>' +
      '<div class="acc-row acc-row2">' +
        campo('acc-alt', T('Altezza (cm)', 'Height (cm)'), '<input id="acc-alt" name="altezza" type="number" inputmode="numeric" min="100" max="230" value="' + esc(p.altezza || '') + '">') +
        campo('acc-peso', T('Peso (kg)', 'Weight (kg)'), '<input id="acc-peso" name="peso" type="text" inputmode="decimal" pattern="[0-9]{2,3}([.,][0-9])?" maxlength="5" value="' + esc(p.peso != null ? String(p.peso).replace('.', LANG === 'en' ? '.' : ',') : '') + '">') +
      '</div>' +
      (() => {
        const stima = Math.round(208 - 0.7 * (p.eta || 33));
        return campo('acc-fcmax', T('FC max misurata (bpm)', 'Measured max HR (bpm)'), '<input id="acc-fcmax" name="fc_max" type="number" inputmode="numeric" min="140" max="220" placeholder="' + stima + '" value="' + esc(p.fc_max || '') + '">' +
          '<small>' + T('Vuoto = stimata dall’età: 208 − 0,7 × età = ' + stima + ' bpm. Le zone cardiache e la FC di sicurezza si ricalcolano da sole.', 'Empty = age-based estimate: 208 − 0.7 × age = ' + stima + ' bpm. Heart-rate zones and safety HR update automatically.') + '</small>');
      })() +
      '<p class="acc-err" hidden></p>' +
      '<button type="submit" class="btn-primary">' + T('Salva', 'Save') + '</button>' +
    '</form>' + '<section class="card acc-notifiche" id="acc-notifiche"><h3>🔔 ' + T('Notifiche', 'Notifications') + '</h3><div class="skeleton" style="height:60px"></div></section>' + renderColori() + '<section class="card" id="acc-scarpe"><h3>👟 ' + T('Le tue scarpe', 'Your shoes') + '</h3><div class="skeleton" style="height:80px"></div></section>' +
    '';
    if (u.login) html += '<button type="button" id="acc-esci" class="btn-secondary acc-logout">' + T('Esci', 'Sign out') + '</button>';
    return html;
  }

  // Pannello di amministrazione (ingranaggio nell'intestazione): riepilogo, invito e utenti divisi per stato.
  // Ogni riga mostra solo nome, email e due etichette; le azioni si aprono toccando la riga
  // (le richieste in attesa hanno "Approva" sempre visibile).
  // "oggi", "ieri", "3 giorni fa", "12 ott" dall'ultimo segnale "AAAA-MM-GG HH:MM"
  function quandoUso(ultima, oggiIso) {
    if (!ultima) return T('mai', 'never');
    const [g, h] = ultima.split(' ');
    const diff = Math.round((Date.parse(oggiIso + 'T12:00:00Z') - Date.parse(g + 'T12:00:00Z')) / 864e5);
    if (diff <= 0) return T('oggi ', 'today ') + h;
    if (diff === 1) return T('ieri ', 'yesterday ') + h;
    if (diff < 7) return diff + T(' giorni fa', ' days ago');
    return fmtData(g);
  }
  const pallini7 = (m) => '<span class="uso7" aria-hidden="true">' + (m || []).map((x) => '<i class="' + (x ? 'on' : '') + '"></i>').join('') + '</span>';

  function renderAdmin(utenti, uso) {
    const u = ME, tutti = utenti || [];
    const oggiIso = (ultimiDati && ultimiDati.oggi) || new Date().toISOString().slice(0, 10);
    const di = (st) => tutti.filter((x) => x.ruolo !== 'admin' && x.stato === st)
      .sort((a, b) => String(a.nome || a.email).localeCompare(String(b.nome || b.email)));
    const attesa = di('in_attesa'), attivi = di('attivo'), bloccati = di('bloccato');
    const me = tutti.filter((x) => x.ruolo === 'admin');
    const num = (v, l, cls) => '<div class="adm-n' + (cls ? ' ' + cls : '') + '"><b>' + v + '</b><span>' + l + '</span></div>';
    const btn = (az, id, testo, cls) => '<button type="button" class="pill-btn ' + (cls || '') + '" data-acc="' + az + '" data-id="' + id + '">' + testo + '</button>';
    const meta = (x) => (x.ha_chiave || x.ha_strava
        ? (x.ha_chiave ? '<span class="adm-tag ok">Intervals ✓</span>' : '') + (x.ha_strava ? '<span class="adm-tag ok">Strava ✓</span>' : '')
        : '<span class="adm-tag">' + T('Nessuna fonte collegata', 'No data source') + '</span>') +
      (x.uso && x.uso.ultima
        ? '<span class="adm-uso">' + pallini7(x.uso.giorni7) + '<span>' + esc(quandoUso(x.uso.ultima, oggiIso)) + (x.uso.minuti_medi ? ' · ' + x.uso.minuti_medi + T('′/giorno', '′/day') : '') + '</span></span>'
        : '<span class="adm-tag">' + (x.ultimo_accesso ? T('nessun uso registrato', 'no usage yet') : T('mai entrato', 'never signed in')) + '</span>');
    const testa = (x) => avatar(x, 'av-sm') + '<div class="adm-u-t"><b>' + esc(x.nome || x.email) + '</b>' +
      (x.nome ? '<small>' + esc(x.email) + '</small>' : '') + '<span class="adm-meta">' + meta(x) + '</span></div>';
    const riga = (x) => {
      if (x.ruolo === 'admin') return '<li class="adm-u adm-me">' + testa(x) + '<a class="pill" href="#uso/' + x.id + '">' + T('Statistiche', 'Stats') + '</a></li>';
      const azioni = x.stato === 'in_attesa'
        ? btn('rimuovi', x.id, T('Rifiuta', 'Decline'), 'bad')
        : x.stato === 'attivo'
          ? '<a class="pill-btn ok" href="#uso/' + x.id + '">' + T('Statistiche', 'Stats') + '</a>' + (u.login ? btn('impersona', x.id, T('Vedi come', 'View as'), 'imp') : '') + btn('bloccato', x.id, T('Blocca', 'Block')) + btn('rimuovi', x.id, T('Rimuovi', 'Remove'), 'bad')
          : btn('attivo', x.id, T('Riattiva', 'Re-enable'), 'ok') + btn('rimuovi', x.id, T('Rimuovi', 'Remove'), 'bad');
      const subito = x.stato === 'in_attesa' ? '<div class="adm-subito">' + btn('attivo', x.id, T('Approva', 'Approve'), 'ok') + '</div>' : '';
      return '<li class="adm-u"><details><summary>' + testa(x) + '<span class="adm-chev" aria-hidden="true">›</span></summary>' +
        '<div class="adm-az">' + azioni + '</div></details>' + subito + '</li>';
    };
    const gruppo = (titolo, lista, cls) => lista.length
      ? '<section class="card adm-g' + (cls ? ' ' + cls : '') + '"><h3>' + titolo + ' <span class="adm-cnt">' + lista.length + '</span></h3><ul class="adm-list">' + lista.map(riga).join('') + '</ul></section>'
      : '';
    return '<section class="card adm-sum">' +
        num(attivi.length + me.length, T('attivi', 'active')) + num(attesa.length, T('in attesa', 'pending'), attesa.length ? 'warn' : '') + num(bloccati.length, T('bloccati', 'blocked')) +
      '</section>' +
      (uso ? '<section class="card"><h3>' + T('Chi usa l’app', 'Who uses the app') + '</h3><div class="adm-sum adm-sum-in">' +
        num(uso.oggi, T('oggi', 'today')) + num(uso.sette, T('7 giorni', '7 days')) + num(uso.trenta, T('30 giorni', '30 days')) + '</div></section>' : '') +
      gruppo(T('In attesa di approvazione', 'Awaiting approval'), attesa, 'warn') +
      '<section class="card"><h3>' + T('Invita', 'Invite') + '</h3><p class="sub">' +
        (u.login ? T('L’accesso è su invito: l’email indicata potrà entrare subito con Google.', 'Access is invite-only: the email you add can sign in with Google straight away.')
          : T('Il login con Google non è attivo: gli inviti restano in sospeso.', 'Google sign-in is not active: invitations wait.')) + '</p>' +
        '<form id="acc-invita" class="acc-invite"><input name="email" type="email" required autocomplete="off" placeholder="' + T('email Google', 'Google email') + '"><button type="submit" class="btn-primary">' + T('Invita', 'Invite') + '</button></form>' +
      '</section>' +
      gruppo(T('Utenti', 'Users'), me.concat(attivi)) +
      gruppo(T('Bloccati', 'Blocked'), bloccati);
  }

  async function apriAdmin() {
    try { ME = await caricaJson('/api/me'); aggiornaAvatar(); } catch (e) { mostraSheet(T('Amministrazione', 'Admin'), '<div class="card empty">' + esc(e.message) + '</div>'); return; }
    if (ME.ruolo !== 'admin' || ME.impersonato_da) { chiudiSheet(); return; }
    let utenti = null, uso = null;
    try { const r = await caricaJson('/api/admin/utenti'); utenti = r.utenti; uso = r.uso; } catch (_) {}
    mostraSheet(T('Amministrazione', 'Admin'), renderAdmin(utenti, uso));
  }
  // Scheda "Utilizzo" di un utente: numeri chiave, calendario delle ultime 5 settimane, fascia oraria, allenamento
  async function apriUso(id) {
    mostraSheet(T('Utilizzo', 'Usage'), '<div class="skeleton" style="height:160px"></div><div class="skeleton" style="height:220px"></div>');
    let d;
    try { d = await caricaJson('/api/admin/utenti/' + encodeURIComponent(id) + '/uso'); }
    catch (e) { mostraSheet(T('Utilizzo', 'Usage'), '<div class="card empty">' + esc(e.message) + '</div>'); return; }
    const u = d.utente;
    const big = (v, l) => '<div class="adm-n"><b>' + v + '</b><span>' + l + '</span></div>';
    // calendario: 5 settimane da lunedi', intensita' in base ai minuti
    const perG = new Map(d.giorni.map((g) => [g.giorno, g]));
    const oggiMs = Date.parse(d.oggi + 'T12:00:00Z');
    const dow = (new Date(oggiMs).getUTCDay() + 6) % 7;
    const inizio = oggiMs - (28 + dow) * 864e5;
    const maxMin = Math.max(10, ...d.giorni.map((g) => g.minuti));
    let celle = '';
    for (let i = 0; i < 35; i++) {
      const iso = new Date(inizio + i * 864e5).toISOString().slice(0, 10);
      const g = perG.get(iso), futuro = iso > d.oggi;
      const liv = g ? Math.max(1, Math.ceil(g.minuti / maxMin * 4)) : 0;
      celle += '<i class="uc l' + liv + (futuro ? ' fut' : '') + (iso === d.oggi ? ' oggi' : '') + '" title="' + esc(fmtData(iso)) + (g ? ': ' + g.minuti + '′, ' + g.aperture + T(' aperture', ' opens') : '') + '"></i>';
    }
    // fascia oraria: le 3 ore consecutive con piu' minuti
    const tot = d.ore.reduce((a, b) => a + b, 0);
    let fascia = '';
    if (tot) {
      let best = 0, h0 = 0;
      for (let h = 0; h < 24; h++) { const s3 = d.ore[h] + d.ore[(h + 1) % 24] + d.ore[(h + 2) % 24]; if (s3 > best) { best = s3; h0 = h; } }
      const nome = h0 >= 5 && h0 < 12 ? T('la mattina', 'in the morning') : h0 >= 12 && h0 < 18 ? T('il pomeriggio', 'in the afternoon') : h0 >= 18 && h0 < 23 ? T('la sera', 'in the evening') : T('di notte', 'at night');
      fascia = T('di solito ', 'usually ') + nome + ', ' + h0 + '–' + ((h0 + 3) % 24);
    }
    const maxOra = Math.max(1, ...d.ore);
    const barre = d.ore.map((m, h) => '<i style="height:' + Math.max(m ? 8 : 2, Math.round(m / maxOra * 100)) + '%"' + (m ? ' class="on"' : '') + ' title="' + h + ':00 · ' + m + '′"></i>').join('');
    const al = d.allenamento;
    const allen = !al ? '' : al.piano && al.previste
      ? '<div class="uso-al"><b>' + al.fatte + '<small>/' + al.previste + '</small></b><span>' + T('sedute fatte del piano', 'plan sessions done') + ' · ' + Math.round(al.fatte / al.previste * 100) + '%</span></div>'
      : '<div class="uso-al"><b>' + al.corse + '</b><span>' + T('corse', 'runs') + '</span></div>';
    const html =
      '<section class="acc-head">' + avatar(u, 'av-lg') + '<div><h1>' + esc(u.nome || u.email) + '</h1><p>' + esc(u.email) + '</p></div></section>' +
      '<section class="card adm-sum">' + big(d.giorni30, T('giorni su 30', 'days of 30')) + big(d.minuti_medi + '′', T('al giorno', 'per day')) + big(esc(quandoUso(d.ultima, d.oggi)).replace(/ (\d\d:\d\d)$/, '<small> $1</small>'), T('ultima visita', 'last visit')) + '</section>' +
      '<section class="card"><h3>' + T('Ultime 5 settimane', 'Last 5 weeks') + '</h3>' +
        '<div class="uso-cal"><span>L</span><span>M</span><span>M</span><span>G</span><span>V</span><span>S</span><span>D</span>' + celle + '</div>' +
        '<p class="uso-leg"><span>' + T('meno', 'less') + '</span><i class="uc l1"></i><i class="uc l2"></i><i class="uc l3"></i><i class="uc l4"></i><span>' + T('più minuti', 'more minutes') + '</span></p></section>' +
      '<section class="card"><h3>' + T('Quando la usa', 'When they use it') + '</h3>' +
        (tot ? '<p class="sub">' + fascia + '</p><div class="uso-ore">' + barre + '</div><div class="uso-ore-x"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>'
          : '<p class="sub">' + T('Nessun utilizzo registrato negli ultimi 30 giorni.', 'No usage in the last 30 days.') + '</p>') + '</section>' +
      (allen ? '<section class="card"><h3>' + T('Allenamento · 4 settimane', 'Training · 4 weeks') + '</h3>' + allen + '</section>' : '') +
      '<p class="uso-nota">' + T('Dal 8 nov 2026 · solo giorni e minuti con l’app aperta, mai cosa guarda.', 'Since 8 Nov 2026 · only days and minutes with the app open, never what they look at.') + '</p>';
    mostraSheet(T('Utilizzo', 'Usage'), html);
  }

  // dopo un'azione si ricarica il pannello aperto (amministrazione o profilo)
  const riapri = () => (location.hash === '#admin' ? apriAdmin() : apriAccount());

  // Anteprima del piano (guida passo passo nel tab Piano)
  const NOMI_TIPO_UI = () => ({ 'corsa-cammino': 'CC', facile: 'F', lungo: 'L', qualita: 'Q', recupero: 'R', gara: '🏁' });
  function htmlAnteprima(a, nota) {
    const fr = a.frequenza || {};
    const sigle = NOMI_TIPO_UI();
    const sett = a.prossime && a.prossime[0] ? a.prossime[0].settimana : a.settimana_piano;
    return '<h4>' + T('Il tuo piano diventa', 'Your plan becomes') + '</h4>' +
      '<div class="ap-kv">' +
        '<div><b>' + a.settimana_piano + '<small>/' + a.settimane_totali + '</small></b><span>' + T('settimana', 'week') + ' · ' + esc(a.fase) + '</span></div>' +
        '<div><b>' + (fr.attuale || 3) + (fr.massima > (fr.attuale || 3) && fr.modo !== 'fissi' ? '<small>→' + fr.massima + '</small>' : '') + '</b><span>' + T('sedute a settimana', 'sessions a week') + '</span></div>' +
        (() => { const dg = a.data_stimata || a.data_gara; const altroAnno = dg.slice(0, 4) !== String(new Date().getFullYear()); return '<div><b>' + esc(fmtData(dg)) + (altroAnno ? '<small>' + dg.slice(0, 4) + '</small>' : '') + '</b><span>' + T('gara se tutto fila', 'race if all goes well') + '</span></div>'; })() +
      '</div>' +
      (a.prossime && a.prossime.length ? '<p class="ap-sett">' + T('Settimana ' + sett + ' del piano', 'Plan week ' + sett) + '</p><ul class="ap-sed">' + a.prossime.map((x) =>
        '<li><b>S' + x.seduta + '</b><span class="sig">' + (sigle[x.tipo] || '') + '</span><span class="ap-nome">' + esc(x.nome) + (x.extra ? T(' · in più', ' · extra') : '') + '</span><span class="ap-d">' + esc(fmtData(x.data)) + '</span></li>').join('') + '</ul>' : '') +
      (fr.consigli && fr.consigli.length ? '<ul class="ap-cons">' + fr.consigli.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>' : '') +
      (nota ? '<p class="sub">' + nota + '</p>' : '');
  }

  /* ---- Guida passo passo nel tab Piano: obiettivo, intensita', giorni, poi il coach propone ---- */
  let guida = null;
  const DESC_OB = () => ({
    '5k': T('Il primo traguardo: ideale se parti da zero o torni a correre.', 'The first milestone: ideal if you start from zero or are getting back into running.'),
    '10k': T('Il passo dopo i 5 km: più resistenza, una seduta di ritmo a settimana.', 'The step after 5K: more endurance, one tempo session a week.'),
    mezza: T('21 km: serve costanza, il lungo cresce piano ogni settimana.', '21 km: it takes consistency, the long run grows slowly every week.'),
    maratona: T('42 km: consigliata se corri già da almeno 6 mesi con regolarità.', '42 km: recommended if you have been running regularly for at least 6 months.'),
  });
  const DESC_INT = () => ({
    tranquilla: T('Volumi un po’ più bassi. Per chi inizia, ha poco tempo o rientra da uno stop.', 'Slightly lower volume. For beginners, busy weeks or a comeback.'),
    equilibrata: T('Il piano così com’è. La scelta giusta per la maggior parte delle persone.', 'The plan as designed. The right choice for most people.'),
    ambiziosa: T('Volumi più alti e prima la 4ª seduta. Per chi corre già e recupera bene.', 'Higher volume and the 4th session sooner. For runners who already train and recover well.'),
  });
  function riepilogoGuida(pr) {
    const ob = OBIETTIVI_UI.find((o) => o[0] === (pr.obiettivo || 'mezza')) || OBIETTIVI_UI[2];
    const it = INTENSITA_UI().find((o) => o[0] === (pr.intensita || 'equilibrata')) || INTENSITA_UI()[1];
    return { ob: LANG === 'en' ? ob[2] : ob[1], it: LANG === 'en' ? it[2] : it[1], settimane: ob[3] };
  }
  // riepilogo del piano senza emoji: obiettivo grande, intensita', settimana dei giorni
  // riepilogo essenziale: obiettivo e intensita' (i giorni si vedono e si decidono dentro la guida)
  function htmlRiepilogoPiano(pr) {
    const r = riepilogoGuida(pr);
    return '<div class="gc-ob"><b>' + esc(r.ob) + '</b><span>' + esc(r.it) + ' · ' + r.settimane + T(' settimane', ' weeks') + '</span></div>';
  }
  const FRECCIA = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  function renderGuidaCard() {
    if (!ME || !ME.profilo) return '';
    if (guida) return '<section class="card guida-card guida-aperta" id="guida-box">' + htmlGuida() + '</section>';
    const p = ultimiDati && ultimiDati.programma;
    const sett = p && p.settimana_piano, tot = p && p.totale_settimane;
    return '<section class="card guida-card" id="guida-box"><p class="gc-eyebrow">' + T('Il tuo piano', 'Your plan') + '</p>' + htmlRiepilogoPiano(ME.profilo) +
      (sett && tot ? '<div class="gc-prog"><div class="gc-lab"><span>' + T('Avanzamento', 'Progress') + '</span><span>' + T('Settimana ', 'Week ') + sett + T(' di ', ' of ') + tot + '</span></div><div class="gc-bar"><i style="width:' + Math.max(3, Math.round((sett / tot) * 100)) + '%"></i></div></div>' : '') +
      '<button type="button" class="gc-cta" data-guida-apri><span>' + T('Rivedi il piano con il coach', 'Review the plan with the coach') + '</span>' + FRECCIA + '</button></section>';
  }
  function apriGuida() {
    if (!ME || !ME.profilo) return;
    const pr = ME.profilo;
    const oggiS = (ultimiDati && ultimiDati.oggi) || new Date().toLocaleDateString('sv-SE');
    const libero = !pr.programma_inizio || pr.programma_inizio > oggiS; // piano non ancora iniziato: si sceglie la prima seduta
    guida = { passo: 1, obiettivo: pr.obiettivo || 'mezza', intensita: pr.intensita || 'equilibrata', giorni: new Set(pr.giorni_sedute || []), modo: pr.giorni_modo || 'preferiti', anteprima: null, req: 0,
      oggi: oggiS, inizioLibero: libero, inizio: pr.programma_inizio || null, inizioManuale: Boolean(pr.programma_inizio) };
    if (libero && !guida.inizio) guida.inizio = primoGiornoUtile(guida);
    ridisegnaGuida();
  }
  // primo giorno utile da oggi: oggi, oppure il primo dei giorni scelti
  function primoGiornoUtile(g) {
    let d = new Date(g.oggi + 'T12:00:00Z');
    for (let i = 0; i < 7 && g.giorni.size && !g.giorni.has(d.getUTCDay()); i++) d = new Date(d.getTime() + 864e5);
    return d.toISOString().slice(0, 10);
  }
  function ridisegnaGuida() {
    const box = $('#guida-box');
    if (box) { box.outerHTML = renderGuidaCard(); const n = $('#guida-box'); if (n && guida) n.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
  }
  function htmlGuida() {
    const g = guida, P = 4;
    const bolla = (t) => '<div class="gd-coach"><span class="gd-av" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-5 4 10 2-5h6"/></svg></span><p>' + t + '</p></div>';
    const passi = '<ol class="gd-passi" aria-label="' + T('Passi', 'Steps') + '">' + [T('Obiettivo', 'Goal'), T('Intensità', 'Intensity'), T('Giorni', 'Days'), T('Piano', 'Plan')].map((x, i) =>
      '<li class="' + (i + 1 < g.passo ? 'fatto' : i + 1 === g.passo ? 'ora' : '') + '"' + (i + 1 === g.passo ? ' aria-current="step"' : '') + '><button type="button" data-guida-passo="' + (i + 1) + '"' + (i + 1 > g.passo ? ' disabled' : '') + '><i>' + (i + 1) + '</i>' + x + '</button></li>').join('') + '</ol>';
    const scelta = (nome, v, on, tit, sotto, extra) => '<label class="gd-opz' + (on ? ' on' : '') + '"><input type="radio" name="' + nome + '" value="' + v + '"' + (on ? ' checked' : '') + '><span><b>' + tit + (extra ? '<small>' + extra + '</small>' : '') + '</b><small>' + sotto + '</small></span></label>';
    let corpo = '';
    if (g.passo === 1) {
      const d = DESC_OB();
      corpo = bolla(T('Partiamo dalla meta. <b>Dove vuoi arrivare?</b> Se cambi obiettivo a piano iniziato, riparti dalla stessa fase del nuovo piano: le corse fatte restano.', 'Let’s start with the destination. <b>Where do you want to get to?</b> If you change goal mid-plan you continue at the same phase of the new plan: your runs stay.')) +
        '<div class="gd-opzioni" role="radiogroup">' + OBIETTIVI_UI.map((o) => scelta('gd-ob', o[0], g.obiettivo === o[0], LANG === 'en' ? o[2] : o[1], d[o[0]], o[3] + T(' sett.', ' wks'))).join('') + '</div>';
    } else if (g.passo === 2) {
      const d = DESC_INT();
      const it = ultimiDati && ultimiDati.programma && ultimiDati.programma.intensita;
      corpo = bolla(T('<b>Quanto vuoi spingere?</b> Non preoccuparti di sbagliare: ogni 3 settimane guardo come rispondi e ritocco io l’intensità di ±10%.', '<b>How hard do you want to push?</b> Don’t worry about getting it wrong: every 3 weeks I look at how you respond and adjust the intensity by ±10% myself.')) +
        '<div class="gd-opzioni" role="radiogroup">' + INTENSITA_UI().map((o) => scelta('gd-int', o[0], g.intensita === o[0], LANG === 'en' ? o[2] : o[1], d[o[0]], o[3])).join('') + '</div>' +
        (it ? '<p class="gd-nota">' + T('Adesso: ', 'Now: ') + '<b>' + esc(it.nome) + (it.percentuale ? ' · ' + (it.percentuale > 0 ? '+' : '') + it.percentuale + '%' : '') + '</b>' + (it.ultima_modifica ? ' · ' + esc(it.ultima_modifica.motivo) : '') + '</p>' : '');
    } else if (g.passo === 3) {
      const nomi = LANG === 'en' ? ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] : ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
      const lunghi = LANG === 'en' ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] : ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
      corpo = bolla(T('<b>Quando puoi correre?</b> Scegli i giorni e dimmi se sono una preferenza o un vincolo. Se un giorno non va bene te lo dico, ma ci proviamo comunque.', '<b>When can you run?</b> Pick the days and tell me whether they are a preference or a must. If something isn’t ideal I’ll tell you, but we’ll give it a go anyway.')) +
        '<div class="gd-opzioni gd-due" role="radiogroup">' +
          scelta('gd-modo', 'preferiti', g.modo !== 'fissi', T('Proposti', 'Suggested'), T('Li uso quando posso; se serve ne scelgo altri e ti dico perché.', 'I use them when I can; if needed I pick others and tell you why.')) +
          scelta('gd-modo', 'fissi', g.modo === 'fissi', T('Obbligatori', 'Fixed'), T('Solo questi giorni. Con 1 giorno il piano si allunga, con 2 salto una corsa facile.', 'Only these days. With 1 day the plan gets longer, with 2 I skip an easy run.')) +
        '</div>' +
        '<div class="giorni-pick gd-giorni">' + [1, 2, 3, 4, 5, 6, 0].map((x, i) => '<label title="' + lunghi[i] + '"><input type="checkbox" name="gd-giorno" value="' + x + '"' + (g.giorni.has(x) ? ' checked' : '') + ' aria-label="' + lunghi[i] + '"><span>' + nomi[i] + '</span></label>').join('') + '</div>' +
        '<p class="gd-nota">' + T('Nessun giorno = decido io, con il lungo di preferenza nel weekend.', 'No days = I decide, with the long run preferably at the weekend.') + '</p>' +
        (g.inizioLibero ? '<label class="acc-f gd-inizio" for="gd-inizio"><span>' + T('Quando inizi?', 'When do you start?') + '</span><input id="gd-inizio" name="gd-inizio" type="date" min="' + esc(g.oggi) + '" value="' + esc(g.inizio || '') + '">' +
          '<small>' + T('Ti propongo il primo giorno utile; scegline un altro se preferisci.', 'I suggest the first suitable day; pick another if you prefer.') + '</small></label>' : '') +
        '<div id="gd-consigli" aria-live="polite">' + consigliGuidaHtml() + '</div>';
    } else {
      corpo = bolla(T('<b>Ecco cosa ti propongo.</b> Se ti convince confermalo; altrimenti torna indietro e cambia quello che vuoi.', '<b>Here is what I propose.</b> If you like it, confirm it; otherwise go back and change anything you want.')) +
        '<div id="gd-anteprima" class="acc-anteprima" aria-live="polite">' + (g.anteprima ? htmlAnteprima(g.anteprima) : '<div class="skeleton" style="height:120px"></div>') + '</div>' +
        '<div class="gd-poi"><h4>' + T('Poi ci penso io', 'Then I take care of it') + '</h4><ul>' +
          '<li>' + T('<b>Ogni giorno</b> guardo FC a riposo, HRV e sonno: se sei stanco la seduta si alleggerisce.', '<b>Every day</b> I check resting HR, HRV and sleep: if you are tired the session gets lighter.') + '</li>' +
          '<li>' + T('<b>Ogni settimana</b> decido se avanzare, ripetere o tornare indietro, e se aggiungere una seduta.', '<b>Every week</b> I decide whether to move on, repeat or step back, and whether to add a session.') + '</li>' +
          '<li>' + T('<b>Ogni 3 settimane</b> ritocco l’intensità in base a come rispondi.', '<b>Every 3 weeks</b> I fine-tune the intensity based on how you respond.') + '</li></ul></div>' +
        (ME.profilo && ME.profilo.ha_fonte ? '<details class="more gd-livello" id="gd-livello"><summary>' + T('Preferisci scegliere tu da quale settimana partire?', 'Prefer to choose which week to start from?') + '</summary><div id="gd-liv-box"><div class="skeleton" style="height:90px"></div></div></details>' : '') +
        '<p id="gd-err" class="acc-err" hidden></p>';
    }
    const nav = '<div class="gd-nav">' + (g.passo > 1 ? '<button type="button" class="pill-btn gd-ind" data-guida-vai="-1">' + T('Indietro', 'Back') + '</button>' : '<button type="button" class="pill-btn gd-ind" data-guida-chiudi>' + T('Annulla', 'Cancel') + '</button>') +
      (g.passo < P ? '<button type="button" class="btn-primary" data-guida-vai="1">' + T('Avanti', 'Next') + '</button>'
        : '<button type="button" class="btn-primary" data-guida-conferma' + (ME.demo ? ' disabled' : '') + '>' + (ME.demo ? T('In demo non si salva', 'Not saved in the demo') : T('Conferma il piano', 'Confirm the plan')) + '</button>') + '</div>';
    return '<div class="gd-wiz">' + passi + corpo + nav + '</div>';
  }
  function consigliGuidaHtml() {
    const a = guida && guida.anteprima;
    const c = a && a.frequenza && a.frequenza.consigli;
    if (!c || !c.length) return guida && guida.giorni.size ? '<p class="gd-ok">' + T('Va bene così: con questi giorni il piano resta quello ideale.', 'All good: with these days the plan stays the ideal one.') + '</p>' : '';
    return '<ul class="ap-cons">' + c.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>';
  }
  async function caricaAnteprimaGuida() {
    const g = guida; if (!g) return;
    const n = ++g.req;
    const giorni = [...g.giorni].sort().join(',');
    let a;
    try { a = await caricaJson('/api/piano/anteprima?obiettivo=' + encodeURIComponent(g.obiettivo) + '&intensita=' + encodeURIComponent(g.intensita) + '&giorni=' + encodeURIComponent(giorni) + '&modo=' + encodeURIComponent(g.modo) + (g.inizioLibero && g.inizio ? '&inizio=' + encodeURIComponent(g.inizio) : '')); } catch (_) { a = null; }
    if (guida !== g || n !== g.req) return;
    g.anteprima = a;
    const box = $('#gd-anteprima'), cons = $('#gd-consigli');
    if (box) box.innerHTML = a ? htmlAnteprima(a) : '<p class="sub">' + T('Anteprima non disponibile: il piano si ricalcola quando confermi.', 'Preview not available: the plan is recalculated when you confirm.') + '</p>';
    if (cons) cons.innerHTML = consigliGuidaHtml();
  }
  document.addEventListener('change', (e) => {
    if (!guida || !e.target.closest('.gd-wiz')) return;
    const t = e.target;
    if (t.name === 'gd-ob') guida.obiettivo = t.value;
    else if (t.name === 'gd-int') guida.intensita = t.value;
    else if (t.name === 'gd-modo') guida.modo = t.value;
    else if (t.name === 'gd-giorno') {
      const v = Number(t.value); if (t.checked) guida.giorni.add(v); else guida.giorni.delete(v);
      if (guida.inizioLibero && !guida.inizioManuale) { guida.inizio = primoGiornoUtile(guida); const i = $('#gd-inizio'); if (i) i.value = guida.inizio; }
    }
    else if (t.name === 'gd-inizio') { if (!/^\d{4}-\d{2}-\d{2}$/.test(t.value)) return; guida.inizio = t.value; guida.inizioManuale = true; }
    else return;
    if (t.type === 'radio') t.closest('.gd-opzioni').querySelectorAll('.gd-opz').forEach((l) => l.classList.toggle('on', l.contains(t)));
    guida.anteprima = null;
    if (guida.passo === 3) caricaAnteprimaGuida();
  });
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-vai-piano]')) { vaiTab('piano'); return; }
    if (e.target.closest('[data-vai-info]')) {
      vaiTab('info');
      requestAnimationFrame(() => { const x = document.getElementById('info-come'); if (x) x.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); });
      return;
    }
    if (e.target.closest('[data-guida-apri]')) { apriGuida(); return; }
    if (!guida) return;
    if (e.target.closest('[data-guida-chiudi]')) { guida = null; ridisegnaGuida(); return; }
    const vai = e.target.closest('[data-guida-vai]'), salta = e.target.closest('[data-guida-passo]');
    if (vai || salta) {
      guida.passo = Math.max(1, Math.min(4, salta ? Number(salta.dataset.guidaPasso) : guida.passo + Number(vai.dataset.guidaVai)));
      ridisegnaGuida();
      if (guida.passo >= 3 && !guida.anteprima) caricaAnteprimaGuida();
      return;
    }
    const b = e.target.closest('[data-guida-conferma]');
    if (!b || ME.demo) return;
    b.disabled = true;
    const g = guida;
    const corpo = { obiettivo: g.obiettivo, intensita: g.intensita, giorni_sedute: [...g.giorni].sort().join(','), giorni_modo: g.giorni.size ? g.modo : 'preferiti', ...(g.inizioLibero && g.inizio ? { programma_inizio: g.inizio } : {}) };
    try {
      const { ok, out } = await inviaJson('PUT', '/api/profilo', corpo);
      if (!ok) { const err = $('#gd-err'); if (err) { err.textContent = T('Salvataggio non riuscito: riprova.', 'Could not save: please try again.'); err.hidden = false; } b.disabled = false; return; }
      ME = out; guida = null;
      toast(T('Piano confermato: eccolo', 'Plan confirmed: here it is'), 'ok');
      await caricaDati(true);
      vaiTab('piano');
      const box = $('#guida-box'); if (box) box.scrollIntoView({ block: 'start' });
    } catch (_) { b.disabled = false; }
  });

  /* ====================================================================== */
  /* App installabile e notifiche push                                      */
  /* ====================================================================== */
  const suIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installata = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushSupportato = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let swPronto = null;
  // Android e Chrome desktop: il browser offre l'installazione e noi la mostriamo con il nostro pulsante
  let promptInstalla = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    promptInstalla = e;
    if ($('#acc-notifiche')) riempiNotifiche();
  });
  window.addEventListener('appinstalled', () => { promptInstalla = null; if ($('#acc-notifiche')) riempiNotifiche(); toast(T('AAC è sulla schermata Home', 'AAC is on your Home Screen'), 'ok'); });
  async function installaOra() {
    if (!promptInstalla) return;
    const p = promptInstalla; promptInstalla = null;
    p.prompt();
    try { await p.userChoice; } catch (_) { /* annullato */ }
    if ($('#acc-notifiche')) riempiNotifiche();
  }
  function registraSW() {
    if (!('serviceWorker' in navigator) || swPronto) return swPronto;
    swPronto = navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).catch(() => null);
    return swPronto;
  }
  const b64uInBytes = (b) => { const p = '='.repeat((4 - (b.length % 4)) % 4); const r = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };

  // Notifiche attive di default: chi non le ha ancora attivate su questo dispositivo trova in Oggi il pulsante (un tocco).
  // Il permesso lo concede solo l'utente (regola di Apple e Google); se l'ha gia' concesso, l'iscrizione si rinnova da sola.
  const ntRimandata = () => { try { return Date.now() < (Number(localStorage.getItem('coach-notifiche-dopo')) || 0); } catch (_) { return false; } };
  function renderAttivaNotifiche() {
    if (!ME || ME.demo || ME.impersonato_da || !pushSupportato() || (suIOS() && !installata())) return '';
    if (Notification.permission !== 'default' || ntRimandata()) return '';
    return '<section class="avviso inst" id="nt-card"><div class="av-h">' + ICO.campana + '<h3>' + T('Attiva le notifiche', 'Turn on notifications') + '</h3></div>' +
      '<p>' + T('Ogni mattina la seduta del giorno e un avviso ogni volta che il coach cambia qualcosa, con il motivo. Puoi scegliere cosa ricevere nel profilo.', 'Your session every morning and an alert every time the coach changes something, with the reason. You can choose what to receive in your profile.') + '</p>' +
      '<button type="button" class="btn-primary inst-btn" id="nt-attiva">' + T('Attiva', 'Turn on') + '</button>' +
      '<button type="button" class="link-btn" id="nt-dopo">' + T('Più tardi', 'Later') + '</button></section>';
  }
  async function rinnovaIscrizione() {
    if (!ME || ME.demo || ME.impersonato_da || !pushSupportato() || Notification.permission !== 'granted') return;
    try {
      const reg = await registraSW();
      if (!reg || await reg.pushManager.getSubscription()) return;
      const st = await caricaJson('/api/push/stato');
      if (!st.disponibile) return;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uInBytes(st.chiave) });
      await inviaJson('POST', '/api/push/iscrizione', { iscrizione: sub.toJSON(), lingua: LANG });
    } catch (_) { /* si riprova alla prossima apertura */ }
  }

  async function iscrizioneAttuale() {
    if (!pushSupportato()) return null;
    const reg = await registraSW();
    return reg ? reg.pushManager.getSubscription() : null;
  }

  async function riempiNotifiche() {
    const box = $('#acc-notifiche');
    if (!box) return;
    if (!ME || ME.demo || ME.impersonato_da) { box.remove(); return; }
    const titolo = '<h3>🔔 ' + T('Notifiche', 'Notifications') + '</h3>';
    if (suIOS() && !installata()) {
      box.innerHTML = titolo + '<p class="sub">' + T('Su iPhone le notifiche arrivano quando AAC è sulla schermata Home: si apre come un’app e ti manda la seduta del mattino.', 'On iPhone notifications arrive when AAC is on your Home Screen: it opens like an app and sends you your morning session.') + '</p>' +
        '<ol class="nt-passi"><li>' + T('In Safari tocca <b>Condividi</b> ', 'In Safari tap <b>Share</b> ') + '<span class="inst-ico">' + ICO.share + '</span></li>' +
          '<li>' + T('Scegli <b>Aggiungi alla schermata Home</b> ', 'Choose <b>Add to Home Screen</b> ') + '<span class="inst-ico">＋</span></li>' +
          '<li>' + T('Apri AAC dall’icona, accedi e torna qui per attivare le notifiche', 'Open AAC from the icon, sign in and come back here to turn on notifications') + '</li></ol>';
      return;
    }
    if (!pushSupportato()) { box.innerHTML = titolo + '<p class="sub">' + T('Questo browser non supporta le notifiche.', 'This browser does not support notifications.') + '</p>'; return; }
    const installa = promptInstalla && !installata() ? '<button type="button" class="btn-mini nt-inst" id="nt-installa">' + ICO.share + T('Installa l’app sulla schermata Home', 'Install the app on your Home Screen') + '</button>' : '';
    let st;
    try { st = await caricaJson('/api/push/stato'); } catch (_) { box.remove(); return; }
    if (!st.disponibile) { box.remove(); return; }
    const sub = await iscrizioneAttuale();
    const negato = Notification.permission === 'denied';
    if (!sub) {
      box.innerHTML = titolo + '<p class="sub">' + T('Ogni mattina la seduta del giorno, un avviso ogni volta che il coach cambia qualcosa e la domenica sera il riepilogo della settimana.', 'Every morning your session for the day, an alert every time the coach changes something and on Sunday evening your weekly recap.') + '</p>' +
        (negato ? '<p class="nt-nota">' + T('Le notifiche sono bloccate: riattivale nelle impostazioni del telefono o del browser per questo sito.', 'Notifications are blocked: turn them back on in your phone or browser settings for this site.') + '</p>'
          : '<button type="button" class="btn-primary nt-attiva" id="nt-attiva">' + T('Attiva le notifiche', 'Turn on notifications') + '</button>') + installa;
      return;
    }
    const ore = []; for (let h = 5; h <= 11; h++) for (const m of ['00', '30']) ore.push(String(h).padStart(2, '0') + ':' + m);
    if (!ore.includes(st.ora)) ore.push(st.ora);
    box.innerHTML = titolo +
      '<label class="nt-riga"><span><b>' + T('Seduta del mattino', 'Morning session') + '</b><small>' + T('solo nei giorni con una seduta', 'only on days with a session') + '</small></span>' +
        '<select id="nt-ora" aria-label="' + T('Ora della notifica', 'Notification time') + '">' + ore.sort().map((o) => '<option' + (o === st.ora ? ' selected' : '') + '>' + o + '</option>').join('') + '</select>' +
        '<input type="checkbox" id="nt-mattina" class="nt-sw"' + (st.mattina ? ' checked' : '') + '></label>' +
      '<label class="nt-riga"><span><b>' + T('Avvisi del coach', 'Coach alerts') + '</b><small>' + T('ogni volta che il coach cambia qualcosa, con il motivo', 'every time the coach changes something, with the reason') + '</small></span>' +
        '<input type="checkbox" id="nt-avvisi" class="nt-sw"' + (st.avvisi !== false ? ' checked' : '') + '></label>' +
      '<label class="nt-riga"><span><b>' + T('Riepilogo della domenica', 'Sunday recap') + '</b><small>' + T('alle 19:00: com’è andata e la prossima seduta', 'at 7 pm: how it went and your next session') + '</small></span>' +
        '<input type="checkbox" id="nt-domenica" class="nt-sw"' + (st.domenica ? ' checked' : '') + '></label>' +
      '<div class="nt-az"><button type="button" class="btn-mini" id="nt-prova">' + T('Invia una prova', 'Send a test') + '</button>' +
        '<button type="button" class="link-btn" id="nt-spegni">' + T('Disattiva su questo dispositivo', 'Turn off on this device') + '</button></div>';
  }

  async function attivaNotifiche() {
    try {
      const st = await caricaJson('/api/push/stato');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast(T('Permesso non concesso', 'Permission not granted'), 'err'); riempiNotifiche(); return; }
      const reg = await registraSW();
      if (!reg) throw new Error('sw');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uInBytes(st.chiave) });
      const r = await inviaJson('POST', '/api/push/iscrizione', { iscrizione: sub.toJSON(), lingua: LANG });
      if (!r.ok) throw new Error(r.out.errore || '');
      toast(T('Notifiche attive', 'Notifications on'), 'ok');
    } catch (e) { toast(T('Non è stato possibile attivare le notifiche', 'Could not turn on notifications'), 'err'); }
    const card = $('#nt-card'); if (card) card.remove();
    riempiNotifiche();
  }
  async function salvaPreferenzeNotifiche() {
    const r = await inviaJson('PUT', '/api/push/preferenze', { mattina: $('#nt-mattina').checked, domenica: $('#nt-domenica').checked, avvisi: $('#nt-avvisi').checked, ora: $('#nt-ora').value });
    toast(r.ok ? T('Preferenze salvate', 'Preferences saved') : T('Valori non validi', 'Invalid values'), r.ok ? 'ok' : 'err');
  }
  document.addEventListener('click', async (e) => {
    if (e.target.closest('#nt-attiva')) { e.target.closest('#nt-attiva').disabled = true; attivaNotifiche(); return; }
    if (e.target.closest('#nt-prova')) {
      const r = await inviaJson('POST', '/api/push/prova');
      toast(r.ok ? T('Notifica di prova inviata', 'Test notification sent') : (r.out.errore || T('Invio non riuscito', 'Sending failed')), r.ok ? 'ok' : 'err');
      return;
    }
    if (e.target.closest('#nt-spegni')) {
      const sub = await iscrizioneAttuale();
      if (sub) { await inviaJson('DELETE', '/api/push/iscrizione', { endpoint: sub.endpoint }); await sub.unsubscribe().catch(() => {}); }
      toast(T('Notifiche disattivate su questo dispositivo', 'Notifications turned off on this device'), 'ok');
      riempiNotifiche();
      return;
    }
    if (e.target.closest('#nt-installa')) { installaOra(); return; }
    if (e.target.closest('#nt-dopo')) {
      try { localStorage.setItem('coach-notifiche-dopo', String(Date.now() + 14 * 864e5)); } catch (_) { /* solo comodità */ }
      const c = $('#nt-card'); if (c) c.remove();
      return;
    }
  });
  document.addEventListener('change', (e) => { if (e.target.closest('#nt-mattina, #nt-domenica, #nt-avvisi, #nt-ora')) salvaPreferenzeNotifiche(); });




  /* ---- Strava: guida, scollega ed esito del collegamento ---- */
  function apriGuidaStrava() {
    const sv = (ME && ME.profilo && ME.profilo.strava) || {};
    mostraSheet(T('Strava', 'Strava'), '<section class="collega">' +
      '<div class="in-flow"><span>⌚ ' + T('Orologio', 'Watch') + '</span><i></i><span>🟠 Strava</span><i></i><span>🏃 AAC</span></div>' +
      '<p class="cl-intro">' + T('Se il tuo orologio carica già le corse su Strava, è il modo <b>più veloce</b> per usare AAC: un tocco e le corse arrivano da sole, ogni 15 minuti.', 'If your watch already uploads runs to Strava, it’s the <b>quickest</b> way to use AAC: one tap and your runs arrive on their own, every 15 minutes.') + '</p>' +
      '<ol class="cl-passi">' +
        '<li>' + T('Nel profilo tocca <b>Connetti con Strava</b>.', 'In your profile tap <b>Connect with Strava</b>.') + '</li>' +
        '<li>' + T('Accedi a Strava e lascia la spunta su <b>“Visualizza dati sulle tue attività”</b>: è l’unico permesso che serve.', 'Sign in to Strava and keep <b>“View data about your activities”</b> ticked: it’s the only permission needed.') + '</li>' +
        '<li>' + T('Tocca <b>Autorizza</b>: torni in AAC e in pochi minuti arrivano le corse degli ultimi 12 mesi.', 'Tap <b>Authorize</b>: you’re back in AAC and within minutes your runs from the last 12 months arrive.') + '</li>' +
      '</ol>' +
      '<div class="cl-note"><h4>' + T('Da sapere', 'Good to know') + '</h4><ul>' +
        '<li>' + T('<b>Cosa arriva</b>: corse e altre attività, con mappa, cardio, passo, cadenza e dislivello.', '<b>What arrives</b>: runs and other activities, with map, heart rate, pace, cadence and elevation.') + '</li>' +
        '<li>' + T('<b>Cosa non arriva</b>: FC a riposo, HRV e sonno (Strava non li condivide). Per l’adattamento di ogni mattina e le zone personali collega anche Intervals.icu.', '<b>What doesn’t</b>: resting HR, HRV and sleep (Strava doesn’t share them). For the daily adaptation and personal zones also connect Intervals.icu.') + '</li>' +
        '<li>' + T('<b>Entrambe le fonti</b>: se la stessa corsa arriva da Strava e da Intervals, la teniamo una volta sola.', '<b>Both sources</b>: if the same run arrives from Strava and Intervals, we keep it only once.') + '</li>' +
        '<li>' + T('<b>Solo lettura</b>: AAC non pubblica nulla su Strava. Puoi scollegarlo quando vuoi dal profilo: le corse arrivate da Strava vengono cancellate da AAC.', '<b>Read only</b>: AAC never posts to Strava. You can disconnect it any time from your profile: runs that came from Strava are deleted from AAC.') + '</li>' +
      '</ul></div>' +
      (sv.disponibile && !sv.collegato && !(ME && ME.demo) ? '<a class="btn-strava cl-go" href="/api/strava/collega">' + T('Connetti con Strava', 'Connect with Strava') + '</a>' : '') +
      '<p class="powered-strava">Powered by Strava</p>' +
    '</section>');
  }
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('#strava-scollega')) return;
    if (!confirm(T('Scollegare Strava? Le corse arrivate da Strava verranno cancellate da AAC.', 'Disconnect Strava? Runs that came from Strava will be deleted from AAC.'))) return;
    const r = await inviaJson('POST', '/api/strava/scollega');
    toast(r.ok ? T('Strava scollegato', 'Strava disconnected') : T('Operazione non riuscita', 'Operation failed'), r.ok ? 'ok' : 'err');
    try { ME = await caricaJson('/api/me'); } catch (_) { /* resta il profilo di prima */ }
    await caricaDati(true);
    if (location.hash === '#account') apriAccount();
  });
  // ritorno dal collegamento con Strava (?strava=ok|annullato|permessi|errore)
  (() => {
    const q = new URLSearchParams(location.search), esito = q.get('strava');
    if (!esito) return;
    const msg = { ok: [T('Strava collegato: le tue corse arrivano tra pochi minuti', 'Strava connected: your runs arrive within minutes'), 'ok'],
      annullato: [T('Collegamento con Strava annullato', 'Strava connection cancelled'), 'err'],
      permessi: [T('Serve il permesso di leggere le attività: riprova e lascia la spunta', 'Permission to read activities is needed: try again and keep it ticked'), 'err'],
      errore: [T('Collegamento con Strava non riuscito: riprova', 'Strava connection failed: please try again'), 'err'] }[esito];
    if (msg) setTimeout(() => toast(msg[0], msg[1]), 600);
    history.replaceState(null, '', location.pathname + location.hash);
  })();

  /* ---- Cosa ha fatto il coach: lo storico di ogni intervento ---- */
  const leggiVisto = () => { try { return localStorage.getItem('coach-diario-visto') || ''; } catch (_) { return ''; } };
  function aggiornaPallinoDiario() {
    const b = $('#btn-diario');
    if (!b) return;
    b.hidden = !ME || Boolean(ME.demo);
    const bc = $('#btn-chat');
    if (bc) { bc.hidden = !ME; bc.title = T('Chiedi al coach', 'Ask the coach'); bc.setAttribute('aria-label', bc.title); }
    const ultimo = ultimiDati && ultimiDati.diario_ultimo;
    b.querySelector('.diario-dot').hidden = !ultimo || ultimo <= leggiVisto();
  }
  const ICO_DIARIO = { settimana: 'cal', alleggerita: 'wave', intensita: 'dati', frequenza: 'cal', zone: 'heart', carico: 'flame', notifica: 'campana', corsa: 'spunta' };
  async function apriDiario() {
    mostraSheet(T('Cosa ha fatto il coach', 'What the coach did'), '<div class="skeleton" style="height:300px"></div>');
    let voci = [];
    try { voci = (await caricaJson('/api/diario')).voci; } catch (e) { mostraSheet(T('Cosa ha fatto il coach', 'What the coach did'), '<div class="card empty">' + esc(e.message) + '</div>'); return; }
    const visto = leggiVisto();
    let html = '<p class="dr-intro">' + T('Ogni volta che il coach cambia qualcosa, o ti scrive, lo trovi qui con il motivo.', 'Every time the coach changes something, or messages you, you find it here with the reason.') + '</p>';
    if (!voci.length) html += '<div class="card empty">' + T('Ancora nessun intervento: arriveranno con le prime settimane di allenamento.', 'No interventions yet: they will come with your first weeks of training.') + '</div>';
    let giorno = null;
    html += '<ol class="dr-lista">';
    for (const v of voci) {
      const g = v.quando.slice(0, 10);
      if (g !== giorno) { giorno = g; html += '<li class="dr-giorno">' + esc(fmtDataLunga(g)).replace(/^./, (x) => x.toUpperCase()) + '</li>'; }
      const ora = /T\d\d:\d\d/.test(v.quando) && !/T21:00:00$/.test(v.quando) ? new Date(v.quando).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' }) : '';
      html += '<li class="dr-voce t-' + esc(v.tipo) + (v.quando > visto ? ' nuova' : '') + '"><span class="dr-ico">' + (ICO[ICO_DIARIO[v.tipo]] || ICO.info) + '</span><div><b>' + esc(v.titolo) + '</b>' + (ora ? '<small>' + ora + '</small>' : '') + (v.testo ? '<p>' + esc(v.testo) + '</p>' : '') + '</div></li>';
    }
    html += '</ol>';
    mostraSheet(T('Cosa ha fatto il coach', 'What the coach did'), html);
    if (voci[0]) { try { localStorage.setItem('coach-diario-visto', voci[0].quando); } catch (_) { /* solo comodità */ } }
    aggiornaPallinoDiario();
  }

  /* ---- Chiedi al coach: chat a regole (il server sceglie l'argomento e risponde con i tuoi dati) ---- */
  const CHAT = { msg: [], sugg: [], attesa: false, tema: null };
  const bolla = (m) => m.da === 'io'
    ? '<div class="ch-m ch-io"><p>' + esc(m.testo) + '</p></div>'
    : '<div class="ch-m ch-coach"><span class="ch-av" aria-hidden="true">' + ICO.logo + '</span><div class="ch-b">' + m.testo.map((x) => '<p>' + esc(x) + '</p>').join('') + '</div></div>';
  function disegnaChat() {
    const log = $('#ch-log');
    if (!log) return;
    log.innerHTML = CHAT.msg.map(bolla).join('') + (CHAT.attesa ? '<div class="ch-m ch-coach"><span class="ch-av" aria-hidden="true">' + ICO.logo + '</span><div class="ch-b ch-dots" aria-label="' + T('Il coach sta scrivendo', 'The coach is typing') + '"><i></i><i></i><i></i></div></div>' : '');
    $('#ch-sugg').innerHTML = CHAT.attesa ? '' : CHAT.sugg.map((s) => '<button type="button" class="ch-chip" data-chat-tema="' + esc(s.tema) + '">' + esc(s.label) + '</button>').join('');
    const ultimo = log.lastElementChild;
    if (ultimo) ultimo.scrollIntoView({ block: 'end', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  async function chiediCoach(corpo, mio) {
    if (CHAT.attesa) return;
    if (mio) CHAT.msg.push({ da: 'io', testo: mio });
    CHAT.attesa = true; disegnaChat();
    let r;
    try { r = await inviaJson('POST', '/api/coach/chat', corpo); } catch (_) { r = { ok: false, out: {} }; }
    // una piccola pausa: la risposta arriva come da una persona, non a scatto
    await new Promise((ok) => setTimeout(ok, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450));
    CHAT.attesa = false;
    if (r.ok && r.out && Array.isArray(r.out.testo)) { CHAT.msg.push({ da: 'coach', testo: r.out.testo }); CHAT.sugg = r.out.suggerimenti || []; }
    else CHAT.msg.push({ da: 'coach', testo: [r.out && r.out.errore ? r.out.errore : T('Non riesco a risponderti ora: riprova tra poco.', 'I can’t answer right now: try again shortly.')] });
    if (CHAT.msg.length > 60) CHAT.msg.splice(0, CHAT.msg.length - 60);
    disegnaChat();
  }
  function apriChat() {
    mostraSheet(T('Chiedi al coach', 'Ask the coach'),
      '<div class="ch-wrap"><p class="ch-nota">' + T('Il coach risponde con le regole di AAC e i tuoi dati. Non sostituisce il parere di un medico.', 'The coach answers with AAC’s rules and your data. It doesn’t replace a doctor’s advice.') + '</p>' +
      '<div id="ch-log" class="ch-log" role="log" aria-live="polite"></div>' +
      '<div id="ch-sugg" class="ch-sugg"></div>' +
      '<form id="ch-form" class="ch-form" autocomplete="off"><input id="ch-in" type="text" maxlength="300" enterkeyhint="send" placeholder="' + T('Scrivi al coach…', 'Message the coach…') + '" aria-label="' + T('Messaggio al coach', 'Message to the coach') + '">' +
      '<button type="submit" class="ch-send" aria-label="' + T('Invia', 'Send') + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></form></div>');
    const tema = CHAT.tema; CHAT.tema = null;
    if (!CHAT.msg.length) chiediCoach({ tema: 'benvenuto' }).then(() => { if (tema) chiediCoach({ tema }, (CHAT.sugg.find((s) => s.tema === tema) || {}).label || null); });
    else { disegnaChat(); if (tema) chiediCoach({ tema }, null); }
  }
  $('#sheet-body').addEventListener('submit', (e) => {
    if (e.target.id !== 'ch-form') return;
    e.preventDefault();
    const inp = $('#ch-in'), t = inp.value.trim().slice(0, 300);
    if (!t || CHAT.attesa) return;
    inp.value = '';
    chiediCoach({ testo: t }, t);
  });
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-chat-tema]');
    if (c && $('#ch-log')) { chiediCoach({ tema: c.dataset.chatTema }, c.textContent); return; }
    const a = e.target.closest('[data-apri-chat]');
    if (a) { CHAT.tema = a.dataset.apriChat || null; apriSheet('#coach'); }
  });

  async function apriAccount() {
    { try { ME = await caricaJson('/api/me'); aggiornaAvatar(); } catch (e) { mostraSheet('Account', '<div class="card empty">' + esc(e.message) + '</div>'); return; } }
    mostraSheet(T('Account', 'Account'), renderAccount());
    riempiScarpeAccount();
    riempiNotifiche();
  }

  const inviaJson = async (metodo, url, corpo) => {
    const r = await fetch(conLang(url), { method: metodo, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'coach', Accept: 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
    const out = await r.json().catch(() => ({}));
    if (r.status === 401) { vaiAlLogin(); throw new Error(''); }
    return { ok: r.ok, out };
  };

  // Data di nascita nel profilo: l'eta' si aggiorna da sola e non si modifica a mano
  $('#sheet-body').addEventListener('input', (e) => {
    if (e.target.id !== 'acc-nascita') return;
    const eta = $('#acc-eta'); if (!eta) return;
    const v = e.target.value;
    eta.disabled = Boolean(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const [a, m, g] = v.split('-').map(Number), d = new Date();
      eta.value = d.getFullYear() - a - (d.getMonth() + 1 < m || (d.getMonth() + 1 === m && d.getDate() < g) ? 1 : 0);
    }
  });

  $('#sheet-body').addEventListener('submit', async (e) => {
    if (['acc-form', 'acc-int-form', 'acc-piano-form'].includes(e.target.id)) {
      e.preventDefault();
      const f = new FormData(e.target), corpo = {};
      for (const [k, v] of f.entries()) if (k !== 'giorni_sedute' && (String(v).trim() !== '' || ['athlete_id', 'eta', 'fc_max', 'altezza', 'peso', 'data_nascita'].includes(k))) corpo[k] = String(v).trim();
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      const err = e.target.querySelector('.acc-err'); err.hidden = true;
      try {
        const { ok, out } = await inviaJson('PUT', '/api/profilo', corpo);
        if (!ok) {
          const msg = { fc_max: T('FC max tra 140 e 220 bpm.', 'Max HR between 140 and 220 bpm.'), altezza: T('Altezza tra 100 e 230 cm.', 'Height between 100 and 230 cm.'), peso: T('Peso tra 30 e 250 kg.', 'Weight between 30 and 250 kg.'), intervals: T('Intervals.icu non accetta questa API key con questo Athlete ID: ricontrollali.', 'Intervals.icu rejects this API key with this Athlete ID: please check them.'), athlete_id: T('Athlete ID non valido (es. i123456).', 'Invalid Athlete ID (e.g. i123456).'), intervals_key: T('API key non valida.', 'Invalid API key.'), eta: T('Età non valida.', 'Invalid age.'), data_nascita: T('Data di nascita non valida (età tra 14 e 90 anni).', 'Invalid date of birth (age between 14 and 90).'), programma_inizio: T('Data non valida.', 'Invalid date.'), programma_ora: T('Orario non valido.', 'Invalid time.'), giorni_sedute: T('Giorni preferiti non validi.', 'Invalid preferred days.'), giorni_modo: T('Scegli Proposti o Obbligatori.', 'Choose Suggested or Fixed.') };
          err.textContent = (out.errori || []).map((x) => msg[x] || x).join(' ') || T('Salvataggio non riuscito.', 'Could not save.');
          err.hidden = false;
          return;
        }
        ME = out;
        toast(T('Profilo salvato', 'Profile saved'), 'ok');
        await caricaDati(true);
        if (ME.profilo.ha_fonte && e.target.id === 'acc-int-form') sincronizza();
        if (chiediInizio()) return;
        apriAccount();
      } catch (_) { /* gestito */ } finally { btn.disabled = false; }
    } else if (e.target.id === 'acc-invita') {
      e.preventDefault();
      const email = new FormData(e.target).get('email');
      const { ok } = await inviaJson('POST', '/api/admin/utenti', { email });
      toast(ok ? T('Invito aggiunto: ', 'Invitation added: ') + email : T('Email non valida', 'Invalid email'), ok ? 'ok' : 'err');
      if (ok) riapri();
    }
  });
  $('#sheet-body').addEventListener('click', async (e) => {
    const a = e.target.closest('[data-acc]');
    if (a) {
      const id = a.dataset.id, az = a.dataset.acc;
      if (az === 'impersona') { await inviaJson('POST', '/api/admin/impersona/' + id); location.href = '/'; return; }
      if (az === 'rimuovi' && !confirm(T('Rimuovere questo utente e tutti i suoi dati (corse, salute, impostazioni)? Non si può annullare.', 'Remove this user and all their data (runs, health, settings)? This cannot be undone.'))) return;
      await (az === 'rimuovi' ? inviaJson('DELETE', '/api/admin/utenti/' + id) : inviaJson('POST', '/api/admin/utenti/' + id + '/stato', { stato: az }));
      riapri();
      return;
    }
    if (e.target.closest('#acc-esci')) {
      await inviaJson('POST', '/auth/logout').catch(() => {});
      vaiAlLogin();
    }
  });

  /* ---------------------------- Seduta ---------------------------------- */
  // Tratti continui di corsa / camminata dalla serie campionata
  function tratti(s) {
    const out = [];
    for (let i = 0; i < s.t.length; i++) {
      const c = s.c[i], t0 = s.t[i], t1 = i + 1 < s.t.length ? s.t[i + 1] : t0 + s.passo;
      const last = out[out.length - 1];
      if (last && last.c === c) { last.fine = t1; last.idx.push(i); }
      else out.push({ c, inizio: t0, fine: t1, idx: [i] });
    }
    // fonde i micro-tratti (< 20 s) con il precedente
    const puliti = [];
    out.forEach((x) => {
      const p = puliti[puliti.length - 1];
      if (p && (x.fine - x.inizio < 20 || p.c === x.c)) { p.fine = x.fine; p.idx = p.idx.concat(x.idx); }
      else puliti.push({ ...x });
    });
    return puliti;
  }

  function analisiTratti(s, giri) {
    const tr = tratti(s);
    const giriCorsa = (giri || []).filter((g) => g.corsa);
    const corse = tr.filter((x) => x.c === 1 && x.fine - x.inizio >= 30);
    if (!corse.length) return null;
    const mediaDi = (idx, arr) => { const v = idx.map((i) => arr && arr[i]).filter((x) => x != null && x > 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const righe = corse.map((x, k) => {
      const dur = x.fine - x.inizio;
      const dist = (s.d[x.idx[x.idx.length - 1]] - s.d[x.idx[0]]) * 1000;
      const hrFine = s.hr ? s.hr[x.idx[x.idx.length - 1]] : null;
      // recupero: quanto scende la FC nel primo minuto di camminata dopo il tratto
      const j = tr.indexOf(x);
      const dopo = tr[j + 1];
      let recupero = null;
      if (s.hr && dopo && dopo.c === 0 && dopo.fine - dopo.inizio >= 45) {
        const iMin = dopo.idx.find((i) => s.t[i] - dopo.inizio >= 55) ?? dopo.idx[dopo.idx.length - 1];
        if (hrFine && s.hr[iMin]) recupero = hrFine - s.hr[iMin];
      }
      // con i giri dell'orologio i valori del tratto sono quelli esatti del giro
      const g = giriCorsa.length === corse.length ? giriCorsa[k] : null;
      if (g) return { n: k + 1, dur: g.dur, passo: g.d > 0.03 ? g.dur / g.d : null, fc: g.hr, fcMax: g.hr_max, cad: g.cad, recupero };
      return { n: k + 1, dur, passo: dist > 30 ? dur / (dist / 1000) : null, fc: mediaDi(x.idx, s.hr), fcMax: s.hr ? Math.max(...x.idx.map((i) => s.hr[i] || 0)) : null, recupero };
    });
    return { tr, righe, daGiri: !!giriCorsa.length && giriCorsa.length === corse.length };
  }

  function kmDaSerie(s) {
    const out = [];
    let k = 1, i0 = 0;
    for (let i = 0; i < s.d.length; i++) {
      if (s.d[i] >= k) {
        const idx = []; for (let j = i0; j <= i; j++) idx.push(j);
        const hr = s.hr ? idx.map((j) => s.hr[j]).filter((x) => x > 0) : [];
        const corsa = idx.filter((j) => s.c[j]).length / idx.length;
        out.push({ km: k, sec: s.t[i] - s.t[i0], fc: hr.length ? hr.reduce((a, b) => a + b, 0) / hr.length : null, corsa });
        i0 = i; k++;
      }
    }
    const resto = s.d[s.d.length - 1] - (k - 1);
    if (resto >= 0.2) {
      const sec = s.t[s.t.length - 1] - s.t[i0];
      out.push({ km: k - 1 + resto, sec, parziale: true, passo: sec / resto });
    }
    return out;
  }

  // Il parere del coach sulla corsa (regole del motore, calcolate dal server)
  function parereCoach(pc) {
    if (!pc || !pc.punti) return '';
    const ico = { ok: '✓', warn: '!', info: '•' };
    return '<section class="card pc-card pc-' + esc(pc.tono) + '"><div class="pc-h"><span class="pc-av">' + ICO.logo + '</span><div><small>' + T('Il parere del coach', 'Coach’s take') + '</small><h3>' + esc(pc.titolo) + '</h3></div></div>' +
      '<ul class="pc-list">' + pc.punti.map((x) => '<li class="pc-' + esc(x.tono) + '"><i aria-hidden="true">' + (ico[x.tono] || '•') + '</i><p>' + esc(x.testo) + '</p></li>').join('') + '</ul>' +
      (pc.consiglio ? '<div class="pc-tip"><b>' + T('Il consiglio del coach', 'Coach’s tip') + '</b><p>' + esc(pc.consiglio) + '</p></div>' : '') +
      (pc.chiusa ? '<p class="pc-chiusa">' + esc(pc.chiusa) + '</p>' : '') +
      '<button type="button" class="pc-chat" data-apri-chat>' + T('Chiedi al coach ›', 'Ask the coach ›') + '</button>' +
    '</section>';
  }

  async function apriSeduta(id) {
    mostraSheet(T('Allenamento', 'Workout'), '<div class="skeleton" style="height:180px"></div><div class="skeleton" style="height:260px"></div>');
    let a;
    try { a = await caricaJson('/api/attivita/' + encodeURIComponent(id)); }
    catch (e) { mostraSheet(T('Allenamento', 'Workout'), '<div class="card empty">' + esc(e.message) + '</div>'); return; }
    if (!SCARPE.length) await caricaScarpe();
    const c = a.corsa, s = a.serie, pr = a.prevista, cf = a.confronto;
    if (pr) { const n = String(pr.fc_target || '').match(/\d+/g); pr.lim = n ? Math.max(...n.map(Number)) : null; }
    const z = a.zone.find((x) => x.z === c.zona);
    const at = s ? analisiTratti(s, a.giri) : null;

    // ---- intestazione e numeri principali ----
    // ---- copertina: mappa, titolo e tre numeri chiave ----
    const cadCorsa = (() => {
      const gc = (a.giri || []).filter((g) => g.corsa && g.cad);
      return gc.length ? gc.reduce((t, g) => t + g.cad * g.dur, 0) / gc.reduce((t, g) => t + g.dur, 0) : null;
    })();
    const pwCorsa = (() => {
      if (!s || !s.pw) return null;
      const v = s.pw.map((p, i) => (s.c[i] && p ? p : null)).filter(Boolean);
      return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
    })();
    const u = (x) => ' <small>' + x + '</small>';
    const tile = (l, v, n) => (v == null ? '' : '<div class="dd-t"><span>' + l + '</span><b>' + v + '</b>' + (n ? '<small>' + n + '</small>' : '') + '</div>');
    const gruppo = (cat, ico, titolo, tiles) => { const t = tiles.join(''); return t ? '<section class="dd-g cat-' + cat + '"><h4><i>' + ico + '</i>' + titolo + '</h4><div class="dd-g-grid">' + t + '</div></section>' : ''; };
    const kpi = [
      [T('Distanza', 'Distance'), fmt1(c.distanza), 'km'],
      [T('Durata', 'Time'), fmtDurata(c.tempo), ''],
      c.passo_corsa ? [T('Passo di corsa', 'Running pace'), fmtPasso(c.passo_corsa), '/km'] : [T('Passo medio', 'Avg pace'), fmtPasso(c.passo_medio), '/km'],
    ];
    let html = '<section class="dd-hero">' +
      (s && s.lat ? '<div class="dd-map-wrap"><div id="dd-map" class="dd-map"></div><div class="dd-map-leg"><span><i class="run"></i>' + T('Corsa', 'Run') + '</span><span><i class="walk"></i>' + T('Camminata', 'Walk') + '</span></div></div>' : '') +
      '<div class="dd-hero-body">' +
        '<span class="dd-chip">' + esc(pr ? pr.titolo : (c.tipo || 'Run')) + '</span>' +
        '<h1>' + esc(c.nome || T('Corsa', 'Run')) + '</h1>' +
        '<p>' + esc(fmtDataLunga(c.data)).replace(/^./, (x) => x.toUpperCase()) + (c.ora_inizio ? T(' · ore ', ' · at ') + esc(c.ora_inizio) : '') + '</p>' +
        (c.meteo ? '<p class="dd-meteo">' + meteoLungo(c.meteo) + '</p>' : '') +
        ((SCARPE.length || c.scarpa_id) ? '<label class="dd-scarpa"><span>👟</span><select data-scarpa-att="' + esc(c.id) + '"' + (ME && ME.demo ? ' disabled' : '') + '>' +
          '<option value="">' + T('Nessuna scarpa', 'No shoe') + '</option>' +
          SCARPE.filter((x) => x.attiva || x.id === c.scarpa_id).map((x) => '<option value="' + x.id + '"' + (x.id === c.scarpa_id ? ' selected' : '') + '>' + esc(x.nome) + '</option>').join('') +
        '</select></label>' : (ME && !ME.demo ? '<button type="button" class="dd-scarpa-add" data-apri-account="1">👟 ' + T('Aggiungi le tue scarpe', 'Add your shoes') + '</button>' : '')) +
        '<div class="dd-kpi">' + kpi.map(([l, v, un]) => '<div><b>' + v + (un ? '<small>' + un + '</small>' : '') + '</b><span>' + l + '</span></div>').join('') + '</div>' +
        (puoCondividere() ? '<button type="button" class="dd-share" data-condividi="' + esc(c.id) + '">' + ICO.share + '<span>' + T('Condividi la corsa', 'Share this run') + '</span></button>' : '') +
      '</div></section>' +
      parereCoach(a.parere) +
      '<div class="dd-groups">' +
        gruppo('cuore', ICO.heart, T('Cuore', 'Heart'), [
          tile(T('FC media', 'Avg HR'), c.fc_media ? fmt0(c.fc_media) + u('bpm') : null, z ? z.z + ' · ' + z.nome : ''),
          tile(T('FC max', 'Max HR'), c.fc_max ? fmt0(c.fc_max) + u('bpm') : null, c.fc_max ? (c.fc_max > a.fc_max_teorica ? '⚠️ ' + T('sopra la FC di sicurezza', 'above your safety HR') : Math.round(c.fc_max / a.fc_max_teorica * 100) + T('% della FC max', '% of max HR')) : ''),
          tile(T('FC in corsa', 'Running HR'), c.fc_corsa ? fmt0(c.fc_corsa) + u('bpm') : null, T('media dei tratti corsi', 'running parts only')),
          tile(T('Efficienza', 'Efficiency'), c.efficiency_factor ? fmt0(c.efficiency_factor * 1000) : null, T('velocità per battito', 'speed per heartbeat')),
          tile(T('Recupero FC', 'HR recovery'), c.fc_recupero ? '−' + fmt0(c.fc_recupero) + u('bpm') : null, T('nel minuto dopo il picco', 'in the minute after the peak')),
        ]) +
        gruppo('ritmo', ICO.wave, T('Ritmo', 'Pace'), [
          tile(T('Passo medio', 'Avg pace'), fmtPasso(c.passo_medio) + u('/km'), c.passo_corsa ? T('camminata compresa', 'walking included') : ''),
          tile(T('Tempo di corsa', 'Running time'), c.tempo_corsa ? fmtDurata(c.tempo_corsa) : null, c.distanza_corsa ? fmt1(c.distanza_corsa) + T(' km corsi', ' km run') : ''),
          cadCorsa ? tile(T('Cadenza di corsa', 'Running cadence'), fmt0(cadCorsa) + u(T('ppm', 'spm')), T('ideale 165–180', 'ideal 165–180'))
            : tile(T('Cadenza', 'Cadence'), c.cadenza ? fmt0(c.cadenza) + u(T('ppm', 'spm')) : null, T('ideale 165–180', 'ideal 165–180')),
          tile(T('Dislivello', 'Elevation'), c.dislivello != null ? fmt0(c.dislivello) + u('m') : null,
            c.passo_gap && c.dislivello >= 20 ? T('in piano ≈ ', 'flat ≈ ') + fmtPasso(c.passo_gap) + '/km' : ''),
        ]) +
        gruppo('forma', ICO.steps, T('Forma di corsa', 'Running form'), [
          tile(T('Lunghezza passo', 'Stride length'), c.lung_passo ? c.lung_passo.toLocaleString(LOC, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + u('m') : null),
          tile(T('Contatto col suolo', 'Ground contact'), c.contatto ? fmt0(c.contatto) + u('ms') : null, T('più basso = più reattivo', 'lower = snappier')),
          tile(T('Oscillazione', 'Vertical osc.'), c.oscillazione ? fmt1(c.oscillazione) + u('cm') : null, T('più bassa = meno rimbalzo', 'lower = less bounce')),
          tile(T('Rapporto verticale', 'Vertical ratio'), c.rapporto_verticale ? fmt1(c.rapporto_verticale) + u('%') : null, T('rimbalzo per passo · sotto 8% = ottimo', 'bounce per stride · below 8% = great')),
          tile(T('Potenza', 'Power'), pwCorsa ? fmt0(pwCorsa) + u('W') : null, T('nei tratti corsi', 'while running')),
        ]) +
        gruppo('attivita', ICO.flame, T('Sforzo', 'Effort'), [
          tile(T('Calorie', 'Calories'), c.calorie ? fmt0(c.calorie) + u('kcal') : null),
          tile(T('Carico', 'Load'), c.carico != null ? fmt0(c.carico) : null, T('impegno complessivo', 'overall strain')),
          tile(T('Sforzo percepito', 'Perceived effort'), c.rpe ? fmt0(c.rpe) + u('/10') : null, c.rpe ? (c.rpe <= 3 ? T('facile', 'easy') : c.rpe <= 6 ? T('moderato', 'moderate') : T('duro', 'hard')) : ''),
          tile(T('Deriva cardiaca', 'Decoupling'), c.decoupling != null ? fmt1(c.decoupling) + u('%') : null, T('sotto 5% = ottimo', 'below 5% = great')),
        ]) +
      '</div>';

    // ---- rispetto al piano ----
    if (pr) {
      const sopra = s && s.hr && pr.lim ? (() => { let n = 0, tot = 0; s.hr.forEach((h, i) => { if (s.c[i] && h) { tot++; if (h > pr.lim) n++; } }); return tot ? n / tot * 100 : null; })() : null;
      const durFatta = c.tempo / 60, corsaFatta = c.tempo_corsa ? c.tempo_corsa / 60 : null;
      const riga = (l, prev, fatto, nota) => '<div class="dd-row"><span>' + l + '</span><span class="dd-prev">' + prev + '</span><b>' + fatto + '</b>' + (nota ? '<em>' + nota + '</em>' : '') + '</div>';
      html += '<section class="card"><h3>' + T('Rispetto al piano', 'Versus the plan') + '</h3><p class="sub">' + esc(pr.blocchi) + '</p>' +
        '<div class="dd-rows"><div class="dd-row dd-row-h"><span></span><span class="dd-prev">' + T('Previsto', 'Planned') + '</span><b>' + T('Fatto', 'Done') + '</b></div>' +
        riga(T('Durata', 'Duration'), pr.durata_min + '′', Math.round(durFatta) + '′') +
        (pr.corsa_min ? riga(T('Di corsa', 'Running'), pr.corsa_min + '′', corsaFatta != null ? Math.round(corsaFatta) + '′' : '–') : '') +
        (pr.lim ? riga(T('FC massima', 'HR cap'), '< ' + pr.lim, c.fc_corsa || c.fc_media ? fmt0(c.fc_corsa || c.fc_media) + (c.fc_corsa ? T(' in corsa', ' running') : T(' media', ' avg')) : '–') : '') +
        '</div>' +
        (sopra != null ? '<p class="dd-verdict ' + (sopra <= 15 ? 'ok' : sopra <= 40 ? 'warn' : 'bad') + '">' +
          (sopra <= 15 ? T('Ottimo: sei rimasto sotto il limite di FC per il ', 'Great: you stayed under the HR cap for ') + Math.round(100 - sopra) + T('% del tempo di corsa.', '% of running time.')
            : T('Sopra il limite di FC per il ', 'Above the HR cap for ') + Math.round(sopra) + T('% del tempo di corsa: la prossima volta rallenta o cammina prima.', '% of running time: next time slow down or walk sooner.')) + '</p>' : '') +
      '</section>';
    }

    // ---- grafici nel tempo ----
    if (s) {
      const durata = s.t[s.t.length - 1] || 1;
      const strip = at ? '<div class="dd-strip">' + at.tr.map((x) => '<i class="' + (x.c ? 'run' : 'walk') + '" style="flex:' + (x.fine - x.inizio) + '" title="' + (x.c ? T('corsa', 'run') : T('camminata', 'walk')) + ' ' + mmss(x.fine - x.inizio) + '"></i>').join('') + '</div>' +
        '<div class="legend-inline"><span><i style="background:var(--accent)"></i>' + T('Corsa', 'Running') + '</span><span><i style="background:var(--surface-3)"></i>' + T('Camminata', 'Walking') + '</span></div>' : '';
      html += '<section class="card"><h3>' + T('Andamento', 'Over time') + '</h3><p class="sub">' + T('Passa il dito o il mouse su un grafico: gli altri mostrano lo stesso istante.', 'Hover or drag over a chart: the others show the same moment.') + '</p>' + strip +
        (s.hr ? '<div class="dd-ch"><div class="dd-ch-h"><b>' + T('Frequenza cardiaca', 'Heart rate') + '</b><span>bpm · ' + T('fasce = zone', 'bands = zones') + '</span></div><div class="chart-box sm"><canvas id="dd-hr"></canvas></div></div>' : '') +
        '<div class="dd-ch"><div class="dd-ch-h"><b>' + T('Passo', 'Pace') + '</b><span>min/km · ' + T('più in alto = più veloce', 'higher = faster') + '</span></div><div class="chart-box sm"><canvas id="dd-passo"></canvas></div></div>' +
        (s.cad ? '<div class="dd-ch"><div class="dd-ch-h"><b>' + T('Cadenza', 'Cadence') + '</b><span>' + T('passi/min', 'steps/min') + '</span></div><div class="chart-box sm"><canvas id="dd-cad"></canvas></div></div>' : '') +
        (s.pw ? '<div class="dd-ch"><div class="dd-ch-h"><b>' + T('Potenza', 'Power') + '</b><span>W</span></div><div class="chart-box sm"><canvas id="dd-pw"></canvas></div></div>' : '') +
        (s.alt ? '<div class="dd-ch"><div class="dd-ch-h"><b>' + T('Altitudine', 'Elevation') + '</b><span>m</span></div><div class="chart-box sm"><canvas id="dd-alt"></canvas></div></div>' : '') +
      '</section>';
      void durata;
    }

    // ---- zone cardiache (limiti e tempi calcolati dal server sulla FC max dell'utente) ----
    const tz = c.tempo_zone;
    if (tz) {
      const fm = a.fc_max_info || { valore: a.fc_max_teorica, fonte: 'stimata' };
      const sz = a.sotto_zone || { a: a.zone[0].da - 1, nome: T('Fuori zona', 'Below zones') };
      const base = a.zone[0].da + '–' + a.zone[1].a;
      const riga = (chip, cls, nome, range, sec, pct, col) => '<div class="dd-zone"><span class="zchip ' + cls + '">' + chip + '</span><span class="dd-zn">' + esc(nome).replace('/', '/<wbr>') + '<small>' + range + ' bpm</small></span>' +
        '<i><b style="width:' + Math.max(pct, sec ? 1 : 0) + '%;background:' + col + '"></b></i><span class="dd-zv">' + mmss(sec) + '<small>' + Math.round(pct) + '%</small></span></div>';
      html += '<section class="card"><h3>' + T('Tempo nelle zone cardiache', 'Time in heart-rate zones') + '</h3>' +
        '<p class="sub">' + testoFcMax(fm) + ' · <a href="#account">' + T('modifica', 'edit') + '</a><br>' +
          T('Per costruire la base conta stare in Z1–Z2 (' + base + ' bpm)', 'Building the base means staying in Z1–Z2 (' + base + ' bpm)') + '</p>' +
        '<p class="dd-sicura' + (c.fc_max > fm.valore ? ' over' : '') + '">' + (c.fc_max > fm.valore
          ? '⚠️ ' + T('Picco di ' + fmt0(c.fc_max) + ' bpm, sopra la FC di sicurezza (' + fm.valore + ' bpm). Se il dato è reale, aggiorna la FC max nel profilo.', 'Peak of ' + fmt0(c.fc_max) + ' bpm, above your safety HR (' + fm.valore + ' bpm). If it is real, update your max HR in your profile.')
          : T('FC di sicurezza: non superare ' + fm.valore + ' bpm', 'Safety HR: do not exceed ' + fm.valore + ' bpm')) + '</p>' +
        '<div class="dd-zones">' +
          riga('&lt; Z1', 'z0', sz.nome, '&lt; ' + (sz.a + 1), tz.sotto.sec, tz.sotto.pct, 'var(--zone-0)') +
          a.zone.map((zz, i) => riga(zz.z, 'z' + (i + 1), zz.nome, zz.da + '–' + zz.a, tz.zone[i].sec, tz.zone[i].pct, 'var(--zone-' + (i + 1) + ')')).join('') +
        '</div>' +
        (tz.fonte === 'serie' ? '<p class="dd-nota">' + T('Stima sui dati a 5 s: quelli al secondo arrivano con la prossima sincronizzazione.', 'Estimate from 5 s data: per-second data arrive with the next sync.') + '</p>' : '') +
        '</section>';
    }

    // ---- tratti di corsa ----
    if (at && at.righe.length > 1) {
      const rec = at.righe.map((r) => r.recupero).filter((x) => x != null);
      const recMed = rec.length ? rec.reduce((x, y) => x + y, 0) / rec.length : null;
      const prime = rec.slice(0, Math.ceil(rec.length / 2)), ultime = rec.slice(Math.ceil(rec.length / 2));
      const m = (v) => (v.length ? v.reduce((x, y) => x + y, 0) / v.length : null);
      html += '<section class="card"><h3>' + T('Tratti di corsa', 'Running intervals') + '</h3><p class="sub">' + at.righe.length + (at.daGiri ? T(' tratti, dai giri registrati dall’orologio', ' intervals, from the laps recorded by the watch') : T(' tratti riconosciuti dalla cadenza', ' intervals detected from cadence')) + '</p>' +
        (recMed != null ? '<div class="dd-callout"><b>' + T('Recupero cardiaco: −', 'Heart-rate recovery: −') + Math.round(recMed) + ' bpm</b><span>' + T('in media nel primo minuto di camminata dopo ogni tratto. Più scende, più il cuore recupera in fretta: è uno dei primi segnali di miglioramento.', 'on average in the first minute of walking after each interval. The bigger the drop, the faster your heart recovers: one of the first signs of progress.') +
          (prime.length && ultime.length ? T(' Primi tratti −', ' First intervals −') + Math.round(m(prime)) + T(', ultimi −', ', last −') + Math.round(m(ultime)) + ' bpm.' : '') + '</span></div>' : '') +
        '<div class="dd-table"><div class="dd-tr dd-th"><span>#</span><span>' + T('Durata', 'Time') + '</span><span>' + T('Passo', 'Pace') + '</span><span>' + T('FC', 'HR') + '</span><span>' + T('FC max', 'Max') + '</span><span>' + T('Rec.', 'Rec.') + '</span></div>' +
        at.righe.map((r) => '<div class="dd-tr"><span>' + r.n + '</span><span>' + mmss(r.dur) + '</span><span>' + (r.passo ? fmtPasso(r.passo) : '–') + '</span><span>' + (r.fc ? fmt0(r.fc) : '–') + '</span><span>' + (r.fcMax ? fmt0(r.fcMax) : '–') + '</span><span>' + (r.recupero != null ? '−' + Math.round(r.recupero) : '–') + '</span></div>').join('') +
        '</div></section>';
    }

    // ---- parziali per km ----
    const kms = s ? kmDaSerie(s) : (c.parziali || []).map((sec, i) => ({ km: i + 1, sec }));
    if (kms.length) {
      const passi = kms.map((k) => (k.parziale ? k.passo : k.sec));
      const lento = Math.max(...passi), veloce = Math.min(...passi);
      html += '<section class="card"><h3>' + T('Parziali per km', 'Splits per km') + '</h3><p class="sub">' + T('Camminata compresa · barra più lunga = km più veloce', 'Walking included · longer bar = faster km') + '</p><div class="dd-splits">' +
        kms.map((k, i) => {
          const p = passi[i];
          const w = lento === veloce ? 80 : 30 + (lento - p) / (lento - veloce) * 70;
          return '<div class="dd-split' + (p === veloce && kms.length > 1 ? ' best' : '') + '"><span>' + (k.parziale ? fmt1(k.km) : k.km) + '</span><i><b style="width:' + w + '%"></b></i><b>' + fmtPasso(p) + '</b><small>' + (k.fc ? fmt0(k.fc) + ' bpm' : '') + (k.corsa != null ? ' · ' + Math.round(k.corsa * 100) + T('% corsa', '% run') : '') + '</small></div>';
        }).join('') + '</div></section>';
    }

    // ---- confronto con le ultime corse ----
    if (cf) {
      const passoQ = c.passo_corsa || c.passo_medio, fcQ = c.fc_corsa || c.fc_media;
      const dv = (q, m, meglioBasso, fmt) => {
        if (q == null || m == null) return '<em>–</em>';
        const d = q - m; const buono = meglioBasso ? d < 0 : d > 0;
        return '<em class="' + (Math.abs(d) < 1e-9 ? '' : buono ? 'ok' : 'warn') + '">' + (d > 0 ? '+' : d < 0 ? '−' : '') + fmt(Math.abs(d)) + '</em>';
      };
      html += '<section class="card"><h3>' + T('Rispetto alle ultime corse', 'Versus your recent runs') + '</h3><p class="sub">' + T('Media delle ' + cf.corse + ' corse precedenti', 'Average of the previous ' + cf.corse + ' runs') + '</p><div class="dd-rows">' +
        '<div class="dd-row dd-row-h"><span></span><span class="dd-prev">' + T('Media', 'Average') + '</span><b>' + T('Questa', 'This one') + '</b><em></em></div>' +
        '<div class="dd-row"><span>' + T('Passo', 'Pace') + '</span><span class="dd-prev">' + fmtPasso(cf.passo) + '</span><b>' + fmtPasso(passoQ) + '</b>' + dv(passoQ, cf.passo, true, (x) => Math.round(x) + '″') + '</div>' +
        '<div class="dd-row"><span>' + T('FC', 'HR') + '</span><span class="dd-prev">' + fmt0(cf.fc) + '</span><b>' + fmt0(fcQ) + '</b>' + dv(fcQ, cf.fc, true, (x) => Math.round(x) + ' bpm') + '</div>' +
        '<div class="dd-row"><span>' + T('Efficienza', 'Efficiency') + '</span><span class="dd-prev">' + (cf.ef ? fmt0(cf.ef * 1000) : '–') + '</span><b>' + (c.efficiency_factor ? fmt0(c.efficiency_factor * 1000) : '–') + '</b>' + dv(c.efficiency_factor ? c.efficiency_factor * 1000 : null, cf.ef ? cf.ef * 1000 : null, false, (x) => fmt0(x)) + '</div>' +
        '<div class="dd-row"><span>' + T('Distanza', 'Distance') + '</span><span class="dd-prev">' + fmt1(cf.distanza) + ' km</span><b>' + fmt1(c.distanza) + ' km</b>' + dv(c.distanza, cf.distanza, false, (x) => fmt1(x) + ' km') + '</div>' +
        '</div><p class="g-note">' + T('Efficienza più alta a parità di sforzo = stai migliorando. Il passo da solo inganna: conta insieme alla FC.', 'Higher efficiency at the same effort = you are improving. Pace alone is misleading: read it together with HR.') + '</p></section>';
    }

    if (!s) html += '<section class="card empty">' + T('I grafici secondo per secondo arrivano con la prossima sincronizzazione (servono i dati dettagliati da Intervals.icu).', 'Second-by-second charts arrive with the next sync (detailed data from Intervals.icu is needed).') + '</section>';

    html += '<div class="azioni dd-actions">' +
      (String(c.id).startsWith('s')
        ? '<a class="btn-mini link-strava" href="https://www.strava.com/activities/' + encodeURIComponent(String(c.id).slice(1)) + '" target="_blank" rel="noopener">' + T('Vedi su Strava', 'View on Strava') + '</a><span class="powered-strava">' + T('Dati da Strava', 'Data from Strava') + '</span>'
        : '<a class="btn-mini" href="https://intervals.icu/activities/' + encodeURIComponent(c.id) + '" target="_blank" rel="noopener">' + T('Apri su Intervals.icu', 'Open in Intervals.icu') + '</a>') + '</div>';

    mostraSheet(T('Allenamento', 'Workout'), html);
    if (s && typeof Chart !== 'undefined') disegnaSeduta(s, a, pr);
  }

  /* ====================================================================== */
  /* Condividi: immagine della seduta fatta (generata nel browser, nessun   */
  /* servizio esterno). Formato post 4:5 o storia 9:16, colore d'accento.   */
  /* ====================================================================== */
  const condividi = { id: null, a: null, tipo: 'immagine', video: null, formato: 'post', percorso: true, sfondo: (() => { try { return localStorage.getItem('coach-cond-sfondo') || 'scuro'; } catch (_) { return 'scuro'; } })(), url: null, file: null };

  const puoCondividere = () => Boolean(ME && !ME.impersonato_da);

  const puoRegistrare = () => typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && Boolean(HTMLCanvasElement.prototype.captureStream) &&
    ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].some((t) => MediaRecorder.isTypeSupported(t));

  async function apriCondividi(id) {
    if (condividi.id !== id || !condividi.a) {
      mostraSheet(T('Condividi', 'Share'), '<div class="skeleton" style="height:420px"></div>');
      try { condividi.a = await caricaJson('/api/attivita/' + encodeURIComponent(id)); condividi.id = id; condividi.video = null; }
      catch (e) { mostraSheet(T('Condividi', 'Share'), '<div class="card empty">' + esc(e.message) + '</div>'); return; }
    }
    const haPercorso = Boolean(condividi.a.serie && condividi.a.serie.lat);
    const conVideo = haPercorso && puoRegistrare();
    if (!conVideo) condividi.tipo = 'immagine';
    const video = condividi.tipo === 'video';
    const seg = (k, v, l) => '<button type="button" data-cond-' + k + '="' + v + '" aria-pressed="' + (condividi[k] === v) + '">' + l + '</button>';
    mostraSheet(T('Condividi', 'Share'),
      '<section class="cond">' +
        (conVideo ? '<div class="cond-seg cond-tipo" role="group" aria-label="' + T('Cosa condividere', 'What to share') + '">' + seg('tipo', 'immagine', T('Immagine', 'Image')) + seg('tipo', 'video', T('Video del percorso', 'Route video')) + '</div>' : '') +
        '<div class="cond-opz"><div class="cond-seg" role="group" aria-label="' + T('Formato', 'Format') + '">' +
          seg('formato', 'post', T('Post 4:5', 'Post 4:5')) + seg('formato', 'storia', T('Storia 9:16', 'Story 9:16')) + '</div>' +
          (haPercorso && !video ? '<div class="cond-seg" role="group" aria-label="' + T('Percorso', 'Route') + '">' + seg('percorso', true, T('Con percorso', 'With route')) + seg('percorso', false, T('Senza', 'Without')) + '</div>' : '') +
        '</div>' +
        (video ? '' : '<div class="cond-sf" role="group" aria-label="' + T('Sfondo', 'Background') + '">' + SFONDI.map((q) => '<button type="button" data-cond-sfondo="' + q.id + '" class="sf-' + q.id + '"' +
          (q.c1 ? ' style="background:linear-gradient(160deg,' + q.c1 + ',' + q.c2 + ')"' : '') + ' aria-pressed="' + (condividi.sfondo === q.id) + '" aria-label="' + esc(T(q.it, q.en)) + '" title="' + esc(T(q.it, q.en)) + '"></button>').join('') + '</div>') +
        (video
          ? '<div class="cond-prev cond-vprev"><video id="cond-vid" playsinline muted loop controls hidden></video>' +
              '<div id="cond-vwait" class="cond-vwait"><button type="button" class="btn-primary" id="cond-crea">' + ICO.play + T('Crea il video', 'Create the video') + '</button><p id="cond-stato"></p></div></div>'
          : '<div class="cond-prev"><img id="cond-img" alt="' + T('Anteprima dell’immagine da condividere', 'Preview of the image to share') + '"></div>') +
        '<div class="cond-az">' +
          '<button type="button" class="btn-primary" id="cond-share" hidden>' + ICO.share + T('Condividi', 'Share') + '</button>' +
          '<a class="btn-mini" id="cond-dl" download' + (video ? ' hidden' : '') + '>' + (video ? T('Scarica il video', 'Download video') : T('Scarica l’immagine', 'Download image')) + '</a>' +
        '</div>' +
        '<p class="g-note">' + (video
          ? T('Il video si registra sul tuo dispositivo in tempo reale (10–40 secondi): tieni lo schermo acceso e l’app aperta. Mostra il percorso su mappa satellitare: non condividerlo se parte da casa tua.', 'The video is recorded on your device in real time (10–40 seconds): keep the screen on and the app open. It shows the route on a satellite map: do not share it if it starts from your home.')
          : T('L’immagine si crea sul tuo dispositivo. Il percorso è solo la forma, senza mappa: toglilo se parte da casa tua.', 'The image is created on your device. The route is only its shape, with no map: remove it if it starts from your home.')) + '</p>' +
      '</section>');
    if (video) mostraVideoPronto();
    else await generaImmagine();
  }

  async function generaImmagine() {
    const cv = await disegnaCard(condividi.a, condividi.formato, condividi.percorso, condividi.sfondo);
    const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
    if (!blob || !$('#cond-img')) return;
    if (condividi.url) URL.revokeObjectURL(condividi.url);
    condividi.url = URL.createObjectURL(blob);
    const nome = 'aac-' + condividi.a.corsa.data + (condividi.formato === 'storia' ? '-storia' : '') + '.png';
    condividi.file = new File([blob], nome, { type: 'image/png' });
    $('#cond-img').src = condividi.url;
    $('#cond-dl').href = condividi.url;
    $('#cond-dl').setAttribute('download', nome);
    $('#cond-share').hidden = !(navigator.canShare && navigator.canShare({ files: [condividi.file] }));
  }

  // Video gia' creato per questa corsa e questo formato: lo mostra subito
  function mostraVideoPronto() {
    const v = condividi.video;
    if (!v || v.formato !== condividi.formato || !$('#cond-vid')) { condividi.file = null; return; }
    $('#cond-vid').src = v.url; $('#cond-vid').hidden = false; $('#cond-vwait').hidden = true;
    condividi.file = v.file;
    $('#cond-dl').href = v.url; $('#cond-dl').setAttribute('download', v.file.name); $('#cond-dl').hidden = false;
    $('#cond-share').hidden = !(navigator.canShare && navigator.canShare({ files: [v.file] }));
    $('#cond-vid').play().catch(() => {});
  }

  async function avviaVideo() {
    const btn = $('#cond-crea'), stato = $('#cond-stato');
    btn.disabled = true;
    try {
      const blob = await creaVideo(condividi.a, condividi.formato, (p, txt) => { if (stato) stato.textContent = txt + ' ' + Math.round(p * 100) + '%'; });
      const est = blob.type.includes('mp4') ? 'mp4' : 'webm';
      const file = new File([blob], 'aac-' + condividi.a.corsa.data + (condividi.formato === 'storia' ? '-storia' : '') + '.' + est, { type: blob.type });
      if (condividi.video) URL.revokeObjectURL(condividi.video.url);
      condividi.video = { formato: condividi.formato, file, url: URL.createObjectURL(blob) };
      mostraVideoPronto();
    } catch (e) {
      if (stato) stato.textContent = e.message || T('Video non riuscito', 'Video failed');
      if (btn) btn.disabled = false;
    }
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-condividi]');
    if (b) { apriSheet('#condividi/' + encodeURIComponent(b.dataset.condividi)); return; }
    const tp = e.target.closest('[data-cond-tipo]');
    if (tp) { condividi.tipo = tp.dataset.condTipo; apriCondividi(condividi.id); return; }
    const f = e.target.closest('[data-cond-formato],[data-cond-percorso],[data-cond-sfondo]');
    if (f) {
      if (f.dataset.condSfondo) { condividi.sfondo = f.dataset.condSfondo; try { localStorage.setItem('coach-cond-sfondo', condividi.sfondo); } catch (_) { /* solo comodità */ } }
      else if (f.dataset.condFormato) condividi.formato = f.dataset.condFormato;
      else condividi.percorso = f.dataset.condPercorso === 'true';
      if (condividi.tipo === 'video') { apriCondividi(condividi.id); return; }
      f.parentNode.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === f)));
      generaImmagine();
      return;
    }
    if (e.target.closest('#cond-crea')) { avviaVideo(); return; }
    if (e.target.closest('#cond-share') && condividi.file) {
      try { await navigator.share({ files: [condividi.file], title: 'Always Adaptive Coach' }); }
      catch (err) { if (err && err.name !== 'AbortError') toast(T('Condivisione non riuscita: usa “Scarica”.', 'Sharing failed: use “Download”.'), 'err'); }
    }
  });

  /* ---- Video del percorso: stesso volo del replay, registrato sul dispositivo (MediaRecorder) ---- */
  async function creaVideo(a, formato, avanza) {
    const s = a.serie, c = a.corsa;
    const tipo = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    await caricaMappa();
    const ml = window.maplibregl;
    const W = 1080, H = formato === 'storia' ? 1920 : 1350, PR = 2;
    const pad = 60, top = formato === 'storia' ? 150 : 60, bottom = formato === 'storia' ? 230 : 60; // margini sicuri di Instagram
    const box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = 'position:fixed;left:0;top:0;width:' + W / PR + 'px;height:' + H / PR + 'px;opacity:0;pointer-events:none;z-index:-1';
    document.body.appendChild(box);
    const v = voloPercorso(s);
    const accent = cssVar('--accent') || '#ff5a36';
    const FN = 'ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, Inter, "Segoe UI", Roboto, sans-serif';
    const FT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, "Segoe UI", Roboto, sans-serif';
    const nf2 = new Intl.NumberFormat(LOC, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const coords = v.pts.map((q) => q.p);
    const bounds = coords.reduce((bb, p) => bb.extend(p), new ml.LngLatBounds(coords[0], coords[0]));
    const fermo = (map, ms) => new Promise((ok) => { const t = setTimeout(ok, ms); map.once('idle', () => { clearTimeout(t); ok(); }); });
    let map = null;
    try {
      try { await Promise.all([document.fonts.load('700 40px Inter'), document.fonts.load('800 40px Inter')]); } catch (_) { /* font di sistema */ }
      map = new ml.Map({ container: box, style: 'https://tiles.openfreemap.org/styles/liberty', center: coords[0], zoom: v.zoom, pitch: 48,
        interactive: false, attributionControl: false, preserveDrawingBuffer: true, pixelRatio: PR, fadeDuration: 0 });
      map.on('error', () => {});
      await new Promise((ok, ko) => { const t = setTimeout(() => ko(new Error(T('Mappa non disponibile', 'Map unavailable'))), 20000); map.once('load', () => { clearTimeout(t); ok(); }); });
      map.getStyle().layers.filter((l) => /poi|transit|bus|aeroway|airport/i.test(l.id) && l.type === 'symbol').forEach((l) => map.setLayoutProperty(l.id, 'visibility', 'none'));
      applicaSatellite(map, 128);
      map.addSource('linea', { type: 'geojson', lineMetrics: true, data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } });
      map.addLayer({ id: 'base', type: 'line', source: 'linea', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-opacity': 0.4, 'line-width': 5 } });
      map.addLayer({ id: 'fatto', type: 'line', source: 'linea', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 8, 'line-gradient': ['step', ['line-progress'], accent, 0.000001, 'rgba(0,0,0,0)'] } });
      map.addSource('punto', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'punto', type: 'circle', source: 'punto', paint: { 'circle-radius': 10, 'circle-color': accent, 'circle-stroke-width': 4, 'circle-stroke-color': '#ffffff', 'circle-pitch-alignment': 'map' } });

      // 1) prepara la mappa: scarica le immagini lungo il percorso e della vista finale
      const tappe = 10;
      let bearing = v.dirA(coords[0], v.trova(Math.min(v.tot, v.avanti)).p);
      for (let k = 0; k <= tappe; k++) {
        const d = v.tot * k / tappe, p = v.trova(d).p;
        map.jumpTo({ center: p, zoom: v.zoom, pitch: 48, bearing: v.dirA(v.trova(Math.max(0, d - v.avanti * 0.5)).p, v.trova(Math.min(v.tot, d + v.avanti)).p) });
        await fermo(map, 6000);
        avanza(k / (tappe + 1) * 0.3, T('Preparo la mappa…', 'Preparing the map…'));
      }
      const padFine = { top: H / PR * 0.17, bottom: (bottom + 640) / PR, left: 30, right: 30 };
      map.fitBounds(bounds, { padding: padFine, pitch: 45, duration: 0, maxZoom: 16 });
      await fermo(map, 6000);
      map.jumpTo({ center: coords[0], zoom: v.zoom, pitch: 48, bearing });
      await fermo(map, 6000);

      // 2) registra in tempo reale: mappa + marchio, dati e riepilogo disegnati sopra
      const comp = document.createElement('canvas'); comp.width = W; comp.height = H;
      const x = comp.getContext('2d');
      const rec = new MediaRecorder(comp.captureStream(30), { mimeType: tipo, videoBitsPerSecond: 10000000 });
      const pezzi = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) pezzi.push(e.data); };
      const finito = new Promise((ok) => { rec.onstop = ok; });
      const INTRO = 700, VOLO = 2200, FINE = 4200, TOT = INTRO + v.durata + VOLO + FINE;
      const testo = (t, px, peso, col, fam, X, Y, al) => { x.font = peso + ' ' + px + 'px ' + fam; x.fillStyle = col; x.textAlign = al || 'left'; x.fillText(t, X, Y); return x.measureText(t).width; };
      const tondo = (X, Y, w, h, r) => { x.beginPath(); if (x.roundRect) x.roundRect(X, Y, w, h, r); else x.rect(X, Y, w, h); };
      const vetro = (X, Y, w, h, r) => {
        tondo(X, Y, w, h, r);
        const g = x.createLinearGradient(X, Y, X + w, Y + h); g.addColorStop(0, rgba(accent, 0.30)); g.addColorStop(1, 'rgba(12,12,14,0.42)');
        x.fillStyle = g; x.fill(); x.strokeStyle = 'rgba(255,255,255,0.18)'; x.lineWidth = 2; x.stroke();
      };
      const logo = (X, Y, size) => {
        x.save(); x.translate(X, Y); x.scale(size / 56, size / 56); x.translate(-4, -6);
        x.strokeStyle = accent; x.lineWidth = 4.8; x.lineCap = 'round'; x.lineJoin = 'round';
        x.stroke(new Path2D('M13.6 26.5A19 19 0 1 1 13.6 37.5')); x.stroke(new Path2D('M8 32h14l3.5-8 5 16 3.5-8h4'));
        x.restore();
      };
      const disegna = (fase, u, tFine) => {
        x.drawImage(map.getCanvas(), 0, 0, W, H);
        let g = x.createLinearGradient(0, 0, 0, top + 260); g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(0, 0, W, top + 260);
        g = x.createLinearGradient(0, H - bottom - 560, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.6)');
        x.fillStyle = g; x.fillRect(0, H - bottom - 560, W, bottom + 560);
        x.save(); x.shadowColor = 'rgba(0,0,0,0.55)'; x.shadowBlur = 10;
        logo(pad, top, 58);
        testo('Always Adaptive Coach', 42, 700, '#ffffff', FT, pad + 74, top + 44);
        testo('aac.run', 36, 700, '#ffffff', FT, W - pad, top + 44, 'right');
        x.restore();
        testo('© Esri, Maxar · © OpenStreetMap', 18, 500, 'rgba(255,255,255,0.6)', FT, W - 24, H - 18, 'right');
        if (fase === 'volo') {
          const { k } = v.trova(u * v.tot), i = v.pts[k].i;
          const val = [[nf2.format(s.d ? s.d[i] : u * v.tot / 1000), 'km'], [s.t ? fmtDurata(s.t[i]) : '–', T('tempo', 'time')], [fmtPasso(v.passoA(i)), '/km']];
          if (s.hr) val.push([s.hr[i] ? fmt0(s.hr[i]) : '–', 'bpm']);
          const hY = H - bottom - 200, hW = W - 2 * pad;
          vetro(pad, hY, hW, 170, 36);
          val.forEach(([n, l], j) => { const cx = pad + hW / val.length * (j + 0.5); testo(n, 62, 700, '#ffffff', FN, cx, hY + 92, 'center'); testo(l, 28, 600, 'rgba(255,255,255,0.7)', FT, cx, hY + 136, 'center'); });
        }
        if (tFine >= 0) {
          // finale nello stile di aac.run: sfumatura dal basso, km in grande che contano, quattro dati puliti
          const ease = (q) => 1 - Math.pow(1 - Math.min(1, Math.max(0, q)), 3);
          const entra = (ritardo, durata) => ease((tFine - ritardo) / (durata || 450));
          const Y0 = H - bottom - 600;
          x.save();
          x.globalAlpha = entra(0, 600);
          g = x.createLinearGradient(0, Y0 - 260, 0, H); g.addColorStop(0, 'rgba(6,7,9,0)'); g.addColorStop(0.35, 'rgba(6,7,9,0.72)'); g.addColorStop(1, 'rgba(6,7,9,0.92)');
          x.fillStyle = g; x.fillRect(0, Y0 - 260, W, H - Y0 + 260);
          x.restore();
          const pezzo = (ritardo, fn) => { const a = entra(ritardo); if (a <= 0) return; x.save(); x.globalAlpha = a; x.translate(0, (1 - a) * 26); fn(); x.restore(); };
          pezzo(0, () => { x.letterSpacing = '4px'; testo(fmtDataLunga(c.data).toUpperCase(), 28, 700, accent, FT, pad, Y0); x.letterSpacing = '0px'; });
          pezzo(90, () => testo(c.nome || T('Corsa', 'Run'), 54, 700, '#ffffff', FT, pad, Y0 + 66));
          pezzo(160, () => {
            const v = (c.distanza || 0) * ease((tFine - 160) / 1100);
            const w = testo(fmt1(v), 230, 800, '#ffffff', FN, pad - 8, Y0 + 300);
            testo('km', 80, 700, accent, FN, pad + w + 6, Y0 + 300);
          });
          const lw = (W - 2 * pad) * entra(450, 600);
          if (lw > 0) { x.fillStyle = 'rgba(255,255,255,0.22)'; x.fillRect(pad, Y0 + 352, lw, 2); }
          const st = [[T('Tempo', 'Time'), fmtDurata(c.tempo), ''], [c.passo_corsa ? T('Passo di corsa', 'Running pace') : T('Passo', 'Pace'), fmtPasso(c.passo_corsa || c.passo_medio), '/km']];
          if (c.fc_media) st.push([T('FC media', 'Avg HR'), fmt0(c.fc_media), 'bpm']);
          if (c.dislivello != null) st.push([T('Dislivello', 'Elevation'), fmt0(c.dislivello), 'm']);
          const cw = (W - 2 * pad) / st.length;
          st.forEach(([l, n, un], j) => pezzo(560 + j * 120, () => {
            const X = pad + cw * j;
            testo(l.toUpperCase(), 24, 600, 'rgba(255,255,255,0.62)', FT, X, Y0 + 420);
            x.font = '700 64px ' + FN; let px = 64; while (px > 40 && x.measureText(n).width + (un ? 60 : 0) > cw - 16) { px -= 2; x.font = '700 ' + px + 'px ' + FN; }
            const w = testo(n, px, 700, '#ffffff', FN, X, Y0 + 492);
            if (un) testo(un, 26, 600, 'rgba(255,255,255,0.62)', FT, X + w + 6, Y0 + 492);
          }));
        }
      };
      disegna('volo', 0, -1);
      rec.start(500);
      const t0 = performance.now();
      let voloFinale = false;
      await new Promise((ok) => {
        const passo = (now) => {
          const t = now - t0;
          let fase = 'volo', u = Math.min(1, Math.max(0, (t - INTRO) / v.durata)), tFine = -1;
          if (t < INTRO + v.durata) {
            const d = u * v.tot, p = v.trova(d).p;
            const dietro = v.trova(Math.max(0, d - v.avanti * 0.5)).p, davanti = v.trova(Math.min(v.tot, d + v.avanti)).p;
            bearing += (((v.dirA(dietro, davanti) - bearing + 540) % 360) - 180) * 0.012;
            map.setPaintProperty('fatto', 'line-gradient', ['step', ['line-progress'], accent, Math.max(0.000001, u), 'rgba(0,0,0,0)']);
            map.getSource('punto').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }] });
            map.jumpTo({ center: p, bearing, pitch: 48, zoom: v.zoom });
          } else {
            fase = 'fine';
            if (!voloFinale) {
              voloFinale = true;
              map.setPaintProperty('fatto', 'line-gradient', ['step', ['line-progress'], accent, 1, accent]);
              map.fitBounds(bounds, { padding: padFine, pitch: 45, bearing, duration: VOLO, maxZoom: 16 });
              map.once('moveend', () => map.easeTo({ bearing: bearing + 25, duration: FINE + 600, easing: (q) => q }));
            }
            tFine = t - INTRO - v.durata - VOLO * 0.55;
          }
          disegna(fase, u, tFine);
          avanza(0.3 + 0.7 * Math.min(1, t / TOT), T('Registro il video…', 'Recording the video…'));
          if (t >= TOT) { ok(); return; }
          requestAnimationFrame(passo);
        };
        requestAnimationFrame(passo);
      });
      rec.stop();
      await finito;
      return new Blob(pezzi, { type: tipo.split(';')[0] });
    } finally {
      if (map) map.remove();
      box.remove();
    }
  }

  // Sfondi dell'immagine: scuro (predefinito), colore del tema, chiaro e qualche tinta sportiva
  const SFONDI = [
    { id: 'scuro', it: 'Scuro', en: 'Dark', c1: '#101114', c2: '#07080a' },
    { id: 'tema', it: 'Colore del tema', en: 'Theme colour' },
    { id: 'chiaro', it: 'Chiaro', en: 'Light', c1: '#ffffff', c2: '#ececf1' },
    { id: 'notte', it: 'Blu notte', en: 'Midnight blue', c1: '#13234f', c2: '#060b1c' },
    { id: 'viola', it: 'Viola', en: 'Purple', c1: '#35155e', c2: '#0f0620' },
    { id: 'bordeaux', it: 'Bordeaux', en: 'Burgundy', c1: '#5a1426', c2: '#1a050b' },
    { id: 'bosco', it: 'Verde bosco', en: 'Forest green', c1: '#123b2a', c2: '#04120c' },
    { id: 'grafite', it: 'Grafite', en: 'Graphite', c1: '#3a3d44', c2: '#16171a' },
  ];
  // Colori per il canvas (che normalizza qualunque colore CSS in #rrggbb)
  function inRgb(colore) {
    const c = document.createElement('canvas').getContext('2d');
    c.fillStyle = '#000'; c.fillStyle = colore;
    const h = c.fillStyle;
    if (h[0] !== '#') return [0, 0, 0];
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  const rgba = (colore, alfa) => 'rgba(' + inRgb(colore).join(',') + ',' + alfa + ')';
  const mescola = (c1, c2, t) => { const a = inRgb(c1), b = inRgb(c2); return 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',') + ')'; };

  async function disegnaCard(a, formato, conPercorso, sfondo) {
    const c = a.corsa, s = a.serie, pr = a.prevista;
    const W = 1080, H = formato === 'storia' ? 1920 : 1350;
    const top = formato === 'storia' ? 230 : 84, bottom = formato === 'storia' ? 250 : 84, pad = 84;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    const FN = 'ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, Inter, "Segoe UI", Roboto, sans-serif';
    const FT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, "Segoe UI", Roboto, sans-serif';
    try { await Promise.all([document.fonts.load('700 40px Inter'), document.fonts.load('500 40px Inter')]); await document.fonts.ready; } catch (_) { /* font di sistema */ }
    const accent = cssVar('--accent') || '#ff5a36';
    const sf = SFONDI.find((q) => q.id === sfondo) || SFONDI[0];
    const chiaro = sf.id === 'chiaro', tema = sf.id === 'tema';
    const BIANCO = chiaro ? '#111114' : '#f5f5f7', GRIGIO = chiaro ? 'rgba(17,17,20,0.58)' : 'rgba(245,245,247,0.66)';
    // colore dei dettagli: l'accento, più scuro sul chiaro, bianco quando lo sfondo è già l'accento
    const EV = tema ? '#ffffff' : chiaro ? mescola(accent, '#000000', 0.25) : accent;

    // sfondo: sfumatura del colore scelto con bagliore del colore d'accento
    const base1 = tema ? mescola(accent, '#000000', 0.05) : sf.c1, base2 = tema ? mescola(accent, '#000000', 0.55) : sf.c2;
    let gr = x.createLinearGradient(0, 0, W * 0.4, H);
    gr.addColorStop(0, base1); gr.addColorStop(1, base2);
    x.fillStyle = gr; x.fillRect(0, 0, W, H);
    if (!tema) {
      gr = x.createRadialGradient(W * 0.85, H * 0.08, 0, W * 0.85, H * 0.08, W * 0.95);
      gr.addColorStop(0, rgba(accent, chiaro ? 0.30 : 0.42)); gr.addColorStop(1, rgba(accent, 0));
      x.fillStyle = gr; x.fillRect(0, 0, W, H);
      gr = x.createRadialGradient(W * 0.1, H * 0.95, 0, W * 0.1, H * 0.95, W * 0.7);
      gr.addColorStop(0, rgba(accent, chiaro ? 0.12 : 0.16)); gr.addColorStop(1, rgba(accent, 0));
      x.fillStyle = gr; x.fillRect(0, 0, W, H);
    }

    const testo = (t, px, peso, col, fam, X, Y, allinea) => { x.font = peso + ' ' + px + 'px ' + fam; x.fillStyle = col; x.textAlign = allinea || 'left'; x.textBaseline = 'alphabetic'; x.fillText(t, X, Y); return x.measureText(t).width; };
    const adatta = (t, px, peso, fam, max) => { let p = px; x.font = peso + ' ' + p + 'px ' + fam; while (p > 28 && x.measureText(t).width > max) { p -= 2; x.font = peso + ' ' + p + 'px ' + fam; } return p; };

    // logo (stesso disegno dell'app) e marchio
    const logo = (X, Y, size) => {
      x.save(); x.translate(X, Y); x.scale(size / 56, size / 56); x.translate(-4, -6);
      x.strokeStyle = EV; x.lineWidth = 4.8; x.lineCap = 'round'; x.lineJoin = 'round';
      x.stroke(new Path2D('M13.6 26.5A19 19 0 1 1 13.6 37.5')); x.stroke(new Path2D('M8 32h14l3.5-8 5 16 3.5-8h4'));
      x.restore();
    };
    logo(pad, top, 60);
    const marchio = 'Always Adaptive Coach';
    testo(marchio, adatta(marchio, 44, 700, FT, W - 2 * pad - 78), 700, BIANCO, FT, pad + 78, top + 46);

    // data, titolo della seduta, traguardo
    let y = top + 150;
    const dataTxt = new Date(c.data + 'T12:00:00').toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
    x.letterSpacing = '3px';
    testo(dataTxt, 30, 700, EV, FT, pad, y);
    x.letterSpacing = '0px';
    const titolo = (pr && pr.titolo ? pr.titolo.replace(/^(Sett\.|Wk) \d+ · /, '') : c.nome) || T('Corsa', 'Run');
    y += 92;
    testo(titolo, adatta(titolo, 80, 700, FT, W - 2 * pad), 700, BIANCO, FT, pad, y);

    const corse = (ultimoStorico && ultimoStorico.corse) || [];
    const badge = [];
    if (corse.length >= 3 && c.distanza && corse.every((k) => k.id === c.id || (k.distanza || 0) < c.distanza)) badge.push(T('La corsa più lunga di sempre', 'Longest run ever'));
    const p = ultimiDati && ultimiDati.programma;
    if (pr && p && p.obiettivo) badge.push(T('Verso: ', 'Towards: ') + p.obiettivo.nome);
    y += 34;
    let bx = pad;
    badge.forEach((t) => {
      x.font = '600 30px ' + FT;
      const w = x.measureText(t).width + 48;
      if (bx + w > W - pad) return;
      x.fillStyle = rgba(EV, tema ? 0.16 : 0.18); x.strokeStyle = rgba(EV, 0.55); x.lineWidth = 2;
      x.beginPath(); x.roundRect ? x.roundRect(bx, y, w, 58, 29) : x.rect(bx, y, w, 58); x.fill(); x.stroke();
      testo(t, 30, 600, BIANCO, FT, bx + 24, y + 39);
      bx += w + 14;
    });
    const sottoTitolo = y + (badge.length ? 58 : 0);

    // numeri in basso: chiave + 4 valori
    const yFoot = H - bottom;
    const valori = [
      [T('Tempo', 'Time'), fmtDurata(c.tempo), ''],
      [c.passo_corsa ? T('Passo di corsa', 'Running pace') : T('Passo', 'Pace'), fmtPasso(c.passo_corsa || c.passo_medio), '/km'],
      c.fc_media ? [T('FC media', 'Avg HR'), fmt0(c.fc_media), 'bpm'] : null,
      c.dislivello ? [T('Dislivello', 'Elevation'), fmt0(c.dislivello), 'm'] : null,
    ].filter(Boolean);
    const colW = (W - 2 * pad) / valori.length;
    // senza percorso il blocco dei numeri si centra nello spazio libero
    const conForma = Boolean(conPercorso && s && s.lat && (yFoot - 280) - 250 - (sottoTitolo + 50) > 160);
    const sposta = conForma ? 0 : Math.max(0, ((yFoot - 455) + (yFoot - 100)) / 2 - (sottoTitolo + 40 + yFoot - 60) / 2);
    const yVal = yFoot - 110 - sposta;
    valori.forEach(([l, v, u], i) => {
      const X = pad + i * colW;
      testo(l.toUpperCase(), 24, 600, GRIGIO, FT, X, yVal - 62);
      const w = testo(v, adatta(v, 58, 700, FN, colW - 20 - (u ? 60 : 0)), 700, BIANCO, FN, X, yVal);
      if (u) testo(u, 26, 600, GRIGIO, FT, X + w + 6, yVal);
    });
    x.fillStyle = chiaro ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.16)'; x.fillRect(pad, yVal - 120, W - 2 * pad, 2);

    // distanza grande
    const yKm = yVal - 170;
    const km = fmt1(c.distanza);
    const wKm = testo(km, 230, 800, BIANCO, FN, pad - 6, yKm);
    testo('km', 72, 700, EV, FN, pad + wKm + 8, yKm);

    // percorso: solo la forma, senza mappa
    const boxT = sottoTitolo + 50, boxB = yKm - 250;
    if (conForma) {
      const pts = [];
      s.lat.forEach((la, i) => { if (la != null && s.lng[i] != null) pts.push([s.lng[i], la]); });
      if (pts.length > 2) {
        const lat0 = pts.reduce((t, q) => t + q[1], 0) / pts.length, k = Math.cos(lat0 * Math.PI / 180);
        const xs = pts.map((q) => q[0] * k), ys = pts.map((q) => -q[1]);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        const bw = W - 2 * pad - 40, bh = boxB - boxT;
        const sc = Math.min(bw / Math.max(maxX - minX, 1e-9), bh / Math.max(maxY - minY, 1e-9));
        const ox = (W - (maxX - minX) * sc) / 2, oy = boxT + (bh - (maxY - minY) * sc) / 2;
        const P = (i) => [ox + (xs[i] - minX) * sc, oy + (ys[i] - minY) * sc];
        x.beginPath();
        pts.forEach((_, i) => { const [X, Y] = P(i); i ? x.lineTo(X, Y) : x.moveTo(X, Y); });
        x.lineCap = 'round'; x.lineJoin = 'round';
        x.shadowColor = rgba(EV, chiaro ? 0.35 : 0.7); x.shadowBlur = 28;
        x.strokeStyle = EV; x.lineWidth = 11; x.stroke();
        x.shadowBlur = 0;
        const [sx, sy] = P(0);
        x.fillStyle = tema ? base2 : BIANCO; x.beginPath(); x.arc(sx, sy, 13, 0, Math.PI * 2); x.fill();
      }
    }

    // piede
    testo(T('Il piano che si adatta a te', 'The plan that adapts to you'), 28, 500, GRIGIO, FT, pad, yFoot);
    testo('aac.run', 30, 700, BIANCO, FT, W - pad, yFoot, 'right');
    return cv;
  }

  function disegnaSeduta(s, a, pr) {
    const accent = cssVar('--accent'), accent2 = cssVar('--accent-2'), muted = cssVar('--muted');
    const labels = s.t.map((t) => t / 60);
    const gruppo = [];
    let suMappa = null;
    const sync = syncHover(gruppo, (i) => suMappa && suMappa(i));
    if (s.lat) disegnaMappa(s, a.corsa).then((f) => { suMappa = f; });
    const base = (fmtY, opz = {}) => {
      const o = opzioniBase((ctx) => ' ' + fmtY(ctx.parsed.y), (it) => mmss(s.t[it[0].dataIndex]) + (s.d ? ' · ' + fmt1(s.d[it[0].dataIndex]) + ' km' : ''));
      o.animation = false;
      o.scales.x = { type: 'linear', min: 0, max: labels[labels.length - 1], grid: { display: false }, border: { display: false }, ticks: { color: muted, maxTicksLimit: 8, font: { size: 10 }, callback: (v) => Math.round(v) + '′' } };
      o.plugins.fasce = opz.fasce || {};
      if (opz.y) Object.assign(o.scales.y, opz.y);
      o.scales.y.ticks.callback = (v) => (opz.tick ? opz.tick(v) : v);
      o.plugins.tooltip.filter = (it) => it.parsed.y != null;
      return o;
    };
    const punti = (arr) => arr.map((v, i) => ({ x: labels[i], y: v }));
    const ds = (data, colore, extra = {}) => ({ data, borderColor: colore, backgroundColor: colore, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.25, spanGaps: false, ...extra });
    const nuovo = (id, cfg) => { const el = document.getElementById(id); if (!el) return; cfg.plugins = [fascePlugin, sync]; const ch = new Chart(el, cfg); gruppo.push(ch); sheetCharts.push(ch); };

    if (s.hr) {
      const zc = [1, 2, 3, 4, 5].map((i) => alpha(cssVar('--zone-' + i), 0.16));
      const fasce = a.zone.map((z, i) => ({ da: z.da, a: i === a.zone.length - 1 ? 250 : z.a + 1, colore: zc[i] }));
      const linee = pr && pr.lim ? [{ v: pr.lim, colore: cssVar('--warn'), testo: T('limite ', 'cap ') + pr.lim }] : [];
      const hrv = s.hr.filter((x) => x);
      nuovo('dd-hr', { type: 'line', data: { datasets: [ds(punti(s.hr), cssVar('--c-cuore'))] },
        options: base((v) => fmt0(v) + ' bpm', { fasce: { fasce, linee }, y: { min: Math.max(50, Math.floor((Math.min(...hrv) - 8) / 10) * 10), max: Math.ceil((Math.max(...hrv, pr && pr.lim || 0) + 8) / 10) * 10 } }) });
    }
    const passo = s.v.map((v) => (v && v > 0.8 ? Math.min(900, 1000 / v) : null));
    const corsa = passo.map((p, i) => (s.c[i] ? p : null)), cammino = passo.map((p, i) => (!s.c[i] ? p : null));
    const pv = passo.filter((x) => x);
    nuovo('dd-passo', { type: 'line', data: { datasets: [ds(punti(corsa), accent), ds(punti(cammino), alpha(muted, 0.7))] },
      options: base((v) => fmtPasso(v) + '/km', { tick: (v) => fmtPasso(v), y: { reverse: true, min: Math.max(150, Math.floor((Math.min(...pv) - 20) / 30) * 30), max: Math.min(900, Math.ceil((Math.max(...pv) + 20) / 30) * 30) } }) });
    if (s.cad) {
      const cv = s.cad.filter((x) => x);
      nuovo('dd-cad', { type: 'line', data: { datasets: [ds(punti(s.cad), accent2, { borderWidth: 0, pointRadius: 1.5, showLine: false })] },
        options: base((v) => fmt0(v) + T(' ppm', ' spm'), { fasce: { linee: [{ v: 165, colore: alpha(muted, 0.8), testo: '165' }] }, y: { min: Math.max(60, Math.floor((Math.min(...cv) - 10) / 10) * 10), max: Math.max(185, Math.ceil(Math.max(...cv) / 10) * 10) } }) });
    }
    if (s.pw) {
      nuovo('dd-pw', { type: 'line', data: { datasets: [ds(punti(s.pw), cssVar('--c-attivita'), { spanGaps: 30 / 60 })] },
        options: base((v) => fmt0(v) + ' W') });
    }
    if (s.alt) {
      nuovo('dd-alt', { type: 'line', data: { datasets: [ds(punti(s.alt), muted, { fill: 'start', backgroundColor: alpha(muted, 0.18) })] },
        options: base((v) => fmt0(v) + ' m') });
    }
  }

  /* ---------------------------- Mappa ----------------------------------- */
  let mappaPronta = null;
  function caricaMappa() {
    if (window.maplibregl) return Promise.resolve();
    if (mappaPronta) return mappaPronta;
    mappaPronta = new Promise((ok, ko) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = '/vendor/maplibre-gl-4.7.1.css';
      document.head.appendChild(css);
      const js = document.createElement('script');
      js.src = '/vendor/maplibre-gl-4.7.1.js';
      js.onload = () => ok(); js.onerror = () => { mappaPronta = null; ko(new Error('maplibre')); };
      document.head.appendChild(js);
    });
    return mappaPronta;
  }

  // Disegna il percorso (verde = corsa, grigio = camminata) su una mappa stile "Google Maps"
  // (OpenFreeMap, stile Liberty, vettoriale e senza chiave). Restituisce una funzione che
  // sposta il segnaposto sul punto i della serie, sincronizzata con i grafici.
  // Vista satellitare (Esri World Imagery Clarity: le immagini più nitide di Esri) con i nomi di strade e luoghi della mappa vettoriale sopra
  function applicaSatellite(map, tile) {
    const stile = map.getStyle().layers;
    const primoSimbolo = stile.find((l) => l.type === 'symbol');
    map.addSource('satellite', { type: 'raster', tiles: ['https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: tile || (window.devicePixelRatio > 1 ? 64 : 128), maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' });
    map.addLayer({ id: 'satellite', type: 'raster', source: 'satellite', paint: { 'raster-fade-duration': 150 } }, primoSimbolo && primoSimbolo.id);
    stile.forEach((l) => {
      if (['fill', 'line', 'fill-extrusion', 'background', 'hillshade'].includes(l.type)) map.setLayoutProperty(l.id, 'visibility', 'none');
      else if (l.type === 'symbol') { try { map.setPaintProperty(l.id, 'text-color', '#ffffff'); map.setPaintProperty(l.id, 'text-halo-color', 'rgba(0,0,0,0.75)'); map.setPaintProperty(l.id, 'text-halo-width', 1.4); } catch (_) { /* livello senza testo */ } }
    });
  }

  // Percorso da animare (replay nell'app e video da condividere): punti, distanze, durata, zoom e direzione
  function voloPercorso(s) {
    const pts = [];
    for (let i = 0; i < s.lat.length; i++) if (s.lat[i] != null && s.lng[i] != null) pts.push({ p: [s.lng[i], s.lat[i]], i });
    const cum = [0];
    const dist = (a, b) => { const k = Math.cos(a[1] * Math.PI / 180); return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * 111320; };
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + dist(pts[k - 1].p, pts[k].p));
    const tot = cum[cum.length - 1] || 1;
    const trova = (d) => { let lo = 0, hi = cum.length - 1; while (lo < hi - 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; } const f = cum[hi] > cum[lo] ? (d - cum[lo]) / (cum[hi] - cum[lo]) : 0; return { k: lo, p: [pts[lo].p[0] + (pts[hi].p[0] - pts[lo].p[0]) * f, pts[lo].p[1] + (pts[hi].p[1] - pts[lo].p[1]) * f] }; };
    const dirA = (a, b) => { const k = Math.cos(a[1] * Math.PI / 180); return Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180 / Math.PI; };
    const passoA = (i) => {
      if (!s.d || !s.t) return null;
      const a = Math.max(0, i - 15), b = Math.min(s.t.length - 1, i + 15);
      const dd = (s.d[b] || 0) - (s.d[a] || 0), dt = s.t[b] - s.t[a];
      return dd > 0.01 ? dt / dd : null;
    };
    return {
      pts, tot, trova, dirA, passoA,
      durata: Math.min(30, Math.max(10, 8 + tot / 1000 * 1.2)) * 1000, // "1×" è già veloce: più godibile
      zoom: tot < 6000 ? 14.9 : tot < 15000 ? 14.4 : 13.9, // vista alta: si vede il percorso intorno, niente giramenti di testa
      avanti: Math.min(900, Math.max(300, tot * 0.08)), // la direzione guarda lontano: ignora le curve brevi
    };
  }

  async function disegnaMappa(s, corsa) {
    const el = document.getElementById('dd-map');
    if (!el) return null;
    const errore = () => { el.innerHTML = '<div class="empty" style="padding:40px 16px">' + T('Mappa non disponibile (serve la connessione a internet)', 'Map unavailable (internet connection needed)') + '</div>'; };
    try { await caricaMappa(); } catch (_) { errore(); return null; }
    if (!document.body.contains(el)) return null;
    const ml = window.maplibregl;
    // tratti consecutivi con lo stesso stato (corsa / camminata)
    const pezzi = [];
    for (let i = 0; i < s.lat.length; i++) {
      if (s.lat[i] == null) continue;
      const p = [s.lng[i], s.lat[i]], c = s.c[i] ? 1 : 0;
      const ult = pezzi[pezzi.length - 1];
      if (ult && ult.c === c) ult.pt.push(p);
      else { if (ult) ult.pt.push(p); pezzi.push({ c, pt: ult ? [ult.pt[ult.pt.length - 1], p] : [p] }); }
    }
    const tutti = pezzi.flatMap((x) => x.pt);
    if (tutti.length < 2) { errore(); return null; }
    const bounds = tutti.reduce((b, p) => b.extend(p), new ml.LngLatBounds(tutti[0], tutti[0]));
    const mobile = window.matchMedia('(pointer: coarse)').matches;
    let map;
    try {
      map = new ml.Map({
        container: el, style: 'https://tiles.openfreemap.org/styles/liberty',
        bounds, fitBoundsOptions: { padding: { top: 64, bottom: 36, left: 32, right: 32 }, maxZoom: 16 },
        attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false,
        cooperativeGestures: mobile, // sul telefono: due dita per muovere, la pagina scorre normalmente
        locale: { 'CooperativeGesturesHandler.MobileHelpText': T('Usa due dita per muovere la mappa', 'Use two fingers to move the map'), 'CooperativeGesturesHandler.WindowsHelpText': T('Usa Ctrl + rotella per lo zoom', 'Use Ctrl + scroll to zoom'), 'CooperativeGesturesHandler.MacHelpText': T('Usa ⌘ + rotella per lo zoom', 'Use ⌘ + scroll to zoom') },
      });
    } catch (_) { errore(); return null; }
    sheetCharts.push({ destroy: () => map.remove() });
    const accent = cssVar('--accent');
    const ini = tutti[0], fin = tutti[tutti.length - 1];
    const vicini = Math.hypot((ini[0] - fin[0]) * Math.cos(ini[1] * Math.PI / 180), ini[1] - fin[1]) * 111320 < 60;
    let pronta = false;
    map.on('load', () => {
      map.resize();
      map.fitBounds(bounds, { padding: { top: 64, bottom: 36, left: 32, right: 32 }, maxZoom: 16, duration: 0 });
      // mappa pulita: niente fermate dei bus e punti di interesse
      map.getStyle().layers.filter((l) => /poi|transit|bus|aeroway|airport/i.test(l.id) && l.type === 'symbol').forEach((l) => map.setLayoutProperty(l.id, 'visibility', 'none'));
      applicaSatellite(map);
      // crediti compressi nell'icona "i"
      el.querySelectorAll('.maplibregl-compact-show').forEach((x) => x.classList.remove('maplibregl-compact-show'));
      map.addSource('percorso', { type: 'geojson', data: { type: 'FeatureCollection', features: pezzi.map((x) => ({ type: 'Feature', properties: { c: x.c }, geometry: { type: 'LineString', coordinates: x.pt } })) } });
      const lay = { type: 'line', source: 'percorso', layout: { 'line-cap': 'round', 'line-join': 'round' } };
      map.addLayer({ ...lay, id: 'alone', paint: { 'line-color': '#ffffff', 'line-width': 9 } });
      map.addLayer({ ...lay, id: 'cammino', filter: ['==', ['get', 'c'], 0], paint: { 'line-color': '#8e8e93', 'line-width': 5 } });
      map.addLayer({ ...lay, id: 'corsa', filter: ['==', ['get', 'c'], 1], paint: { 'line-color': accent, 'line-width': 5.5 } });
      const pt = (coord, tipo) => ({ type: 'Feature', properties: { tipo }, geometry: { type: 'Point', coordinates: coord } });
      map.addSource('estremi', { type: 'geojson', data: { type: 'FeatureCollection', features: vicini ? [pt(ini, 'start')] : [pt(fin, 'end'), pt(ini, 'start')] } });
      map.addLayer({ id: 'estremi', type: 'circle', source: 'estremi', paint: { 'circle-radius': 7, 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff', 'circle-color': ['match', ['get', 'tipo'], 'start', accent, cssVar('--danger')] } });
      map.addSource('punto', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'punto', type: 'circle', source: 'punto', paint: { 'circle-radius': 8, 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff', 'circle-color': cssVar('--c-cuore'), 'circle-pitch-alignment': 'map' } });
      // ---- Rivivi la corsa: replay 3D del percorso ----
      map.addSource('linea', { type: 'geojson', lineMetrics: true, data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: tutti } } });
      map.addLayer({ id: 'fatto', type: 'line', source: 'linea', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-width': 7, 'line-gradient': ['step', ['line-progress'], accent, 0.000001, 'rgba(0,0,0,0)'] } }, 'estremi');
      const wrap = el.parentNode;
      wrap.insertAdjacentHTML('beforeend', '<button type="button" class="rv-play" aria-label="' + T('Riproduci il percorso in 3D', 'Play the route in 3D') + '">' + ICO.play + '</button>');
      wrap.querySelector('.rv-play').addEventListener('click', () => rivivi());
      pronta = true;
    });
    // Replay: la telecamera segue il percorso in 3D, la linea si disegna mentre avanza
    function rivivi() {
      const wrap = el.parentNode;
      if (wrap.classList.contains('rivivi')) return;
      // "Indietro" (gesto o tasto del telefono) chiude il replay e resta sul dettaglio della corsa
      history.pushState({ sheet: 1, rivivi: 1 }, '', location.hash);
      const nf2 = new Intl.NumberFormat(LOC, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const lento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const { pts, tot, durata, zoom, avanti, trova, dirA, passoA } = voloPercorso(s);

      wrap.classList.add('rivivi');
      document.body.classList.add('rivivi-on');
      wrap.insertAdjacentHTML('beforeend',
        '<div class="rv-hud" aria-live="off"><div><b id="rv-km">0,00</b><span>km</span></div><div><b id="rv-t">0:00</b><span>' + T('tempo', 'time') + '</span></div><div><b id="rv-p">–</b><span>/km</span></div>' + (s.hr ? '<div><b id="rv-fc">–</b><span>bpm</span></div>' : '') + (s.alt ? '<div><b id="rv-alt">–</b><span>' + T('m alt.', 'm elev.') + '</span></div>' : '') + '</div>' +
        '<button type="button" class="rv-back" id="rv-x">' + ICO.indietro + '<span>' + T('Indietro', 'Back') + '</span></button>' +
        '<div class="rv-bar"><button type="button" class="rv-btn" id="rv-pp" aria-label="' + T('Pausa', 'Pause') + '">' + ICO.pausa + '</button>' +
          '<div class="rv-prog" id="rv-prog" role="slider" aria-label="' + T('Avanzamento', 'Progress') + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0"><i><b id="rv-fill"></b></i></div>' +
          '<button type="button" class="rv-btn rv-vel" id="rv-vel" aria-label="' + T('Velocità', 'Speed') + '">1×</button></div>');
      const $w = (q) => wrap.querySelector(q);
      ['dragPan', 'scrollZoom', 'touchZoomRotate', 'doubleClickZoom', 'keyboard', 'boxZoom'].forEach((h) => map[h] && map[h].disable());
      map.resize();
      ['alone', 'cammino', 'corsa'].forEach((id) => map.setPaintProperty(id, 'line-opacity', 0.35));
      map.setPaintProperty('punto', 'circle-color', accent); map.setPaintProperty('punto', 'circle-radius', 9);
      map.setLayoutProperty('fatto', 'visibility', 'visible');

      let u = 0, vel = 1, inPausa = false, ultimo = null, raf = null, bearing = dirA(pts[0].p, trova(Math.min(tot, avanti)).p), finito = false;
      const disegna = () => {
        const d = u * tot, { k, p } = trova(d);
        map.setPaintProperty('fatto', 'line-gradient', ['step', ['line-progress'], accent, Math.max(0.000001, u), 'rgba(0,0,0,0)']);
        map.getSource('punto').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }] });
        if (!lento) {
          const dietro = trova(Math.max(0, d - avanti * 0.5)).p, davanti = trova(Math.min(tot, d + avanti)).p;
          let diff = ((dirA(dietro, davanti) - bearing + 540) % 360) - 180;
          bearing += diff * 0.012; // rotazione lenta e morbida
          map.jumpTo({ center: p, bearing, pitch: 48, zoom });
        }
        const i = pts[k].i;
        $w('#rv-km').textContent = nf2.format(s.d ? s.d[i] : d / 1000);
        $w('#rv-t').textContent = s.t ? fmtDurata(s.t[i]) : '–';
        $w('#rv-p').textContent = fmtPasso(passoA(i));
        if (s.hr && $w('#rv-fc')) $w('#rv-fc').textContent = s.hr[i] ? fmt0(s.hr[i]) : '–';
        if (s.alt && $w('#rv-alt')) $w('#rv-alt').textContent = s.alt[i] != null ? fmt0(s.alt[i]) : '–';
        if (u < 1 && $w('.rv-fine')) { $w('.rv-fine').remove(); if ($w('.rv-marchio')) $w('.rv-marchio').remove(); $w('.rv-hud').hidden = false; wrap.classList.remove('rv-finito'); }
        $w('#rv-fill').style.width = (u * 100).toFixed(1) + '%';
        $w('#rv-prog').setAttribute('aria-valuenow', String(Math.round(u * 100)));
      };
      const fine = () => {
        finito = true; inPausa = true;
        // a fine percorso: i dati veri della corsa (gli stessi del dettaglio), non l'ultimo istante
        if (corsa && !$w('.rv-fine')) {
          const r = (l, v, un) => (v == null || v === '–' ? '' : '<div><b>' + v + (un ? '<small>' + un + '</small>' : '') + '</b><span>' + l + '</span></div>');
          const dataTxt = fmtDataLunga(corsa.data).replace(/^./, (x) => x.toUpperCase());
          $w('.rv-hud').hidden = true;
          // marchio come nell'immagine condivisa: nome intero a sinistra, aac.run a destra
          $w('.rv-back').insertAdjacentHTML('afterend', '<div class="rv-marchio"><span>' + ICO.logo + 'Always Adaptive Coach</span><b>aac.run</b></div>');
          $w('.rv-bar').insertAdjacentHTML('beforebegin', '<div class="rv-fine">' +
            '<small class="rv-fine-d">' + esc(dataTxt) + '</small><h3>' + esc(corsa.nome || T('Corsa', 'Run')) + '</h3>' +
            '<div class="rv-fine-km"><b data-km="' + (corsa.distanza || 0) + '">' + fmt1(corsa.distanza) + '</b><small>km</small></div><i class="rv-fine-l"></i>' +
            '<div class="rv-fine-g">' +
            r(T('Tempo', 'Time'), fmtDurata(corsa.tempo)) +
            r(T('Passo', 'Pace'), fmtPasso(corsa.passo_corsa || corsa.passo_medio), '/km') +
            r(T('FC media', 'Avg HR'), corsa.fc_media ? fmt0(corsa.fc_media) : null, 'bpm') +
            r(T('Dislivello', 'Elevation'), corsa.dislivello != null ? fmt0(corsa.dislivello) : null, 'm') +
            '</div></div>');
          wrap.classList.add('rv-finito');
          // i km contano da 0 al valore
          const kb = $w('.rv-fine-km b'), kmFin = Number(kb.dataset.km);
          if (!lento && kmFin > 0) { const t0k = performance.now(); const conta = (now) => { const q = Math.min(1, (now - t0k) / 1100); kb.textContent = fmt1(kmFin * (1 - Math.pow(1 - q, 3))); if (q < 1 && kb.isConnected) requestAnimationFrame(conta); }; requestAnimationFrame(conta); }
        }
        $w('#rv-pp').innerHTML = ICO.play; $w('#rv-pp').setAttribute('aria-label', T('Rivedi', 'Replay'));
        map.fitBounds(bounds, { padding: { top: 120, bottom: corsa ? Math.round(el.clientHeight * 0.46) : 120, left: 40, right: 40 }, pitch: lento ? 0 : 45, bearing: lento ? 0 : bearing, duration: lento ? 0 : 2200, maxZoom: 16 });
        // poi un giro lento intorno al percorso
        if (!lento) map.once('moveend', () => { if (finito && wrap.classList.contains('rivivi')) map.easeTo({ bearing: map.getBearing() + 40, duration: 16000, easing: (t) => t }); });
      };
      const passo = (ts) => {
        if (!wrap.classList.contains('rivivi')) return;
        if (ultimo != null && !inPausa) { u = Math.min(1, u + (ts - ultimo) / durata * vel); disegna(); if (u >= 1) fine(); }
        ultimo = ts;
        raf = requestAnimationFrame(passo);
      };
      const parti = () => { ultimo = null; raf = requestAnimationFrame(passo); };
      // inquadratura iniziale: dall'alto al punto di partenza
      if (lento) { map.fitBounds(bounds, { padding: 60, duration: 0 }); disegna(); setTimeout(parti, 300); }
      else { map.flyTo({ center: pts[0].p, zoom, pitch: 48, bearing, duration: 1800, essential: true }); map.once('moveend', () => { disegna(); parti(); }); }

      const pp = () => {
        if (finito) { finito = false; u = 0; inPausa = false; if (!lento) map.flyTo({ center: pts[0].p, zoom, pitch: 48, bearing, duration: 1200 }); }
        else inPausa = !inPausa;
        $w('#rv-pp').innerHTML = inPausa ? ICO.play : ICO.pausa;
        $w('#rv-pp').setAttribute('aria-label', inPausa ? T('Riprendi', 'Resume') : T('Pausa', 'Pause'));
      };
      $w('#rv-pp').addEventListener('click', pp);
      $w('#rv-vel').addEventListener('click', (e) => { vel = vel === 1 ? 2 : vel === 2 ? 4 : 1; e.currentTarget.textContent = vel + '×'; });
      const cerca = (x) => { const r = $w('#rv-prog').getBoundingClientRect(); u = Math.min(0.999, Math.max(0, (x - r.left) / r.width)); finito = false; disegna(); };
      // trascinare la barra porta avanti o indietro (durante il trascinamento il replay è fermo)
      let trascina = false, eraInPausa = false;
      $w('#rv-prog').addEventListener('pointerdown', (e) => { trascina = true; eraInPausa = inPausa; inPausa = true; $w('#rv-prog').setPointerCapture(e.pointerId); cerca(e.clientX); });
      $w('#rv-prog').addEventListener('pointermove', (e) => { if (trascina) cerca(e.clientX); });
      const lascia = () => { if (!trascina) return; trascina = false; inPausa = eraInPausa; $w('#rv-pp').innerHTML = inPausa ? ICO.play : ICO.pausa; };
      $w('#rv-prog').addEventListener('pointerup', lascia);
      $w('#rv-prog').addEventListener('pointercancel', lascia);
      $w('#rv-prog').addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); u = Math.min(0.999, Math.max(0, u + (e.key === 'ArrowRight' ? 0.05 : -0.05))); finito = false; disegna(); } });
      const chiudi = () => {
        chiudiRivivi = null;
        cancelAnimationFrame(raf);
        wrap.classList.remove('rivivi', 'rv-finito'); document.body.classList.remove('rivivi-on');
        wrap.querySelectorAll('.rv-hud, .rv-bar, .rv-back, .rv-fine, .rv-marchio').forEach((x) => x.remove());
        map.setLayoutProperty('fatto', 'visibility', 'none');
        ['alone', 'cammino', 'corsa'].forEach((id) => map.setPaintProperty(id, 'line-opacity', 1));
        map.getSource('punto').setData({ type: 'FeatureCollection', features: [] });
        map.setPaintProperty('punto', 'circle-color', cssVar('--c-cuore')); map.setPaintProperty('punto', 'circle-radius', 8);
        ['dragPan', 'scrollZoom', 'touchZoomRotate', 'doubleClickZoom', 'keyboard', 'boxZoom'].forEach((h) => map[h] && map[h].enable());
        map.resize();
        map.fitBounds(bounds, { padding: { top: 64, bottom: 36, left: 32, right: 32 }, maxZoom: 16, pitch: 0, bearing: 0, duration: 0 });
        document.removeEventListener('keydown', tasto, true);
        wrap.querySelector('.rv-play').focus();
      };
      chiudiRivivi = chiudi;
      const tasto = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); history.back(); } else if (e.key === ' ' && e.target === document.body) { e.preventDefault(); pp(); } };
      document.addEventListener('keydown', tasto, true);
      $w('#rv-x').addEventListener('click', () => history.back());
      sheetCharts.push({ destroy: () => { chiudiRivivi = null; cancelAnimationFrame(raf); document.body.classList.remove('rivivi-on'); document.removeEventListener('keydown', tasto, true); } });
      $w('#rv-pp').focus();
    }

    map.on('error', () => {});
    return (i) => {
      if (!pronta) return;
      const ok = i != null && s.lat[i] != null;
      map.getSource('punto').setData({ type: 'FeatureCollection', features: ok ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [s.lng[i], s.lat[i]] } }] : [] });
    };
  }

  /* ---------------------------- Salute ---------------------------------- */
  const METRICHE = {
    fc_riposo: { cat: 'cuore', nome: () => T('FC a riposo', 'Resting HR'), u: 'bpm', tipo: 'line', fmt: (v) => fmt0(v), meglio: 'basso', base: 'base_fc_riposo',
      cosa: () => T('I battiti al minuto a riposo, misurati dall’orologio durante la giornata e il sonno. Con l’allenamento aerobico tende a scendere di qualche battito nell’arco di mesi.', 'Beats per minute at rest, measured by your watch through the day and during sleep. With aerobic training it tends to drop a few beats over months.'),
      coach: () => T('Se oggi è <b>almeno 5 bpm sopra</b> la tua media delle 4 settimane precedenti, il coach riduce la seduta del giorno a circa il 60%. Se succede 3 o più giorni in una settimana, la settimana si ripete.', 'If today it is <b>at least 5 bpm above</b> your average of the previous 4 weeks, the coach cuts the day’s session to about 60%. If it happens on 3 or more days in a week, the week is repeated.') },
    hrv: { cat: 'cuore', nome: () => 'HRV', u: 'ms', tipo: 'line', fmt: (v) => fmt0(v), meglio: 'alto', base: 'base_hrv',
      cosa: () => T('La variabilità del battito (SDNN con Apple Watch, rMSSD con Garmin e altri: scale diverse, per questo conta solo il confronto con la tua media). Valori più alti del tuo solito indicano un sistema nervoso riposato; varia molto da persona a persona, quindi conta il confronto con te stesso.', 'Heart-rate variability (SDNN on Apple Watch, rMSSD on Garmin and others: different scales, which is why only the comparison with your own average matters). Values above your usual mean a rested nervous system; it varies a lot between people, so what matters is comparing with yourself.'),
      coach: () => T('Se oggi è <b>almeno il 15% sotto</b> la tua media delle 4 settimane precedenti, il coach riduce la seduta del giorno. 3 o più giorni così in una settimana → la settimana si ripete.', 'If today it is <b>at least 15% below</b> your average of the previous 4 weeks, the coach lightens the day’s session. 3 or more such days in a week → the week is repeated.') },
    sonno_sec: { cat: 'sonno', nome: () => T('Sonno', 'Sleep'), u: '', tipo: 'bar', fmt: (v) => fmtOre(v), meglio: 'alto', conv: (v) => v / 3600, tick: (v) => v + 'h',
      cosa: () => T('Le ore dormite registrate dall’orologio (serve indossarlo di notte con il monitoraggio del sonno attivo).', 'Hours slept as recorded by your watch (wear it at night with sleep tracking on).'),
      coach: () => T('Se dormi <b>meno di 5h30</b>, la seduta del giorno viene alleggerita.', 'If you sleep <b>less than 5h30</b>, the day’s session is lightened.') },
    passi: { cat: 'attivita', nome: () => T('Passi', 'Steps'), u: '', tipo: 'bar', fmt: (v) => fmt0(v), meglio: 'alto',
      cosa: () => T('I passi della giornata. Utile per capire quanto ti muovi al di fuori degli allenamenti.', 'Daily steps. Useful to see how much you move outside workouts.'),
      coach: () => T('Solo informativo: il coach non lo usa per adattare il piano.', 'Informational only: the coach does not use it to adapt the plan.') },
    piani: { cat: 'attivita', nome: () => T('Piani saliti', 'Floors climbed'), u: '', tipo: 'bar', fmt: (v) => fmt0(v), meglio: 'alto',
      cosa: () => T('I piani di scale saliti nella giornata, misurati dall’altimetro dell’orologio.', 'Flights of stairs climbed during the day, measured by your watch’s altimeter.'),
      coach: () => T('Solo informativo: il coach non lo usa per adattare il piano.', 'Informational only: the coach does not use it to adapt the plan.') },
    calorie: { cat: 'attivita', nome: () => T('Calorie allenamenti', 'Workout calories'), u: 'kcal', tipo: 'bar', fmt: (v) => fmt0(v), meglio: null,
      cosa: () => T('Le calorie attive bruciate negli allenamenti registrati dall’orologio (corse, camminate e altre attività), sommate per giorno. Le calorie di tutta la giornata non arrivano da Intervals.icu, quindi qui ci sono solo quelle degli allenamenti.', 'Active calories burned in the workouts recorded by your watch (runs, walks and other activities), summed per day. All-day calories are not available from Intervals.icu, so only workout calories appear here.'),
      coach: () => T('Solo informativo: il coach non lo usa per adattare il piano.', 'Informational only: the coach does not use it to adapt the plan.') },
    spo2: { cat: 'respiro', nome: () => T('Ossigeno nel sangue', 'Blood oxygen'), u: '%', tipo: 'line', fmt: (v) => fmt1(v), meglio: 'alto',
      cosa: () => T('La saturazione di ossigeno (SpO2). Valori normali a riposo sono tra 95 e 100%.', 'Oxygen saturation (SpO2). Normal resting values are 95–100%.'),
      coach: () => T('Solo informativo: il coach non lo usa per adattare il piano.', 'Informational only: the coach does not use it to adapt the plan.') },
    respirazione: { cat: 'respiro', nome: () => T('Frequenza respiratoria', 'Respiratory rate'), u: T('resp/min', 'br/min'), tipo: 'line', fmt: (v) => fmt1(v), meglio: 'basso',
      cosa: () => T('Respiri al minuto durante il sonno. Un aumento improvviso rispetto al tuo solito può accompagnare stanchezza o un malanno in arrivo.', 'Breaths per minute during sleep. A sudden rise above your usual can come with fatigue or an oncoming illness.'),
      coach: () => T('Solo informativo: il coach non lo usa per adattare il piano.', 'Informational only: the coach does not use it to adapt the plan.') },
    fc_sonno: { cat: 'cuore', nome: () => T('FC nel sonno', 'Sleeping HR'), u: 'bpm', tipo: 'line', fmt: (v) => fmt0(v), meglio: 'basso',
      cosa: () => T('La frequenza cardiaca media mentre dormi.', 'Average heart rate while you sleep.'),
      coach: () => T('Solo informativo: il coach non lo usa per adattare il piano.', 'Informational only: the coach does not use it to adapt the plan.') },
    vo2max: { cat: 'cuore', nome: () => 'VO2max', u: 'ml/kg/min', tipo: 'line', fmt: (v) => fmt1(v), meglio: 'alto',
      cosa: () => T('La stima dell’orologio della tua capacità aerobica massima: si aggiorna dopo camminate e corse all’aperto.', 'Your watch’s estimate of your maximal aerobic capacity: it updates after outdoor walks and runs.'),
      coach: () => T('Solo informativo: il coach non lo usa per adattare il piano.', 'Informational only: the coach does not use it to adapt the plan.') },
    peso: { cat: 'corpo', nome: () => T('Peso', 'Weight'), u: 'kg', tipo: 'line', fmt: (v) => fmt1(v), meglio: null,
      cosa: () => T('Il peso registrato nella tua app di salute o sulla bilancia collegata a Intervals.icu.', 'Weight recorded in your health app or a scale linked to Intervals.icu.'),
      coach: () => T('Solo informativo: il coach non lo usa per adattare il piano.', 'Informational only: the coach does not use it to adapt the plan.') },
    grasso: { cat: 'corpo', nome: () => T('Massa grassa', 'Body fat'), u: '%', tipo: 'line', fmt: (v) => fmt1(v), meglio: null,
      cosa: () => T('La percentuale di massa grassa misurata da una bilancia smart o inserita nella tua app di salute.', 'Body-fat percentage measured by a smart scale or entered in your health app.'),
      coach: () => T('Solo informativo: il coach non lo usa per adattare il piano.', 'Informational only: the coach does not use it to adapt the plan.') },
    sonno_score: { cat: 'sonno', nome: () => T('Qualità del sonno', 'Sleep score'), u: '/100', tipo: 'line', fmt: (v) => fmt0(v), meglio: 'alto',
      cosa: () => T('Il punteggio del sonno calcolato dal tuo orologio (durata, fasi e risvegli).', 'The sleep score computed by your watch (duration, stages and awakenings).'),
      coach: () => T('Solo informativo: il coach non lo usa per adattare il piano.', 'Informational only: the coach does not use it to adapt the plan.') },
    pressione_max: { cat: 'cuore', nome: () => T('Pressione massima', 'Systolic pressure'), u: 'mmHg', tipo: 'line', fmt: (v) => fmt0(v), meglio: 'basso',
      cosa: () => T('La pressione sistolica registrata con un misuratore collegato o inserita nella tua app di salute.', 'Systolic pressure recorded with a connected monitor or entered in your health app.'),
      coach: () => T('Solo informativo: il coach non lo usa per adattare il piano.', 'Informational only: the coach does not use it to adapt the plan.') },
    pressione_min: { cat: 'cuore', nome: () => T('Pressione minima', 'Diastolic pressure'), u: 'mmHg', tipo: 'line', fmt: (v) => fmt0(v), meglio: 'basso',
      cosa: () => T('La pressione diastolica registrata con un misuratore collegato o inserita nella tua app di salute.', 'Diastolic pressure recorded with a connected monitor or entered in your health app.'),
      coach: () => T('Solo informativo: il coach non lo usa per adattare il piano.', 'Informational only: the coach does not use it to adapt the plan.') },
    glicemia: { cat: 'corpo', nome: () => T('Glicemia', 'Blood glucose'), u: 'mmol/L', tipo: 'line', fmt: (v) => fmt1(v), meglio: null,
      cosa: () => T('La glicemia inserita nella tua app di salute o da un sensore collegato.', 'Blood glucose entered in your health app or from a connected sensor.'),
      coach: () => T('Solo informativo: il coach non lo usa per adattare il piano.', 'Informational only: the coach does not use it to adapt the plan.') },
  };
  const RANGE = () => [[7, T('S', 'W')], [30, T('M', 'M')], [90, T('3M', '3M')], [365, T('A', 'Y')]];

  async function apriSalute() {
    if (!Object.hasOwn(METRICHE, saluteMetrica)) saluteMetrica = 'fc_riposo'; // solo metriche note (il valore arriva dall'URL)
    if (!storiaSalute) {
      mostraSheet(T('Salute e recupero', 'Health and recovery'), '<div class="skeleton" style="height:320px"></div>');
      try { storiaSalute = await caricaJson('/api/salute/storia'); }
      catch (e) { mostraSheet(T('Salute e recupero', 'Health and recovery'), '<div class="card empty">' + esc(e.message) + '</div>'); return; }
    }
    renderSaluteSheet();
  }

  // Approfondimenti per ogni parametro di Salute: come si misura, valori di riferimento, cosa lo fa cambiare, consiglio
  const DETTAGLI_SALUTE = {
    fc_riposo: [
      ['Come si misura', 'L’orologio prende i battiti più bassi e stabili della giornata, di solito di notte. Apple Watch, Garmin e gli altri usano metodi un po’ diversi: per questo conta il confronto con la tua media, non con quella di un altro.', 'How it’s measured', 'Your watch takes the lowest, steadiest heart rate of the day, usually at night. Apple Watch, Garmin and others use slightly different methods: that’s why the comparison with your own average matters, not with someone else’s.'],
      ['Valori di riferimento', 'Negli adulti tra 50 e 80 bpm; chi corre con regolarità scende spesso sotto 60. Quello che conta è la tua tendenza nel tempo.', 'Reference values', 'In adults between 50 and 80 bpm; regular runners often go below 60. What matters is your own trend over time.'],
      ['Cosa la fa salire', 'Allenamenti duri o ravvicinati, poco sonno, stress, alcol, caldo, disidratazione e i primi giorni di un raffreddore. Spesso sale prima che tu senta la stanchezza.', 'What raises it', 'Hard or back-to-back workouts, short sleep, stress, alcohol, heat, dehydration and the first days of a cold. It often rises before you feel tired.'],
      ['Consiglio', 'Se resta alta 2–3 giorni di fila, rallenta anche tu: il coach lo fa già, ma ascoltati. È anche il dato da cui partono le tue zone cardiache personali.', 'Tip', 'If it stays high for 2–3 days in a row, slow down too: the coach already does, but listen to yourself. It is also where your personal heart-rate zones start from.'],
    ],
    hrv: [
      ['Come si misura', 'Di notte l’orologio misura le piccole differenze di tempo tra un battito e l’altro. Garmin e la maggior parte usano l’rMSSD, Apple l’SDNN: numeri su scale diverse.', 'How it’s measured', 'At night your watch measures the tiny differences in time between heartbeats. Garmin and most others use rMSSD, Apple uses SDNN: numbers on different scales.'],
      ['Valori di riferimento', 'Non esiste un valore “giusto”: dipende da età, genetica e allenamento, e va da 20 a oltre 100 ms. Più alto del tuo solito = sistema nervoso riposato.', 'Reference values', 'There’s no “right” value: it depends on age, genetics and fitness, from 20 to over 100 ms. Higher than your usual = rested nervous system.'],
      ['Cosa la fa scendere', 'Fatica accumulata, sonno scarso, stress, alcol, malattia in arrivo, cene pesanti e tardive.', 'What lowers it', 'Accumulated fatigue, poor sleep, stress, alcohol, an oncoming illness, heavy late dinners.'],
      ['Consiglio', 'Guarda la tendenza di una settimana, non il singolo giorno. Respirazione lenta, sonno regolare e giorni facili davvero facili la fanno risalire.', 'Tip', 'Look at the weekly trend, not a single day. Slow breathing, regular sleep and truly easy easy days bring it back up.'],
    ],
    sonno_sec: [
      ['Come si misura', 'Dal movimento e dai battiti mentre dormi. La durata è affidabile; le fasi del sonno sono solo una stima.', 'How it’s measured', 'From movement and heart rate while you sleep. Duration is reliable; sleep stages are only an estimate.'],
      ['Valori di riferimento', 'Gli adulti hanno bisogno di 7–9 ore; chi si allena ne trae beneficio anche dalla parte alta.', 'Reference values', 'Adults need 7–9 hours; people who train benefit from the upper end too.'],
      ['Perché conta tanto', 'Il corpo si adatta all’allenamento mentre dormi: lì ripara i muscoli e consolida la forma. Poco sonno aumenta il rischio di infortuni e rende le sedute più faticose.', 'Why it matters so much', 'Your body adapts to training while you sleep: that’s where muscles repair and fitness consolidates. Short sleep raises injury risk and makes sessions feel harder.'],
      ['Consiglio', 'Orari regolari, camera fresca e buia, schermi spenti un po’ prima. Una notte corta capita: il coach alleggerisce quella giornata.', 'Tip', 'Regular hours, a cool dark room, screens off a little earlier. A short night happens: the coach eases that day.'],
    ],
    sonno_score: [
      ['Come si calcola', 'Un punteggio da 0 a 100 dell’orologio che combina durata, regolarità, fasi e risvegli. Ogni marca ha la sua formula; Apple non lo fornisce.', 'How it’s calculated', 'A 0–100 score from your watch combining duration, regularity, stages and awakenings. Each brand has its own formula; Apple doesn’t provide one.'],
      ['Come leggerlo', 'Sopra 80 buono, tra 60 e 80 discreto, sotto 60 scarso. Più utile della singola notte è la tendenza.', 'How to read it', 'Above 80 good, 60–80 fair, below 60 poor. The trend is more useful than a single night.'],
    ],
    passi: [
      ['Come si misura', 'L’accelerometro dell’orologio o del telefono conta i passi di tutta la giornata, allenamenti compresi.', 'How it’s measured', 'The accelerometer in your watch or phone counts steps all day, workouts included.'],
      ['Valori di riferimento', 'Tra 7.000 e 10.000 al giorno sono associati a benefici per la salute, oltre all’allenamento.', 'Reference values', 'Between 7,000 and 10,000 a day are linked to health benefits, on top of training.'],
      ['Consiglio', 'Nei giorni di riposo camminare aiuta il recupero. Una giornata da 25.000 passi però è carico: tienilo presente prima di un lungo.', 'Tip', 'On rest days walking helps recovery. A 25,000-step day is load, though: keep it in mind before a long run.'],
    ],
    piani: [
      ['Come si misura', 'L’altimetro barometrico dell’orologio conta circa 3 metri di salita come un piano.', 'How it’s measured', 'Your watch’s barometric altimeter counts about 3 metres of climbing as one floor.'],
      ['Consiglio', 'Le scale sono un ottimo rinforzo per polpacci e glutei: aiutano anche la corsa.', 'Tip', 'Stairs are great strength work for calves and glutes: they help your running too.'],
    ],
    calorie: [
      ['Come si calcola', 'L’orologio stima l’energia spesa da battiti, peso, età e movimento. È una stima, con un margine anche del 20%.', 'How it’s calculated', 'Your watch estimates the energy spent from heart rate, weight, age and movement. It’s an estimate, with a margin of up to 20%.'],
      ['Consiglio', 'Nei giorni di lungo e di qualità mangia abbastanza carboidrati: correre a stomaco vuoto rende le sedute più dure e il recupero più lento.', 'Tip', 'On long-run and quality days eat enough carbs: running on empty makes sessions harder and recovery slower.'],
    ],
    spo2: [
      ['Come si misura', 'Con la luce rossa e infrarossa del sensore, di solito di notte. Al polso è meno precisa di un pulsossimetro da dito.', 'How it’s measured', 'With the sensor’s red and infrared light, usually at night. At the wrist it’s less precise than a finger pulse oximeter.'],
      ['Valori di riferimento', 'Normale tra 95 e 100%. In quota scende un po’, ed è normale.', 'Reference values', 'Normal between 95 and 100%. At altitude it drops a little, and that’s normal.'],
      ['Attenzione', 'Valori bassi ripetuti, soprattutto con fiato corto, sono da sentire con un medico: AAC non fa diagnosi.', 'Caution', 'Repeated low values, especially with shortness of breath, are worth checking with a doctor: AAC doesn’t diagnose.'],
    ],
    respirazione: [
      ['Come si misura', 'Dalle piccole variazioni del battito legate al respiro, mentre dormi.', 'How it’s measured', 'From the small heart-rate changes linked to breathing, while you sleep.'],
      ['Valori di riferimento', 'A riposo tra 12 e 20 respiri al minuto. È un dato molto stabile in ogni persona.', 'Reference values', 'At rest between 12 and 20 breaths per minute. It’s very stable for each person.'],
      ['Perché guardarla', 'Proprio perché è stabile, un aumento di 2–3 respiri sul tuo solito è un segnale precoce di malanno o di fatica.', 'Why watch it', 'Precisely because it’s stable, a rise of 2–3 breaths over your usual is an early sign of illness or fatigue.'],
    ],
    fc_sonno: [
      ['Come si misura', 'La media dei battiti durante il sonno.', 'How it’s measured', 'The average heart rate during sleep.'],
      ['Come leggerla', 'Di solito qualche battito sopra la FC a riposo. Se sale rispetto al tuo solito, il corpo sta ancora lavorando: digestione, alcol, fatica o un malanno.', 'How to read it', 'Usually a few beats above resting HR. If it rises above your usual, your body is still working: digestion, alcohol, fatigue or an illness.'],
    ],
    vo2max: [
      ['Come si misura', 'L’orologio lo stima dal rapporto tra passo e battiti nelle corse e camminate all’aperto con GPS. È una stima: un test in laboratorio può dare un valore diverso.', 'How it’s measured', 'Your watch estimates it from the relationship between pace and heart rate on outdoor runs and walks with GPS. It’s an estimate: a lab test may give a different value.'],
      ['Valori di riferimento', 'Dipende da età e sesso: per un uomo di 30–40 anni, sopra 45 è buono; per una donna, sopra 38. Le tabelle cambiano con l’età.', 'Reference values', 'It depends on age and sex: for a man aged 30–40, above 45 is good; for a woman, above 38. The tables change with age.'],
      ['Cosa lo fa salire', 'La costanza: tante corse facili e un po’ di lavoro intenso, come il 4×4 norvegese. Sale lentamente, in settimane e mesi.', 'What raises it', 'Consistency: lots of easy running and some hard work, like the Norwegian 4×4. It rises slowly, over weeks and months.'],
    ],
    peso: [
      ['Da dove arriva', 'Dalla bilancia collegata a Intervals.icu o dall’app di salute; se inserisci il peso nel profilo, vale il dato più recente.', 'Where it comes from', 'From a scale linked to Intervals.icu or your health app; if you enter your weight in the profile, the most recent value wins.'],
      ['Come leggerlo', 'Varia di 1–2 kg da un giorno all’altro per acqua e cibo: conta la media di qualche settimana. Pesati sempre nello stesso momento, per esempio al mattino.', 'How to read it', 'It varies by 1–2 kg from day to day because of water and food: the average over a few weeks is what counts. Weigh yourself at the same time, for example in the morning.'],
      ['Consiglio', 'Con il peso e l’altezza AAC calcola il BMI in Salute. Il peso lo decide soprattutto l’alimentazione: la corsa aiuta, ma non fa miracoli.', 'Tip', 'With weight and height AAC computes your BMI in Health. Weight is mostly decided by diet: running helps, but it doesn’t work miracles.'],
    ],
    grasso: [
      ['Come si misura', 'Le bilance smart usano l’impedenza: una piccola corrente attraversa il corpo. Il valore cambia con l’idratazione, quindi conta la tendenza.', 'How it’s measured', 'Smart scales use impedance: a small current passes through your body. The value changes with hydration, so the trend is what counts.'],
      ['Valori di riferimento', 'Indicativamente 10–20% negli uomini e 18–28% nelle donne per chi è sportivo.', 'Reference values', 'Roughly 10–20% for men and 18–28% for women among active people.'],
    ],
    pressione_max: [
      ['Come si misura', 'Con uno sfigmomanometro collegato alla tua app di salute.', 'How it’s measured', 'With a blood-pressure monitor linked to your health app.'],
      ['Valori di riferimento', 'Ottimale sotto 120 mmHg (massima) e 80 (minima). Misurala seduto, a riposo, sempre nello stesso orario.', 'Reference values', 'Optimal below 120 mmHg (systolic) and 80 (diastolic). Measure it seated, at rest, at the same time of day.'],
      ['Attenzione', 'Valori alti ripetuti vanno sentiti con un medico prima di aumentare l’allenamento.', 'Caution', 'Repeated high values should be checked with a doctor before increasing training.'],
    ],
    pressione_min: [
      ['Valori di riferimento', 'Ottimale sotto 80 mmHg. Con l’allenamento aerobico regolare la pressione tende a scendere.', 'Reference values', 'Optimal below 80 mmHg. With regular aerobic training blood pressure tends to drop.'],
    ],
    glicemia: [
      ['Come si misura', 'Da un glucometro o da un sensore continuo collegato all’app di salute.', 'How it’s measured', 'From a glucose meter or a continuous sensor linked to your health app.'],
      ['Valori di riferimento', 'A digiuno di norma 70–100 mg/dL. Durante e dopo lo sport la glicemia si muove: è normale.', 'Reference values', 'Fasting usually 70–100 mg/dL. During and after exercise blood sugar moves: that’s normal.'],
      ['Attenzione', 'In caso di diabete segui le indicazioni del tuo medico su allenamento e alimentazione.', 'Caution', 'If you have diabetes, follow your doctor’s advice on training and nutrition.'],
    ],
  };
  function dettagliSalute(key) {
    const d = DETTAGLI_SALUTE[key];
    if (!d) return '';
    // ogni voce si apre da sola: la pagina resta corta
    return '<section class="card dd-dett"><h3>' + T('Approfondisci', 'Learn more') + '</h3>' +
      d.map(([ti, tx, te, txe]) => '<details class="dd-dv"><summary>' + esc(LANG === 'en' ? te : ti) + '</summary><p>' + esc(LANG === 'en' ? txe : tx) + '</p></details>').join('') +
      '<p class="g-note">' + T('Indicazioni generali, non una diagnosi: per dubbi sulla salute senti un medico.', 'General guidance, not a diagnosis: for health concerns, see a doctor.') + '</p></section>';
  }

  function renderSaluteSheet() {
    const st = storiaSalute, key = saluteMetrica, M = METRICHE[key];
    const disponibili = Object.keys(METRICHE).filter((k) => st.giorni.some((g) => g[k] != null));
    const fine = st.oggi, inizio = addGiorni(fine, -(saluteGiorni - 1));
    const giorniRange = []; for (let d = inizio; d <= fine; d = addGiorni(d, 1)) giorniRange.push(d);
    const perData = new Map(st.giorni.map((g) => [g.data, g]));
    const valori = giorniRange.map((d) => { const g = perData.get(d); return g && g[key] != null ? g[key] : null; });
    const presenti = valori.filter((v) => v != null);
    const med = presenti.length ? presenti.reduce((a, b) => a + b, 0) / presenti.length : null;
    const precInizio = addGiorni(inizio, -saluteGiorni);
    const prec = st.giorni.filter((g) => g.data >= precInizio && g.data < inizio && g[key] != null).map((g) => g[key]);
    const medPrec = prec.length ? prec.reduce((a, b) => a + b, 0) / prec.length : null;
    const ultimo = [...st.giorni].reverse().find((g) => g[key] != null);

    const chips = '<div class="m-chips">' + (disponibili.length ? disponibili : [key]).map((k) => '<button type="button" class="m-chip cat-' + METRICHE[k].cat + (k === key ? ' on' : '') + '" data-metrica="' + k + '">' + esc(METRICHE[k].nome()) + '</button>').join('') + '</div>';
    const seg = '<div class="seg-ctl" role="tablist">' + RANGE().map(([n, l]) => '<button type="button" role="tab" aria-selected="' + (n === saluteGiorni) + '" class="' + (n === saluteGiorni ? 'on' : '') + '" data-range="' + n + '">' + l + '</button>').join('') + '</div>';
    const unita = M.u ? ' <small>' + M.u + '</small>' : '';
    const dv = med != null && medPrec != null ? med - medPrec : null;
    const dvTxt = dv == null ? '–' : ['0', '0,0', '0.0'].includes(M.fmt(Math.abs(dv))) || (key === 'sonno_sec' && Math.abs(dv) < 60) ? T('invariato', 'unchanged') : (dv > 0 ? '+' : dv < 0 ? '−' : '') + M.fmt(Math.abs(dv)) + (key === 'sonno_sec' ? '' : M.u ? ' ' + M.u : '');
    const dvCls = dv == null || !M.meglio || Math.abs(dv) < 1e-9 ? '' : (M.meglio === 'alto') === (dv > 0) ? 'ok' : 'warn';

    let html = chips +
      '<section class="card dd-health cat-' + M.cat + '">' + seg +
        '<div class="dd-big"><span>' + T('Media', 'Average') + '</span><b>' + (med != null ? M.fmt(med) + unita : '–') + '</b><small>' + esc(fmtData(inizio)) + ' – ' + esc(fmtData(fine)) + '</small></div>' +
        (presenti.length ? '<div class="chart-box dd-hchart"><canvas id="dd-salute"></canvas></div>' : '<div class="chart-empty dd-hchart">' + T('Nessun dato in questo periodo', 'No data in this period') + '</div>') +
        (M.base ? '<div class="legend-inline"><span><i style="background:var(--cat)"></i>' + esc(M.nome()) + '</span><span><i style="background:var(--muted)"></i>' + T('tua media (4 sett.)', 'your average (4 wk)') + '</span><span><i style="background:var(--warn)"></i>' + T('soglia del coach', 'coach threshold') + '</span></div>' : '') +
      '</section>' +
      '<section class="card dd-grid">' +
        stat(T('Ultimo valore', 'Latest'), ultimo ? M.fmt(ultimo[key]) + unita : '–', ultimo ? fmtData(ultimo.data) : '') +
        stat(T('Minimo', 'Minimum'), presenti.length ? M.fmt(Math.min(...presenti)) + unita : '–') +
        stat(T('Massimo', 'Maximum'), presenti.length ? M.fmt(Math.max(...presenti)) + unita : '–') +
        '<div class="dd-stat"><span>' + T('Rispetto al periodo prima', 'Versus previous period') + '</span><b class="' + dvCls + '">' + dvTxt + '</b><small>' + (medPrec != null ? T('media precedente ', 'previous avg ') + M.fmt(medPrec) : T('dati insufficienti', 'not enough data')) + '</small></div>' +
        stat(T('Giorni con dato', 'Days with data'), presenti.length + '<small>/' + saluteGiorni + '</small>') +
      '</section>' +
      '<section class="card"><h3>' + T('Cosa significa', 'What it means') + '</h3><p class="dd-p">' + M.cosa() + '</p><h3 class="dd-h2">' + T('Come lo usa il coach', 'How the coach uses it') + '</h3><p class="dd-p">' + M.coach() + '</p></section>' +
      dettagliSalute(key);

    mostraSheet(T('Salute e recupero', 'Health and recovery'), html);
    const chipOn = document.querySelector('.m-chip.on');
    if (chipOn) chipOn.scrollIntoView({ inline: 'center', block: 'nearest' });
    if (presenti.length && typeof Chart !== 'undefined') disegnaSalute(giorniRange, valori, perData, key, M);
  }

  function addGiorni(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

  function disegnaSalute(giorni, valori, perData, key, M) {
    const el = document.getElementById('dd-salute'); if (!el) return;
    const accent = cssVar('--c-' + M.cat), muted = cssVar('--muted'), warn = cssVar('--warn');
    const conv = M.conv || ((v) => v);
    const y = valori.map((v) => (v == null ? null : conv(v)));
    const segn = giorni.map((d) => { const g = perData.get(d); return !!(g && g.segnali && g.segnali.length); });
    const datasets = [];
    if (M.tipo === 'bar') {
      datasets.push({ type: 'bar', data: y, backgroundColor: y.map((v) => (key === 'sonno_sec' && v != null && v < 5.5 ? warn : accent)), borderRadius: 4, borderSkipped: false, maxBarThickness: 18 });
    } else {
      datasets.push({ type: 'line', data: y, borderColor: accent, backgroundColor: accent, borderWidth: 2, tension: 0.15, spanGaps: true,
        pointRadius: giorni.length > 90 ? 0 : y.map((v, i) => (v == null ? 0 : segn[i] ? 4.5 : 3)), pointBackgroundColor: y.map((_, i) => (segn[i] ? warn : accent)), pointBorderColor: cssVar('--surface'), pointBorderWidth: 1.5, pointHoverRadius: 5 });
    }
    if (M.base) {
      const b = giorni.map((d) => { const g = perData.get(d); return g ? g[M.base] : null; });
      datasets.push({ type: 'line', data: b, borderColor: alpha(muted, 0.9), borderWidth: 1.5, borderDash: [4, 4], pointRadius: 0, spanGaps: true, tension: 0.3 });
      const soglia = b.map((v) => (v == null ? null : key === 'fc_riposo' ? v + 5 : v * 0.85));
      datasets.push({ type: 'line', data: soglia, borderColor: alpha(warn, 0.85), borderWidth: 1.5, borderDash: [2, 3], pointRadius: 0, spanGaps: true, tension: 0.3 });
    }
    const o = opzioniBase((c) => {
      if (c.parsed.y == null) return null;
      const nomi = [M.nome(), T('tua media', 'your average'), T('soglia', 'threshold')];
      const v = key === 'sonno_sec' ? fmtOre(c.parsed.y * 3600) : M.fmt(c.parsed.y) + (M.u ? ' ' + M.u : '');
      return ' ' + (c.datasetIndex ? nomi[c.datasetIndex] + ': ' : '') + v;
    }, (it) => fmtDataLunga(giorni[it[0].dataIndex]));
    o.plugins.tooltip.displayColors = false;
    o.plugins.tooltip.filter = (it) => it.parsed.y != null;
    o.scales.x.ticks.callback = (v, i) => fmtData(giorni[i]);
    if (M.tick) o.scales.y.ticks.callback = M.tick;
    if (key === 'sonno_sec') o.plugins.fasce = { linee: [{ v: 5.5, colore: warn, testo: '5h30' }] };
    if (M.tipo === 'bar') o.scales.y.beginAtZero = true;
    sheetCharts.push(new Chart(el, { data: { labels: giorni, datasets }, options: o, plugins: [fascePlugin] }));
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('#sheet-back')) { chiudiSheet(); return; }
    const m = e.target.closest('[data-metrica]');
    if (m) { saluteMetrica = m.dataset.metrica; history.replaceState(history.state, '', '#salute/' + saluteMetrica); renderSaluteSheet(); return; }
    const r = e.target.closest('[data-range]');
    if (r) { saluteGiorni = Number(r.dataset.range); renderSaluteSheet(); return; }
    const sa = e.target.closest('[data-salute]');
    if (sa) { apriSheet('#salute/' + sa.dataset.salute); return; }
    const sd = e.target.closest('[data-seduta]');
    if (sd) { apriSheet('#seduta/' + encodeURIComponent(sd.dataset.seduta)); }
  });

  function render(d) {
    ultimiDati = d;
    renderBadge(d);
    renderSyncInfo(d);
    aggiornaPallinoDiario();
    const pane = (id, titolo, sotto, html) => '<div class="tab-pane" data-pane="' + id + '"' + (id === tabAttiva ? '' : ' hidden') + '>' +
      '<div class="pane-head"><h1>' + titolo + '</h1>' + (sotto ? '<span>' + sotto + '</span>' : '') + '</div>' + html + '</div>';
    $('#main').innerHTML =
      pane('oggi', T('Oggi', 'Today'), esc(fmtDataLunga(d.oggi)).replace(/^./, (x) => x.toUpperCase()),
        renderAttivaNotifiche() + renderAvvisi(d) + renderObiettivoBreve(d) + renderLivello() + renderComeStai(d) + renderOggi(d) + '<div id="ultima-wrap"></div>' + renderSettimana(d)) +
      pane('salute', T('Salute', 'Health'), '', renderSalute(d)) +
      pane('piano', T('Piano', 'Plan'), d.programma ? T('Settimana ', 'Week ') + d.programma.settimana_piano + T(' di ', ' of ') + d.programma.totale_settimane : '',
        renderProgramma(d) + renderGuidaCard()) +
      pane('corse', T('Corse', 'Runs'), T('tocca una corsa per grafici e mappa', 'tap a run for charts and map'), '<div id="corse-wrap"></div>') +
      pane('progressi', T('Progressi', 'Progress'), '',
        renderObiettivo(d) + renderSblocchi(d) + renderPasso(d) + renderPrevisioni(d) + renderCarico(d) + renderCorsa(d) + '<div id="storico-wrap" class="wrap"></div>') +
      pane('info', T('Come funziona', 'How it works'), '', renderInfo(d));
    if (ultimoStorico) { const r = renderStorico(ultimoStorico); $('#storico-wrap').innerHTML = r.stats; $('#corse-wrap').innerHTML = riepilogoCorse(ultimoStorico) + r.elenco + cardScarpe(); renderUltimaCorsa(); }
    aggiornaTabbar();
    aggiornaLivello();
    disegnaGrafici(d);
  }

  async function caricaDati(silenzioso) {
    try {
      const res = await fetch(conLang('/api/coach-data'), { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
      if (res.status === 401 || res.status === 403) { vaiAlLogin(); return; }
      if (!res.ok) throw new Error(T('Errore del server (', 'Server error (') + res.status + ')');
      const ct = res.headers.get('content-type') || '';
      if (ct.indexOf('application/json') === -1) { vaiAlLogin(); return; }
      render(await res.json());
      caricaStorico();
      // il deep dive Salute tiene lo storico in memoria: va riletto a ogni aggiornamento, altrimenti resta fermo alla prima apertura
      if (storiaSalute) caricaJson('/api/salute/storia').then((st) => {
        const cambiato = JSON.stringify(st) !== JSON.stringify(storiaSalute);
        storiaSalute = st;
        if (cambiato && !$('#sheet').hidden && $('#sheet .dd-health')) renderSaluteSheet();
      }).catch(() => { storiaSalute = null; });
    } catch (e) {
      if (!silenzioso || !ultimiDati) $('#main').innerHTML = '<div class="card empty">' + T('Impossibile caricare i dati: ', 'Could not load data: ') + esc(e.message) + '</div>';
      if (silenzioso) console.warn(e);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Sincronizzazione                                                       */
  /* ---------------------------------------------------------------------- */
  function impostaSyncUI(inCorso) {
    syncInCorso = inCorso;
    const btn = $('#acc-sync');
    if (!btn) return;
    btn.disabled = inCorso;
    btn.classList.toggle('loading', inCorso);
    btn.querySelector('span').textContent = inCorso ? T('Sincronizzo…', 'Syncing…') : T('Sincronizza ora', 'Sync now');
  }

  async function sincronizza() {
    if (syncInCorso) return;
    impostaSyncUI(true);
    try {
      const res = await fetch(conLang('/api/sync'), { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'coach', Accept: 'application/json' } });
      if (res.status === 401 || res.status === 403) { vaiAlLogin(); return; }
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.errore || T('Sincronizzazione fallita (', 'Sync failed (') + res.status + ')');
      await caricaDati(false);
      toast(T('Sincronizzato · ' + out.nuove + ' corse nuove, ' + (out.altre_attivita || 0) + ' altre attività, ' + (out.giorni_salute || 0) + ' giorni di salute', 'Synced · ' + out.nuove + ' new runs, ' + (out.altre_attivita || 0) + ' other activities, ' + (out.giorni_salute || 0) + ' health days'), 'ok');
    } catch (e) {
      toast(e.message, 'err');
      await caricaDati(true);
    } finally {
      impostaSyncUI(false);
    }
  }


  /* ---------------------------------------------------------------------- */
  /* Lingua IT / EN                                                         */
  /* ---------------------------------------------------------------------- */
  function applicaTestiStatici() {
    document.documentElement.lang = LANG;
    $('#btn-lingua').textContent = LANG === 'en' ? 'IT' : 'EN';
    $('#sheet-back-t').textContent = T('Indietro', 'Back');
    $('#btn-lingua').setAttribute('aria-label', T('Switch to English', 'Passa all’italiano'));
    $('#btn-lingua').title = T('English', 'Italiano');
    $('#btn-tema').setAttribute('aria-label', T('Cambia tema chiaro/scuro', 'Toggle light/dark theme'));
    $('#btn-tema').title = T('Tema chiaro/scuro', 'Light/dark theme');
  }
  $('#btn-lingua').addEventListener('click', () => {
    LANG = LANG === 'en' ? 'it' : 'en';
    LOC = LANG === 'en' ? 'en-GB' : 'it-IT';
    nf1 = new Intl.NumberFormat(LOC, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    nf0 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 0 });
    try { localStorage.setItem('coach-lingua', LANG); } catch (_) {}
    applicaTestiStatici();
    ultimoStorico = null;
    storiaSalute = null;
    caricaDati(false).then(() => { if (!$('#sheet').hidden) { $('#sheet').hidden = true; rotta(); } });
  });
  applicaTestiStatici();

  document.addEventListener('click', (e) => { if (e.target.closest('#acc-sync')) sincronizza(); });
  setInterval(() => { if (!document.hidden && !syncInCorso) caricaDati(true); }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !syncInCorso) caricaDati(true); });

  caricaDati(false).then(caricaMe).then(rotta);
})();
