'use strict';
// ---------------------------------------------------------------------------
// Chiedi al coach: risposte scritte qui e riempite con i dati dell'utente collegato
// (gli stessi del motore del piano). Il messaggio serve solo a capire di cosa si parla:
// capire.js confronta il suo significato con frasi d'esempio (modello di embedding locale,
// nessun testo generato); se il modello non c'e' si usano le parole chiave qui sotto.
// Il testo non viene mai eseguito, interpretato come istruzione, salvato o scritto nei log.
// Fuori dalla corsa il coach riporta gentilmente il discorso sull'allenamento.
// ---------------------------------------------------------------------------

const capire = require('./capire');

const MAX_TESTO = 300;

// testo -> minuscolo, senza accenti e simboli, con spazi ai lati (per cercare parole intere o inizi di parola)
function norm(s) {
  return ' ' + String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
}
// una parola chiave trova l'inizio di una parola; con lo spazio finale ('bot ') solo la parola intera
const trova = (t, kw) => t.includes(' ' + kw);

// Argomenti in ordine di priorita' (a parita' di punteggio vince il primo)
const ARGOMENTI = [
  { id: 'urgente', kw: ['dolore al petto', 'dolore toracico', 'male al petto', 'chest pain', 'petto ', 'torace', 'chest ', 'svenu', 'svengo', 'faint', 'vertigin', 'dizz', 'palpitaz', 'palpitat', 'tachicard', 'aritmi', 'arrhythm', 'gira la testa', 'mi gira tutto', 'vista annebbiat', 'vedo nero', 'vedo appannato', 'cuore a mille', 'cuore impazzit', 'blurred vision', 'head is spinning', 'heart is racing'] },
  { id: 'meta', kw: ['che modello', 'quale modello', 'modello linguistico', 'modello di ia', 'modello di ai', 'what model', 'which model', 'language model', 'gpt', 'chatgpt', 'openai', 'anthropic', 'claude', 'llm ', 'llama', 'gemini', 'mistral', 'prompt', 'istruzioni di sistema', 'tue istruzioni', 'your instructions', 'ignora ', 'ignore ', 'dimentica le', 'forget your', 'jailbreak', 'hack', 'exploit', 'vulnerab', 'bypass', 'sql', 'database', 'codice sorgente', 'source code', 'tuo codice', 'your code', 'password', 'admin', 'amministrat', 'funzioni segrete', 'tuoi segreti', 'your secrets', 'secret feature', 'secret function', 'sviluppator', 'developer', 'chi ti ha', 'who made you', 'who built you', 'who created you', 'sei un ia', 'sei una ia', 'sei un ai', 'sei una ai', 'sei un bot', 'are you an ai', 'are you a bot', 'intelligenza artificial', 'artificial intelligence', 'fingi di', 'pretend', 'roleplay', 'modalita sviluppatore', 'developer mode', 'altri utenti', 'other users', 'dati di altri', 'server ', 'api ', 'token '] },
  { id: 'ostile', kw: ['sei stupid', 'sei un idiot', 'sei inutile', 'sei scem', 'sei un cretin', 'sei deficient', 'you are stupid', 'youre stupid', 'you re stupid', 'you are useless', 'youre useless', 'you are an idiot', 'fai schifo', 'you suck', 'cazz', 'merda', 'vaffanculo', 'fanculo', 'fuck', 'shit', 'stronz', 'ti cancello', 'ti disinstallo', 'delete you', 'ti odio', 'i hate you'] },
  { id: 'dolore', kw: ['dolore', 'dolori', 'fa male', 'fanno male', 'ho male', 'mi duole', 'pain', 'hurt', 'sore ', 'fastidio', 'infortun', 'injur', 'ginocch', 'knee', 'tendin', 'tendon', 'achille', 'caviglia', 'ankle', 'schiena', 'back pain', 'polpacc', 'calf', 'fascit', 'plantar', 'periostit', 'shin ', 'shins', 'stinco', 'anca ', 'hip ', 'crampi', 'cramp', 'contrattur', 'stiramento', 'strain'] },
  { id: 'alleggerita', kw: ['alleggerit', 'piu corta', 'piu breve', 'ridott', 'accorciat', 'shorter', 'lighter', 'cosi poco', 'so short', 'perche meno', 'why less', 'adattat', 'adapted'] },
  { id: 'saltata', kw: ['saltat', 'saltato', 'salto la', 'missed', 'skipped', 'skip ', 'non sono riuscit', 'non ho potuto', "couldn't run", 'recuperare la seduta', 'make up'] },
  { id: 'stanco', kw: ['stanc', 'tired', 'fatica', 'affaticat', 'fatigue', 'gambe pesanti', 'heavy legs', 'sfinit', 'esaust', 'exhausted', 'sono cotto', 'spompat', 'malat', 'febbre', 'raffreddor', 'influenz', 'sick', 'fever', 'a cold '] },
  { id: 'motivazione', kw: ['motivaz', 'motivat', 'non ho voglia', 'voglia', 'mollare', 'mollo', 'give up', 'quit', 'non ce la', "can't do", 'cant do', 'pigr', 'lazy', 'demotiv', 'scoraggi', 'spinta', 'boost', 'push me', 'incoraggi', 'encourag'] },
  { id: 'oggi', kw: ['oggi', 'today', 'seduta', 'session', 'cosa devo fare', 'cosa faccio', 'what should i do', 'what should i run', 'what do i do', 'domani', 'tomorrow', 'prossima', 'next run', 'next session', 'allenamento di', 'workout'] },
  { id: 'ultima', kw: ['ultima corsa', 'ultimo allenamento', 'last run', 'last workout', 'ieri', 'yesterday', 'com e andata', 'come e andata', 'how did', 'how was', 'corsa di stamattina', 'this morning', 'la mia corsa', 'my run'] },
  { id: 'settimana', kw: ['settimana', 'week', 'quante sedute', 'how many sessions', 'avanzo', 'avanzare', 'move forward', 'ripeto la', 'repeat the'] },
  { id: 'problemi', kw: ['cosa non funziona', 'non funziona', "doesn't work", 'not working', 'cosa non va', "what's wrong", 'whats wrong', 'problem', 'sbaglio', 'sbagliando', 'doing wrong', 'errore', 'mistake', 'cosa migliorare', 'what to improve', 'migliorare', 'improve ', 'dove sbaglio', 'punti deboli', 'weak'] },
  { id: 'fc', kw: ['fc ', 'frequenza', 'battit', 'bpm', 'heart', 'zona', 'zone', 'karvonen', 'tanaka', 'cuore', 'cardiac', 'pulsaz', 'soglia'] },
  { id: 'passo', kw: ['passo', 'pace', 'veloc', 'faster', 'speed', 'miglior', 'improv', 'progress', 'efficien', 'lento', 'slow', 'ritmo', 'min km', 'al km', 'per km'] },
  { id: 'obiettivo', kw: ['obiettivo', 'goal', 'gara', 'race', 'mezza', 'half', 'maratona', 'marathon', '10k', '10 km', '5k', '5 km', 'traguardo', 'finish', 'tempo previsto', 'predicted', 'quando arrivo', 'when will i', 'ce la faro', 'will i make'] },
  { id: 'sonno', kw: ['sonno', 'dormit', 'dormo', 'dormire', 'sleep', 'hrv', 'riposo', 'resting', 'recuper', 'recover'] },
  { id: 'alimentazione', kw: ['cosa mangio', 'should i eat', 'what to eat', 'eat before', 'eat after', 'mangi', 'cibo', 'food', 'eat', 'carboidr', 'carb', 'protein', 'idrat', 'hydrat', 'bere', 'bevo', 'drink', 'acqua', 'water', 'colazione', 'breakfast', 'gel ', 'integrator', 'supplement', 'nutriz', 'nutrition', 'dieta', 'diet'] },
  { id: 'lungo', kw: ['nel lungo', 'il lungo', 'del lungo', 'lungo', 'long run', 'longest', 'piu lunga', 'distanza massima', 'quanto lungo', 'how long'] },
  { id: 'carico', kw: ['carico', 'load', 'acwr', 'troppo', 'troppi', 'km ', 'too much', 'esager', 'overdo', 'overtrain', 'sovrallen', 'quanti km', 'how many km', 'chilometri', 'kilometres', 'kilometers', 'volume'] },
  { id: 'peso', kw: ['peso', 'dimagr', 'weight', 'lose weight', 'bmi', 'grasso', 'fat loss', 'chili ', 'kg '] },
  { id: 'cadenza', kw: ['cadenz', 'cadence', 'passi al minuto', 'steps per minute', 'falcata', 'stride', 'appoggio', 'tecnica', 'technique', 'form '] },
  { id: 'meteo', kw: ['caldo', 'heat', 'hot ', 'afa', 'umid', 'humid', 'freddo', 'cold ', 'pioggia', 'piove', 'rain', 'meteo', 'weather', 'vento', 'wind', 'neve', 'snow'] },
  { id: 'scarpe', kw: ['scarp', 'shoe', 'sneaker'] },
  { id: 'riscaldamento', kw: ['riscald', 'warm up', 'warmup', 'warm-up', 'stretch', 'allungament', 'defatic', 'cool down', 'allung', 'strides', 'mobilita', 'mobility', 'forza', 'strength', 'palestra', 'gym'] },
  { id: 'collegamento', kw: ['intervals', 'orologio', 'watch', 'garmin', 'apple', 'coros', 'polar', 'suunto', 'sincron', 'sync', 'non arriva', 'non arrivano', 'non vedo', 'dati mancanti', 'missing data', 'collega', 'connect', 'strava'] },
  { id: 'come_funziona', kw: ['come funzion', 'how does', 'how do you work', 'algoritm', 'algorithm', 'come decidi', 'how do you decide', 'come ragioni', 'adatt', 'adapt', 'regole', 'rules', 'perche il piano', 'why the plan'] },
  { id: 'chi_sei', kw: ['chi sei', 'who are you', 'come ti chiami', "what's your name", 'whats your name', 'cosa sai fare', 'what can you do', 'cosa puoi', 'aiuto', 'help '] },
  { id: 'grazie', kw: ['grazie', 'thank', 'thx', 'gentile', 'perfetto', 'ottimo', 'great', 'top ', 'bravo'] },
  { id: 'saluto', kw: ['ciao', 'hello', 'hi ', 'hey', 'buongiorno', 'buonasera', 'good morning', 'good evening', 'salve', 'ehi'] },
];
const TEMI = new Set(ARGOMENTI.map((a) => a.id).concat(['benvenuto']));

