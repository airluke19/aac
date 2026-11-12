'use strict';
// ---------------------------------------------------------------------------
// Capire le domande della chat con un modello di embedding locale e open-source
// (multilingual-e5-large, licenza MIT, ONNX quantizzato int8, ~560 MB, in /app/modello).
// Scelto il 12 nov 2026 tra 7 modelli: 38/40 domande mai viste al primo tema, contro 32/40
// di e5-small, ~330 ms a domanda con 2 thread, ~1 GB di RAM mentre e' caricato.
// Il modello trasforma una frase in un vettore di significato: confrontandolo con le
// frasi d'esempio di chat-esempi.js troviamo il tema (o i due temi) della domanda.
// NON genera testo: le risposte restano frasi scritte in chat.js con i dati dell'utente,
// quindi niente invenzioni. Gira tutto sul server, senza rete (telemetria ORT spenta).
// Si carica alla prima domanda e si libera dopo 10 minuti senza domande (RAM).
// Se il modello manca o fallisce, chat.js torna alle parole chiave.
// I vettori delle frasi d'esempio si calcolano nella build: `node capire.js --vettori <file>`.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ESEMPI } = require('./chat-esempi');

process.env.ORT_DISABLE_TELEMETRY = '1';
const DIR = process.env.CHAT_MODELLO_DIR || path.join(__dirname, 'modello');
const FILE_VETTORI = process.env.CHAT_VETTORI || path.join(__dirname, 'chat-vettori.json');
const RIPOSO_MS = 10 * 60 * 1000;
const PREFISSO = 'query: '; // e5: stesso prefisso per frasi da confrontare tra loro

// Soglie tarate su 75 domande e verificate su 40 mai viste (scala compressa di e5: ~0,80–0,96).
// Se cambi modello vanno ritarate: i valori dipendono dalla scala dei coseni.
const SOGLIA = 0.816; // sotto: non ho capito
const MARGINE = 0.003; // un secondo tema entro questo distacco viene trattato insieme al primo
const BONUS_PAROLA = 0.01; // per ogni parola chiave del tema presente nel testo (max 3)
const BONUS_PRIMA = 0.013; // messaggi brevi: favorisce il tema della domanda precedente
const MAI_SECONDI = new Set(['saluto', 'grazie', 'chi_sei', 'fuori', 'meta', 'ostile']);

const firma = () => crypto.createHash('sha256').update('e5-large-q8|' + JSON.stringify(ESEMPI)).digest('hex').slice(0, 16);

let stato = null; // Promise<{ vec, rif }>
let sessione = null;
let timer = null;
let coda = Promise.resolve();

async function caricaModello() {
  const ort = require('onnxruntime-node');
  const { Tokenizer } = require('@huggingface/tokenizers');
  const leggi = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const tok = new Tokenizer(leggi('tokenizer.json'), leggi('tokenizer_config.json'));
  const sess = await ort.InferenceSession.create(path.join(DIR, 'onnx', 'model_quantized.onnx'), {
    intraOpNumThreads: 2, interOpNumThreads: 1, graphOptimizationLevel: 'all', logSeverityLevel: 3,
  });
  sessione = sess;
  const big = (a) => BigInt64Array.from(a, BigInt);
  // una frase -> vettore normalizzato (media dei token, come in e5)
  const vec = async (s) => {
    const e = tok.encode(PREFISSO + s);
    const n = Math.min(e.ids.length, 256);
    const feeds = {
      input_ids: new ort.Tensor('int64', big(e.ids.slice(0, n)), [1, n]),
      attention_mask: new ort.Tensor('int64', big(e.attention_mask.slice(0, n)), [1, n]),
      token_type_ids: new ort.Tensor('int64', new BigInt64Array(n), [1, n]),
    };
    const out = (await sess.run(feeds)).last_hidden_state;
    const H = out.dims[2], v = new Float32Array(H);
    for (let i = 0; i < n; i++) for (let j = 0; j < H; j++) v[j] += out.data[i * H + j];
    let q = 0; for (let j = 0; j < H; j++) q += v[j] * v[j];
    q = Math.sqrt(q) || 1; for (let j = 0; j < H; j++) v[j] /= q;
    return v;
  };
  return vec;
}

