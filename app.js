'use strict';

const $ = (s) => document.querySelector(s);
const view = $('#view');
const KEY = 'russian-start-v1';
const INTERVALS = [0, 1, 3, 7, 14, 30, 60]; // days until next review, by "box"

// ---------- saved progress (stays on your phone) ----------
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
let state = Object.assign({ cards: {}, streak: 0, lastDay: null, reviewed: { day: null, n: 0 }, level: 'beginner', lv: {}, convBest: {}, hints: true, rate: 0.8, alpha: [], sfx: true, voices: {} }, saved);
if (!state.voices || typeof state.voices !== 'object') state.voices = {};
if (!(state.rate >= 0.4 && state.rate <= 1.2)) state.rate = 0.8;
state.alpha = Array.isArray(state.alpha) ? state.alpha.filter((n) => Number.isInteger(n)) : [];
if (!state.lv || typeof state.lv !== 'object') state.lv = {};
// progress saved by older versions belongs to the Beginner level
if (saved.progress && !saved.lv) state.lv.beginner = { day: saved.day || 0, progress: saved.progress };
delete state.day; delete state.progress; delete state.deck;
if (!LEVELS.some((l) => l.id === state.level)) state.level = 'beginner';
for (const l of LEVELS) {
  const r = (state.lv[l.id] = state.lv[l.id] || {});
  if (!(r.day >= 0 && r.day < l.days.length)) r.day = 0;
  if (!r.progress || typeof r.progress !== 'object') r.progress = {};
}
// state.day and state.progress always point at the current level
Object.defineProperty(state, 'day', { get() { return state.lv[state.level].day; }, set(v) { state.lv[state.level].day = v; } });
Object.defineProperty(state, 'progress', { get() { return state.lv[state.level].progress; }, set(v) { state.lv[state.level].progress = v; } });
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
let LDAYS = [];
let LSCEN = [];
const curLevel = () => LEVELS.find((l) => l.id === state.level);
function applyLevel() {
  const L = curLevel();
  LDAYS = L.days;
  LSCEN = L.scenarios;
  ALL.length = 0;
  LDAYS.forEach((d, di) => d.cards.forEach(([ru, tr, en]) => ALL.push({ id: ru, ru, tr, en, deck: d.deck, day: di })));
}
applyLevel();
function setLevel(id) {
  state.level = id;
  save();
  applyLevel();
  session = null; sp = null;
}
const dayCards = (di) => ALL.filter((c) => c.day === di);
const prog = (d) => {
  const p = (state.progress[d] = state.progress[d] || {});
  if (!Array.isArray(p.spoke)) p.spoke = [];
  if (!Array.isArray(p.studied)) p.studied = [];
  if (typeof p.quiz !== 'number') p.quiz = 0;
  if (typeof p.quizOf !== 'number') p.quizOf = 0;
  return p;
};

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

// ---------- speech output ----------
let VOICES = [];
function loadVoices() { if ('speechSynthesis' in window) VOICES = speechSynthesis.getVoices() || []; }
loadVoices();
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = loadVoices;
const vLang = (v) => (v.lang || '').toLowerCase().replace('_', '-');
const voicesFor = (code) => VOICES.filter((v) => vLang(v).startsWith(code));
// Picks the voice you chose in Settings, otherwise the most natural-sounding one the phone has.
function bestVoice(code) {
  const pool = voicesFor(code);
  const want = state.voices && state.voices[code];
  if (want) { const f = pool.find((v) => v.voiceURI === want || v.name === want); if (f) return f; }
  const score = (v) => (/neural|natural|enhanced|premium|wavenet|online/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 3 : 0) + (v.localService === false ? 1 : 0) + (v.default ? 1 : 0);
  return pool.slice().sort((a, b) => score(b) - score(a))[0];
}
const ruVoice = () => bestVoice('ru');
const transLink = (text) => 'https://translate.google.com/?sl=ru&tl=en&op=translate&text=' + encodeURIComponent(text);

// Long text is read one sentence at a time: phones cut off or stutter on long utterances.
const chunkText = (t) => (String(t).match(/[^.!?…;:]+[.!?…;:]*/g) || [String(t)]).map((x) => x.trim()).filter((x) => /\S/.test(x));
let speakGen = 0;
let speakKick = null;

// Speaks several pieces one after another, each in its own language, without gaps or cut-offs.
function speakSeq(parts) {
  if (!('speechSynthesis' in window)) return;
  loadVoices();
  const gen = ++speakGen;
  clearTimeout(speakKick);
  if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
  const code = (l) => (l === 'ru-RU' ? 'ru' : 'en');
  const list = [];
  parts.forEach((p) => chunkText(p.text).forEach((t) => list.push({ t, lang: p.lang })));
  // a very short pause after cancel() lets the phone's speech engine reset (avoids a swallowed first word)
  speakKick = setTimeout(() => {
    if (gen !== speakGen) return;
    list.forEach((it, i) => {
      const u = new SpeechSynthesisUtterance(it.t);
      u.lang = it.lang;
      u.rate = state.rate;
      u.pitch = 1;
      u.volume = 1;
      const v = bestVoice(code(it.lang));
      if (v) u.voice = v;
      if (i === 0 && it.lang === 'ru-RU') u.onerror = (e) => { if (e && e.error && e.error !== 'canceled' && e.error !== 'interrupted') toast('Sound error (' + e.error + '). See Settings → Sound help.'); };
      speechSynthesis.speak(u);
    });
    if (speechSynthesis.paused) speechSynthesis.resume();
  }, 60);
}

function speak(text) {
  if (!('speechSynthesis' in window)) { toast('This browser has no speech. Use the Google Translate link instead.'); return; }
  loadVoices();
  if (VOICES.length && !ruVoice()) toast('No Russian voice installed. See Settings → Sound help.');
  speakSeq([{ text, lang: 'ru-RU' }]);
}

// ---------- right / wrong sound effects (soft chimes made in the browser, no files) ----------
let AC = null;
let fbTimer = null;
function warmAudio() {
  try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) {}
}
// Right: a gentle rising two-note chime. Wrong: a soft falling two-note tone. Returns how long to wait before speaking.
function playSfx(ok) {
  if (!state.sfx) return 0;
  try {
    warmAudio();
    if (!AC) return 0;
    const t0 = AC.currentTime + 0.02;
    const notes = ok ? [[523.25, 0], [783.99, 0.13]] : [[329.63, 0], [261.63, 0.16]];
    notes.forEach(([f, d]) => {
      const o = AC.createOscillator();
      const g = AC.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.linearRampToValueAtTime(0.12, t0 + d + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.42);
      o.connect(g);
      g.connect(AC.destination);
      o.start(t0 + d);
      o.stop(t0 + d + 0.45);
    });
    return 380;
  } catch (e) { return 0; }
}
function sfxThen(ok, fn) {
  clearTimeout(fbTimer);
  const wait = playSfx(ok);
  if (wait) fbTimer = setTimeout(fn, wait); else fn();
}

