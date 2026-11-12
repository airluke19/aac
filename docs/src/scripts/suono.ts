// Stesso suono dell'app aac.run: tasto di tastiera meccanica ("thock"), sintetizzato, nessun file audio.
// Più chiaro quando accendi (tema chiaro), più grave quando spegni.
let ctx: AudioContext | null = null;
export function suonoInterruttore(acceso: boolean) {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = ctx || new AC();
    const c = ctx, t0 = c.currentTime + 0.005;
    const uscita = c.createGain(); uscita.gain.value = 0.35; uscita.connect(c.destination);
    const rumore = (t: number, dur: number, passaBasso: number, passaAlto: number, vol: number) => {
      const n = Math.max(1, Math.round(c.sampleRate * dur)), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
      for (let k = 0; k < n; k++) d[k] = (Math.random() * 2 - 1) * Math.exp(-6 * k / n);
      const src = c.createBufferSource(); src.buffer = buf;
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = passaAlto;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = passaBasso; lp.Q.value = 0.7;
      const g = c.createGain(); g.gain.value = vol;
      src.connect(hp).connect(lp).connect(g).connect(uscita); src.start(t);
    };
    const corpo = (t: number, f: number, vol: number, dur: number) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.7, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(uscita); o.start(t); o.stop(t + dur + 0.01);
    };
    const f = acceso ? 1 : 0.82;
    rumore(t0, 0.032, 2300 * f, 140, 0.85);
    corpo(t0, 260 * f, 0.4, 0.055);
    rumore(t0, 0.006, 4200 * f, 2000, 0.16);
    const t1 = t0 + 0.085;
    rumore(t1, 0.016, 2600 * f, 220, 0.2);
    corpo(t1, 360 * f, 0.08, 0.028);
  } catch { /* audio non disponibile: nessun suono */ }
}
