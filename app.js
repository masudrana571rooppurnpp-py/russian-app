'use strict';

const $ = (s) => document.querySelector(s);
const view = $('#view');
const KEY = 'russian-start-v1';
const INTERVALS = [0, 1, 3, 7, 14, 30, 60]; // days until next review, by "box"
const NEW_PER_SESSION = 10;

// ---------- saved progress (stays on your phone) ----------
let state = { cards: {}, streak: 0, lastDay: null, reviewed: { day: null, n: 0 }, deck: 'All' };
try { Object.assign(state, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };

// ---------- helpers ----------
const todayNum = () => {
  const d = new Date();
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
};
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const ALL = [];
for (const [deck, list] of Object.entries(DECKS)) {
  for (const [ru, tr, en] of list) ALL.push({ id: ru, ru, tr, en, deck });
}
const cardsOf = (deck) => (deck === 'All' ? ALL : ALL.filter((c) => c.deck === deck));

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

let VOICES = [];
function loadVoices() { if ('speechSynthesis' in window) VOICES = speechSynthesis.getVoices() || []; }
loadVoices();
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = loadVoices;
const ruVoice = () => VOICES.find((x) => x.lang && x.lang.toLowerCase().replace('_', '-').startsWith('ru'));
const transLink = (text) => 'https://translate.google.com/?sl=ru&tl=en&op=translate&text=' + encodeURIComponent(text);

function speak(text) {
  if (!('speechSynthesis' in window)) { toast('This browser has no speech. Use the Google Translate link instead.'); return; }
  loadVoices();
  const v = ruVoice();
  if (VOICES.length && !v) toast('No Russian voice installed. See "Sound help" on the Home tab.');
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ru-RU';
  u.rate = 0.8;
  u.volume = 1;
  if (v) u.voice = v;
  u.onerror = (e) => toast('Sound error (' + ((e && e.error) || 'unknown') + '). See "Sound help" on the Home tab.');
  if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
  speechSynthesis.speak(u);
  if (speechSynthesis.paused) speechSynthesis.resume();
}

function soundCheck() {
  const out = $('#sc-out');
  loadVoices();
  const n = VOICES.length;
  const v = ruVoice();
  let msg;
  if (!('speechSynthesis' in window)) msg = '❌ This browser cannot speak. Try Chrome.';
  else if (!n) msg = '⚠️ No voices found yet. Tap again in a few seconds. If still 0, install "Speech Services by Google".';
  else if (!v) msg = '❌ ' + n + ' voices found, but none is Russian. Install Russian voice data (steps below).';
  else msg = '✅ Russian voice found: ' + v.name + '. If you hear nothing, raise the media volume.';
  if (out) out.textContent = msg;
  speak('Привет! Как дела?');
}

// ---------- spaced repetition ----------
function noteActivity() {
  const t = todayNum();
  if (state.lastDay !== t) {
    state.streak = state.lastDay === t - 1 ? state.streak + 1 : 1;
    state.lastDay = t;
  }
  if (state.reviewed.day !== t) state.reviewed = { day: t, n: 0 };
  state.reviewed.n++;
}

// rating: 0 = again, 1 = good, 2 = easy
function review(card, rating) {
  const s = state.cards[card.id] || { box: 0, due: 0 };
  s.box = rating === 0 ? 0 : Math.min(s.box + rating, INTERVALS.length - 1);
  s.due = todayNum() + INTERVALS[s.box];
  state.cards[card.id] = s;
  noteActivity();
  save();
}

function buildQueue(deck) {
  const t = todayNum();
  const pool = cardsOf(deck);
  const due = pool.filter((c) => state.cards[c.id] && state.cards[c.id].due <= t);
  const fresh = pool.filter((c) => !state.cards[c.id]).slice(0, NEW_PER_SESSION);
  return shuffle(due).concat(fresh);
}

// ---------- navigation ----------
function go(tab) {
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  window.scrollTo(0, 0);
  if (tab === 'home') renderHome();
  else if (tab === 'alphabet') renderAlphabet();
  else if (tab === 'study') renderStudy(true);
  else if (tab === 'speak') renderSpeak(true);
  else renderQuizSetup();
}

// ---------- home ----------
function renderHome() {
  const t = todayNum();
  const streak = state.lastDay !== null && state.lastDay >= t - 1 ? state.streak : 0;
  const seen = Object.keys(state.cards).length;
  const known = Object.values(state.cards).filter((s) => s.box >= 3).length;
  const due = ALL.filter((c) => state.cards[c.id] && state.cards[c.id].due <= t).length;
  const today = state.reviewed.day === t ? state.reviewed.n : 0;
  const decks = ['All', ...Object.keys(DECKS)];

  view.innerHTML = `
    <section class="stats">
      <div><b>${streak}</b><span>day streak 🔥</span></div>
      <div><b>${today}</b><span>reviews today</span></div>
      <div><b>${due}</b><span>due now</span></div>
    </section>
    <section class="card">
      <h2>Your progress</h2>
      <div class="bar"><i style="width:${Math.round((known / ALL.length) * 100)}%"></i></div>
      <p class="muted">${known} well known · ${seen} started · ${ALL.length} words in total</p>
    </section>
    <section class="card">
      <h2>Choose a deck</h2>
      <div class="chips">
        ${decks.map((d) => `<button class="chip ${d === state.deck ? 'on' : ''}" data-deck="${d}">${d} <small>${cardsOf(d).length}</small></button>`).join('')}
      </div>
      <button class="btn" id="go-study">Start studying</button>
    </section>
    <section class="card tip">
      <h2>🔊 Sound help</h2>
      <button class="btn alt" id="sc-test">Test the sound</button>
      <p id="sc-out" style="margin-top:10px"></p>
      <p style="margin-top:10px">No Russian voice? On Android: Settings → search "Text-to-speech output" → choose <b>Speech Services by Google</b> → ⚙ → <b>Install voice data</b> → <b>Russian</b>. Also raise the media volume. Then restart this app.</p>
    </section>
    <section class="card tip">
      <h2>How to learn</h2>
      <p>1) Learn the alphabet first (Alphabet tab). 2) Study about 10 new words a day with the flashcards. 3) Take a quiz. Come back every day: the app brings old words back just before you forget them.</p>
    </section>
    <button class="btn small" id="reset">Reset my progress</button>`;

  view.querySelectorAll('[data-deck]').forEach((b) => {
    b.onclick = () => { state.deck = b.dataset.deck; save(); renderHome(); };
  });
  $('#go-study').onclick = () => go('study');
  $('#sc-test').onclick = soundCheck;
  $('#reset').onclick = () => {
    if (confirm('Erase all progress?')) {
      state.cards = {}; state.streak = 0; state.lastDay = null; state.reviewed = { day: null, n: 0 };
      save(); renderHome();
    }
  };
}

// ---------- alphabet ----------
function renderAlphabet() {
  view.innerHTML = `
    <h2>The Russian alphabet</h2>
    <p class="muted">33 letters. Tap a letter to see how it sounds.</p>
    <div class="grid">
      ${ALPHABET.map((a, i) => `<button class="tile" data-i="${i}"><span class="big">${a[0]}</span><span class="tr">${a[1]}</span></button>`).join('')}
    </div>
    <button class="btn" id="aq">Practise the alphabet</button>`;
  view.querySelectorAll('.tile').forEach((b) => { b.onclick = () => { showLetter(+b.dataset.i); speak(ALPHABET[+b.dataset.i][3]); }; });
  $('#aq').onclick = () => startQz(buildAlphaQuiz, 'alphabet', 'alpha');
}

function showLetter(i) {
  const a = ALPHABET[i];
  const sh = $('#sheet');
  const close = () => { sh.hidden = true; sh.innerHTML = ''; };
  sh.hidden = false;
  sh.innerHTML = `
    <div class="sheet-bg"></div>
    <div class="sheet-box">
      <div class="big2">${a[0]}</div>
      <p><b>${a[1]}</b>: ${a[2]}</p>
      <p>Example: <b>${a[3]}</b> (${a[4]}) = ${a[5]}</p>
      <div class="row2">
        <button class="btn" id="sl">🔊 Letter</button>
        <button class="btn" id="sw">🔊 Word</button>
      </div>
      <a class="lnk" target="_blank" rel="noopener" href="${transLink(a[3])}">No sound? Listen on Google Translate</a>
      <button class="btn alt" id="sc">Close</button>
    </div>`;
  sh.querySelector('.sheet-bg').onclick = close;
  $('#sc').onclick = close;
  $('#sw').onclick = () => speak(a[3]);
  $('#sl').onclick = () => speak(a[0].charAt(0));
}

// ---------- flashcards ----------
let session = null;

function renderStudy(fresh) {
  if (fresh || !session) {
    const queue = buildQueue(state.deck);
    session = { queue, total: queue.length, done: 0, shown: false };
  }
  const s = session;

  if (!s.queue.length) {
    view.innerHTML = `
      <section class="card center">
        <h2>${s.total ? '🎉 Session complete' : 'Nothing due right now'}</h2>
        <p class="muted">${s.total ? `You reviewed ${s.done} cards. Great work!` : 'Pick another deck, try a quiz, or come back tomorrow.'}</p>
        <button class="btn" id="back">Choose a deck</button>
      </section>`;
    $('#back').onclick = () => go('home');
    return;
  }

  const c = s.queue[0];
  const isNew = !state.cards[c.id];
  view.innerHTML = `
    <div class="meta"><span>${state.deck}</span><span>${s.done}/${s.total}</span></div>
    <div class="bar"><i style="width:${s.total ? Math.round((s.done / s.total) * 100) : 0}%"></i></div>
    <section class="flash" id="flash">
      ${isNew ? '<span class="badge">NEW</span>' : ''}
      <div class="ru">${c.ru}</div>
      ${s.shown ? `<div class="tr">${c.tr}</div><div class="en">${c.en}</div>` : '<div class="muted">Tap to reveal</div>'}
      <button class="speak" id="say" aria-label="Listen">🔊</button>
    </section>
    <a class="lnk" target="_blank" rel="noopener" href="${transLink(c.ru)}">No sound? Listen on Google Translate</a>
    ${s.shown
      ? '<div class="rate"><button class="r0" data-r="0">Again</button><button class="r1" data-r="1">Good</button><button class="r2" data-r="2">Easy</button></div>'
      : '<button class="btn" id="show">Show answer</button>'}`;

  $('#say').onclick = (e) => { e.stopPropagation(); speak(c.ru); };
  $('#flash').onclick = () => { if (!s.shown) { s.shown = true; renderStudy(); } };
  const showBtn = $('#show');
  if (showBtn) showBtn.onclick = () => { s.shown = true; renderStudy(); };
  view.querySelectorAll('[data-r]').forEach((b) => {
    b.onclick = () => {
      const r = +b.dataset.r;
      s.queue.shift();
      s.shown = false;
      review(c, r);
      if (r === 0) s.queue.push(c); else s.done++;
      renderStudy();
    };
  });
}

// ---------- quizzes ----------
let qz = null;

function renderQuizSetup() {
  view.innerHTML = `
    <section class="card">
      <h2>Quiz</h2>
      <p class="muted">10 questions from: <b>${state.deck}</b> (change the deck on the Home tab).</p>
      <button class="btn" data-m="ru-en">Russian → English</button>
      <button class="btn alt" data-m="en-ru">English → Russian</button>
      <button class="btn alt" data-m="listen">🎧 Listening: hear it, pick the meaning</button>
    </section>`;
  view.querySelectorAll('[data-m]').forEach((b) => {
    b.onclick = () => startQz(() => buildVocabQuiz(b.dataset.m), 'quiz', b.dataset.m);
  });
}

function buildVocabQuiz(mode) {
  const toRu = mode === 'en-ru';
  const key = toRu ? 'ru' : 'en';
  return shuffle(cardsOf(state.deck)).slice(0, 10).map((c) => {
    const others = shuffle(ALL.filter((o) => o.id !== c.id && o[key] !== c[key])).slice(0, 3);
    const opts = shuffle([c, ...others]);
    return {
      prompt: toRu ? c.en : mode === 'listen' ? '🎧' : c.ru,
      sub: mode === 'ru-en' ? c.tr : '',
      say: mode === 'en-ru' ? null : c.ru,
      auto: mode === 'listen',
      opts: opts.map((o) => (toRu ? `${o.ru} <small>${o.tr}</small>` : o.en)),
      ans: opts.indexOf(c),
      card: c,
      reveal: `${c.ru} · ${c.tr} · ${c.en}`,
    };
  });
}

function buildAlphaQuiz() {
  return shuffle(ALPHABET).slice(0, 10).map((a) => {
    const others = shuffle(ALPHABET.filter((o) => o[1] !== a[1])).slice(0, 3);
    const opts = shuffle([a, ...others]);
    return {
      prompt: a[0], sub: '', say: null, auto: false,
      opts: opts.map((o) => o[1]),
      ans: opts.indexOf(a), card: null,
      reveal: `${a[0]} = ${a[1]} (${a[2]})`,
    };
  });
}

function startQz(build, back, mode) {
  qz = { build, back, mode, items: build(), i: 0, score: 0, missed: [], picked: null };
  renderQz();
}

function renderQz() {
  const q = qz.items[qz.i];

  if (!q) {
    const n = qz.items.length;
    view.innerHTML = `
      <section class="card center">
        <h2>${qz.score} / ${n}</h2>
        <p class="muted">${qz.score >= 8 ? 'Excellent! 🎉' : qz.score >= 5 ? 'Good work, keep going.' : 'Keep practising, you will get there.'}</p>
        ${qz.missed.length ? `<div class="missed"><h3>Review these</h3>${qz.missed.map((m) => `<p>${m}</p>`).join('')}</div>` : ''}
        <button class="btn" id="qa">Try again</button>
        <button class="btn alt" id="qb">Back</button>
      </section>`;
    $('#qa').onclick = () => startQz(qz.build, qz.back, qz.mode);
    $('#qb').onclick = () => go(qz.back);
    return;
  }

  const done = qz.picked !== null;
  view.innerHTML = `
    <div class="meta"><span>Question ${qz.i + 1}/${qz.items.length}</span><span>Score ${qz.score}</span></div>
    <div class="bar"><i style="width:${Math.round((qz.i / qz.items.length) * 100)}%"></i></div>
    <section class="card center">
      <div class="qp">${q.prompt}</div>
      ${q.sub ? `<div class="muted">${q.sub}</div>` : ''}
      ${q.say ? '<button class="speak inline" id="say" aria-label="Listen">🔊</button>' : ''}
    </section>
    <div class="opts">
      ${q.opts.map((o, i) => `<button class="opt ${done ? (i === q.ans ? 'right' : i === qz.picked ? 'wrong' : '') : ''}" data-i="${i}" ${done ? 'disabled' : ''}>${o}</button>`).join('')}
    </div>
    ${done ? `<p class="fb">${q.reveal}</p><button class="btn" id="next">${qz.i + 1 === qz.items.length ? 'See result' : 'Next'}</button>` : ''}`;

  const sayBtn = $('#say');
  if (sayBtn) sayBtn.onclick = () => speak(q.say);
  if (q.auto && !q.spoken) { q.spoken = true; speak(q.say); }

  view.querySelectorAll('.opt').forEach((b) => {
    b.onclick = () => {
      if (qz.picked !== null) return;
      const i = +b.dataset.i;
      qz.picked = i;
      const ok = i === q.ans;
      if (ok) qz.score++; else qz.missed.push(q.reveal);
      if (q.card) review(q.card, ok ? 1 : 0);
      renderQz();
    };
  });
  const next = $('#next');
  if (next) next.onclick = () => { qz.i++; qz.picked = null; renderQz(); };
}

// ---------- speaking practice ----------
// <pure>
const NUMW = { '0': 'ноль', '1': 'один', '2': 'два', '3': 'три', '4': 'четыре', '5': 'пять', '6': 'шесть', '7': 'семь', '8': 'восемь', '9': 'девять', '10': 'десять' };
const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  .split(' ').map((w) => NUMW[w] || w).join(' ');

function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}
const sim = (a, b) => (a === b ? 1 : 1 - lev(a, b) / Math.max(a.length, b.length, 1));