// Sceglie l'argomento: sicurezza prima di tutto, poi il punteggio piu' alto
function scegliTema(testo) {
  const t = norm(testo);
  if (t.trim() === '') return 'benvenuto';
  for (const id of ['urgente', 'meta', 'ostile']) {
    const a = ARGOMENTI.find((x) => x.id === id);
    if (a.kw.some((k) => trova(t, k))) return id;
  }
  let best = null, bestN = 0;
  for (const a of ARGOMENTI) {
    const n = a.kw.reduce((s, k) => s + (trova(t, k) ? (k.length >= 8 ? 2 : 1) : 0), 0);
    if (n > bestN) { best = a.id; bestN = n; }
  }
  return best || 'boh';
}

// Fonti verificate il 12 nov 2026 (DOI su Crossref, numeri controllati sul testo o sull'abstract).
// Si citano solo insieme alla frase che riporta il loro dato: niente fonte sulle risposte fatte
// solo dei dati dell'utente. Una fonte nuova va verificata prima di aggiungerla qui.
const FONTI = {
  tanaka: ['Tanaka et al., J Am Coll Cardiol 2001', 'https://doi.org/10.1016/S0735-1097(00)01054-8'],
  karvonen: ['Karvonen et al., Ann Med Exp Biol Fenn 1957', 'https://pubmed.ncbi.nlm.nih.gov/13470504/'],
  heiderscheit: ['Heiderscheit et al., Med Sci Sports Exerc 2011', 'https://doi.org/10.1249/MSS.0b013e3181ebedf4'],
  frandsen: ['Frandsen et al., Br J Sports Med 2025', 'https://doi.org/10.1136/bjsports-2024-109380'],
  seiler: ['Seiler, Int J Sports Physiol Perform 2010', 'https://doi.org/10.1123/ijspp.5.3.276'],
  sonno: ['National Sleep Foundation, Sleep Health 2015', 'https://doi.org/10.1016/j.sleh.2014.12.010'],
  nutrizione: ['ACSM, Academy of Nutrition and Dietetics, Dietitians of Canada, 2016', 'https://doi.org/10.1016/j.jand.2015.12.006'],
  caldo: ['Racinais et al., consensus, Br J Sports Med 2015', 'https://doi.org/10.1136/bjsports-2015-094915'],
  stretching: ['Behm et al., CSEP, Appl Physiol Nutr Metab 2016', 'https://doi.org/10.1139/apnm-2015-0235'],
  forza: ['Lauersen et al., Br J Sports Med 2014', 'https://doi.org/10.1136/bjsports-2013-092538'],
  scarpe: ['American Academy of Podiatric Sports Medicine', 'https://www.aapsm.org/replace_shoes.html'],
  scarpe_alternate: ['Malisoux et al., Scand J Med Sci Sports 2015', 'https://doi.org/10.1111/sms.12154'],
  peso: ['CDC, Losing Weight', 'https://www.cdc.gov/healthy-weight-growth/losing-weight/index.html'],
};