// Microphone answers: sound, then "Correct", or "Say, please" followed by the right sentence.
function speakFeedback(res, target) {
  sfxThen(res.g.pass, () => {
    if (res.g.pass) speakSeq([{ text: 'Correct', lang: 'en-US' }]);
    else speakSeq([{ text: 'Say, please:', lang: 'en-US' }, { text: target, lang: 'ru-RU' }]);
  });
}
// Quiz answers: sound, then "Correct", or "Wrong" followed by the right Russian word.
function quizFeedback(ok, q) {
  sfxThen(ok, () => {
    if (ok) speakSeq([{ text: 'Correct', lang: 'en-US' }]);
    else speakSeq(q.card ? [{ text: 'Wrong', lang: 'en-US' }, { text: q.card.ru, lang: 'ru-RU' }] : [{ text: 'Wrong', lang: 'en-US' }]);
  });
}

// ---------- voice speed control (one setting, shown wherever voice is used) ----------
const speedHtml = () => `<div class="speed"><span>🐢</span><input type="range" min="0.4" max="1.2" step="0.1" value="${state.rate}" aria-label="Voice speed"><span>🐇</span><b class="rv">${state.rate.toFixed(1)}×</b></div>`;
function syncSpeed() {
  document.querySelectorAll('.speed').forEach((el) => {
    el.querySelector('input').value = state.rate;
    el.querySelector('.rv').textContent = state.rate.toFixed(1) + '×';
  });
}
function bindSpeed(el) {
  const r = el.querySelector('input');
  r.oninput = () => { state.rate = Math.round(+r.value * 10) / 10; syncSpeed(); };
  r.onchange = () => { save(); speak('Привет! Как дела?'); };
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
  else msg = '✅ Using the Russian voice: ' + v.name + '. If you hear nothing, raise the media volume.';
  if (out) out.textContent = msg;
  playSfx(true);
  setTimeout(() => speak('Привет! Как дела? Меня зовут Анна. Приятно познакомиться.'), 400);
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

// ---------- speaking: grading ----------
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

// ---------- speaking: microphone ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let micMemo = {};
let activeRecog = null;

const MIC_ERR = {
  'not-allowed': '🚫 Microphone blocked. Allow the microphone for this site (lock icon next to the address, or phone Settings → Apps → Chrome → Permissions).',
  'service-not-allowed': '🚫 Microphone blocked. Allow it in your browser settings.',
  'no-speech': "I didn't hear anything. Tap the button and speak right away.",
  'audio-capture': '🎤 No microphone found.',
  'network': '🌐 No internet. Speech checking needs a connection.',
  'language-not-supported': '❌ Russian speech recognition is not available on this device.',
};

// Listens once and reports through callbacks: onstart, onresult(alternatives), onerror(message), onend.
function listenOnce(cb) {
  if (!SR) { cb.onerror('❌ This browser has no speech recognition. Open the app in Chrome.'); cb.onend(); return; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  try { if (activeRecog) activeRecog.abort(); } catch (e) {}
  const r = new SR();
  activeRecog = r;
  r.lang = 'ru-RU';
  r.interimResults = false;
  r.continuous = false;
  r.maxAlternatives = 5;
  let got = false, errored = false;
  r.onresult = (e) => { got = true; cb.onresult(Array.from(e.results[0]).map((a) => a.transcript)); };
  r.onerror = (e) => {
    errored = true;
    if (e.error === 'aborted') return;
    cb.onerror(MIC_ERR[e.error] || 'Could not listen (' + e.error + '). Try again.');
  };
  r.onend = () => {
    if (!got && !errored) cb.onerror("I didn't catch that. Try again.");
    cb.onend();
  };
  cb.onstart();
  try { r.start(); } catch (e) { cb.onerror('Could not start the microphone. Try again.'); cb.onend(); }
}

function feedbackHtml(res) {
  const pct = Math.round(res.g.score * 100);
  const cls = res.g.pass ? 'good' : pct >= 50 ? 'mid' : 'low';
  return `
    <section class="card fbk pct ${cls}">
      <div class="bigpct">${pct}%</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      ${res.g.pass ? '' : '<button class="btn small" data-again>🔊 Hear it again</button>'}
    </section>`;
}

// Puts a "say it" button and its feedback into an empty slot element. Works on any screen.
function mountMic(slot, target, tr, label, onResult) {
  if (!slot) return;
  let busy = false, msg = '';
  let res = micMemo[target] || null;
  const draw = () => {
    slot.innerHTML = `<button class="btn mic ${busy ? 'rec' : ''}" ${busy ? 'disabled' : ''}>${busy ? '🎤 Listening… speak now' : '🎤 ' + (label || 'Tap, then say it in Russian')}</button>${msg ? `<p class="fb">${msg}</p>` : ''}${res ? feedbackHtml(res) : ''}`;
    const b = slot.querySelector('button');
    if (b) b.onclick = start;
    const again = slot.querySelector('[data-again]');
    if (again) again.onclick = () => speakFeedback(res, target);
  };
  const start = () => listenOnce({
    onstart: () => { busy = true; msg = ''; res = null; delete micMemo[target]; draw(); },
    onresult: (alts) => {
      const t = norm(target);
      const heard = alts.find((x) => norm(x) === t) || alts[0];
      res = { heard, g: grade(target, heard) };
      micMemo[target] = res;
      if (res.g.pass) { noteActivity(); save(); }
      speakFeedback(res, target);
      if (onResult) onResult(res);
    },
    onerror: (m) => { msg = m; },
    onend: () => { busy = false; draw(); },
  });
  draw();
}

// ---------- day navigation ----------
function dayBarHtml() {
  const d = LDAYS[state.day];
  return `<div class="daybar">
    <button id="dprev" aria-label="Previous day" ${state.day === 0 ? 'disabled' : ''}>◀</button>
    <button id="dpick"><b>Day ${state.day + 1}</b> of ${LDAYS.length}<small>${curLevel().emoji} ${curLevel().name} · ${d.title}</small></button>
    <button id="dnext" aria-label="Next day" ${state.day === LDAYS.length - 1 ? 'disabled' : ''}>▶</button>
  </div>`;
}
function setDay(n) { state.day = Math.max(0, Math.min(LDAYS.length - 1, n)); save(); }
const PASS_RATIO = 0.8; // a quiz or a conversation counts as completed at 80% or more

// Is this day completed for a sub-level? kind: study | quiz | speak
// Study words said correctly (80% or more) in a day
function studiedCount(L, di) {
  const st = (state.lv[L.id].progress[di] || {}).studied || [];
  return L.days[di].cards.filter((c) => st.indexOf(c[0]) >= 0).length;
}
function dayDone(kind, L, di) {
  const p = state.lv[L.id].progress[di] || {};
  if (kind === 'study') return studiedCount(L, di) >= L.days[di].cards.length;
  if (kind === 'quiz') return !!p.quizOf && p.quiz / p.quizOf >= PASS_RATIO;
  return !!p.spoke && p.spoke.length >= L.days[di].cards.length;
}
const talkDone = (s) => (state.convBest[s.id] || 0) >= PASS_RATIO * 100;

// Everything completed in one level, sub-level by sub-level.
function levelStats(L) {
  const n = L.days.length;
  const count = (kind) => L.days.filter((d, i) => dayDone(kind, L, i)).length;
  const items = n ? [
    { key: 'study', icon: '📖', name: 'Study', done: count('study'), total: n, unit: 'days' },
    { key: 'quiz', icon: '✅', name: 'Quiz', done: count('quiz'), total: n, unit: 'days' },
    { key: 'speak', icon: '🎤', name: 'Speak', done: count('speak'), total: n, unit: 'days' },
  ] : [];
  items.push(
    { key: 'talk', icon: '💬', name: 'Talk', done: L.scenarios.filter(talkDone).length, total: L.scenarios.length, unit: 'conversations' });
  if (L.id === 'beginner') items.push({ key: 'alphabet', icon: 'Aa', name: 'Alphabet', done: state.alpha.length, total: ALPHABET.length, unit: 'letters seen' });
  const done = items.reduce((t, i) => t + i.done, 0);
  const total = items.reduce((t, i) => t + i.total, 0);
  return { items, pct: Math.round((done / total) * 100) };
}

const KIND_HINT = {
  study: 'Say every word of the day correctly (80% or more) to complete it. Pressing Next alone does not count.',
  quiz: 'Score 80% or more in the quiz to complete a day.',
  speak: 'Say every word of the day correctly (80% or more) to complete it.',
};
// A small status strip for the sub-level pages: is this day completed, and how many days overall.
function statusHtml(kind) {
  const L = curLevel();
  const done = L.days.filter((d, i) => dayDone(kind, L, i)).length;
  const today = dayDone(kind, L, state.day);
  return `<div class="status"><span class="pill ${today ? 'ok' : ''}">${today ? '✔ Day ' + (state.day + 1) + ' completed' : 'Day ' + (state.day + 1) + ' not completed yet'}</span><span>${done}/${L.days.length} days completed</span></div><p class="muted hint">${KIND_HINT[kind]}</p>`;
}

function bindDayBar(rerender, kind) {
  $('#dprev').onclick = () => { setDay(state.day - 1); rerender(); };
  $('#dnext').onclick = () => { setDay(state.day + 1); rerender(); };
  $('#dpick').onclick = () => pickDay(rerender, kind);
}
function pickDay(rerender, kind) {
  const sh = $('#sheet');
  const L = curLevel();
  const close = () => { sh.hidden = true; sh.innerHTML = ''; };
  const rowStatus = (i) => {
    const p = state.progress[i] || {};
    const ok = dayDone(kind, L, i);
    if (kind === 'study') return `${ok ? '✔' : '•'} ${studiedCount(L, i)}/${LDAYS[i].cards.length} words`;
    if (kind === 'quiz') return p.quizOf ? `${ok ? '✔' : '•'} ${p.quiz}/${p.quizOf}` : 'Not taken';
    const n = (p.spoke || []).length;
    return `${ok ? '✔' : '•'} ${n}/${LDAYS[i].cards.length} words`;
  };
  sh.hidden = false;
  sh.innerHTML = `
    <div class="sheet-bg"></div>
    <div class="sheet-box">
      <h2>Choose a day</h2>
      <div class="daylist">
        ${LDAYS.map((d, i) => `<button class="dayrow ${i === state.day ? 'on' : ''} ${dayDone(kind, L, i) ? 'done' : ''}" data-d="${i}"><span><b>Day ${i + 1}</b> · ${d.title}</span><small>${rowStatus(i)}</small></button>`).join('')}
      </div>
      <button class="btn alt" id="dclose">Close</button>
    </div>`;
  sh.querySelector('.sheet-bg').onclick = close;
  $('#dclose').onclick = close;
  sh.querySelectorAll('.dayrow').forEach((b) => { b.onclick = () => { setDay(+b.dataset.d); close(); rerender(); }; });
}

// ---------- navigation ----------
function go(tab, opt) {
  micMemo = {};
  clearTimeout(fbTimer);
  try { if (activeRecog) activeRecog.abort(); } catch (e) {}
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const sh = $('#sheet');
  sh.hidden = true; sh.innerHTML = '';
  const active = tab === 'alphabet' ? 'level' : tab;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === active));
  $('#nav').hidden = tab === 'home';
  const noDays = !curLevel().days.length;
  document.querySelectorAll('#nav button').forEach((b) => { b.hidden = noDays && ['study', 'quiz', 'speak'].indexOf(b.dataset.tab) >= 0; });
  document.body.classList.toggle('nonav', tab === 'home');
  window.scrollTo(0, 0);
  if (tab === 'home') renderHome();
  else if (tab === 'level') renderLevel();
  else if (tab === 'alphabet') renderAlphabet();
  else if (tab === 'study') renderStudy(true, opt);
  else if (tab === 'quiz') renderQuizSetup();
  else if (tab === 'speak') renderSpeak(true);
  else renderTalk();
}

