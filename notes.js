'use strict';
// ======================================================================
// My Notes: save your own words and sentences by voice (Russian or English),
// with sound, word meanings and "did you mean" suggestions.
// Uses helpers from app.js (state, view, speak, speakSeq, listenOnce, mountMic, norm, sim ...).
// ======================================================================

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// saved notes: { id, ru, en, added }
state.notes = (Array.isArray(state.notes) ? state.notes : [])
  .filter((n) => n && typeof n === 'object' && (n.ru || n.en))
  .map((n) => ({ id: String(n.id || Date.now() + '' + Math.random()), ru: String(n.ru || ''), en: String(n.en || ''), added: +n.added || 0 }));

const wordCount = (t) => (String(t).trim() ? String(t).trim().split(/\s+/).length : 0);
const isSentence = (n) => wordCount(n.ru || n.en) > 1;
// one word stays as it is, a sentence gets a capital letter
const tidy = (t) => {
  t = String(t).replace(/\s+/g, ' ').trim();
  return wordCount(t) > 1 ? t.charAt(0).toUpperCase() + t.slice(1) : t;
};

// ---------- what the app already knows (for meanings and suggestions) ----------
let KB = null;
const noParen = (s) => s.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
function buildKB() {
  if (KB) return KB;
  const ru2en = new Map(), en2ru = new Map(), ruList = [], enList = [], forms = {};
  const put = (ru, en) => {
    ru = String(ru).replace(/…/g, '').trim();
    en = String(en).trim();
    if (!ru || !en) return;
    const kr = norm(ru);
    if (kr && !ru2en.has(kr)) { ru2en.set(kr, en); ruList.push(ru); }
    if (wordCount(ru) === 1 && forms[gkey(ru)] === undefined) forms[gkey(ru)] = ru;
    const vars = new Set([en, noParen(en)]);
    en.split(/\s*\/\s*/).forEach((p) => { vars.add(p); vars.add(noParen(p)); });
    [...vars].forEach((v) => vars.add(v.replace(/^to /, '')));
    vars.forEach((v) => {
      const ke = norm(v);
      if (ke && !en2ru.has(ke)) { en2ru.set(ke, ru); enList.push(v); }
    });
  };
  [DECKS, DECKS_MID, DECKS_PRO, DECKS_FAMILY].forEach((d) => Object.values(d).forEach((list) => list.forEach((c) => put(c[0], c[2]))));
  ALPHABET.forEach((a) => put(a[3], a[5]));
  GLOSS_TEXT.split('\n').forEach((l) => { const p = l.split('|'); if (p.length >= 3) put(p[0].trim(), p.slice(2).join('|').trim()); });
  LEVELS.forEach((L) => L.scenarios.forEach((s) => s.lines.forEach((ln) => put(ln[1], ln[3]))));
  KB = { ru2en, en2ru, ruList, enList, forms };
  return KB;
}

// meaning from the app's own word lists ('' if unknown)
function localLookup(src, text) {
  const k = norm(text);
  if (!k) return '';
  const kb = buildKB();
  return (src === 'ru' ? kb.ru2en : kb.en2ru).get(k) || '';
}

function nearestForm(w) {
  const kb = buildKB();
  let best = null, bs = 0;
  for (const k in kb.forms) {
    if (Math.abs(k.length - w.length) > 3) continue;
    const s = sim(w, k);
    if (s > bs) { bs = s; best = k; }
  }
  return bs >= 0.72 ? kb.forms[best] : null;
}