function alignWords(exp, got) {
  const n = exp.length, m = got.length;
  const D = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) D[i][0] = i;
  for (let j = 1; j <= m; j++) D[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + 1 - sim(exp[i - 1], got[j - 1]));
    }
  }
  const ops = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && Math.abs(D[i][j] - (D[i - 1][j - 1] + 1 - sim(exp[i - 1], got[j - 1]))) < 1e-9) {
      ops.push({ exp: exp[i - 1], got: got[j - 1], s: sim(exp[i - 1], got[j - 1]) }); i--; j--;
    } else if (i > 0 && Math.abs(D[i][j] - (D[i - 1][j] + 1)) < 1e-9) {
      ops.push({ exp: exp[i - 1], got: null, s: 0 }); i--;
    } else {
      ops.push({ exp: null, got: got[j - 1], s: 0 }); j--;
    }
  }
  return ops.reverse();
}

function grade(target, heard) {
  const exp = norm(target).split(' ').filter(Boolean);
  const got = norm(heard).split(' ').filter(Boolean);
  const ops = alignWords(exp, got);
  const extras = ops.filter((o) => o.exp === null).length;
  const sum = ops.reduce((t, o) => t + o.s, 0);
  const score = Math.min(1, sum / (exp.length + 0.5 * extras));
  return { ops, score, pass: score >= 0.8 };
}
// </pure>

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let sp = null;
let recog = null;