// vettori delle frasi d'esempio: dal file della build se aggiornato, altrimenti calcolati ora (sviluppo)
async function vettoriEsempi(vec) {
  try {
    const f = JSON.parse(fs.readFileSync(FILE_VETTORI, 'utf8'));
    if (f.firma === firma()) {
      const tutti = new Float32Array(Buffer.from(f.dati, 'base64').buffer.slice(0));
      return f.temi.map((tema, i) => ({ tema, v: tutti.subarray(i * f.dim, (i + 1) * f.dim) }));
    }
  } catch (_) { /* file assente: si calcolano */ }
  const rif = [];
  for (const [tema, frasi] of Object.entries(ESEMPI)) for (const s of frasi) rif.push({ tema, v: await vec(s) });
  return rif;
}

function libera() {
  const s = sessione;
  stato = null; sessione = null;
  if (s) s.release().catch(() => {});
}

function pronto() {
  if (!stato) {
    stato = (async () => { const vec = await caricaModello(); return { vec, rif: await vettoriEsempi(vec) }; })();
    stato.catch((e) => { console.error('[chat] modello non disponibile:', e.message); stato = null; sessione = null; });
  }
  clearTimeout(timer);
  timer = setTimeout(libera, RIPOSO_MS);
  timer.unref();
  return stato;
}

const disponibile = () => fs.existsSync(path.join(DIR, 'onnx', 'model_quantized.onnx'));

// testo -> { temi: [1 o 2 temi], punti } oppure null (modello non disponibile: si usano le parole chiave)
// paroleChiave(testo) -> { tema: numero di parole chiave trovate }; prima = tema della domanda precedente
// bonus = { tema: punti } da indizi certi (es. un giorno citato spinge verso le sedute)
async function capisci(testo, { paroleChiave, prima, bonus = {} } = {}) {
  if (!disponibile()) return null;
  let m;
  try { m = await pronto(); } catch (_) { return null; }
  const lavoro = coda.then(() => m.vec(testo));
  coda = lavoro.catch(() => {});
  const v = await lavoro;
  // per tema: media dei 2 esempi piu' vicini (piu' stabile del solo massimo)
  const top = {};
  for (const r of m.rif) {
    let c = 0; for (let j = 0; j < v.length; j++) c += v[j] * r.v[j];
    const t = top[r.tema] || (top[r.tema] = [-1, -1]);
    if (c > t[0]) { t[1] = t[0]; t[0] = c; } else if (c > t[1]) t[1] = c;
  }
  const kw = (paroleChiave && paroleChiave(testo)) || {};
  const breve = String(testo).trim().split(/\s+/).length <= 4;
  const punti = Object.entries(top).map(([tema, [a, b]]) => [tema,
    (a + b) / 2 + BONUS_PAROLA * Math.min(kw[tema] || 0, 3) + (breve && prima === tema ? BONUS_PRIMA : 0) + (bonus[tema] || 0)]);
  punti.sort((x, y) => y[1] - x[1]);
  const [t1, s1] = punti[0];
  // 'urgente' solo se e' il primo: i casi chiari li prende gia' il controllo a parole chiave in chat.js
  if (t1 === 'urgente' && s1 >= SOGLIA) return { temi: ['urgente'], punti: punti.slice(0, 3) };
  if (s1 < SOGLIA) return { temi: ['boh'], punti: punti.slice(0, 3) };
  if (t1 === 'fuori') return { temi: ['fuori'], punti: punti.slice(0, 3) };
  const temi = [t1];
  const sec = punti.find((p, i) => i > 0 && !MAI_SECONDI.has(p[0]) && p[0] !== 'urgente');
  if (!MAI_SECONDI.has(t1) && sec && sec[1] >= s1 - MARGINE && sec[1] >= SOGLIA) temi.push(sec[0]);
  return { temi, punti: punti.slice(0, 3) };
}

module.exports = { capisci, disponibile, firma, libera, _soglie: { SOGLIA, MARGINE } };

// Build: node capire.js --vettori chat-vettori.json
if (require.main === module && process.argv[2] === '--vettori') {
  (async () => {
    const vec = await caricaModello();
    const temi = [], parti = [];
    for (const [tema, frasi] of Object.entries(ESEMPI)) for (const s of frasi) { temi.push(tema); parti.push(await vec(s)); }
    const dim = parti[0].length, tutti = new Float32Array(dim * parti.length);
    parti.forEach((p, i) => tutti.set(p, i * dim));
    fs.writeFileSync(process.argv[3], JSON.stringify({ firma: firma(), dim, temi, dati: Buffer.from(tutti.buffer).toString('base64') }));
    console.log(`chat-vettori: ${temi.length} frasi, firma ${firma()}`);
    libera();
  })().catch((e) => { console.error(e); process.exit(1); });
}