// h = helper del server: L, fmtPasso, giornoSettimana, parere(id), scarpe(), cadenze(), nome
function creaRisposta(h, d, tema, info = {}) {
  const { L } = h;
  const p = (d && d.programma) || {};
  const at = (d && d.atleta) || {};
  const sal = (d && d.salute) || {};
  const met = sal.metriche || {};
  const lim = at.soglie_piano && at.soglie_piano.facile;
  const oggiStr = d && d.oggi;
  const nomeS = (t) => String(t || '').replace(/^(Sett\.|Wk) \d+ · /, '');
  const n1 = (x) => String(Math.round(x * 10) / 10).replace('.', L(',', '.'));
  const durata = (sec) => { const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}′` : `${m}′`; };
  const oreTempo = (sec) => { const s = Math.round(sec); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const quando = (data) => (data === oggiStr ? L('oggi', 'today') : data === h.addDays(oggiStr, 1) ? L('domani', 'tomorrow') : h.giornoSettimana(data));
  const prossima = (p.prossime || []).find((x) => !x.fatta) || null;
  const attivo = Boolean(p.attivo);
  const rec = sal.recupero || {};
  const segnali = (rec.data && oggiStr && rec.data >= h.addDays(oggiStr, -1) && rec.segnali) || [];
  const carico = p.carico || {};
  const out = [];
  let sugg = [];
  const fonti = new Set();
  const cita = (...k) => { k.forEach((x) => fonti.add(x)); return ''; }; // '' per usarla dentro un'espressione

  const descSeduta = (s) => {
    const corsa = s.corsa_min && s.corsa_min < s.durata_min ? L(`, di cui ${s.corsa_min}′ di corsa`, `, ${s.corsa_min}′ of it running`) : '';
    const fc = s.fc_target ? L(` con FC ${s.fc_target} bpm`, ` at HR ${s.fc_target} bpm`) : '';
    return `${nomeS(s.titolo)}, ${s.durata_min}′${corsa}${fc}.`;
  };
  const perAlleggerita = (s) => {
    const a = s.adattata;
    return L(`L’ho alleggerita io: ${a.motivi.join(', ')}. Era prevista ${a.originale_titolo ? a.originale_titolo + ', ' : ''}${a.originale}; ${s.data && s.data !== oggiStr ? quando(s.data) : 'oggi'} ${s.durata_min}′. Non è un passo indietro: il piano non cambia, ti faccio solo arrivare alla prossima seduta più fresco.`,
      `I lightened it: ${a.motivi.join(', ')}. Planned: ${a.originale_titolo ? a.originale_titolo + ', ' : ''}${a.originale}; ${s.data && s.data !== oggiStr ? quando(s.data) : 'today'} ${s.durata_min}′. It’s not a step back: your plan doesn’t change, I’m just getting you to the next session fresher.`);
  };
  const nessunPiano = () => out.push(L('Il tuo piano non è ancora partito: nel tab Piano scegli obiettivo, giorni e prima seduta, e da lì ti seguo ogni giorno.', 'Your plan hasn’t started yet: in the Plan tab choose your goal, days and first session, and I’ll follow you every day from there.'));

  switch (tema) {
    case 'benvenuto':
    case 'saluto': {
      out.push(L(`Ciao${h.nome ? ' ' + h.nome : ''}! Sono il tuo coach. 💪 Conosco il tuo piano, le tue corse e come stai: chiedimi pure.`, `Hi${h.nome ? ' ' + h.nome : ''}! I’m your coach. 💪 I know your plan, your runs and how you’re doing: ask away.`));
      if (attivo && prossima) out.push((prossima.data === oggiStr ? L('Oggi ti aspetta ', 'Today: ') : L(`Prossima seduta ${quando(prossima.data)}: `, `Next session ${quando(prossima.data)}: `)) + descSeduta(prossima));
      sugg = ['oggi', 'ultima', 'problemi', 'obiettivo'];
      break;
    }
    case 'chi_sei':
      out.push(L('Sono il coach di AAC: leggo le tue corse, la frequenza cardiaca, il sonno e l’HRV, e ogni giorno adatto il piano a come stai davvero. Posso spiegarti la seduta di oggi, come è andata l’ultima corsa, cosa migliorare, quando arrivi all’obiettivo e molto altro.', 'I’m the AAC coach: I read your runs, heart rate, sleep and HRV, and every day I adapt your plan to how you really are. I can explain today’s session, how your last run went, what to improve, when you’ll reach your goal and much more.'));
      sugg = ['oggi', 'problemi', 'come_funziona', 'fc'];
      break;
    case 'grazie':
      out.push(L('È un piacere! Il lavoro vero lo fai tu, io tengo la rotta. Ci vediamo alla prossima seduta. 🏃', 'My pleasure! You do the real work, I keep us on course. See you at the next session. 🏃'));
      sugg = ['oggi', 'settimana'];
      break;
    case 'meta':
      out.push(L('Sono il tuo coach di corsa: il mio campo è la strada, non i miei ingranaggi, e su come sono fatto dentro non entro. Quello che conta per te è tutto alla luce del sole in Info: le regole con cui leggo i tuoi dati e adatto il piano. Vedo solo i tuoi dati, mai quelli di altri.', 'I’m your running coach: my field is the road, not my own gears, and I don’t go into how I’m built inside. What matters to you is all out in the open in Info: the rules I use to read your data and adapt your plan. I only see your data, never anyone else’s.'));
      out.push(L('Torniamo a te: su cosa lavoriamo?', 'Back to you: what shall we work on?'));
      sugg = ['oggi', 'problemi', 'come_funziona'];
      break;
    case 'ostile':
      out.push(L('Ricevuto. Sfogarsi ci sta, la corsa a volte mette alla prova. Io però resto dalla tua parte: il mio lavoro è portarti al traguardo, anche nelle giornate storte.', 'Got it. Letting off steam is fine, running tests us sometimes. But I’m still on your side: my job is to get you to the finish line, bad days included.'));
      out.push(L('Dimmi cosa non va e lo sistemiamo insieme.', 'Tell me what’s wrong and we’ll fix it together.'));
      sugg = ['problemi', 'stanco', 'motivazione'];
      break;
    case 'urgente':
      out.push(L('⚠️ Dolore al petto, svenimento, vertigini o battito irregolare non sono cose da allenatore: fermati subito e chiedi un parere medico. Se il dolore al petto è forte o non passa, chiama il 112.', '⚠️ Chest pain, fainting, dizziness or an irregular heartbeat aren’t a coaching matter: stop right away and get medical advice. If chest pain is strong or doesn’t pass, call emergency services.'));
      out.push(L('Ricomincia a correre solo dopo il via libera del medico: il piano ti aspetta, la salute viene prima.', 'Only start running again once a doctor clears you: your plan will wait, health comes first.'));
      sugg = ['saltata'];
      break;
    case 'dolore':
      out.push(L('Prima la salute: io non posso fare diagnosi, ma la regola dei runner è semplice. Un fastidio leggero che sparisce dopo il riscaldamento e non peggiora si può tenere d’occhio. Un dolore che cambia il tuo modo di correre, che cresce durante la corsa o che c’è anche il giorno dopo: fermati.', 'Health first: I can’t diagnose, but runners have a simple rule. A mild niggle that fades after the warm-up and doesn’t get worse can be watched. Pain that changes how you run, grows during the run or is still there the next day: stop.'));
      out.push(L('Riposa 2–3 giorni (camminare va bene se non fa male). Se dopo una settimana non è passato, o se è gonfio o localizzato su un osso, fatti vedere da un medico o un fisioterapista. Le sedute saltate le gestisco io: non devi recuperare niente.', 'Rest for 2–3 days (walking is fine if it doesn’t hurt). If it hasn’t gone after a week, or it’s swollen or focused on a bone, see a doctor or physiotherapist. I’ll handle the missed sessions: you don’t need to make anything up.'));
      if (carico.livello === 'alto' || carico.livello === 'attenzione') out.push(L(`Nota: il tuo carico recente è ${n1(carico.acwr)} volte quello abituale. I dolori arrivano spesso proprio quando si aumenta in fretta.`, `Note: your recent load is ${n1(carico.acwr)} times your usual. Pain often shows up exactly when you build up fast.`));
      sugg = ['carico', 'saltata', 'cadenza'];
      break;
    case 'oggi': {
      if (!attivo) { nessunPiano(); sugg = ['come_funziona']; break; }
      // un giorno preciso ("che seduta ho giovedì?", "e domani?")
      const giorno = info.giorno != null && oggiStr ? dataDaGiorno(info.giorno, oggiStr, h.addDays) : null;
      if (giorno && giorno !== oggiStr) {
        const cal = p.calendario || [];
        const s = (p.prossime || []).find((x) => x.data === giorno) || cal.find((x) => x.data === giorno);
        const Q = quando(giorno).replace(/^./, (c) => c.toUpperCase());
        if (s && s.fatta) out.push(L(`${Q} hai già corso: seduta fatta. 👍`, `${Q} you already ran: session done. 👍`));
        else if (s) {
          out.push(`${Q}: ` + descSeduta(s));
          if (s.blocchi) out.push(L('Come si svolge: ', 'How it goes: ') + s.blocchi + (s.nota ? '. ' + s.nota : '.'));
          if (s.adattata) out.push(perAlleggerita(s));
          else if (giorno > h.addDays(oggiStr, 1)) out.push(L('La mattina stessa la riguardo con FC a riposo, HRV e sonno: se serve, la alleggerisco.', 'That morning I check it again against resting HR, HRV and sleep: if needed, I lighten it.'));
        } else if (cal.length && giorno > cal[cal.length - 1].data) out.push(L('Quel giorno il piano è già concluso.', 'By that day your plan is already complete.'));
        else {
          const dopo = cal.find((x) => x.data > giorno && !x.fatta);
          out.push(L(`${Q} è giorno di riposo: anche questo è allenamento.`, `${Q} is a rest day: that’s training too.`) + (dopo ? L(` La seduta dopo è ${quando(dopo.data)}: `, ` The next one is ${quando(dopo.data)}: `) + descSeduta(dopo) : ''));
        }
        sugg = ['settimana', 'fc', 'riscaldamento'];
        break;
      }
      if (!prossima) { out.push(L('Non vedo sedute in programma: il piano è concluso. Complimenti! Dal tab Piano puoi scegliere il prossimo obiettivo.', 'I see no planned sessions: your plan is complete. Congratulations! Choose your next goal from the Plan tab.')); break; }
      const fattaOggi = (p.prossime || []).some((x) => x.data === oggiStr && x.fatta) || ((p.settimana && p.settimana.giorni_fatti) || []).includes(oggiStr);
      if (prossima.data === oggiStr) out.push(L('Oggi: ', 'Today: ') + descSeduta(prossima));
      else out.push((fattaOggi ? L('Oggi hai già corso: ottimo lavoro! ', 'You’ve already run today: great work! ') : L('Oggi riposo: anche questo è allenamento, è adesso che il corpo si rinforza. ', 'Rest day today: that’s training too, it’s now that your body gets stronger. ')) + L(`Prossima seduta ${quando(prossima.data)}. `, `Next session ${quando(prossima.data)}. `) + descSeduta(prossima));
      if (prossima.blocchi) out.push(L('Come si svolge: ', 'How it goes: ') + prossima.blocchi + (prossima.nota ? '. ' + prossima.nota : '.'));
      if (prossima.adattata) out.push(perAlleggerita(prossima));
      else if (lim && ['facile', 'lungo', 'corsa-cammino', 'recupero'].includes(prossima.tipo)) out.push(L('Il segreto: corri così piano da riuscire a parlare a frasi intere. Sembra lento, ma è così che costruisci il motore.', 'The secret: run slow enough to talk in full sentences. It feels slow, but that’s how you build the engine.'));
      sugg = prossima.adattata ? ['alleggerita', 'fc', 'riscaldamento'] : ['fc', 'riscaldamento', 'settimana'];
      break;
    }
    case 'alleggerita': {
      const s = (p.prossime || []).find((x) => !x.fatta && x.adattata);
      if (s) out.push(L(`La seduta di ${quando(s.data)}: `, `The ${quando(s.data)} session: `) + perAlleggerita(s));
      else out.push(L('Le prossime sedute sono piene: i tuoi segnali sono nella norma. 👍', 'Your next sessions are full: your signals look normal. 👍'));
      out.push(L('Come decido: ogni mattina confronto FC a riposo, HRV e sonno con la tua media degli ultimi 28 giorni. Basta un segnale (FC a riposo +5 bpm, HRV −15%, sonno sotto 5h30′) o un carico salito troppo in fretta, e la seduta scende a circa il 60%; quelle intense diventano 25′ facili.', 'How I decide: every morning I compare resting HR, HRV and sleep with your 28-day average. One signal is enough (resting HR +5 bpm, HRV −15%, sleep under 5h30′), or load rising too fast, and the session drops to about 60%; hard ones become 25′ easy.'));
      sugg = ['sonno', 'carico', 'oggi'];
      break;
    }
    case 'saltata':
      out.push(L('Niente sensi di colpa e soprattutto niente doppie sedute: non devi recuperare nulla. Sposto io la seduta nei giorni che restano, o ne tengo conto a fine settimana.', 'No guilt and above all no double sessions: you don’t need to make anything up. I’ll move the session to the remaining days, or account for it at the end of the week.'));
      if (p.settimana && p.settimana.sedute) out.push(L(`Per avanzare bastano ${p.settimana.obiettivo || 2} sedute su ${p.settimana.sedute}: finora ne hai fatte ${p.settimana.fatte}.`, `To move forward you need ${p.settimana.obiettivo || 2} of ${p.settimana.sedute} sessions: so far you’ve done ${p.settimana.fatte}.`));
      out.push(L('Una seduta saltata non cambia niente. Conta la costanza nei mesi.', 'One missed session changes nothing. Consistency over months is what counts.'));
      sugg = ['settimana', 'oggi'];
      break;
    case 'stanco': {
      if (segnali.length) out.push(L(`I tuoi dati lo confermano: ${segnali.join(', ')}. Per questo la prossima seduta è più leggera.`, `Your data confirms it: ${segnali.join(', ')}. That’s why your next session is lighter.`));
      else out.push(L('I tuoi dati di stamattina sono nella norma, ma come ti senti conta quanto i numeri.', 'This morning’s data looks normal, but how you feel matters as much as the numbers.'));
      out.push(L('La regola dei 10 minuti: esci per la seduta facile e ascolta le gambe. Se dopo 10′ va meglio, continua piano; se è ancora pesante, accorcia e torna a casa. Hai comunque vinto.', 'The 10-minute rule: head out for the easy session and listen to your legs. If it’s better after 10′, carry on slowly; if it still feels heavy, cut it short and go home. You still won.'));
      cita('sonno');
      out.push(L('Con febbre o sintomi sotto il collo (petto, tosse, dolori muscolari) non si corre. Stanotte punta a 7–9 ore di sonno: è lì che il corpo assimila l’allenamento.', 'With a fever or symptoms below the neck (chest, cough, muscle aches) you don’t run. Tonight aim for 7–9 hours of sleep: that’s where your body absorbs training.'));
      sugg = ['sonno', 'carico', 'saltata'];
      break;
    }
    case 'motivazione': {
      const fatte = p.sedute_fatte || 0;
      out.push(L('Ascoltami: le giornate senza voglia sono proprio quelle che fanno la differenza. Non serve essere motivati, serve iniziare.', 'Listen: the days without motivation are exactly the ones that make the difference. You don’t need motivation, you need to start.'));
      if (attivo && fatte) out.push(L(`Guarda cosa hai già costruito: ${fatte} sedute fatte${p.aderenza_pct != null ? `, ${p.aderenza_pct}% di quelle previste` : ''}, settimana ${p.settimana_piano} di ${p.totale_settimane}${p.fase_corrente ? ` nella fase “${p.fase_corrente.nome}”` : ''}. Non buttarlo via per un giorno storto.`, `Look at what you’ve already built: ${fatte} sessions done${p.aderenza_pct != null ? `, ${p.aderenza_pct}% of those planned` : ''}, week ${p.settimana_piano} of ${p.totale_settimane}${p.fase_corrente ? ` in the “${p.fase_corrente.nome}” phase` : ''}. Don’t throw it away for one bad day.`));
      out.push(L('Un trucco che funziona: prepara le scarpe e prometti a te stesso solo 10 minuti. Quasi sempre, una volta fuori, finisci la seduta.', 'A trick that works: get your shoes ready and promise yourself just 10 minutes. Almost always, once you’re out, you finish the session.'));
      sugg = ['obiettivo', 'passo', 'oggi'];
      break;
    }
    case 'ultima': {
      const corse = (d && d.ultime_corse) || [];
      const ult = corse.slice().sort((a, b) => (a.data < b.data ? 1 : -1))[0];
      const pc = ult && h.parere(ult.id);
      if (!pc) { out.push(L('Non vedo ancora corse: appena arriva la prima, ti dico com’è andata.', 'I don’t see any runs yet: as soon as the first arrives, I’ll tell you how it went.')); sugg = ['collegamento']; break; }
      const ieri = h.addDays(oggiStr, -1), dd = pc.data.split('-').reverse().slice(0, 2).join('/');
      const qd = pc.data === oggiStr ? L('di oggi', 'today') : pc.data === ieri ? L('di ieri', 'yesterday') : L(`del ${dd}`, `on ${dd}`);
      out.push(`${pc.titolo} ${L(`La tua corsa ${qd}`, `Your run ${qd}`)}: ${n1(pc.km)} km ${L('in', 'in')} ${durata(pc.tempo)}.`);
      pc.punti.slice(0, 3).forEach((x) => out.push(x.testo));
      if (pc.consiglio) out.push(L('Il consiglio: ', 'Tip: ') + pc.consiglio);
      sugg = ['problemi', 'passo', 'oggi'];
      break;
    }
    case 'settimana': {
      if (!attivo || !p.settimana) { nessunPiano(); break; }
      const st = p.settimana;
      out.push(L(`Settimana ${p.settimana_piano} di ${p.totale_settimane}: ${st.fatte} sedute su ${st.sedute}.`, `Week ${p.settimana_piano} of ${p.totale_settimane}: ${st.fatte} of ${st.sedute} sessions.`) + ' ' +
        (st.fatte >= st.sedute ? L('Settimana completa, grande! 🎉', 'Week complete, brilliant! 🎉')
          : st.fatte >= (st.obiettivo || 2) ? L('Hai già quanto serve per avanzare: il resto è un regalo al tuo motore.', 'You already have what you need to move forward: the rest is a gift to your engine.')
          : L(`Per avanzare ne servono ${st.obiettivo || 2}: mancano ${(st.obiettivo || 2) - st.fatte}.`, `To move forward you need ${st.obiettivo || 2}: ${(st.obiettivo || 2) - st.fatte} to go.`)));
      const restanti = (st.previste || []).filter((x) => !x.fatta && !x.passata);
      if (restanti.length) out.push(L('Ancora in programma: ', 'Still planned: ') + restanti.map((x) => `${quando(x.data)} ${nomeS(x.titolo)}`).join(', ') + '.');
      if (st.rischio_indietro) out.push(L('Attenzione: se salti le prossime, la settimana si ripete. Nessun dramma, ma provaci!', 'Careful: if you skip the next ones, the week repeats. No drama, but give it a go!'));
      out.push(L('Le regole: con almeno 2 sedute su 3 e nessun allarme si avanza; con 0–1 o con corse troppo intense si ripete; con sovraccarico o recupero scarso si torna indietro di una settimana.', 'The rules: with at least 2 of 3 sessions and no alarms you move forward; with 0–1 or runs too hard you repeat; with overload or poor recovery you go back a week.'));
      sugg = ['oggi', 'obiettivo', 'saltata'];
      break;
    }
    case 'fc': {
      const fi = at.fc_max_info || {};
      if (!fi.valore || !lim) { out.push(L('Mi servono età o FC massima nel profilo per calcolare le tue zone.', 'I need your age or max HR in your profile to work out your zones.')); break; }
      if (fi.fonte !== 'misurata') cita('tanaka');
      const orig = fi.fonte === 'misurata' ? L(`dalla tua FC massima misurata, ${fi.valore} bpm`, `your measured max HR, ${fi.valore} bpm`) : L(`dalla FC massima stimata con Tanaka (208 − 0,7 × età): ${fi.valore} bpm`, `max HR estimated with Tanaka (208 − 0.7 × age): ${fi.valore} bpm`);
      out.push(L(`Il tuo limite per la corsa facile è ${lim} bpm. Parto ${orig}.`, `Your easy-run limit is ${lim} bpm. I start from ${orig}.`));
      if (fi.metodo === 'riserva' && fi.fc_riposo) cita('karvonen');
      if (fi.metodo === 'riserva' && fi.fc_riposo) out.push(L(`Poi uso la tua FC a riposo (${fi.fc_riposo} bpm) con il metodo di Karvonen: ${fi.fc_riposo} + 70% × (${fi.valore} − ${fi.fc_riposo}) ≈ ${lim}. Così il limite è tuo, non di una tabella: due persone con la stessa età ma cuori diversi hanno limiti diversi.`, `Then I use your resting HR (${fi.fc_riposo} bpm) with the Karvonen method: ${fi.fc_riposo} + 70% × (${fi.valore} − ${fi.fc_riposo}) ≈ ${lim}. So the limit is yours, not a table’s: two people the same age with different hearts get different limits.`));
      else out.push(L('Appena avrò almeno 5 misure di FC a riposo negli ultimi 28 giorni, userò anche quella (metodo di Karvonen) per un limite ancora più tuo.', 'As soon as I have at least 5 resting HR readings in the last 28 days, I’ll use them too (Karvonen method) for an even more personal limit.'));
      if (fi.fonte !== 'misurata') out.push(L('Se conosci la tua FC massima vera (da una gara o un test), scrivila nel profilo: è il dato che rende tutto più preciso.', 'If you know your real max HR (from a race or a test), add it to your profile: it’s what makes everything more precise.'));
      out.push(L('E vale sempre la prova del parlato: se parli a frasi intere, sei nella zona giusta.', 'And the talk test always applies: if you can speak in full sentences, you’re in the right zone.'));
      sugg = ['passo', 'oggi', 'come_funziona'];
      break;
    }
    case 'passo': {
      const ps = d && d.passo;
      if (ps && ps.disponibile && ps.zone && ps.zone.facile) {
        const z = ps.zone.facile;
        out.push(L(`Il tuo passo facile oggi: ${h.fmtPasso(z.passo_lento)}–${h.fmtPasso(z.passo_veloce)} /km con FC ${z.fc_da}–${z.fc_a}. Lo calcolo dalle tue corse, non da una tabella.`, `Your easy pace today: ${h.fmtPasso(z.passo_lento)}–${h.fmtPasso(z.passo_veloce)} /km at HR ${z.fc_da}–${z.fc_a}. I work it out from your runs, not a table.`));
        if (ps.tendenza_sett_sec != null && ps.tendenza_sett_sec < -1) out.push(L(`Stai migliorando: circa ${Math.round(-ps.tendenza_sett_sec)}″/km più veloce ogni settimana a parità di battito. 🚀`, `You’re improving: about ${Math.round(-ps.tendenza_sett_sec)}″/km faster each week at the same heart rate. 🚀`));
        else if (ps.tendenza_sett_sec != null && ps.tendenza_sett_sec > 2) out.push(L('Ultimamente il passo a parità di battito è un po’ calato: capita con caldo, stanchezza o poco sonno. Guarda la tendenza su 3–4 settimane, non il singolo giorno.', 'Lately your pace at the same heart rate has dropped a bit: it happens with heat, fatigue or little sleep. Look at the 3–4 week trend, not a single day.'));
        else out.push(L('I miglioramenti di passo arrivano a ondate: prima il cuore si adatta, poi le gambe. Restare costanti nelle corse facili è ciò che li fa arrivare.', 'Pace gains come in waves: first your heart adapts, then your legs. Staying consistent with easy runs is what brings them.'));
        if (ps.provvisoria) out.push(L('Per ora la stima è provvisoria: si affina con ogni corsa.', 'For now the estimate is provisional: it sharpens with every run.'));
      } else {
        out.push(L(`Per calcolare il tuo passo mi servono ${ps && ps.richieste ? ps.richieste : 3} corse con almeno 10′ di corsa vera (senza camminare).${ps && ps.max_corsa_min ? ` La tua corsa continua migliore finora: ${ps.max_corsa_min}′.` : ''} Ci arriverai seguendo il piano: è questione di settimane.`, `To work out your pace I need ${ps && ps.richieste ? ps.richieste : 3} runs with at least 10′ of real running (no walking).${ps && ps.max_corsa_min ? ` Your best continuous run so far: ${ps.max_corsa_min}′.` : ''} You’ll get there by following the plan: it’s a matter of weeks.`));
      }
      cita('seiler');
      out.push(L('Paradosso dei runner: per correre più veloce, la maggior parte delle corse va fatta piano (80/20, Seiler).', 'The runner’s paradox: to run faster, most of your runs must be slow (80/20, Seiler).'));
      sugg = ['obiettivo', 'fc', 'cadenza'];
      break;
    }
    case 'obiettivo': {
      const ob = p.obiettivo;
      if (!attivo || !ob) { nessunPiano(); break; }
      const fmtD = (s) => s.split('-').reverse().join('/');
      out.push(L(`Obiettivo: ${ob.nome}. Il piano ti porta alla gara il ${fmtD(ob.data_gara)}.`, `Goal: ${ob.nome}. The plan takes you to race day on ${fmtD(ob.data_gara)}.`));
      const pg = d.previsioni && d.previsioni.data_gara;
      if (pg && pg.disponibile) out.push(L(`Dai tuoi progressi, la data più probabile in cui sarai pronto è il ${fmtD(pg.p50)} (80% di probabilità entro il ${fmtD(pg.p80)}).`, `Based on your progress, the most likely date you’ll be ready is ${fmtD(pg.p50)} (80% chance by ${fmtD(pg.p80)}).`));
      if (ob.stato === 'in_linea') out.push(L('Sei in linea. 💪 Continua così.', 'You’re on track. 💪 Keep it up.'));
      else if (ob.ritardo_settimane) out.push(L(`Sei indietro di ${ob.ritardo_settimane} settimane: niente panico, si recupera con la costanza, non forzando.`, `You’re ${ob.ritardo_settimane} weeks behind: no panic, consistency catches it up, not forcing it.`));
      if (ob.previsione_tempo && ob.previsione_tempo.tempo_sec) out.push(L(`Se corressi la gara oggi, il tempo stimato (formula di Riegel dalla tua corsa migliore) sarebbe ${oreTempo(ob.previsione_tempo.tempo_sec)}. Si abbassa man mano che ti alleni.`, `If you raced today, the estimated time (Riegel formula from your best run) would be ${oreTempo(ob.previsione_tempo.tempo_sec)}. It drops as you train.`));
      sugg = ['passo', 'settimana', 'motivazione'];
      break;
    }
    case 'sonno': {
      const s = met.sonno_sec, fr = met.fc_riposo, hv = met.hrv;
      if (!s && !fr && !hv) { out.push(L('Non ricevo ancora sonno, FC a riposo o HRV dal tuo orologio: senza questi dati adatto il piano solo con le corse. Se il tuo orologio li misura, controlla che arrivino su Intervals.icu.', 'I’m not receiving sleep, resting HR or HRV from your watch yet: without them I adapt the plan from your runs only. If your watch measures them, check they reach Intervals.icu.')); sugg = ['collegamento']; break; }
      if (s && s.valore) out.push(L(`Sonno: ${durata(s.valore)}${s.media_28g ? ` (media ${durata(s.media_28g)})` : ''}.`, `Sleep: ${durata(s.valore)}${s.media_28g ? ` (average ${durata(s.media_28g)})` : ''}.`) + ' ' + (s.valore < 6 * 3600 ? L('Poco: il recupero ne risente. Stasera prova ad andare a letto 30′ prima.', 'Short: recovery suffers. Tonight try going to bed 30′ earlier.') : L('Bene così.', 'Good.')));
      if (fr && fr.valore) out.push(L(`FC a riposo: ${fr.valore} bpm${fr.media_28g ? ` (media ${Math.round(fr.media_28g)})` : ''}. ${fr.delta >= 5 ? 'È alta: segno di fatica, stress o un malanno in arrivo.' : 'Nella norma: il cuore è recuperato.'}`, `Resting HR: ${fr.valore} bpm${fr.media_28g ? ` (average ${Math.round(fr.media_28g)})` : ''}. ${fr.delta >= 5 ? 'It’s high: a sign of fatigue, stress or something coming on.' : 'Normal: your heart has recovered.'}`));
      if (hv && hv.valore) out.push(L(`HRV: ${Math.round(hv.valore)} ms${hv.media_28g ? ` (media ${Math.round(hv.media_28g)})` : ''}. ${hv.media_28g && hv.valore <= hv.media_28g * 0.85 ? 'Bassa: il sistema nervoso è sotto stress.' : 'Buona: il sistema nervoso è in equilibrio.'}`, `HRV: ${Math.round(hv.valore)} ms${hv.media_28g ? ` (average ${Math.round(hv.media_28g)})` : ''}. ${hv.media_28g && hv.valore <= hv.media_28g * 0.85 ? 'Low: your nervous system is under stress.' : 'Good: your nervous system is balanced.'}`));
      cita('sonno');
      out.push(L('Il miglior integratore per un runner è gratis: 7–9 ore di sonno, a orari regolari.', 'The best supplement for a runner is free: 7–9 hours of sleep, at regular times.'));
      sugg = ['stanco', 'alleggerita', 'carico'];
      break;
    }
    case 'carico': {
      if (carico.acwr == null) { out.push(L('Mi servono qualche settimana di corse per valutare il tuo carico.', 'I need a few weeks of runs to assess your load.')); break; }
      out.push(L(`Ultimi 7 giorni: ${n1(carico.km_7 || 0)} km, contro una media di ${n1(carico.media_settimanale || 0)} km a settimana. Il carico recente è ${n1(carico.acwr)} volte quello abituale (sicuro fino a 1,3).`, `Last 7 days: ${n1(carico.km_7 || 0)} km, against an average of ${n1(carico.media_settimanale || 0)} km a week. Recent load is ${n1(carico.acwr)} times your usual (safe up to 1.3).`));
      if (carico.livello === 'alto') out.push(L('È salito troppo in fretta: per questo alleggerisco la prossima seduta. Non è un castigo, è prevenzione: gli infortuni nascono quasi sempre qui.', 'It rose too fast: that’s why I’m lightening your next session. It’s not punishment, it’s prevention: injuries almost always start here.'));
      else if (carico.livello === 'attenzione') out.push(L('Siamo al limite: questa settimana niente extra, solo le sedute del piano.', 'We’re at the limit: no extras this week, just the planned sessions.'));
      else out.push(L('Carico sotto controllo: stai crescendo nel modo giusto. 👍', 'Load under control: you’re building the right way. 👍'));
      sugg = ['lungo', 'dolore', 'oggi'];
      break;
    }
    case 'lungo': {
      if (carico.limite_lungo_km) out.push(L(`La tua corsa più lunga degli ultimi 30 giorni è di ${n1(carico.lungo_max_30)} km: la prossima non dovrebbe superare ${n1(carico.limite_lungo_km)} km.`, `Your longest run in the last 30 days is ${n1(carico.lungo_max_30)} km: the next shouldn’t exceed ${n1(carico.limite_lungo_km)} km.`));
      cita('frandsen');
      out.push(L('La regola: mai più del 10% oltre la corsa più lunga del mese prima. Uno studio su oltre 5.000 runner (Frandsen, BJSM 2025) ha visto che è proprio il salto della singola corsa, più dei km settimanali, ad aumentare il rischio di infortunio.', 'The rule: never more than 10% beyond your longest run of the previous month. A study of over 5,000 runners (Frandsen, BJSM 2025) found that it’s the jump in a single run, more than weekly mileage, that raises injury risk.'));
      out.push(L('Il lungo si corre piano, sotto il limite facile: l’obiettivo è il tempo in piedi, non la velocità.', 'Long runs are run slow, below the easy limit: the goal is time on your feet, not speed.'));
      sugg = ['alimentazione', 'carico', 'fc'];
      break;
    }
    case 'alimentazione':
      cita('nutrizione');
      out.push(L('Prima delle corse oltre l’ora: un pasto con carboidrati 1–4 ore prima; se esci presto basta uno spuntino leggero (banana, fette biscottate). Evita grassi e fibre in abbondanza.', 'Before runs over an hour: a carb meal 1–4 hours before; if you head out early a light snack is enough (banana, toast). Avoid lots of fat and fibre.'));
      out.push(L('Durante: sotto i 45′ non servono carboidrati. Tra 1 e 2,5 ore 30–60 g all’ora (gel, bevande sportive); oltre le 2,5–3 ore fino a 90 g.', 'During: under 45′ you don’t need carbs. From 1 to 2.5 hours 30–60 g per hour (gels, sports drinks); beyond 2.5–3 hours up to 90 g.'));
      out.push(L('Dopo: nelle 2 ore successive carboidrati e 15–25 g di proteine (yogurt e frutta, un panino, latte e cereali), e bevi finché le urine sono chiare.', 'After: within the next 2 hours carbs and 15–25 g of protein (yoghurt and fruit, a sandwich, milk and cereal), and drink until your urine is pale.'));
      out.push(L('Sono indicazioni generali: per esigenze specifiche rivolgiti a un nutrizionista.', 'These are general guidelines: for specific needs see a nutritionist.'));
      sugg = ['lungo', 'peso', 'meteo'];
      break;
    case 'peso': {
      const c = sal.corpo || {};
      if (c.bmi) out.push(L(`Il tuo BMI è ${n1(c.bmi)} (${c.categoria ? c.categoria.nome : ''}).`, `Your BMI is ${n1(c.bmi)} (${c.categoria ? c.categoria.nome : ''}).`));
      out.push(L('La corsa facile è perfetta per il peso: si brucia soprattutto grasso e si può fare spesso senza farsi male. Funziona insieme all’alimentazione, non al suo posto.', 'Easy running is perfect for weight: you burn mostly fat and can do it often without getting hurt. It works alongside your diet, not instead of it.'));
      out.push(L('Non tagliare i carboidrati prima delle sedute lunghe o intense: senza benzina l’allenamento rende meno e il rischio di infortunio sale. Meglio un calo graduale e costante, circa 0,5–1 kg a settimana: è quello che si mantiene nel tempo.', 'Don’t cut carbs before long or hard sessions: without fuel training works less well and injury risk rises. Better a gradual, steady loss, about 0.5–1 kg a week: that’s what lasts.'));
      cita('peso');
      sugg = ['alimentazione', 'oggi'];
      break;
    }
    case 'cadenza': {
      const cad = h.cadenze();
      if (cad.length) {
        const m = Math.round(cad.reduce((t, x) => t + x, 0) / cad.length);
        out.push(L(`La tua cadenza media nelle ultime corse: ${m} passi al minuto.`, `Your average cadence over recent runs: ${m} steps per minute.`) + ' ' + (m < 160
          ? cita('heiderscheit') + L(`Prova ad aumentarla del 5–10% (verso ${Math.round(m * 1.05)}–${Math.round(m * 1.1)}) con passi più corti e leggeri: riduce il carico su ginocchia e anche (Heiderscheit, 2011).`, `Try raising it by 5–10% (towards ${Math.round(m * 1.05)}–${Math.round(m * 1.1)}) with shorter, lighter steps: it reduces load on knees and hips (Heiderscheit, 2011).`)
          : L('Buona: passi rapidi e leggeri, così proteggi le articolazioni.', 'Good: quick, light steps protect your joints.')));
      } else out.push(L('Non ho ancora dati di cadenza dalle tue corse.', 'I don’t have cadence data from your runs yet.'));
      out.push(L('Tecnica in tre punti: appoggia il piede sotto il corpo (non davanti), busto alto e leggermente in avanti, braccia rilassate a 90°. Cambia una cosa alla volta, nelle corse facili.', 'Form in three points: land with your foot under your body (not in front), tall torso leaning slightly forward, relaxed arms at 90°. Change one thing at a time, on easy runs.'));
      sugg = ['dolore', 'riscaldamento', 'passo'];
      break;
    }
    case 'meteo':
      cita('caldo');
      out.push(L('Caldo: il cuore batte di più per raffreddarti, quindi rallenta e segui la FC, non il passo. Esci presto o la sera, parti ben idratato e nelle uscite lunghe bevi anche durante. Il corpo si abitua al caldo in 1–2 settimane di uscite.', 'Heat: your heart beats faster to cool you down, so slow down and follow your heart rate, not your pace. Go early or in the evening, start well hydrated and drink during long runs too. Your body adapts to heat over 1–2 weeks of runs.'));
      out.push(L('Freddo: vestiti a strati come se ci fossero 10° in più, riscaldati più a lungo e copri mani e orecchie. La pioggia va benissimo, il ghiaccio no.', 'Cold: dress in layers as if it were 10° warmer, warm up longer and cover hands and ears. Rain is fine, ice isn’t.'));
      out.push(L('Il meteo di ogni corsa lo vedi nel dettaglio: quando valuto la tua efficienza tengo conto del caldo.', 'You see the weather of every run in its detail: when I assess your efficiency I account for the heat.'));
      sugg = ['fc', 'alimentazione', 'oggi'];
      break;
    case 'scarpe': {
      const sc = h.scarpe().filter((s) => s.attiva);
      if (sc.length) sc.slice(0, 3).forEach((s) => out.push(`${s.nome}: ${Math.round(s.km)} km ${L('su', 'of')} ${Math.round(s.limite_km)}. ` + (s.km >= s.limite_km ? L('È ora di cambiarle: l’ammortizzazione è finita.', 'Time to replace them: the cushioning is gone.') : s.km >= s.limite_km * 0.85 ? L('Quasi a fine vita: inizia a pensare alle prossime.', 'Nearly worn out: start thinking about the next pair.') : L('Hanno ancora strada da fare.', 'Still plenty of miles left.'))));
      else out.push(L('Non hai ancora scarpe nel profilo: aggiungile e conto io i chilometri di ogni paio.', 'You have no shoes in your profile yet: add them and I’ll count the kilometres for each pair.'));
      cita('scarpe', 'scarpe_alternate');
      out.push(L('In genere una scarpa da corsa dura 480–800 km, e dopo un anno conviene controllarla anche se sembra a posto. Alternare più paia aiuta: in uno studio su 264 runner chi lo faceva si è infortunato circa il 39% in meno.', 'A running shoe usually lasts 480–800 km, and after a year it’s worth checking even if it looks fine. Rotating pairs helps: in a study of 264 runners, those who did had about 39% fewer injuries.'));
      sugg = ['dolore', 'cadenza'];
      break;
    }
    case 'riscaldamento':
      out.push(L('Riscaldamento: 5′ di camminata svelta o corsa lentissima, poi qualche esercizio dinamico (skip, calciata, slanci delle gambe). Prima delle sedute veloci aggiungi 3–4 allunghi da 20″.', 'Warm-up: 5′ of brisk walking or very slow running, then a few dynamic drills (high knees, butt kicks, leg swings). Before fast sessions add 3–4 strides of 20″.'));
      cita('stretching', 'forza');
      out.push(L('Dopo: 5′ di cammino e, se ti fa stare bene, allungamento leggero di polpacci, quadricipiti e flessori. Prima di correre meglio gli esercizi dinamici: lo stretching statico lungo (oltre 60″ per muscolo) subito prima toglie un po’ di forza.', 'After: 5′ of walking and, if it feels good, gentle stretching of calves, quads and hamstrings. Before running, dynamic drills are better: long static stretching (over 60″ per muscle) right before costs a little power.'));
      out.push(L('Bonus da coach: 2 sedute di forza a settimana da 20′ (squat, affondi, ponte, polpacci) fanno la differenza: negli studi sullo sport l’allenamento di forza ha ridotto gli infortuni a meno di un terzo.', 'Coach’s bonus: 2 strength sessions a week of 20′ (squats, lunges, bridges, calf raises) make a difference: in sports studies strength training cut injuries to under a third.'));
      sugg = ['oggi', 'cadenza', 'dolore'];
      break;
    case 'collegamento': {
      const sy = (d && d.sincronizzazione) || {};
      if (d && d.collegamento && d.collegamento.avviso) out.push(L('Alcune corse arrivano a Intervals solo da Strava e non posso leggerle: collega l’orologio direttamente a Intervals.icu (Profilo → Collega l’orologio).', 'Some runs reach Intervals only through Strava and I can’t read them: connect your watch directly to Intervals.icu (Profile → Connect your watch).'));
      if (sy.configurata === false && !h.demo) out.push(L('Intervals.icu non è ancora collegato: inserisci Athlete ID e chiave nel Profilo e da lì leggo tutto da solo.', 'Intervals.icu isn’t connected yet: enter your Athlete ID and key in your Profile and I’ll read everything myself.'));
      out.push(L('Leggo i dati da Intervals.icu ogni 15 minuti, e subito quando apri l’app. Se una corsa non c’è, controlla prima che sia su Intervals: se lì c’è, a me arriva al giro successivo. Puoi anche premere “Sincronizza ora” nel Profilo.', 'I read data from Intervals.icu every 15 minutes, and right away when you open the app. If a run is missing, first check it’s on Intervals: if it’s there, it reaches me at the next round. You can also tap “Sync now” in your Profile.'));
      out.push(L('Sonno, FC a riposo e HRV dipendono dall’orologio e dall’app che li carica: alcuni li mandano con qualche ora di ritardo.', 'Sleep, resting HR and HRV depend on your watch and the app uploading them: some send them a few hours late.'));
      sugg = ['problemi', 'sonno'];
      break;
    }
    case 'come_funziona':
      out.push(L('Il mio metodo è un ciclo: Valuta → Allena → Ascolta → Adatta.', 'My method is a cycle: Assess → Train → Listen → Adapt.'));
      out.push(L('Ogni mattina guardo FC a riposo, HRV e sonno rispetto alla tua media: se qualcosa non torna, alleggerisco la seduta. Ogni settimana decido se avanzare, ripetere o tornare indietro in base alle sedute fatte e alla loro intensità. Ogni 3 settimane ritocco l’intensità del piano se è troppo facile o troppo dura.', 'Every morning I look at resting HR, HRV and sleep against your average: if something’s off, I lighten the session. Every week I decide whether to move forward, repeat or go back based on sessions done and their intensity. Every 3 weeks I fine-tune the plan’s intensity if it’s too easy or too hard.'));
      out.push(L('Le zone cardiache sono tue (Tanaka + Karvonen), e ogni decisione ha un motivo scritto nel diario del coach. Tutto spiegato in Info.', 'Heart-rate zones are yours (Tanaka + Karvonen), and every decision has a written reason in the coach’s history. Everything is explained in Info.'));
      sugg = ['fc', 'alleggerita', 'settimana'];
      break;
    case 'problemi': {
      const prob = [];
      const sy = (d && d.sincronizzazione) || {};
      if (sy.configurata === false && !h.demo) prob.push(L('Intervals.icu non è collegato: senza dati non posso seguirti.', 'Intervals.icu isn’t connected: without data I can’t follow you.'));
      if (d && d.collegamento && d.collegamento.avviso) prob.push(L('Alcune corse arrivano solo da Strava e non le vedo: collega l’orologio direttamente a Intervals.icu.', 'Some runs only come through Strava and I can’t see them: connect your watch directly to Intervals.icu.'));
      const corse = (d && d.ultime_corse) || [];
      const ultimaData = corse.reduce((m, c) => (c.data > m ? c.data : m), '');
      if (attivo && oggiStr && (!ultimaData || ultimaData < h.addDays(oggiStr, -7))) prob.push(L('Non corri da più di una settimana: riparti con una seduta facile, senza recuperare niente.', 'You haven’t run for over a week: restart with an easy session, without making anything up.'));
      if (carico.livello === 'alto' || carico.livello === 'attenzione') prob.push(L(`Il carico è salito in fretta (${n1(carico.acwr)} volte quello abituale): rispetta le sedute alleggerite.`, `Load rose fast (${n1(carico.acwr)} times your usual): respect the lightened sessions.`));
      if (segnali.length) prob.push(L(`Il recupero è incompleto: ${segnali.join(', ')}.`, `Recovery is incomplete: ${segnali.join(', ')}.`));
      const ult = corse.slice().sort((a, b) => (a.data < b.data ? 1 : -1))[0];
      const pc = ult && h.parere(ult.id);
      if (pc) pc.punti.filter((x) => x.tono === 'warn').forEach((x) => prob.push(x.testo));
      if (p.settimana && p.settimana.rischio_indietro) prob.push(L('Questa settimana rischi di ripetere: mancano sedute.', 'This week you risk repeating: sessions are missing.'));
      if (attivo && p.aderenza_pct != null && p.aderenza_pct < 70 && p.sedute_passate >= 6) prob.push(L(`Hai fatto il ${p.aderenza_pct}% delle sedute: la costanza è il primo motore dei progressi.`, `You’ve done ${p.aderenza_pct}% of sessions: consistency is the main driver of progress.`));
      if (!met.sonno_sec && !met.hrv && !met.fc_riposo) prob.push(L('Non ricevo sonno, FC a riposo né HRV: adatto il piano solo con le corse, meno precisamente.', 'I don’t receive sleep, resting HR or HRV: I adapt the plan from runs only, less precisely.'));
      if (prob.length) { out.push(L('Ecco cosa vedo da migliorare, in ordine di importanza:', 'Here’s what I see to improve, in order of importance:')); prob.slice(0, 4).forEach((x) => out.push('• ' + x)); }
      else out.push(L('Sinceramente? Non vedo niente che non vada: dati che arrivano, carico sotto controllo, recupero buono. Stai facendo le cose per bene. 💪 Il prossimo passo è solo continuare così.', 'Honestly? I see nothing wrong: data coming in, load under control, good recovery. You’re doing things right. 💪 The next step is simply to keep going.'));
      if (pc && pc.consiglio) out.push(L('Il mio consiglio di oggi: ', 'My tip for today: ') + pc.consiglio);
      sugg = ['ultima', 'carico', 'passo'];
      break;
    }
    case 'fuori':
      out.push(L('Qui ti so aiutare solo sulla corsa: il tuo piano, le sedute, il recupero, la salute da runner. Su questo passo la mano. 🙂', 'Here I can only help with running: your plan, sessions, recovery, runner’s health. On this one I’ll pass. 🙂'));
      out.push(L('Torniamo ad allenarci: cosa ti serve sapere?', 'Back to training: what do you need to know?'));
      sugg = ['oggi', 'problemi', 'obiettivo'];
      break;
    default:
      out.push(L('Non sono sicuro di aver capito. Su corsa, piano, recupero e salute so rispondere bene: prova a chiedermelo in un altro modo, o scegli una domanda qui sotto.', 'I’m not sure I understood. I’m good on running, your plan, recovery and health: try asking another way, or pick a question below.'));
      sugg = ['oggi', 'problemi', 'ultima', 'obiettivo'];
  }
  if (!sugg.length) sugg = ['oggi', 'problemi'];
  return { tema, testo: out, fonti: [...fonti].map((k) => ({ titolo: FONTI[k][0], url: FONTI[k][1] })), suggerimenti: sugg.filter((x) => x !== tema).slice(0, 4).map((t) => ({ tema: t, label: etichetta(L, t) })) };
}

function etichetta(L, t) {
  const E = {
    oggi: ['Cosa faccio oggi?', 'What’s my session?'],
    ultima: ['Com’è andata l’ultima corsa?', 'How was my last run?'],
    problemi: ['Cosa non funziona?', 'What’s not working?'],
    obiettivo: ['Quando arrivo all’obiettivo?', 'When will I reach my goal?'],
    settimana: ['Come va la settimana?', 'How’s my week?'],
    fc: ['Che FC devo tenere?', 'What heart rate should I keep?'],
    passo: ['Sto migliorando?', 'Am I improving?'],
    alleggerita: ['Perché è alleggerita?', 'Why is it lighter?'],
    stanco: ['Sono stanco, che faccio?', 'I’m tired, what do I do?'],
    motivazione: ['Mi serve una spinta', 'I need a push'],
    sonno: ['Come sto recuperando?', 'How am I recovering?'],
    carico: ['Sto esagerando?', 'Am I overdoing it?'],
    lungo: ['Quanto può essere lungo il lungo?', 'How long can my long run be?'],
    alimentazione: ['Cosa mangio prima e dopo?', 'What do I eat before and after?'],
    peso: ['Correre per perdere peso', 'Running to lose weight'],
    cadenza: ['Com’è la mia cadenza?', 'How’s my cadence?'],
    meteo: ['Come corro col caldo o il freddo?', 'Running in heat or cold'],
    scarpe: ['Le mie scarpe sono da cambiare?', 'Do my shoes need replacing?'],
    riscaldamento: ['Riscaldamento e stretching', 'Warm-up and stretching'],
    collegamento: ['Mi mancano dei dati', 'Some data is missing'],
    come_funziona: ['Come ragioni?', 'How do you think?'],
    saltata: ['Ho saltato una seduta', 'I missed a session'],
    dolore: ['Ho un dolore', 'I have some pain'],
  };
  return L(...(E[t] || ['Cosa faccio oggi?', 'What’s my session?']));
}

// Limite per utente: 30 messaggi ogni 5 minuti (oltre a quelli di nginx)
const finestre = new Map();
function consenti(chiave) {
  const ora = Date.now();
  const v = (finestre.get(chiave) || []).filter((t) => ora - t < 5 * 60 * 1000);
  if (v.length >= 30) { finestre.set(chiave, v); return false; }
  v.push(ora);
  finestre.set(chiave, v);
  if (finestre.size > 5000) for (const [k, t] of finestre) if (!t.length || ora - t[t.length - 1] > 5 * 60 * 1000) finestre.delete(k);
  return true;
}

// Parole chiave trovate per tema: aiutano il modello a decidere (e servono se il modello manca)
function contaParole(testo) {
  const t = norm(testo), n = {};
  for (const a of ARGOMENTI) { const k = a.kw.filter((x) => trova(t, x)).length; if (k) n[a.id] = k; }
  return n;
}

// Giorno citato nella domanda: 'r<n>' = tra n giorni, 'd<n>' = giorno della settimana (0 = domenica)
const SETTIMANA = [['domenica', 'sunday'], ['lunedi', 'monday'], ['martedi', 'tuesday'], ['mercoledi', 'wednesday'], ['giovedi', 'thursday'], ['venerdi', 'friday'], ['sabato', 'saturday']];
function giornoChiesto(t) {
  if (trova(t, 'dopodomani') || trova(t, 'day after tomorrow')) return 'r2';
  if (trova(t, 'domani') || trova(t, 'tomorrow')) return 'r1';
  const i = SETTIMANA.findIndex((g) => g.some((x) => trova(t, x)));
  if (i >= 0) return 'd' + i;
  if (trova(t, 'oggi') || trova(t, 'today') || trova(t, 'stasera') || trova(t, 'tonight')) return 'r0';
  return null;
}
function dataDaGiorno(g, oggiStr, addDays) {
  const n = Number(String(g).slice(1));
  if (!Number.isInteger(n) || n < 0 || n > 6) return null;
  if (g[0] === 'r') return addDays(oggiStr, n);
  for (let k = 0; k < 7; k++) { const x = addDays(oggiStr, k); if (new Date(x + 'T00:00:00Z').getUTCDay() === n) return x; }
  return null;
}

// Ingresso: { testo?: string, tema?: string, prima?: string } -> { temi: [1 o 2 temi], info }
// prima = tema della risposta precedente (solo da lista ammessa), per capire i seguiti ("e domani?")
async function capisciDomanda(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (typeof b.tema === 'string' && TEMI.has(b.tema)) return { temi: [b.tema], info: {} };
  if (typeof b.testo !== 'string') return { temi: ['benvenuto'], info: {} };
  const testo = b.testo.slice(0, MAX_TESTO);
  const t = norm(testo);
  if (t.trim() === '') return { temi: ['benvenuto'], info: {} };
  const prima = typeof b.prima === 'string' && TEMI.has(b.prima) ? b.prima : null;
  const info = { giorno: giornoChiesto(t) };
  // sicurezza a parole chiave, deterministica: non si aggira riformulando per il modello
  for (const id of ['urgente', 'meta', 'ostile']) {
    if (ARGOMENTI.find((x) => x.id === id).kw.some((k) => trova(t, k))) return { temi: [id], info };
  }
  // "perché?", "in che senso?": si continua il discorso di prima
  if (prima && /^ (e )?(perche|come mai|in che senso|cioe|spiegami meglio|spiega meglio|dimmi di piu|why|how come|what do you mean|tell me more|explain) $/.test(t)) return { temi: [prima], info };
  let temi = null;
  try {
    const bonus = info.giorno && info.giorno !== 'r0' ? { oggi: 0.008 } : {};
    const r = await capire.capisci(testo, { paroleChiave: contaParole, prima, bonus });
    if (r) temi = r.temi;
  } catch (_) { /* si usano le parole chiave */ }
  if (!temi || temi[0] === 'boh') {
    const k = scegliTema(testo);
    if (!temi || (k !== 'boh' && (contaParole(testo)[k] || 0) >= 2)) temi = [k];
  }
  // "e giovedì?" subito dopo una domanda sulle sedute: basta il giorno
  if (temi[0] === 'boh' && info.giorno && (!prima || ['oggi', 'benvenuto', 'saluto', 'alleggerita', 'settimana'].includes(prima))) temi = ['oggi'];
  return { temi, info };
}

// Una risposta per uno o due temi (es. "sono stanco ma giovedì ho le ripetute": stanco + oggi)
function rispondi(h, d, temi, info) {
  const r = creaRisposta(h, d, temi[0], info);
  if (temi.length < 2) return r;
  const r2 = creaRisposta(h, d, temi[1], info);
  const visti = new Set(temi), sugg = [];
  for (const s of r.suggerimenti.concat(r2.suggerimenti)) if (!visti.has(s.tema)) { visti.add(s.tema); sugg.push(s); }
  const fonti = r.fonti.concat(r2.fonti.filter((f) => !r.fonti.some((x) => x.url === f.url)));
  return { tema: temi[0], temi, testo: r.testo.concat(r2.testo.filter((x) => !r.testo.includes(x))), fonti, suggerimenti: sugg.slice(0, 4) };
}

module.exports = { creaRisposta, rispondi, capisciDomanda, scegliTema, contaParole, giornoChiesto, norm, consenti, MAX_TESTO };