// ---------- home: the three levels ----------
function renderHome() {
  view.innerHTML = `
    <h2>Choose your level</h2>
    ${LEVELS.map((l) => {
      const st = levelStats(l);
      return `
      <div class="card lvlcard" role="button" tabindex="0" data-lv="${l.id}">
        <div class="lvhead"><span class="lemo">${l.emoji}</span><span class="lvt"><b>${l.name}</b><small>${l.sub}</small></span><span class="lvpct">${st.pct}%</span></div>
        <div class="bar"><i style="width:${st.pct}%"></i></div>
        <div class="subgrid">${st.items.map((i) => `<span class="subi ${i.done === i.total ? 'full' : ''}">${i.done === i.total ? '✔' : i.icon} ${i.name} <b>${i.done}/${i.total}</b></span>`).join('')}</div>
      </div>`;
    }).join('')}`;
  view.querySelectorAll('[data-lv]').forEach((b) => { b.onclick = () => { setLevel(b.dataset.lv); go('level'); }; });
}

// ---------- inside a level: its sub-levels ----------
function renderLevel() {
  const L = curLevel();
  const st = levelStats(L);
  const t = todayNum();
  const due = ALL.filter((c) => state.cards[c.id] && state.cards[c.id].due <= t).length;
  view.innerHTML = `
    <button class="btn small" id="back">◀ All levels</button>
    <section class="card">
      <div class="lvhead"><span class="lemo">${L.emoji}</span><span class="lvt"><b>${L.name} level</b><small>${L.sub}</small></span><span class="lvpct">${st.pct}%</span></div>
      <div class="bar"><i style="width:${st.pct}%"></i></div>
    </section>
    ${st.items.map((i) => {
      const pc = i.total ? Math.round((i.done / i.total) * 100) : 0;
      return `
      <button class="card sub" data-go="${i.key}">
        <span class="emo">${i.icon}</span>
        <span class="scx"><b>${i.name}</b><small>${i.done}/${i.total} ${i.unit}${i.key === 'alphabet' ? '' : ' completed'}</small><span class="mbar"><i style="width:${pc}%"></i></span></span>
        ${i.done === i.total ? '<span class="done">✔ Completed</span>' : '<span class="chev">›</span>'}
      </button>`;
    }).join('')}
    ${due ? `<button class="btn alt" id="due">🔁 Review ${due} due word${due === 1 ? '' : 's'}</button>` : ''}`;
  $('#back').onclick = () => go('home');
  view.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go); });
  const dueBtn = $('#due');
  if (dueBtn) dueBtn.onclick = () => go('study', 'due');
}