// "Did you mean ...": the corrected sentence, similar known words/sentences, and what the microphone also heard
function suggestions(src, text, alts) {
  const kb = buildKB();
  const k = norm(text);
  const out = [];
  const push = (s) => {
    s = String(s || '').trim();
    if (s && norm(s) !== k && !out.some((o) => norm(o) === norm(s))) out.push(s);
  };
  const known = (src === 'ru' ? kb.ru2en : kb.en2ru).has(k);
  if (k && !known) {
    if (src === 'ru') {
      let changed = false;
      const fixed = (text.match(WORD_RE) || []).map((w) => {
        if (kb.forms[gkey(w)] !== undefined || w.length < 3) return w;
        const f = nearestForm(gkey(w));
        if (f) { changed = true; return f; }
        return w;
      });
      if (changed) push(tidy(fixed.join(' ')));
    }
    const pool = src === 'ru' ? kb.ruList : kb.enList;
    const sc = [];
    for (const p of pool) {
      const kp = norm(p);
      if (Math.abs(kp.length - k.length) > Math.max(3, k.length * 0.4)) continue;
      const s = sim(k, kp);
      if (s >= 0.6) sc.push([s, p]);
    }
    sc.sort((a, b) => b[0] - a[0]);
    sc.slice(0, 3).forEach((x) => push(x[1]));
  }
  (alts || []).forEach((a) => push(tidy(a)));
  return out.slice(0, 5);
}

function scriptHint(src, text) {
  if (src === 'ru' && /[a-z]/i.test(text) && !/[а-яё]/i.test(text)) return 'I heard English letters. Say it in Russian, or switch to "I will speak English".';
  if (src === 'en' && /[а-яё]/i.test(text)) return 'I heard Russian letters. Say it in English, or switch to "I will speak Russian".';
  return '';
}

// free online translation (only when you tap the button; sends the text to MyMemory)
async function onlineTranslate(text, from, to) {
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text.slice(0, 450)) + '&langpair=' + from + '|' + to;
  const r = await fetch(url);
  const j = await r.json();
  let t = j && j.responseData && j.responseData.translatedText;
  if (!t || /MYMEMORY WARNING|INVALID|QUERY LENGTH/i.test(t)) throw new Error('none');
  const ta = document.createElement('textarea');
  ta.innerHTML = t;
  t = ta.value.trim();
  if (!t) throw new Error('none');
  return t;
}

// ---------- the page ----------
let nt = { src: 'ru', filter: 'all', q: '', draft: null, busy: false, msg: '' };
const SIDE = { ru: '🇷🇺 Russian', en: '🇬🇧 English' };
const other = (s) => (s === 'ru' ? 'en' : 'ru');
const langCode = (s) => (s === 'ru' ? 'ru-RU' : 'en-US');
const hearEn = (t) => speakSeq([{ text: t, lang: 'en-US' }]);

function newDraft(src, text, extra) {
  const d = Object.assign({ src, ru: '', en: '', ruEdited: false, enEdited: false, editId: null, alts: [], hint: '' }, extra || {});
  if (text != null) d[src] = text;
  autoFill(d);
  return d;
}
function autoFill(d) {
  const o = other(d.src);
  if (d[o + 'Edited']) return;
  d[o] = localLookup(d.src, d[d.src]);
}

