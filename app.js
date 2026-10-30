'use strict';

const $ = (s) => document.querySelector(s);
const view = $('#view');
const KEY = 'russian-start-v1';
const INTERVALS = [0, 1, 3, 7, 14, 30, 60]; // days until next review, by "box"

// ---------- saved progress (stays on your phone) ----------
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
let state = Object.assign({ cards: {}, streak: 0, lastDay: null, reviewed: { day: null, n: 0 }, level: 'beginner', lv: {}, convBest: {}, hints: true }, saved);
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
  renderHome();
}
const dayCards = (di) => ALL.filter((c) => c.day === di);
const prog = (d) => {
  const p = (state.progress[d] = state.progress[d] || {});
  if (!Array.isArray(p.spoke)) p.spoke = [];
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
const ruVoice = () => VOICES.find((x) => x.lang && x.lang.toLowerCase().replace('_', '-').startsWith('ru'));
const transLink = (text) => 'https://translate.google.com/?sl=ru&tl=en&op=translate&text=' + encodeURIComponent(text);

function speak(text, rate) {
  if (!('speechSynthesis' in window)) { toast('This browser has no speech. Use the Google Translate link instead.'); return; }
  loadVoices();
  const v = ruVoice();
  if (VOICES.length && !v) toast('No Russian voice installed. See "Sound help" on the Home tab.');
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ru-RU';
  u.rate = rate || 0.8;
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

// ---------- speaking: grading and suggestions ----------
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

// Hard Russian sounds and a tip for each (taken from the alphabet data).
const HARD = 'ыжщчцхрьъ';
function letterTips(word, max, got) {
  const out = [], seen = {};
  for (const ch of word) {
    if (HARD.indexOf(ch) >= 0 && !seen[ch]) {
      seen[ch] = 1;
      if (got && got.indexOf(ch) >= 0) continue; // you already said this letter
      const a = ALPHABET.find((x) => x[0].split(' ')[1] === ch);
      if (a) out.push(`${a[0]} (“${a[1]}”): ${a[2]}`);
      if (out.length >= max) break;
    }
  }
  return out;
}

// Plain-language suggestions about what to fix.
function suggest(g, tr, target) {
  const out = [];
  const exp = norm(target).split(' ').filter(Boolean);
  const trw = (tr || '').trim().split(/\s+/);
  const sound = (w) => { if (trw.length !== exp.length) return null; const k = exp.indexOf(w); return k >= 0 ? trw[k] : null; };
  const bad = [];
  for (const o of g.ops) {
    if (o.exp !== null && o.s < 1) {
      const snd = sound(o.exp);
      const sfx = snd ? ` (sounds like “${snd}”)` : '';
      if (o.got === null) out.push(`You skipped “${o.exp}”${sfx}.`);
      else if (o.s >= 0.6) out.push(`Say “${o.exp}”${sfx}, not “${o.got}”.`);
      else out.push(`“${o.exp}”${sfx} was heard as “${o.got}”. Say it slowly.`);
      bad.push([o.exp, o.got]);
    } else if (o.exp === null) {
      out.push(`Leave out the extra word “${o.got}”.`);
    }
  }
  const tips = [];
  for (const b of bad) for (const t of letterTips(b[0], 2, b[1])) if (tips.indexOf(t) < 0 && tips.length < 2) tips.push(t);
  tips.forEach((t) => out.push('Sound tip: ' + t));
  if (g.score < 0.5 && exp.length > 1) out.push('Say each word separately first, then the whole phrase.');
  return out;
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

function feedbackHtml(res, tr, target) {
  const w = (o) => {
    if (o.exp === null) return `<span class="w extra"><small>extra word</small>${o.got}</span>`;
    if (o.got === null) return `<span class="w bad">${o.exp}<small>missing</small></span>`;
    if (o.s === 1) return `<span class="w ok">${o.exp}</span>`;
    return `<span class="w ${o.s >= 0.6 ? 'near' : 'bad'}">${o.exp}<small>you said: ${o.got}</small></span>`;
  };
  const g = res.g;
  const tips = g.score < 1 ? suggest(g, tr, target) : [];
  return `
    <section class="card fbk">
      <h2>${g.pass ? (g.score >= 0.95 ? '🎉 Perfect!' : '👍 Good, almost there') : '🔁 Try again'} <span class="muted">${Math.round(g.score * 100)}%</span></h2>
      <p class="muted">I heard: <b>${res.heard}</b></p>
      <div class="words">${g.ops.map(w).join('')}</div>
      ${tips.length ? `<h3>💡 Suggestions</h3><ul class="sug">${tips.map((t) => `<li>${t}</li>`).join('')}</ul>` : ''}
      ${!g.pass ? `<p class="muted" style="margin-top:8px">Tap 🔊 to hear it again, then say it slowly. Sounds like: <b>${tr}</b></p>` : ''}
    </section>`;
}

// Puts a "say it" button and its feedback into an empty slot element. Works on any screen.
function mountMic(slot, target, tr, label, onResult) {
  if (!slot) return;
  let busy = false, msg = '';
  let res = micMemo[target] || null;
  const draw = () => {
    slot.innerHTML = `<button class="btn mic ${busy ? 'rec' : ''}" ${busy ? 'disabled' : ''}>${busy ? '🎤 Listening… speak now' : '🎤 ' + (label || 'Tap, then say it in Russian')}</button>${msg ? `<p class="fb">${msg}</p>` : ''}${res ? feedbackHtml(res, tr, target) : ''}`;
    const b = slot.querySelector('button');
    if (b) b.onclick = start;
  };
  const start = () => listenOnce({
    onstart: () => { busy = true; msg = ''; res = null; delete micMemo[target]; draw(); },
    onresult: (alts) => {
      const t = norm(target);
      const heard = alts.find((x) => norm(x) === t) || alts[0];
      res = { heard, g: grade(target, heard) };
      micMemo[target] = res;
      if (res.g.pass) { noteActivity(); save(); }
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
function bindDayBar(rerender) {
  $('#dprev').onclick = () => { setDay(state.day - 1); rerender(); };
  $('#dnext').onclick = () => { setDay(state.day + 1); rerender(); };
  $('#dpick').onclick = () => pickDay(rerender);
}
function pickDay(rerender) {
  const sh = $('#sheet');
  const close = () => { sh.hidden = true; sh.innerHTML = ''; };
  sh.hidden = false;
  sh.innerHTML = `
    <div class="sheet-bg"></div>
    <div class="sheet-box">
      <h2>Choose a day</h2>
      <div class="daylist">
        ${LDAYS.map((d, i) => {
          const p = state.progress[i] || {};
          const badges = [p.study ? '📖' : '', p.quizOf ? `✅ ${p.quiz}/${p.quizOf}` : '', p.spoke && p.spoke.length ? `🎤 ${p.spoke.length}/${d.cards.length}` : ''].filter(Boolean).join('  ');
          return `<button class="dayrow ${i === state.day ? 'on' : ''}" data-d="${i}"><span><b>Day ${i + 1}</b> · ${d.title}</span><small>${badges}</small></button>`;
        }).join('')}
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
  try { if (activeRecog) activeRecog.abort(); } catch (e) {}
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const sh = $('#sheet');
  sh.hidden = true; sh.innerHTML = '';
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  window.scrollTo(0, 0);
  if (tab === 'home') renderHome();
  else if (tab === 'alphabet') renderAlphabet();
  else if (tab === 'study') renderStudy(true, opt);
  else if (tab === 'quiz') renderQuizSetup();
  else if (tab === 'speak') renderSpeak(true);
  else renderTalk();
}

// ---------- home ----------
function renderHome() {
  const t = todayNum();
  const streak = state.lastDay !== null && state.lastDay >= t - 1 ? state.streak : 0;
  const seen = Object.keys(state.cards).length;
  const known = Object.values(state.cards).filter((s) => s.box >= 3).length;
  const due = ALL.filter((c) => state.cards[c.id] && state.cards[c.id].due <= t).length;
  const today = state.reviewed.day === t ? state.reviewed.n : 0;
  const d = LDAYS[state.day];
  const p = prog(state.day);
  const studied = Object.keys(state.progress).filter((k) => state.progress[k].study).length;
  const lvl = curLevel();
  const levelCards = LEVELS.map((l) => {
    const n = Object.values(state.lv[l.id].progress).filter((p) => p.study).length;
    return `<button class="lvl ${l.id === state.level ? 'on' : ''}" data-lv="${l.id}"><span class="lemo">${l.emoji}</span><b>${l.name}</b><small>${n}/${l.days.length} days</small></button>`;
  }).join('');

  view.innerHTML = `
    <section class="stats">
      <div><b>${streak}</b><span>day streak 🔥</span></div>
      <div><b>${today}</b><span>reviews today</span></div>
      <div><b>${due}</b><span>due now</span></div>
    </section>
    <section class="levels">${levelCards}</section>
    <section class="card">
      <h2>${lvl.emoji} ${lvl.name} level</h2>
      <p class="muted" style="margin-bottom:6px">${lvl.sub}</p>
      ${dayBarHtml()}
      <p class="muted" style="margin:10px 0 4px">${d.cards.slice(0, 6).map((c) => c[0]).join(' · ')}${d.cards.length > 6 ? ' …' : ''}</p>
      <p class="muted">${p.study ? '📖 studied' : '📖 not studied yet'} · ${p.quizOf ? '✅ quiz ' + p.quiz + '/' + p.quizOf : '✅ no quiz yet'} · 🎤 ${p.spoke.length}/${d.cards.length}</p>
      <div class="row3">
        <button class="btn" data-go="study">Study</button>
        <button class="btn" data-go="quiz">Quiz</button>
        <button class="btn" data-go="speak">Speak</button>
      </div>
      ${due ? `<button class="btn alt" id="due">Review ${due} due word${due === 1 ? '' : 's'}</button>` : ''}
      <button class="btn alt" data-go="talk">💬 Practise a conversation</button>
    </section>
    <section class="card">
      <h2>Your progress</h2>
      <div class="bar"><i style="width:${Math.round((known / ALL.length) * 100)}%"></i></div>
      <p class="muted">${studied}/${LDAYS.length} days studied · ${known} well known · ${seen} started · ${ALL.length} words in total</p>
    </section>
    <section class="card tip">
      <h2>🔊 Sound help</h2>
      <button class="btn alt" id="sc-test">Test the sound</button>
      <p id="sc-out" style="margin-top:10px"></p>
      <p style="margin-top:10px">No Russian voice? On Android: Settings → search "Text-to-speech output" → choose <b>Speech Services by Google</b> → ⚙ → <b>Install voice data</b> → <b>Russian</b>. Also raise the media volume. Then restart this app.</p>
    </section>
    <section class="card tip">
      <h2>How to learn</h2>
      <p>1) Choose your level above: Beginner, Mid (daily life and engineering basics) or Professional (electrical and power engineering). New to Russian? Start with Beginner and the Alphabet tab. 2) Each day: Study the words, take the Quiz, then Speak them aloud with 🎤. 3) Use the ◀ ▶ buttons to move between days. 4) Practise real situations in the Talk tab. Come back every day: the app brings old words back just before you forget them.</p>
    </section>
    <button class="btn small" id="reset">Reset my progress</button>`;

  bindDayBar(renderHome);
  view.querySelectorAll('[data-lv]').forEach((b) => { b.onclick = () => setLevel(b.dataset.lv); });
  view.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go); });
  const dueBtn = $('#due');
  if (dueBtn) dueBtn.onclick = () => go('study', 'due');
  $('#sc-test').onclick = soundCheck;
  $('#reset').onclick = () => {
    if (confirm('Erase all progress?')) {
      state.cards = {}; state.streak = 0; state.lastDay = null; state.reviewed = { day: null, n: 0 };
      for (const l of LEVELS) state.lv[l.id] = { day: 0, progress: {} };
      state.convBest = {};
      save(); renderHome();
    }
  };
}

// ---------- alphabet ----------
function renderAlphabet() {
  view.innerHTML = `
    <h2>The Russian alphabet</h2>
    <p class="muted">33 letters. Tap a letter to hear it and to practise saying it.</p>
    <div class="grid">
      ${ALPHABET.map((a, i) => `<button class="tile" data-i="${i}"><span class="big">${a[0]}</span><span class="tr">${a[1]}</span></button>`).join('')}
    </div>
    <button class="btn" id="aq">Practise the alphabet</button>`;
  view.querySelectorAll('.tile').forEach((b) => { b.onclick = () => { showLetter(+b.dataset.i); speak(ALPHABET[+b.dataset.i][3]); }; });
  $('#aq').onclick = () => startQz(buildAlphaQuiz, 'alphabet', 'alpha', 'alpha');
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
      <div class="mic-slot"></div>
      <a class="lnk" target="_blank" rel="noopener" href="${transLink(a[3])}">No sound? Listen on Google Translate</a>
      <button class="btn alt" id="sc">Close</button>
    </div>`;
  sh.querySelector('.sheet-bg').onclick = close;
  $('#sc').onclick = close;
  $('#sw').onclick = () => speak(a[3]);
  $('#sl').onclick = () => speak(a[0].charAt(0));
  mountMic(sh.querySelector('.mic-slot'), a[3], a[4], 'Say the word: ' + a[3]);
}

// ---------- study (flashcards, one day at a time) ----------
let session = null;

function newSession(mode) {
  const t = todayNum();
  let queue;
  if (mode === 'due') queue = shuffle(ALL.filter((c) => state.cards[c.id] && state.cards[c.id].due <= t)).slice(0, 30);
  else if (mode === 'all') queue = shuffle(dayCards(state.day));
  else queue = shuffle(dayCards(state.day).filter((c) => !state.cards[c.id] || state.cards[c.id].due <= t));
  return { mode: mode || 'day', day: state.day, queue, total: queue.length, done: 0, shown: false, hist: [] };
}

function renderStudy(fresh, mode) {
  if (fresh || !session) session = newSession(mode);
  const s = session;
  const header = s.mode === 'due' ? '<div class="daybar solo"><span><b>Review: words due now</b></span></div>' : dayBarHtml();
  const rerender = () => renderStudy(true);

  if (!s.queue.length) {
    if (s.total && s.mode !== 'due') { prog(s.day).study = true; save(); }
    const last = state.day === LDAYS.length - 1;
    const title = s.total ? '🎉 Lesson complete' : s.mode === 'due' ? 'No words are due' : 'Nothing is due in this day';
    const text = s.total ? `You reviewed ${s.done} card${s.done === 1 ? '' : 's'}. Great work!` : s.mode === 'due' ? 'Come back later, or study the next day.' : 'You already know these words for now. Practise again, or move on.';
    view.innerHTML = `
      ${header}
      <section class="card center">
        <h2>${title}</h2>
        <p class="muted">${text}</p>
        ${s.mode === 'due'
          ? '<button class="btn" id="home">Back to Home</button>'
          : `<button class="btn" id="again">Practise this day again</button>
             <button class="btn alt" id="toquiz">Take the Day ${state.day + 1} quiz</button>
             ${last ? '' : '<button class="btn alt" id="nextday">Next day ▶</button>'}`}
      </section>`;
    if (s.mode !== 'due') bindDayBar(rerender);
    const bind = (id, fn) => { const el = $('#' + id); if (el) el.onclick = fn; };
    bind('home', () => go('home'));
    bind('again', () => renderStudy(true, 'all'));
    bind('toquiz', () => go('quiz'));
    bind('nextday', () => { setDay(state.day + 1); rerender(); });
    return;
  }

  const c = s.queue[0];
  const isNew = !state.cards[c.id];
  view.innerHTML = `
    ${header}
    <div class="meta"><span>${s.mode === 'due' ? 'Due words' : 'Day ' + (s.day + 1)}</span><span>${s.done}/${s.total}</span></div>
    <div class="bar"><i style="width:${s.total ? Math.round((s.done / s.total) * 100) : 0}%"></i></div>
    <section class="flash" id="flash">
      ${isNew ? '<span class="badge">NEW</span>' : ''}
      <div class="ru">${c.ru}</div>
      ${s.shown ? `<div class="tr">${c.tr}</div><div class="en">${c.en}</div>` : '<div class="muted">Tap to reveal</div>'}
      <button class="speak" id="say" aria-label="Listen">🔊</button>
    </section>
    <div class="mic-slot"></div>
    <a class="lnk" target="_blank" rel="noopener" href="${transLink(c.ru)}">No sound? Listen on Google Translate</a>
    ${s.shown
      ? '<div class="rate"><button class="r0" data-r="0">Again</button><button class="r1" data-r="1">Good</button><button class="r2" data-r="2">Easy</button></div>'
      : '<button class="btn" id="show">Show answer</button>'}
    ${s.hist.length ? '<button class="btn small" id="prevc">◀ Previous card</button>' : ''}`;

  if (s.mode !== 'due') bindDayBar(rerender);
  $('#say').onclick = (e) => { e.stopPropagation(); speak(c.ru); };
  mountMic(view.querySelector('.mic-slot'), c.ru, c.tr, 'Say it in Russian');
  $('#flash').onclick = () => { if (!s.shown) { s.shown = true; renderStudy(); } };
  const showBtn = $('#show');
  if (showBtn) showBtn.onclick = () => { s.shown = true; renderStudy(); };
  view.querySelectorAll('[data-r]').forEach((b) => {
    b.onclick = () => {
      const r = +b.dataset.r;
      s.queue.shift();
      s.shown = false;
      review(c, r);
      delete micMemo[c.ru];
      if (r === 0) s.queue.push(c); else s.done++;
      s.hist.push({ c, counted: r !== 0 });
      renderStudy();
    };
  });
  const prev = $('#prevc');
  if (prev) prev.onclick = () => {
    const h = s.hist.pop();
    s.queue = s.queue.filter((x) => x.id !== h.c.id);
    s.queue.unshift(h.c);
    if (h.counted) s.done--;
    s.shown = false;
    renderStudy();
  };
}

// ---------- quizzes (one day at a time) ----------
let qz = null;

function renderQuizSetup() {
  const n = dayCards(state.day).length;
  const q = Math.min(10, n);
  view.innerHTML = `
    ${dayBarHtml()}
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
  bindDayBar(renderQuizSetup);
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
  qz = { build, back, mode, kind, day: state.day, items: build(), i: 0, score: 0, missed: [], picked: null };
  renderQz();
}

function renderQz() {
  const q = qz.items[qz.i];

  if (!q) {
    const n = qz.items.length;
    if (qz.kind === 'day') {
      const p = prog(qz.day);
      if (!p.quizOf || qz.score >= p.quiz) { p.quiz = qz.score; p.quizOf = n; }
      save();
    }
    const isVocab = qz.kind === 'day' || qz.kind === 'review';
    view.innerHTML = `
      <section class="card center">
        <h2>${qz.score} / ${n}</h2>
        <p class="muted">${qz.score >= 8 ? 'Excellent! 🎉' : qz.score >= 5 ? 'Good work, keep going.' : 'Keep practising, you will get there.'}</p>
        ${qz.missed.length ? `<div class="missed"><h3>Review these</h3>${qz.missed.map((m) => `<p>${m}</p>`).join('')}</div>` : ''}
        <button class="btn" id="qa">Try again</button>
        ${isVocab ? `<div class="row2">
          <button class="btn alt" id="qp" ${state.day === 0 ? 'disabled' : ''}>◀ Previous day</button>
          <button class="btn alt" id="qn" ${state.day === LDAYS.length - 1 ? 'disabled' : ''}>Next day ▶</button>
        </div>` : ''}
        <button class="btn alt" id="qb">Back</button>
      </section>`;
    $('#qa').onclick = () => startQz(qz.build, qz.back, qz.mode, qz.kind);
    $('#qb').onclick = () => go(qz.back);
    if (isVocab) {
      $('#qp').onclick = () => { setDay(state.day - 1); renderQuizSetup(); };
      $('#qn').onclick = () => { setDay(state.day + 1); renderQuizSetup(); };
    }
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
    ${done ? `<p class="fb">${q.reveal}</p><div class="mic-slot"></div><button class="btn" id="next">${qz.i + 1 === qz.items.length ? 'See result' : 'Next'}</button>` : ''}`;

  const sayBtn = $('#say');
  if (sayBtn) sayBtn.onclick = () => speak(q.say);
  if (done && q.mic) mountMic(view.querySelector('.mic-slot'), q.mic.t, q.mic.tr, 'Now say: ' + q.mic.t);
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
  if (next) next.onclick = () => { if (q.mic) delete micMemo[q.mic.t]; qz.i++; qz.picked = null; renderQz(); };
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
    ${dayBarHtml()}
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
  bindDayBar(() => renderSpeak(true));
  $('#say').onclick = () => speak(c.ru);
  mountMic(view.querySelector('.mic-slot'), c.ru, c.tr, undefined, (res) => {
    if (res.g.pass && p.spoke.indexOf(c.ru) < 0) {
      p.spoke.push(c.ru);
      save();
      const el = $('#spk');
      if (el) el.textContent = `🎤 ${p.spoke.length}/${list.length} passed`;
    }
  });
  $('#pw').onclick = () => { delete micMemo[c.ru]; sp.i--; renderSpeak(); };
  $('#nw').onclick = () => {
    delete micMemo[c.ru];
    if (lastWord) { setDay(state.day + 1); renderSpeak(true); } else { sp.i++; renderSpeak(); }
  };
}

// ---------- conversations ----------
let cs = null;   // setup choices (scenario index, which role you play)
let conv = null; // running conversation

function renderTalk() {
  conv = null;
  view.innerHTML = `
    <h2>Conversations</h2>
    <p class="muted">A professional talks to you in Russian and you answer with your voice. You can also swap roles and play the professional.</p>
    ${LSCEN.map((s, i) => `
      <button class="card sc" data-i="${i}">
        <span class="emo">${s.emoji}</span>
        <span class="scx"><b>${s.title}</b><small>${s.who} · ${s.lines.length} lines${state.convBest[s.id] ? ' · best ' + state.convBest[s.id] + '%' : ''}</small></span>
      </button>`).join('')}`;
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
  conv = { sc, role, i: 0, log: [], scores: [], lineBest: 0, revealed: false, skipped: 0 };
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

function renderConv(say) {
  const sc = conv.sc;
  const herName = conv.role === 'Y' ? sc.who : sc.youLabel;
  const myName = conv.role === 'Y' ? sc.youLabel : sc.who;
  const herEmo = conv.role === 'Y' ? sc.emoji : '🙂';
  const myEmo = conv.role === 'Y' ? '🙂' : sc.emoji;
  const bub = (l, idx) => {
    const mine = convIsMine(l);
    return `<div class="bub ${mine ? 'u' : 'p'}"><span class="em">${mine ? myEmo : herEmo}</span><div class="bt"><div class="r">${l[1]}</div><div class="t">${l[2]}</div><div class="e">${l[3]}</div></div>${mine ? '' : `<button class="bsay" data-i="${idx}" aria-label="Hear it">🔊</button>`}</div>`;
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
        <button class="btn" id="again">Practise again</button>
        <button class="btn alt" id="swap">Swap roles and play again</button>
        <button class="btn alt" id="all">Choose another conversation</button>
      </section>`;
    $('#again').onclick = () => startConv(LSCEN.indexOf(sc), conv.role);
    $('#swap').onclick = () => startConv(LSCEN.indexOf(sc), conv.role === 'Y' ? 'P' : 'Y');
    $('#all').onclick = renderTalk;
    view.querySelectorAll('.bsay').forEach((b) => { b.onclick = () => speak(conv.log[+b.dataset.i][1], 0.85); });
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
      ${showRu ? `<div class="ru2">${line[1]}</div><div class="trl">${line[2]}</div>` : '<button class="btn alt" id="reveal">Show the Russian</button>'}
      <div class="chips"><button class="chip" id="hear">🔊 Hear it</button></div>
      <div class="mic-slot"></div>
      <button class="btn" id="cont" ${already ? '' : 'hidden'}>Continue →</button>
      <button class="btn small" id="skip">Skip this line</button>
    </section>
    <button class="btn small" id="exit">Stop and go back</button>`;

  view.querySelectorAll('.bsay').forEach((b) => { b.onclick = () => speak(conv.log[+b.dataset.i][1], 0.85); });
  $('#hear').onclick = () => speak(line[1], 0.85);
  const rev = $('#reveal');
  if (rev) rev.onclick = () => { conv.revealed = true; renderConv(); };
  mountMic(view.querySelector('.mic-slot'), line[1], line[2], 'Say it in Russian', (res) => {
    conv.lineBest = Math.max(conv.lineBest, res.g.score);
    if (res.g.pass) $('#cont').hidden = false;
  });
  const step = (score, skipped) => {
    conv.scores.push(score);
    if (skipped) conv.skipped++;
    conv.log.push(line);
    delete micMemo[line[1]];
    conv.i++;
    convAdvance();
  };
  $('#cont').onclick = () => step(Math.max(conv.lineBest, micMemo[line[1]] ? micMemo[line[1]].g.score : 0), false);
  $('#skip').onclick = () => step(0, true);
  $('#exit').onclick = renderTalk;
  if (say) speak(say, 0.85);
  const turn = $('#turn');
  if (turn && turn.scrollIntoView) turn.scrollIntoView({ block: 'center' });
}

// ---------- start ----------
document.querySelectorAll('#nav button').forEach((b) => { b.onclick = () => go(b.dataset.tab); });
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
go('home');