function renderSpeak(fresh) {
  if (fresh || !sp) sp = { queue: shuffle(cardsOf(state.deck)), i: 0, busy: false, res: null, msg: '' };
  const c = sp.queue[sp.i % sp.queue.length];
  const w = (o) => {
    if (o.exp === null) return `<span class="w extra"><small>extra word</small>${o.got}</span>`;
    if (o.got === null) return `<span class="w bad">${o.exp}<small>missing</small></span>`;
    if (o.s === 1) return `<span class="w ok">${o.exp}</span>`;
    const cls = o.s >= 0.6 ? 'near' : 'bad';
    return `<span class="w ${cls}">${o.exp}<small>you said: ${o.got}</small></span>`;
  };
  const r = sp.res;
  const result = r ? `
    <section class="card">
      <h2>${r.g.pass ? (r.g.score >= 0.95 ? '🎉 Perfect!' : '👍 Good, almost there') : '🔁 Try again'} <span class="muted">${Math.round(r.g.score * 100)}%</span></h2>
      <p class="muted">I heard: <b>${r.heard}</b></p>
      <div class="words">${r.g.ops.map(w).join('')}</div>
      ${r.g.pass ? '' : `<p class="muted" style="margin-top:10px">Tip: tap 🔊, listen carefully, then say it slowly. Sounds like: <b>${c.tr}</b></p>`}
    </section>` : '';

  view.innerHTML = `
    <div class="meta"><span>Speaking · ${state.deck}</span><span>${sp.i + 1}/${sp.queue.length}</span></div>
    <section class="flash" style="min-height:190px">
      <div class="ru">${c.ru}</div>
      <div class="tr">${c.tr}</div>
      <div class="en">${c.en}</div>
      <button class="speak" id="say" aria-label="Listen">🔊</button>
    </section>
    <button class="btn mic ${sp.busy ? 'rec' : ''}" id="mic" ${sp.busy ? 'disabled' : ''}>${sp.busy ? '🎤 Listening… speak now' : '🎤 Tap, then say it in Russian'}</button>
    ${sp.msg ? `<p class="fb">${sp.msg}</p>` : ''}
    ${result}
    <button class="btn alt" id="nx">${r && r.g.pass ? 'Next word →' : 'Skip →'}</button>
    <p class="muted center" style="margin-top:12px">Needs internet and microphone permission.</p>`;

  $('#say').onclick = () => speak(c.ru);
  $('#mic').onclick = () => startListening(c);
  $('#nx').onclick = () => { sp.i++; sp.res = null; sp.msg = ''; renderSpeak(); };
}