function renderNotes() {
  nt.draft = null; nt.busy = false; nt.msg = '';
  view.innerHTML = `
    <button class="btn small" id="nhome">◀ Home</button>
    <h2>📝 My Notes</h2>
    <p class="muted">Say a word or a sentence, in Russian or in English. It is saved with its meaning, so you can listen to it again later.</p>
    <section class="card" id="addcard"></section>
    <section class="card">
      <div class="chips" id="nfilters">
        ${[['all', 'All'], ['word', 'Words'], ['sentence', 'Sentences']].map(([k, l]) => `<button class="chip ${nt.filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}
      </div>
      <input class="nin nsearch" id="nq" type="search" placeholder="Search my notes" value="${esc(nt.q)}" autocomplete="off">
    </section>
    <div id="nlist"></div>
    <button class="btn small" id="nexport">📋 Copy all notes</button>`;
  $('#nhome').onclick = () => go('home');
  view.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { nt.filter = b.dataset.f; view.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === b)); drawList(); }; });
  $('#nq').oninput = (e) => { nt.q = e.target.value; drawList(); };
  $('#nexport').onclick = () => {
    const txt = state.notes.map((n) => [n.ru, n.en].filter(Boolean).join(' — ')).join('\n');
    if (!txt) { toast('No notes yet.'); return; }
    try { navigator.clipboard.writeText(txt).then(() => toast('✔ Copied. Paste it anywhere.'), () => toast('Could not copy.')); } catch (e) { toast('Could not copy.'); }
  };
  drawAdd();
  drawList();
}

// the "add a note" card: language, microphone, message and the draft form
function drawAdd() {
  const box = $('#addcard');
  if (!box) return;
  box.innerHTML = `
    <div class="chips">
      <button class="chip ${nt.src === 'ru' ? 'on' : ''}" data-src="ru">🇷🇺 I will speak Russian</button>
      <button class="chip ${nt.src === 'en' ? 'on' : ''}" data-src="en">🇬🇧 I will speak English</button>
    </div>
    <button class="btn mic ${nt.busy ? 'rec' : ''}" id="nmic" ${nt.busy ? 'disabled' : ''}>${nt.busy ? '🎤 Listening… speak now' : '🎤 Tap, then say a word or sentence'}</button>
    ${nt.msg ? `<p class="fb">${esc(nt.msg)}</p>` : ''}
    ${nt.draft ? draftHtml() : '<button class="btn small" id="ntype">✍️ Type it instead</button>'}`;
  box.querySelectorAll('[data-src]').forEach((b) => { b.onclick = () => { nt.src = b.dataset.src; if (nt.draft && !nt.draft.editId) nt.draft = null; nt.msg = ''; drawAdd(); }; });
  $('#nmic').onclick = noteListen;
  const ty = $('#ntype');
  if (ty) ty.onclick = () => { nt.draft = newDraft(nt.src, ''); drawAdd(); const el = $('#d-' + nt.src); if (el) el.focus(); };
  if (nt.draft) bindDraft();
}

function noteListen() {
  listenOnce({
    onstart: () => { nt.busy = true; nt.msg = ''; drawAdd(); },
    onresult: gotSpeech,
    onerror: (m) => { nt.msg = m + ' Speak clearly and a little closer, or tap "Type it instead".'; },
    onend: () => { nt.busy = false; drawAdd(); },
  }, langCode(nt.src));
}

function gotSpeech(alts, confs) {
  const src = nt.src;
  const text = tidy(alts[0] || '');
  if (!text) { nt.msg = "I didn't catch that. Try again."; return; }
  const conf = confs && typeof confs[0] === 'number' && confs[0] > 0 ? confs[0] : 1;
  const d = newDraft(src, text, { alts: alts.slice(1) });
  d.hint = scriptHint(src, text) || (conf < 0.6 ? 'I am not sure I heard that correctly. Check the text, or say it again.' : '');
  nt.draft = d;
  nt.msg = '';
  // if it sounds like something the app knows, say the suggestion out loud
  const near = suggestions(src, text, []);
  const say = near[0] || (conf < 0.6 && d.alts[0] ? tidy(d.alts[0]) : '');
  if (say) {
    sfxThen(false, () => speakSeq([{ text: 'Did you mean:', lang: 'en-US' }, { text: say, lang: langCode(src) }]));
  }
}

function draftHtml() {
  const d = nt.draft;
  const field = (side) => `
    <label class="nlab">${SIDE[side]}${d.src === side ? ' <small>(what you said)</small>' : ' <small>(meaning)</small>'}
      <div class="nrow"><input class="nin" id="d-${side}" lang="${side}" value="${esc(d[side])}" placeholder="${side === 'ru' ? 'Russian text' : 'English text'}" autocomplete="off"><button class="nhear" data-hear="${side}" aria-label="Listen" type="button">🔊</button></div>
    </label>`;
  return `
    <div class="draft">
      ${d.hint ? `<p class="nhint">${esc(d.hint)}</p>` : ''}
      ${field(d.src)}
      <div class="sugs" id="dsug"></div>
      ${field(other(d.src))}
      <div id="dgloss"></div>
      <div class="row2">
        <button class="btn alt" id="dtr">🌐 Translate online</button>
        <button class="btn" id="dsave">💾 ${d.editId ? 'Save changes' : 'Save note'}</button>
      </div>
      <button class="btn small" id="dcancel">Cancel</button>
    </div>`;
}

// the parts that change while you type: suggestions and word-by-word meanings
function refreshDraft() {
  const d = nt.draft;
  if (!d) return;
  const o = other(d.src);
  const el = $('#d-' + o);
  if (el && document.activeElement !== el) el.value = d[o];
  const sug = suggestions(d.src, d[d.src], d.alts);
  const box = $('#dsug');
  if (box) {
    box.innerHTML = sug.length ? `<p class="muted">Did you mean:</p><div class="chips">${sug.map((s, i) => `<button class="chip" data-s="${i}">${esc(s)}</button>`).join('')}</div>` : '';
    box.querySelectorAll('[data-s]').forEach((b) => {
      b.onclick = () => {
        d[d.src] = sug[+b.dataset.s];
        d.alts = [];
        d.hint = '';
        autoFill(d);
        const sEl = $('#d-' + d.src);
        if (sEl) sEl.value = d[d.src];
        refreshDraft();
        if (d.src === 'ru') speak(d.ru); else hearEn(d.en || d.src);
      };
    });
  }
  const g = $('#dgloss');
  if (g) {
    g.innerHTML = d.ru && lineWords(d.ru).length ? `<p class="muted" style="margin:10px 0 0">Word by word (tap a word to hear it):</p>${glossHtml(d.ru)}` : '';
    bindGloss(g);
  }
}

function bindDraft() {
  const d = nt.draft;
  ['ru', 'en'].forEach((side) => {
    const el = $('#d-' + side);
    el.oninput = () => {
      d[side] = el.value;
      if (side === d.src) autoFill(d);
      else d[side + 'Edited'] = el.value.trim() !== '';
      if (side !== d.src && !el.value.trim()) autoFill(d);
      refreshDraft();
    };
  });
  view.querySelectorAll('.nhear').forEach((b) => {
    b.onclick = () => {
      const side = b.dataset.hear;
      if (!d[side].trim()) { toast('Nothing to listen to yet.'); return; }
      if (side === 'ru') speak(d.ru); else hearEn(d.en);
    };
  });
  $('#dtr').onclick = async () => {
    const from = d.src, to = other(from);
    if (!d[from].trim()) { toast('Say or type something first.'); return; }
    const btn = $('#dtr');
    btn.disabled = true; btn.textContent = '🌐 Translating…';
    try {
      d[to] = await onlineTranslate(d[from], from, to);
      d[to + 'Edited'] = false;
      const el = $('#d-' + to); if (el) el.value = d[to];
      refreshDraft();
    } catch (e) {
      toast('Could not translate now. Check the internet, or type the meaning yourself.');
    }
    btn.disabled = false; btn.textContent = '🌐 Translate online';
  };
  $('#dsave').onclick = () => {
    const ru = tidy(d.ru), en = tidy(d.en);
    if (!ru && !en) { toast('Say or type something first.'); return; }
    if (d.editId) {
      const n = state.notes.find((x) => x.id === d.editId);
      if (n) { n.ru = ru; n.en = en; }
    } else {
      const dup = state.notes.some((n) => (ru && norm(n.ru) === norm(ru)) || (!ru && en && norm(n.en) === norm(en) && !n.ru));
      if (dup) { toast('That is already in your notes.'); return; }
      state.notes.push({ id: Date.now() + '' + Math.floor(Math.random() * 1000), ru, en, added: Date.now() });
    }
    save();
    noteActivity();
    nt.draft = null;
    renderNotes();
    toast('✔ Saved to your notes');
  };
  $('#dcancel').onclick = () => { nt.draft = null; nt.msg = ''; drawAdd(); };
  refreshDraft();
}

// ---------- the list of saved notes ----------
function noteCard(n) {
  const missing = n.ru && !n.en ? 'en' : !n.ru && n.en ? 'ru' : '';
  const snd = n.ru ? lineSound(n.ru) : '';
  return `
    <article class="card note" data-id="${esc(n.id)}">
      <div class="nhead"><span class="ntag">${isSentence(n) ? 'Sentence' : 'Word'}</span><button class="nx" data-del aria-label="Delete note">🗑</button></div>
      ${n.ru ? `<div class="nru">${esc(n.ru)}</div>${snd ? `<div class="nsnd">${esc(snd)}</div>` : ''}` : ''}
      <div class="nen ${n.en ? '' : 'none'}">${n.en ? esc(n.en) : 'No meaning saved yet'}</div>
      <div class="chips">
        ${n.ru ? '<button class="chip" data-hru>🔊 Russian</button>' : ''}
        ${n.en ? '<button class="chip" data-hen>🔊 English</button>' : ''}
        ${n.ru ? '<button class="chip" data-prac>🎤 Practise</button>' : ''}
        ${missing ? `<button class="chip" data-tr>🌐 ${missing === 'en' ? 'Get meaning' : 'Get Russian'}</button>` : ''}
        <button class="chip" data-edit>✏️ Edit</button>
      </div>
      ${n.ru && lineWords(n.ru).length ? `<details><summary>Word by word</summary>${glossHtml(n.ru)}</details>` : ''}
      <div class="mic-slot"></div>
    </article>`;
}

function drawList() {
  const box = $('#nlist');
  if (!box) return;
  const q = norm(nt.q);
  const list = state.notes.slice().sort((a, b) => b.added - a.added).filter((n) => {
    if (nt.filter === 'word' && isSentence(n)) return false;
    if (nt.filter === 'sentence' && !isSentence(n)) return false;
    return !q || norm(n.ru).includes(q) || norm(n.en).includes(q);
  });
  box.innerHTML = list.length
    ? list.map(noteCard).join('')
    : `<p class="muted center">${state.notes.length ? 'No notes match.' : 'No notes yet. Tap the microphone above and say your first word or sentence.'}</p>`;
  bindGloss(box);
  box.querySelectorAll('.note').forEach((card) => {
    const n = state.notes.find((x) => x.id === card.dataset.id);
    if (!n) return;
    const on = (sel, fn) => { const el = card.querySelector(sel); if (el) el.onclick = fn; };
    on('[data-hru]', () => speak(n.ru));
    on('[data-hen]', () => hearEn(n.en));
    on('[data-prac]', () => {
      micMemo = {};
      mountMic(card.querySelector('.mic-slot'), n.ru, '', 'Say it in Russian');
      const b = card.querySelector('.mic-slot button.mic');
      if (b) b.click();
    });
    on('[data-tr]', async () => {
      const from = n.ru ? 'ru' : 'en', to = other(from);
      const b = card.querySelector('[data-tr]');
      b.disabled = true; b.textContent = '🌐 …';
      try { n[to] = await onlineTranslate(n[from], from, to); save(); drawList(); }
      catch (e) { b.disabled = false; b.textContent = '🌐 Try again'; toast('Could not translate now. Check the internet.'); }
    });
    on('[data-edit]', () => {
      nt.src = n.ru ? 'ru' : 'en';
      nt.draft = newDraft(nt.src, null, { ru: n.ru, en: n.en, ruEdited: true, enEdited: true, editId: n.id });
      nt.msg = '';
      drawAdd();
      window.scrollTo(0, 0);
    });
    on('[data-del]', () => {
      if (!confirm('Delete this note?')) return;
      state.notes = state.notes.filter((x) => x.id !== n.id);
      save();
      drawList();
      const hp = document.querySelector('.lvpct'); if (hp) hp.textContent = state.notes.length;
    });
  });
}

// ---------- start ----------
$('#notesbtn').onclick = () => go('notes');
go('home'); // redraw Home now that the notes are loaded
