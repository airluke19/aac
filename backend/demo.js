'use strict';

/**
 * Demo pubblica con dati simulati (/demo)
 * ---------------------------------------------------------------------------
 * Un atleta di fantasia alla 6a settimana del piano: corse secondo per secondo (con giri e GPS
 * su un anello di fantasia attorno a Parco Sempione, Milano), salute degli ultimi 70 giorni,
 * qualche camminata. Le corse seguono il vero motore del piano, giorno per giorno.
 * Il database si rigenera ogni giorno (date sempre attuali) in /data/demo/demo-AAAA-MM-GG.db.
 * Sola lettura: le scritture sono bloccate a monte (account.js).
 */

const fs = require('fs');
const path = require('path');

const SETTIMANE_FATTE = 5; // la demo e' nella 6a settimana del piano
const VERSIONE = 2; // cambiarla rigenera i dati demo (2: scarpe, orario, meteo)
const CENTRO = { lat: 45.4727, lng: 9.1762 }; // Parco Sempione, Milano

function creaDemo({ BASE, dbPer, chiudiDb, contesto, fn }) {
  const dir = path.join(BASE.dataDir, 'demo');
  let corrente = null; // { giorno, ctx }

  const utente = { id: 'demo', email: 'demo@aac', nome: 'Atleta demo', foto: null, ruolo: 'demo', stato: 'attivo', intervals_key: null, athlete_id: null, eta: 35, programma_ora: '07:00' };

  function contestoDemo() {
    const giorno = fn.oggi();
    if (corrente && corrente.giorno === giorno) return corrente.ctx;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `demo-${giorno}-v${VERSIONE}.db`);
    const nuovo = !fs.existsSync(file);
    const inizio = fn.addDays(giorno, -(SETTIMANE_FATTE * 7 + 3));
    const ctx = {
      utente: { id: 'demo', email: utente.email, ruolo: 'demo' },
      db: dbPer(file),
      cfg: { apiKey: '', athleteId: '', eta: 35, programmaInizio: inizio, programmaOra: '07:00', seedMock: false, obiettivo: 'mezza', intensita: 'equilibrata', intensitaAuto: true },
    };
    if (nuovo) {
      const t0 = Date.now();
      contesto.run(ctx, () => genera(ctx.db, inizio, giorno));
      console.log(`[demo] dati simulati generati per il ${giorno} (${Date.now() - t0} ms)`);
    }
    // rimuove i database demo dei giorni precedenti (solo file demo-*.db in /data/demo)
    const vecchio = corrente;
    corrente = { giorno, ctx, programmaInizio: inizio };
    for (const f of fs.readdirSync(dir)) {
      if (/^demo-\d{4}-\d{2}-\d{2}(-v\d+)?\.db(-wal|-shm)?$/.test(f) && !f.startsWith(path.basename(file))) {
        const p = path.join(dir, f);
        const base = p.replace(/(-wal|-shm)$/, '');
        chiudiDb(base);
        try { fs.unlinkSync(p); } catch (_) { /* gia' rimosso */ }
      }
    }
    return ctx;
  }

  // ---- generatore ----
  function genera(db, inizio, oggi) {
    let seme = 20261106;
    const rnd = () => ((seme = (seme * 16807) % 2147483647) / 2147483647);
    const giorni = [];
    for (let d = fn.addDays(inizio, -70 + SETTIMANE_FATTE * 7); d < oggi; d = fn.addDays(d, 1)) giorni.push(d);

    // salute: FC a riposo in lieve calo, HRV in lieve crescita, qualche notte corta / giorno storto
    const insB = db.prepare(`INSERT INTO benessere (data, ctl, atl, fc_riposo, hrv, sonno_sec, passi, spo2, respirazione, fc_sonno, vo2max, peso)
      VALUES (@data, @ctl, @atl, @fc, @hrv, @sonno, @passi, @spo2, @resp, @fcs, @vo2, @peso)
      ON CONFLICT(data) DO UPDATE SET ctl=@ctl, atl=@atl, fc_riposo=@fc, hrv=@hrv, sonno_sec=@sonno, passi=@passi, spo2=@spo2, respirazione=@resp, fc_sonno=@fcs, vo2max=@vo2, peso=@peso`);
    const storti = new Set([9, 23, 41, 58].map((k) => giorni[k]).filter(Boolean));

    // scarpe: una principale e una per i lunghi
    const nuovaScarpa = db.prepare('INSERT INTO scarpe (nome, km_iniziali, limite_km, predefinita, creata) VALUES (?, ?, ?, ?, ?)');
    const scarpaA = nuovaScarpa.run('Pegasus 41', 180, 700, 1, inizio + 'T08:00:00Z').lastInsertRowid;
    const scarpaB = nuovaScarpa.run('Novablast 5', 25, 700, 0, inizio + 'T08:00:00Z').lastInsertRowid;
    const METEO = [[0, 11], [1, 13], [2, 12], [3, 10], [61, 9], [0, 14], [2, 15], [45, 7], [1, 12], [80, 11], [0, 16], [3, 13]];

    // corse: il piano decide giorno per giorno quale seduta c'e'; ne salto una per realismo
    const carichi = new Map();
    const corse = [];
    let saltata = false;
    for (let i = 0; i < giorni.length; i++) {
      const d = giorni[i];
      const n = giorni.length - i;
      salute(d, n);
      if (d < inizio) continue;
      const prog = fn.costruisciProgramma(d);
      const s = prog && prog.calendario.find((x) => x.data === d);
      if (!s) continue;
      if (!saltata && d >= fn.addDays(inizio, 14) && rnd() < 0.25) { saltata = true; continue; }
      const c = corsa(d, s, corse.length);
      corse.push(c);
      carichi.set(d, c.carico);
      salute(d, n); // aggiorna CTL/ATL del giorno con il carico appena aggiunto
    }

    // camminate del sabato
    const insA = db.prepare('INSERT OR REPLACE INTO altre_attivita (id, data, tipo, nome, durata, distanza, fc_media, calorie, carico) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    giorni.filter((d) => new Date(d + 'T12:00:00Z').getUTCDay() === 6 && !carichi.has(d)).forEach((d, k) => {
      const min = 40 + Math.round(rnd() * 30);
      insA.run(`demo-w${k}`, d, 'Walk', 'Camminata', min * 60, +(min * 0.085).toFixed(2), 98 + Math.round(rnd() * 8), Math.round(min * 4.2), Math.round(min * 0.25));
    });

    function ctlAtl(d) {
      let ctl = 0, atl = 0;
      for (const g of giorni) {
        if (g > d) break;
        const l = carichi.get(g) || 0;
        ctl += (l - ctl) / 42;
        atl += (l - atl) / 7;
      }
      return { ctl: +ctl.toFixed(1), atl: +atl.toFixed(1) };
    }

    function salute(d, n) {
      const brutto = storti.has(d);
      const { ctl, atl } = ctlAtl(d);
      insB.run({
        data: d, ctl, atl,
        fc: Math.round(64 + n * 0.04 + (rnd() - 0.5) * 2.5 + (brutto ? 6 : 0)),
        hrv: Math.round(38 - n * 0.05 + (rnd() - 0.5) * 7 - (brutto ? 9 : 0)),
        sonno: Math.round((7 + (rnd() - 0.5) * 1.4 - (brutto ? 1.8 : 0)) * 3600),
        passi: Math.round(6500 + rnd() * 5500),
        spo2: +(96.5 + rnd() * 2.5).toFixed(1),
        resp: +(14.5 + (rnd() - 0.5) * 1.4).toFixed(1),
        fcs: Math.round(57 + (rnd() - 0.5) * 4 + (brutto ? 4 : 0)),
        vo2: n % 5 === 0 ? +(38.5 + (70 - n) * 0.02).toFixed(1) : null,
        peso: n % 7 === 0 ? +(76.5 - (70 - n) * 0.015 + (rnd() - 0.5) * 0.4).toFixed(1) : null,
      });
    }

    function corsa(d, s, k) {
      const livello = k * 0.06; // migliora un po' a ogni corsa
      // blocchi dal piano (riscaldamento, ripetute corsa/cammino, defaticamento)
      const blocchi = s.segmenti.map((g) => ({ corre: !(g.tipo === 'walk' || g.tipo === 'cool'), sec: Math.round(g.min * 60), tipo: g.tipo }));
      const time = [], vel = [], hr = [], cad = [], dist = [], alt = [], lat = [], lng = [];
      const giri = [];
      let t = 0, dd = 0, h = 86;
      blocchi.forEach((b, bi) => {
        const iniz = { t, d: dd, hr: [], cad: [] };
        for (let i = 0; i < b.sec; i++) {
          const fatica = bi / blocchi.length;
          const v = b.corre ? 2.35 + livello * 0.12 + (rnd() - 0.5) * 0.22 : 1.5 + (rnd() - 0.5) * 0.14;
          const target = b.corre ? 128 + fatica * 10 - livello * 4 + Math.min(i, 90) / 90 * 6 : 103 + fatica * 5;
          h += (target - h) * (b.corre ? 0.035 : 0.025) + (rnd() - 0.5) * 1.1;
          const c = b.corre ? 154 + livello * 3 + (rnd() - 0.5) * 6 : 108 + (rnd() - 0.5) * 6;
          dd += v;
          const p = punto(dd);
          time.push(t); vel.push(+v.toFixed(2)); hr.push(Math.round(h)); cad.push(Math.round(c / 2)); dist.push(+dd.toFixed(1));
          alt.push(+(122 + Math.sin(dd / 320) * 3 + Math.sin(dd / 90) * 0.6).toFixed(1)); lat.push(p.lat); lng.push(p.lng);
          iniz.hr.push(h); iniz.cad.push(c);
          t++;
        }
        const media = (a) => a.reduce((x, y) => x + y, 0) / a.length;
        giri.push({ start_time: iniz.t, elapsed_time: b.sec, moving_time: b.sec, distance: dd - iniz.d, average_speed: (dd - iniz.d) / b.sec,
          average_heartrate: media(iniz.hr), max_heartrate: Math.max(...iniz.hr), average_cadence: media(iniz.cad) / 2 });
      });
      const streams = [
        { type: 'time', data: time }, { type: 'velocity_smooth', data: vel }, { type: 'heartrate', data: hr }, { type: 'cadence', data: cad },
        { type: 'distance', data: dist }, { type: 'fixed_altitude', data: alt }, { type: 'latlng', data: lat, data2: lng },
      ];
      const a = fn.analizzaStream(streams);
      const g = fn.applicaGiri(a, { icu_intervals: giri });
      const T = time.length, km = dd / 1000;
      const fcMedia = hr.reduce((x, y) => x + y, 0) / T;
      const carico = Math.round(T / 60 * (fcMedia > 125 ? 0.75 : 0.6));
      const id = `demo-${d}`;
      const [cod, temp] = METEO[k % METEO.length];
      const meteo = JSON.stringify({ codice: cod, temp, percepita: temp - 1, vento: 6 + (k * 7) % 14, umidita: 55 + (k * 11) % 35, pioggia: cod >= 51 ? 0.6 : 0, ora: '07:00' });
      db.prepare(`INSERT OR REPLACE INTO attivita (id, data, distanza, tempo, passo_medio, fc_media, efficiency_factor, origine, nome, tipo, fc_max, cadenza, dislivello, carico, calorie,
          rpe, contatto, oscillazione, lung_passo, tempo_corsa, distanza_corsa, passo_corsa, fc_corsa, parziali, serie, giri, stream_ok, v_analisi, ora_inizio, scarpa_id, meteo)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'intervals', ?, 'Run', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 2, ?, ?, ?)`)
        .run(id, d, +km.toFixed(3), T, +(T / km).toFixed(1), +fcMedia.toFixed(1), +(60000 / (T / km) / fcMedia).toFixed(3), s.tipo === 'lungo' ? 'Lungo della domenica' : 'Corsa',
          Math.max(...hr), Math.round(cad.reduce((x, y) => x + y, 0) / T), 8 + Math.round(rnd() * 10), carico, Math.round(km * 68),
          3 + Math.round(rnd() * 2), 300 - Math.round(livello * 20), +(10.2 - livello).toFixed(1), +(0.95 + livello * 0.04).toFixed(2),
          a.tempo_corsa, a.distanza_corsa, a.passo_corsa, a.fc_corsa, JSON.stringify(a.parziali), JSON.stringify(a.serie), JSON.stringify(g),
          `07:0${k % 10}`, k % 3 === 2 ? scarpaB : scarpaA, meteo);
      return { id, carico };
    }

    // anello di fantasia attorno al parco (~1,9 km), percorso alla distanza d in metri
    function punto(m) {
      const L = 1900, th = ((m % L) / L) * 2 * Math.PI;
      const rx = 360 + 40 * Math.sin(3 * th), ry = 230 + 25 * Math.cos(2 * th), rot = 0.6;
      const x = rx * Math.cos(th), y = ry * Math.sin(th);
      const e = x * Math.cos(rot) - y * Math.sin(rot), n = x * Math.sin(rot) + y * Math.cos(rot);
      return { lat: +(CENTRO.lat + n / 111320).toFixed(6), lng: +(CENTRO.lng + e / (111320 * Math.cos(CENTRO.lat * Math.PI / 180))).toFixed(6) };
    }

    // ricalcola i CTL/ATL di ogni corsa con lo storico completo
    const up = db.prepare('UPDATE attivita SET ctl = ?, atl = ?, tsb = ? WHERE id = ?');
    for (const c of corse) {
      const d = c.id.slice(5);
      const { ctl, atl } = ctlAtl(d);
      up.run(ctl, atl, +(ctl - atl).toFixed(1), c.id);
    }
  }

  return { utente, contestoDemo };
}

module.exports = { creaDemo };