function startListening(c) {
  if (!SR) { sp.msg = '❌ This browser has no speech recognition. Open the app in Chrome.'; renderSpeak(); return; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const r = new SR();
  recog = r;
  r.lang = 'ru-RU';
  r.interimResults = false;
  r.continuous = false;
  r.maxAlternatives = 5;
  let got = false;

  r.onresult = (e) => {
    got = true;
    const alts = Array.from(e.results[0]).map((a) => a.transcript);
    const target = norm(c.ru);
    const heard = alts.find((t) => norm(t) === target) || alts[0];
    sp.res = { heard, g: grade(c.ru, heard) };
    sp.msg = '';
    if (sp.res.g.pass) { noteActivity(); save(); }
  };
  r.onerror = (e) => {
    const m = {
      'not-allowed': '🚫 Microphone blocked. Allow the microphone for this site (lock icon next to the address, or phone Settings → Apps → Chrome → Permissions).',
      'service-not-allowed': '🚫 Microphone blocked. Allow it in your browser settings.',
      'no-speech': "I didn't hear anything. Tap the button and speak right away.",
      'audio-capture': '🎤 No microphone found.',
      'network': '🌐 No internet. Speech checking needs a connection.',
      'language-not-supported': '❌ Russian speech recognition is not available on this device.',
    }[e.error];
    sp.msg = m || 'Could not listen (' + e.error + '). Try again.';
  };
  r.onend = () => {
    sp.busy = false;
    if (!got && !sp.msg) sp.msg = "I didn't catch that. Try again.";
    if ($('#mic')) renderSpeak();
  };

  sp.busy = true; sp.msg = ''; sp.res = null;
  renderSpeak();
  try { r.start(); } catch (e) { sp.busy = false; sp.msg = 'Could not start the microphone. Try again.'; renderSpeak(); }
}

// ---------- start ----------
document.querySelectorAll('#nav button').forEach((b) => { b.onclick = () => go(b.dataset.tab); });
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
go('home');