// ---------- settings (⚙): streak, sound help, reset ----------
function voicePickHtml() {
  loadVoices();
  const one = (code, label) => {
    const list = voicesFor(code);
    if (list.length < 2) return '';
    const cur = bestVoice(code);
    return `<label class="vlab">${label}<select class="vsel" data-code="${code}">${list.map((v) => `<option value="${v.voiceURI || v.name}" ${cur && cur.name === v.name ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label>`;
  };
  return one('ru', 'Russian voice') + one('en', 'English voice (for "Correct")');
}

function showSettings() {
  const t = todayNum();
  const streak = state.lastDay !== null && state.lastDay >= t - 1 ? state.streak : 0;
  const today = state.reviewed.day === t ? state.reviewed.n : 0;
  const started = Object.keys(state.cards).length;
  const sh = $('#sheet');
  const close = () => { sh.hidden = true; sh.innerHTML = ''; };
  sh.hidden = false;
  sh.innerHTML = `
    <div class="sheet-bg"></div>
    <div class="sheet-box left">
      <h2>Settings</h2>
      <section class="stats">
        <div><b>${streak}</b><span>day streak 🔥</span></div>
        <div><b>${today}</b><span>reviews today</span></div>
        <div><b>${started}</b><span>words started</span></div>
      </section>
      <h3>🔔 Sound effects</h3>
      <button class="btn alt" id="sfx">Right / wrong sounds: ${state.sfx ? 'ON' : 'OFF'}</button>
      <h3>🔊 Sound help</h3>
      ${voicePickHtml()}
      <button class="btn alt" id="sc-test">Test the sound</button>
      <p id="sc-out" style="margin-top:10px"></p>
      <p class="muted">No Russian voice? On Android: Settings → search "Text-to-speech output" → choose <b>Speech Services by Google</b> → ⚙ → <b>Install voice data</b> → <b>Russian</b>. Also raise the media volume. Then restart this app.</p>
      <h3>How to learn</h3>
      <p class="muted">Pick a level on the home page. Inside it, work through Study, Quiz, Speak and Talk day by day. In every section tap 🎤 and say the word aloud: the voice tells you if it is correct. Come back every day: the app brings old words back just before you forget them.</p>
      <button class="btn small" id="reset">Reset my progress</button>
      <button class="btn alt" id="sclose">Close</button>
    </div>`;
  sh.querySelector('.sheet-bg').onclick = close;
  $('#sclose').onclick = close;
  $('#sc-test').onclick = soundCheck;
  sh.querySelectorAll('.vsel').forEach((el) => { el.onchange = () => { state.voices[el.dataset.code] = el.value; save(); soundCheck(); }; });
  $('#sfx').onclick = () => { state.sfx = !state.sfx; save(); showSettings(); if (state.sfx) playSfx(true); };
  $('#reset').onclick = () => {
    if (confirm('Erase all progress?')) {
      state.cards = {}; state.streak = 0; state.lastDay = null; state.reviewed = { day: null, n: 0 };
      for (const l of LEVELS) state.lv[l.id] = { day: 0, progress: {} };
      state.convBest = {}; state.alpha = [];
      save(); close(); go('home');
    }
  };
}

// ---------- alphabet ----------
function renderAlphabet() {
  const seen = state.alpha.length;
  view.innerHTML = `
    <button class="btn small" id="back">◀ ${curLevel().name} level</button>
    <h2>The Russian alphabet</h2>
    <div class="status"><span class="pill ${seen === ALPHABET.length ? 'ok' : ''}" id="alphacount">${seen}/${ALPHABET.length} letters seen</span></div>
    <p class="muted">Tap a letter to hear it and to practise saying it.</p>
    <div class="grid">
      ${ALPHABET.map((a, i) => `<button class="tile ${state.alpha.indexOf(i) >= 0 ? 'seen' : ''}" data-i="${i}"><span class="big">${a[0]}</span><span class="tr">${a[1]}</span></button>`).join('')}
    </div>
    <button class="btn" id="aq">Practise the alphabet</button>`;
  $('#back').onclick = () => go('level');
  view.querySelectorAll('.tile').forEach((b) => { b.onclick = () => { showLetter(+b.dataset.i); speak(ALPHABET[+b.dataset.i][3]); }; });
  $('#aq').onclick = () => startQz(buildAlphaQuiz, 'alphabet', 'alpha', 'alpha');
}

function showLetter(i) {
  const a = ALPHABET[i];
  if (state.alpha.indexOf(i) < 0) {
    state.alpha.push(i);
    save();
    const tile = view.querySelector(`.tile[data-i="${i}"]`);
    if (tile) tile.classList.add('seen');
    const cnt = $('#alphacount');
    if (cnt) { cnt.textContent = `${state.alpha.length}/${ALPHABET.length} letters seen`; cnt.classList.toggle('ok', state.alpha.length === ALPHABET.length); }
  }
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
      ${speedHtml()}
      <div class="mic-slot"></div>
      <div class="row2">
        <button class="btn alt" id="lp" ${i === 0 ? 'disabled' : ''}>◀ Previous</button>
        <button class="btn alt" id="ln" ${i === ALPHABET.length - 1 ? 'disabled' : ''}>Next ▶</button>
      </div>
      <a class="lnk" target="_blank" rel="noopener" href="${transLink(a[3])}">No sound? Listen on Google Translate</a>
      <button class="btn alt" id="sc">Close</button>
    </div>`;
  sh.querySelector('.sheet-bg').onclick = close;
  $('#sc').onclick = close;
  $('#sw').onclick = () => speak(a[3]);
  $('#sl').onclick = () => speak(a[0].charAt(0));
  bindSpeed(sh.querySelector('.speed'));
  mountMic(sh.querySelector('.mic-slot'), a[3], a[4], 'Say the word: ' + a[3]);
  $('#lp').onclick = () => { showLetter(i - 1); speak(ALPHABET[i - 1][3]); };
  $('#ln').onclick = () => { showLetter(i + 1); speak(ALPHABET[i + 1][3]); };
}

// ---------- study (flashcards, one day at a time) ----------
let session = null;

function newSession(mode) {
  const t = todayNum();
  const list = mode === 'due'
    ? shuffle(ALL.filter((c) => state.cards[c.id] && state.cards[c.id].due <= t)).slice(0, 30)
    : dayCards(state.day);
  return { mode: mode || 'day', day: state.day, list, i: 0, finished: false, rated: {}, spokenAt: -1 };
}

// Leaving a card schedules it: said wrongly = again soon, said well = later, not tried = normal.
function rateCard(c, s) {
  if (s.rated[c.id]) return;
  s.rated[c.id] = 1;
  const m = micMemo[c.ru];
  review(c, m ? (m.g.pass ? (m.g.score >= 0.95 ? 2 : 1) : 0) : 1);
}

function studyBadge(c, s) {
  const ok = prog(c.day).studied.indexOf(c.id) >= 0;
  return `${ok ? '✔ counted' : '🎤 say it to count'} · ${studiedCount(curLevel(), c.day)}/${LDAYS[c.day].cards.length}`;
}
function renderStudy(fresh, mode) {
  if (fresh || !session) session = newSession(mode);
  const s = session;
  const header = s.mode === 'due' ? '<div class="daybar solo"><span><b>Review: words due now</b></span></div>' : dayBarHtml() + statusHtml('study');
  const rerender = () => renderStudy(true);

  if (s.finished || !s.list.length) {
    const last = state.day === LDAYS.length - 1;
    const dayOk = s.mode === 'due' || dayDone('study', curLevel(), s.day);
    const nDone = s.mode === 'due' ? 0 : studiedCount(curLevel(), s.day);
    const title = !s.list.length ? 'No words are due' : s.mode === 'due' ? '🎉 Review complete' : dayOk ? '🎉 Lesson complete' : '📝 Not completed yet';
    const text = !s.list.length ? 'Come back later, or study the next day.' : dayOk ? `You went through ${s.list.length} card${s.list.length === 1 ? '' : 's'}. Great work!` : `You said ${nDone} of ${LDAYS[s.day].cards.length} words correctly (80% or more). Say every word correctly to complete this day.`;
    view.innerHTML = `
      ${header}
      <section class="card center">
        <h2>${title}</h2>
        <p class="muted">${text}</p>
        ${s.mode === 'due' || !s.list.length
          ? '<button class="btn" id="home">Back to the level</button>'
          : `${dayOk ? '' : '<button class="btn" id="missing">🎤 Practise the missing words</button>'}
             <button class="btn ${dayOk ? '' : 'alt'}" id="again">Practise this day again</button>
             <button class="btn alt" id="toquiz">Take the Day ${state.day + 1} quiz</button>
             ${last ? '' : '<button class="btn alt" id="nextday">Next day ▶</button>'}`}
        ${s.list.length ? '<button class="btn small" id="lastcard">◀ Back to the last card</button>' : ''}
      </section>`;
    if (s.mode !== 'due') bindDayBar(rerender, 'study');
    const bind = (id, fn) => { const el = $('#' + id); if (el) el.onclick = fn; };
    bind('home', () => go('level'));
    bind('again', () => renderStudy(true));
    bind('missing', () => {
      const st = prog(s.day).studied;
      session = newSession();
      session.list = session.list.filter((c) => st.indexOf(c.id) < 0);
      renderStudy();
    });
    bind('toquiz', () => go('quiz'));
    bind('nextday', () => { setDay(state.day + 1); rerender(); });
    bind('lastcard', () => { s.finished = false; s.i = s.list.length - 1; s.spokenAt = -1; renderStudy(); });
    return;
  }

  const c = s.list[s.i];
  const isNew = !state.cards[c.id];
  const lastCard = s.i === s.list.length - 1;
  view.innerHTML = `
    ${header}
    <div class="meta"><span>${s.mode === 'due' ? 'Due words' : 'Day ' + (s.day + 1)}</span><span>Card ${s.i + 1}/${s.list.length}${s.mode === 'due' ? '' : ` · <b id="stcount">${studyBadge(c, s)}</b>`}</span></div>
    <div class="bar"><i style="width:${Math.round((s.i / s.list.length) * 100)}%"></i></div>
    <section class="flash">
      ${isNew ? '<span class="badge">NEW</span>' : ''}
      <div class="ru">${c.ru}</div>
      <div class="tr">${c.tr}</div>
      <div class="en">${c.en}</div>
      <button class="speak" id="say" aria-label="Listen">🔊</button>
    </section>
    <div class="mic-slot"></div>
    <div class="row2">
      <button class="btn alt" id="pc" ${s.i === 0 ? 'disabled' : ''}>◀ Previous</button>
      <button class="btn" id="nc">${lastCard ? 'Finish ✔' : 'Next ▶'}</button>
    </div>
    <a class="lnk" target="_blank" rel="noopener" href="${transLink(c.ru)}">No sound? Listen on Google Translate</a>`;

  if (s.mode !== 'due') bindDayBar(rerender, 'study');
  $('#say').onclick = () => speak(c.ru);
  mountMic(view.querySelector('.mic-slot'), c.ru, c.tr, 'Say it in Russian', (res) => {
    if (!res.g.pass) return;
    const p = prog(c.day);
    if (p.studied.indexOf(c.id) < 0) {
      p.studied.push(c.id); save();
      const el = $('#stcount'); if (el) el.textContent = studyBadge(c, s);
      if (s.mode !== 'due' && dayDone('study', curLevel(), c.day)) toast('✔ Day ' + (c.day + 1) + ' completed!');
    }
  });
  $('#pc').onclick = () => { s.i--; s.spokenAt = -1; renderStudy(); };
  $('#nc').onclick = () => {
    rateCard(c, s);
    if (lastCard) {
      s.finished = true;
    } else { s.i++; s.spokenAt = -1; }
    renderStudy();
  };
  if (s.spokenAt !== s.i) { s.spokenAt = s.i; speak(c.ru); } // you hear each word as it appears
}

// ---------- quizzes (one day at a time) ----------
let qz = null;

function renderQuizSetup() {
  const n = dayCards(state.day).length;
  const q = Math.min(10, n);
  view.innerHTML = `
    ${dayBarHtml()}${statusHtml('quiz')}
    <section class="card">
      <h2>Day ${state.day + 1} quiz</h2>
      <p class="muted">${q} questions from this day's ${n} words.</p>
      <button class="btn" data-m="ru-en">Russian → English</button>
      <button class="btn alt" data-m="en-ru">English → Russian</button>
      <button class="btn alt" data-m="listen">🎧 Listening: hear it, pick the meaning</button>
    </section>
    ${state.day > 0 ? `<section class="card">
      <h2>Review quiz</h2>
      <p class="muted">10 questions from Days 1 to ${state.day + 1}.</p>
      <button class="btn alt" data-m="review">🔁 Start review quiz</button>
    </section>` : ''}`;
  bindDayBar(renderQuizSetup, 'quiz');
  view.querySelectorAll('[data-m]').forEach((b) => {
    const m = b.dataset.m;
    b.onclick = () => {
      if (m === 'review') startQz(() => buildVocabQuiz('ru-en', ALL.filter((c) => c.day <= state.day)), 'quiz', m, 'review');
      else startQz(() => buildVocabQuiz(m, dayCards(state.day)), 'quiz', m, 'day');
    };
  });
}

function buildVocabQuiz(mode, pool) {
  const toRu = mode === 'en-ru';
  const key = toRu ? 'ru' : 'en';
  return shuffle(pool).slice(0, 10).map((c) => {
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
      mic: { t: c.ru, tr: c.tr },
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
      ans: opts.indexOf(a), card: null, mic: { t: a[3], tr: a[4] },
      reveal: `${a[0]} = ${a[1]} (${a[2]})`,
    };
  });
}

function startQz(build, back, mode, kind) {
  const items = build();
  items.forEach((q) => { q.picked = null; });
  qz = { build, back, mode, kind, day: state.day, items, i: 0 };
  renderQz();
}
const qzScore = () => qz.items.filter((q) => q.picked === q.ans).length;

function renderQz() {
  const q = qz.items[qz.i];
  const n = qz.items.length;

  if (!q) {
    const score = qzScore();
    if (qz.kind === 'day') {
      const p = prog(qz.day);
      if (!p.quizOf || score >= p.quiz) { p.quiz = score; p.quizOf = n; }
      save();
    }
    const missed = qz.items.filter((x) => x.picked !== x.ans).map((x) => x.reveal);
    const isVocab = qz.kind === 'day' || qz.kind === 'review';
    view.innerHTML = `
      <section class="card center">
        <h2>${score} / ${n}</h2>
        ${qz.kind === 'day' ? (score / n >= PASS_RATIO ? '<p class="okmsg">✔ Day completed!</p>' : '<p class="muted">Score 80% or more to complete this day.</p>') : ''}
        <p class="muted">${score >= 8 ? 'Excellent! 🎉' : score >= 5 ? 'Good work, keep going.' : 'Keep practising, you will get there.'}</p>
        ${missed.length ? `<div class="missed"><h3>Review these</h3>${missed.map((m) => `<p>${m}</p>`).join('')}</div>` : ''}
        <button class="btn" id="qa">Try again</button>
        <button class="btn alt" id="qlast">◀ Previous question</button>
        ${isVocab ? `<div class="row2">
          <button class="btn alt" id="qp" ${state.day === 0 ? 'disabled' : ''}>◀ Previous day</button>
          <button class="btn alt" id="qn" ${state.day === LDAYS.length - 1 ? 'disabled' : ''}>Next day ▶</button>
        </div>` : ''}
        <button class="btn alt" id="qb">Back</button>
      </section>`;
    $('#qa').onclick = () => startQz(qz.build, qz.back, qz.mode, qz.kind);
    $('#qlast').onclick = () => { qz.i = n - 1; renderQz(); };
    $('#qb').onclick = () => go(qz.back);
    if (isVocab) {
      $('#qp').onclick = () => { setDay(state.day - 1); renderQuizSetup(); };
      $('#qn').onclick = () => { setDay(state.day + 1); renderQuizSetup(); };
    }
    return;
  }

  const done = q.picked !== null;
  view.innerHTML = `
    <div class="meta"><span>Question ${qz.i + 1}/${n}</span><span>Score ${qzScore()}</span></div>
    <div class="bar"><i style="width:${Math.round((qz.i / n) * 100)}%"></i></div>
    <section class="card center">
      <div class="qp">${q.prompt}</div>
      ${q.sub ? `<div class="muted">${q.sub}</div>` : ''}
      ${q.say ? '<button class="speak inline" id="say" aria-label="Listen">🔊</button>' : ''}
    </section>
    <div class="opts">
      ${q.opts.map((o, i) => `<button class="opt ${done ? (i === q.ans ? 'right' : i === q.picked ? 'wrong' : '') : ''}" data-i="${i}" ${done ? 'disabled' : ''}>${o}</button>`).join('')}
    </div>
    ${done ? `<p class="fb">${q.reveal}</p><div class="mic-slot"></div>` : ''}
    <div class="row2">
      <button class="btn alt" id="qprev" ${qz.i === 0 ? 'disabled' : ''}>◀ Previous</button>
      <button class="btn" id="next" ${done ? '' : 'disabled'}>${qz.i + 1 === n ? 'See result' : 'Next ▶'}</button>
    </div>`;

  const sayBtn = $('#say');
  if (sayBtn) sayBtn.onclick = () => speak(q.say);
  if (done && q.mic) mountMic(view.querySelector('.mic-slot'), q.mic.t, q.mic.tr, 'Now say: ' + q.mic.t);
  if (q.auto && !q.spoken) { q.spoken = true; speak(q.say); }

  view.querySelectorAll('.opt').forEach((b) => {
    b.onclick = () => {
      if (q.picked !== null) return;
      q.picked = +b.dataset.i;
      const ok = q.picked === q.ans;
      if (q.card) review(q.card, ok ? 1 : 0);
      quizFeedback(ok, q);
      renderQz();
    };
  });
  $('#qprev').onclick = () => { qz.i--; renderQz(); };
  $('#next').onclick = () => { qz.i++; renderQz(); };
}

// ---------- speak tab (one day at a time) ----------
let sp = null;

function renderSpeak(fresh) {
  if (fresh || !sp || sp.day !== state.day) sp = { day: state.day, i: 0 };
  const list = dayCards(state.day);
  const c = list[sp.i];
  const p = prog(state.day);
  const lastWord = sp.i === list.length - 1;
  const lastDay = state.day === LDAYS.length - 1;
  view.innerHTML = `
    ${dayBarHtml()}${statusHtml('speak')}
    <div class="meta"><span>Word ${sp.i + 1}/${list.length}</span><span id="spk">🎤 ${p.spoke.length}/${list.length} passed</span></div>
    <div class="bar"><i style="width:${Math.round((sp.i / list.length) * 100)}%"></i></div>
    <section class="flash" style="min-height:190px">
      <div class="ru">${c.ru}</div>
      <div class="tr">${c.tr}</div>
      <div class="en">${c.en}</div>
      <button class="speak" id="say" aria-label="Listen">🔊</button>
    </section>
    <div class="mic-slot"></div>
    <div class="row2">
      <button class="btn alt" id="pw" ${sp.i === 0 ? 'disabled' : ''}>◀ Previous word</button>
      <button class="btn alt" id="nw" ${lastWord && lastDay ? 'disabled' : ''}>${lastWord ? 'Next day ▶' : 'Next word ▶'}</button>
    </div>
    <p class="muted center" style="margin-top:12px">Needs internet and microphone permission.</p>`;
  bindDayBar(() => renderSpeak(true), 'speak');
  $('#say').onclick = () => speak(c.ru);
  mountMic(view.querySelector('.mic-slot'), c.ru, c.tr, undefined, (res) => {
    if (res.g.pass && p.spoke.indexOf(c.ru) < 0) {
      p.spoke.push(c.ru);
      save();
      const el = $('#spk');
      if (el) el.textContent = `🎤 ${p.spoke.length}/${list.length} passed`;
      const st = view.querySelector('.status');
      if (st && st.nextElementSibling) { const tmp = document.createElement('div'); tmp.innerHTML = statusHtml('speak'); st.replaceWith(tmp.children[0]); }
    }
  });
  $('#pw').onclick = () => { delete micMemo[c.ru]; sp.i--; renderSpeak(); };
  $('#nw').onclick = () => {
    delete micMemo[c.ru];
    if (lastWord) { setDay(state.day + 1); renderSpeak(true); } else { sp.i++; renderSpeak(); }
  };
}

// ---------- conversations ----------
// Every Russian word of a line with its meaning under it (tap a word to hear it).
const glossHtml = (ru) => `<div class="gl">${lineWords(ru).map((x) => `<span class="gw" data-w="${x.w}"><b>${x.w}</b><em>${x.tr}</em><i>${x.en || '·'}</i></span>`).join('')}</div>`;
function bindGloss(root) {
  root.querySelectorAll('.gw').forEach((el) => { el.onclick = () => speak(el.dataset.w); });
}

let cs = null;   // setup choices (scenario index, which role you play)
let conv = null; // running conversation

function renderTalk() {
  conv = null;
  const done = LSCEN.filter(talkDone).length;
  view.innerHTML = `
    <h2>Conversations</h2>
    <div class="status"><span class="pill ${done === LSCEN.length ? 'ok' : ''}">${done}/${LSCEN.length} completed</span><span>Score 80% or more to complete one.</span></div>
    <p class="muted">A professional talks to you in Russian and you answer with your voice. You can also swap roles and play the professional.</p>
    ${LSCEN.map((s, i) => {
      const best = state.convBest[s.id] || 0;
      return `
      <button class="card sc" data-i="${i}">
        <span class="emo">${s.emoji}</span>
        <span class="scx"><b>${s.title}</b><small>${s.who} · ${s.lines.length} lines${best ? ' · best ' + best + '%' : ''}</small></span>
        ${best >= PASS_RATIO * 100 ? '<span class="done">✔ Completed</span>' : ''}
      </button>`;
    }).join('')}`;
  view.querySelectorAll('.sc').forEach((b) => { b.onclick = () => renderConvIntro(+b.dataset.i); });
}

function renderConvIntro(i, role) {
  const s = LSCEN[i];
  cs = { si: i, role: role || (cs && cs.si === i ? cs.role : 'Y') };
  view.innerHTML = `
    <button class="btn small" id="cb">◀ All conversations</button>
    <section class="card">
      <h2>${s.emoji} ${s.title}</h2>
      <p class="muted">${s.intro}</p>
      <h3>Choose your role</h3>
      <div class="chips">
        <button class="chip ${cs.role === 'Y' ? 'on' : ''}" data-role="Y">I am the ${s.youLabel.toLowerCase()}</button>
        <button class="chip ${cs.role === 'P' ? 'on' : ''}" data-role="P">I am the ${s.who.toLowerCase()}</button>
      </div>
      <h3>Useful words</h3>
      <div class="keys">${s.keys.map((k) => `<p><b>${k[0]}</b> <span class="muted">${k[1]} · ${k[2]}</span></p>`).join('')}</div>
      <h3>Help</h3>
      <div class="chips"><button class="chip ${state.hints ? 'on' : ''}" id="hint">Show the Russian text: ${state.hints ? 'ON' : 'OFF'}</button></div>
      <button class="btn" id="start">Start conversation</button>
    </section>`;
  $('#cb').onclick = renderTalk;
  view.querySelectorAll('[data-role]').forEach((b) => { b.onclick = () => renderConvIntro(i, b.dataset.role); });
  $('#hint').onclick = () => { state.hints = !state.hints; save(); renderConvIntro(i, cs.role); };
  $('#start').onclick = () => startConv(i, cs.role);
}

function startConv(i, role) {
  const sc = LSCEN[i];
  conv = { sc, role, i: 0, log: [], scores: [], lineBest: 0, revealed: false, skipped: 0, stack: [] };
  micMemo = {};
  convAdvance();
}

const convIsMine = (l) => l[0] === conv.role;

// Moves past the partner's lines (and speaks the last one) until it is your turn.
function convAdvance() {
  let say = null;
  while (conv.i < conv.sc.lines.length && !convIsMine(conv.sc.lines[conv.i])) {
    const l = conv.sc.lines[conv.i];
    conv.log.push(l);
    say = l[1];
    conv.i++;
  }
  conv.lineBest = 0;
  conv.revealed = false;
  renderConv(say);
}

// Goes back to your previous line (the partner's line before it is spoken again).
function convBack() {
  const snap = conv.stack.pop();
  if (!snap) return;
  conv.i = snap.i; conv.log.length = snap.log; conv.scores.length = snap.scores; conv.skipped = snap.skipped;
  conv.lineBest = 0; conv.revealed = false;
  const last = conv.log[conv.log.length - 1];
  renderConv(last && !convIsMine(last) ? last[1] : null);
}

function renderConv(say) {
  const sc = conv.sc;
  const herName = conv.role === 'Y' ? sc.who : sc.youLabel;
  const myName = conv.role === 'Y' ? sc.youLabel : sc.who;
  const herEmo = conv.role === 'Y' ? sc.emoji : '🙂';
  const myEmo = conv.role === 'Y' ? '🙂' : sc.emoji;
  const bub = (l, idx) => {
    const mine = convIsMine(l);
    return `<div class="bub ${mine ? 'u' : 'p'}"><span class="em">${mine ? myEmo : herEmo}</span><div class="bt"><div class="r">${l[1]}</div>${glossHtml(l[1])}<div class="t">${l[2]}</div><div class="e">${l[3]}</div></div>${mine ? '' : `<button class="bsay" data-i="${idx}" aria-label="Hear it">🔊</button>`}</div>`;
  };
  const total = sc.lines.length;
  const myLines = sc.lines.filter((l) => convIsMine(l)).length;
  const bubbles = conv.log.map(bub).join('');

  if (conv.i >= total) {
    const avg = conv.scores.length ? Math.round((conv.scores.reduce((a, b) => a + b, 0) / conv.scores.length) * 100) : 0;
    if (avg > (state.convBest[sc.id] || 0)) { state.convBest[sc.id] = avg; save(); }
    view.innerHTML = `
      <div class="meta"><span>${sc.emoji} ${sc.title}</span><span>Finished</span></div>
      <div class="chat">${bubbles}</div>
      <section class="card center">
        <h2>${avg >= 85 ? '🎉 Excellent!' : avg >= 60 ? '👍 Well done!' : '💪 Good start!'}</h2>
        <p class="muted">Your score: <b>${avg}%</b>${conv.skipped ? ` · ${conv.skipped} line${conv.skipped === 1 ? '' : 's'} skipped` : ''}</p>
        ${avg >= PASS_RATIO * 100 ? '<p class="okmsg">✔ Conversation completed!</p>' : '<p class="muted">Score 80% or more to complete it.</p>'}
        <button class="btn" id="again">Practise again</button>
        ${conv.stack.length ? '<button class="btn alt" id="pl">◀ Previous line</button>' : ''}
        <button class="btn alt" id="swap">Swap roles and play again</button>
        <button class="btn alt" id="all">Choose another conversation</button>
      </section>`;
    $('#again').onclick = () => startConv(LSCEN.indexOf(sc), conv.role);
    $('#swap').onclick = () => startConv(LSCEN.indexOf(sc), conv.role === 'Y' ? 'P' : 'Y');
    $('#all').onclick = renderTalk;
    const plf = $('#pl');
    if (plf) plf.onclick = convBack;
    view.querySelectorAll('.bsay').forEach((b) => { b.onclick = () => speak(conv.log[+b.dataset.i][1]); });
    bindGloss(view);
    return;
  }

  const line = sc.lines[conv.i];
  const showRu = state.hints || conv.revealed;
  const already = micMemo[line[1]] && micMemo[line[1]].g.pass;
  view.innerHTML = `
    <div class="meta"><span>${sc.emoji} ${sc.title}</span><span>Your line ${conv.scores.length + 1}/${myLines}</span></div>
    <div class="chat">${bubbles}</div>
    <section class="card turn" id="turn">
      <p class="muted">Your turn · you are the ${myName.toLowerCase()}</p>
      <p class="saythis">Say: <b>${line[3]}</b></p>
      ${showRu ? `<div class="ru2">${line[1]}</div>${glossHtml(line[1])}<div class="trl">${line[2]}</div>` : '<button class="btn alt" id="reveal">Show the Russian</button>'}
      <div class="chips"><button class="chip" id="hear">🔊 Hear it</button></div>
      <div class="mic-slot"></div>
      <button class="btn" id="cont" ${already ? '' : 'hidden'}>Continue →</button>
      <div class="row2">
        <button class="btn alt" id="pl" ${conv.stack.length ? '' : 'disabled'}>◀ Previous</button>
        <button class="btn alt" id="skip">Skip ▶</button>
      </div>
    </section>
    <button class="btn small" id="exit">Stop and go back</button>`;

  view.querySelectorAll('.bsay').forEach((b) => { b.onclick = () => speak(conv.log[+b.dataset.i][1]); });
  bindGloss(view);
  $('#hear').onclick = () => speak(line[1]);
  const rev = $('#reveal');
  if (rev) rev.onclick = () => { conv.revealed = true; renderConv(); };
  mountMic(view.querySelector('.mic-slot'), line[1], line[2], 'Say it in Russian', (res) => {
    conv.lineBest = Math.max(conv.lineBest, res.g.score);
    if (res.g.pass) $('#cont').hidden = false;
  });
  const step = (score, skipped) => {
    conv.stack.push({ i: conv.i, log: conv.log.length, scores: conv.scores.length, skipped: conv.skipped });
    conv.scores.push(score);
    if (skipped) conv.skipped++;
    conv.log.push(line);
    delete micMemo[line[1]];
    conv.i++;
    convAdvance();
  };
  $('#cont').onclick = () => step(Math.max(conv.lineBest, micMemo[line[1]] ? micMemo[line[1]].g.score : 0), false);
  $('#skip').onclick = () => step(0, true);
  $('#pl').onclick = convBack;
  $('#exit').onclick = renderTalk;
  if (say) speak(say);
  const turn = $('#turn');
  if (turn && turn.scrollIntoView) turn.scrollIntoView({ block: 'center' });
}

// ---------- start ----------
document.querySelectorAll('#nav button').forEach((b) => { b.onclick = () => go(b.dataset.tab); });
document.addEventListener('pointerdown', warmAudio);
$('#gear').onclick = showSettings;
$('header').insertAdjacentHTML('beforeend', speedHtml());
bindSpeed($('header .speed'));
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
go('home');
