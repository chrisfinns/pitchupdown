import { SampledPiano, SynthPiano, prefetchSamples, keyFor, midiToFreq, inharmonicity } from './audio.js';
import { LEVELS, noteName, fmtCents } from './music.js';
import * as log from './log.js';

const NOTE_DUR = 1.0;   // seconds each note sounds
const GAP = 0.3;        // silence between notes
const LEVEL_UP = 50;    // level progress needed to move up (+1 per correct, −1 per miss)
const LEVEL_DOWN = 5;   // misses in a row to drop back a level
const REENTRY = 40;     // progress you return to on a level you dropped back to

// Start-pitch range (MIDI). Singable core A2–E5; optional low extension C2–G#2.
const CORE = [45, 76];
const LOW = [36, 45];
const LOW_CHANCE = 0.2;

const $ = (id) => document.getElementById(id);
const el = {
  levels: $('levels'), levelName: $('levelName'),
  play: $('play'), playLabel: $('playLabel'), replay: $('replay'),
  dot1: $('dot1'), dot2: $('dot2'),
  lower: $('lower'), higher: $('higher'),
  feedback: $('feedback'), detail: $('detail'),
  streak: $('streak'), best: $('best'), acc: $('acc'), prog: $('prog'), progLabel: $('progLabel'), pbarFill: $('pbarFill'),
  optDyn: $('optDyn'), optLow: $('optLow'), optAuto: $('optAuto'),
  logOpen: $('logOpen'), logDlg: $('logDlg'), logClose: $('logClose'), logBody: $('logBody'),
  logLevel: $('logLevel'), logPeriod: $('logPeriod'), logExport: $('logExport'), logClear: $('logClear'),
};

// ---------- persistence (best effort) ----------
const STORE = 'pitchupdown.v1';
function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      level: state.level, best: state.best, perLevel: state.perLevel, progress: state.progress,
      opts: { dyn: el.optDyn.checked, low: el.optLow.checked, auto: el.optAuto.checked },
    }));
  } catch { /* storage unavailable */ }
}

const saved = load();
const state = {
  level: Number.isInteger(saved.level) ? Math.min(Math.max(saved.level, 0), LEVELS.length - 1) : 0,
  best: saved.best || 0,
  perLevel: Array.isArray(saved.perLevel) && saved.perLevel.length === LEVELS.length
    ? saved.perLevel : LEVELS.map(() => ({ c: 0, t: 0 })),
  progress: Array.isArray(saved.progress) && saved.progress.length === LEVELS.length
    ? saved.progress.map((x) => Math.min(LEVEL_UP, Math.max(0, x | 0))) : LEVELS.map(() => 0),
  streak: 0,
  runDown: 0,   // consecutive misses at this level
  phase: 'idle', // idle | playing | awaiting | answered
  trial: null,
  timers: [],
};
if (saved.opts) {
  el.optDyn.checked = saved.opts.dyn !== false;
  el.optLow.checked = saved.opts.low !== false;
  el.optAuto.checked = saved.opts.auto !== false;
}

// ---------- audio ----------
let ctx = null;
let sampler = null;
let synth = null;     // fallback if samples can't load
let playToken = 0;
function ensureAudio() {
  if (!ctx) {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* iOS mute switch */ }
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    sampler = new SampledPiano(ctx);
  }
  if (ctx.state !== 'running') ctx.resume();
}
function stopSound() {
  sampler?.stopAll();
  synth?.stopAll();
}

// ---------- helpers ----------
const rand = (a, b) => a + Math.random() * (b - a);

function newTrial() {
  const cents = LEVELS[state.level].cents;
  const [lo, hi] = el.optLow.checked && Math.random() < LOW_CHANCE ? LOW : CORE;
  // Half steps start on real piano keys; finer levels start anywhere between keys.
  const m1 = cents >= 100 ? Math.round(rand(lo, hi)) : rand(lo, hi);
  const dir = Math.random() < 0.5 ? 1 : -1;
  const m2 = m1 + (dir * cents) / 100;
  const vary = el.optDyn.checked;
  const v1 = vary ? Math.random() : 0.6;
  const v2 = vary ? Math.random() : 0.6;
  return { m1, m2, dir, cents, v1, v2, key: keyFor(m1).midi, B: inharmonicity(midiToFreq(m1)) };
}

function clearTimers() {
  state.timers.forEach(clearTimeout);
  state.timers = [];
  el.dot1.classList.remove('on');
  el.dot2.classList.remove('on');
}

function at(seconds, fn) {
  state.timers.push(setTimeout(fn, Math.max(0, seconds * 1000)));
}

// ---------- flow ----------
async function playTrial() {
  const t = state.trial;
  const token = ++playToken;
  ensureAudio();
  clearTimers();
  stopSound();

  // Both notes use the sample key picked for the first note, so the interval is exact.
  const notes = [{ keyMidi: t.key, velocity: t.v1 }, { keyMidi: t.key, velocity: t.v2 }];
  let useSynth = false;
  const slow = setTimeout(() => { el.playLabel.textContent = 'Loading…'; }, 150);
  try {
    await sampler.load(notes);
  } catch (err) {
    console.warn('Piano samples unavailable, using synth:', err);
    useSynth = true;
  }
  clearTimeout(slow);
  if (token !== playToken || state.trial !== t) return; // superseded by a newer action
  render();
  if (useSynth) {
    synth ||= new SynthPiano(ctx);
    el.detail.textContent = 'Couldn’t load piano samples — using a synth piano.';
  }

  const start = ctx.currentTime + 0.08;
  const t2 = start + NOTE_DUR + GAP;
  if (useSynth) {
    synth.play(midiToFreq(t.m1), start, { velocity: 0.3 + 0.7 * t.v1, duration: NOTE_DUR, B: t.B });
    synth.play(midiToFreq(t.m2), t2, { velocity: 0.3 + 0.7 * t.v2, duration: NOTE_DUR, B: t.B });
  } else {
    sampler.play(t.m1, start, { velocity: t.v1, duration: NOTE_DUR, keyMidi: t.key });
    sampler.play(t.m2, t2, { velocity: t.v2, duration: NOTE_DUR, keyMidi: t.key });
  }

  const lead = start - ctx.currentTime;
  at(lead, () => el.dot1.classList.add('on'));
  at(lead + NOTE_DUR, () => el.dot1.classList.remove('on'));
  at(lead + NOTE_DUR + GAP, () => {
    el.dot2.classList.add('on');
    if (state.phase === 'playing') { state.phase = 'awaiting'; render(); }
  });
  at(lead + 2 * NOTE_DUR + GAP, () => el.dot2.classList.remove('on'));
}

function primary() {
  if (state.phase === 'idle' || state.phase === 'answered') {
    state.trial = newTrial();
    state.phase = 'playing';
    el.lower.classList.remove('right', 'wrong');
    el.higher.classList.remove('right', 'wrong');
    setFeedback('', '&nbsp;', '&nbsp;');
    playTrial();
    render();
  } else {
    playTrial(); // replay current pair
  }
}

function replay() {
  if (state.trial) playTrial();
}

function answer(dir) {
  if (state.phase !== 'awaiting') return; // answerable once the second note starts
  const t = state.trial;
  const ok = dir === t.dir;
  log.record(t, dir);
  const rec = state.perLevel[state.level];
  rec.t++;
  if (ok) rec.c++;

  const actual = t.dir > 0 ? el.higher : el.lower;
  const chosen = dir > 0 ? el.higher : el.lower;
  actual.classList.add('right');
  if (!ok) chosen.classList.add('wrong');

  const moved = `${t.dir > 0 ? 'up' : 'down'} ${t.cents >= 100 ? 'a half step' : fmtCents(t.cents)}`;
  const detail = `${noteName(t.m1)} → ${noteName(t.m2)}`;

  let note = '';
  if (ok) {
    state.streak++;
    state.best = Math.max(state.best, state.streak);
    state.runDown = 0;
    state.progress[state.level] = Math.min(LEVEL_UP, state.progress[state.level] + 1);
    if (el.optAuto.checked && state.progress[state.level] >= LEVEL_UP && state.level < LEVELS.length - 1) {
      setLevel(state.level + 1);
      note = ` · Level up: ${LEVELS[state.level].name}`;
    }
    setFeedback('good', `Correct — it went ${moved}`, detail + note);
  } else {
    state.streak = 0;
    state.runDown++;
    state.progress[state.level] = Math.max(0, state.progress[state.level] - 1);
    if (el.optAuto.checked && state.runDown >= LEVEL_DOWN && state.level > 0) {
      setLevel(state.level - 1);
      state.progress[state.level] = Math.min(state.progress[state.level], REENTRY);
      note = ` · Back to ${LEVELS[state.level].name}`;
    }
    setFeedback('bad', `Not quite — it went ${moved}`, detail + note);
  }
  state.phase = 'answered';
  save();
  render();
}

function setLevel(i) {
  if (i === state.level) return;
  state.level = i;
  state.runDown = 0;
  // A trial in progress keeps its interval; the new level applies from the next one.
  save();
}

function setFeedback(cls, html, detailHtml) {
  el.feedback.className = 'feedback' + (cls ? ' ' + cls : '');
  el.feedback.innerHTML = html || '&nbsp;';
  el.detail.innerHTML = detailHtml || '&nbsp;';
}

// ---------- render ----------
function buildLevels() {
  el.levels.innerHTML = '';
  LEVELS.forEach((lv, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.title = `${lv.name} (${fmtCents(lv.cents)})`;
    b.innerHTML = `${lv.short}<small>${fmtCents(lv.cents)}</small>`;
    b.addEventListener('click', () => {
      setLevel(i);
      if (state.phase === 'awaiting' || state.phase === 'playing') {
        // Switch immediately: drop the unanswered trial.
        stopSound();
        playToken++;
        clearTimers();
        state.phase = 'idle';
        state.trial = null;
        setFeedback('', '&nbsp;', '&nbsp;');
      }
      render();
    });
    el.levels.appendChild(b);
  });
}

function render() {
  const lv = LEVELS[state.level];
  [...el.levels.children].forEach((b, i) => {
    b.setAttribute('aria-checked', String(i === state.level));
    b.tabIndex = i === state.level ? 0 : -1;
  });
  el.levelName.textContent = `${lv.name} · ${fmtCents(lv.cents)}`;

  const p = state.phase;
  el.playLabel.textContent = p === 'idle' ? 'Play' : p === 'answered' ? 'Next' : 'Replay';
  el.play.setAttribute('aria-label', el.playLabel.textContent);
  el.replay.disabled = !state.trial;
  el.lower.disabled = el.higher.disabled = p !== 'awaiting';

  el.streak.textContent = state.streak;
  el.best.textContent = state.best;
  const rec = state.perLevel[state.level];
  el.acc.textContent = rec.t ? `${Math.round((100 * rec.c) / rec.t)}%` : '–';
  el.acc.title = `${rec.c} / ${rec.t} correct`;

  const auto = el.optAuto.checked && state.level < LEVELS.length - 1;
  const prog = state.progress[state.level];
  el.prog.innerHTML = auto ? `${prog}<small>/${LEVEL_UP}</small>` : `${rec.c}<small>/${rec.t}</small>`;
  el.progLabel.textContent = auto ? 'To level up' : 'Correct';
  el.pbarFill.style.width = auto ? `${(100 * prog) / LEVEL_UP}%` : `${rec.t ? (100 * rec.c) / rec.t : 0}%`;
  el.prog.parentElement.title = auto ? '+1 for each correct answer, −1 for each miss' : '';
}

// ---------- log ----------
function renderLog() {
  log.renderLog(el.logBody, { level: el.logLevel.value, period: el.logPeriod.value });
}
function openLog() {
  if (el.logDlg.open) return;
  renderLog();
  el.logDlg.showModal();
  el.logBody.scrollTop = 0;
}
el.logLevel.innerHTML = '<option value="all">All levels</option>'
  + LEVELS.map((lv, i) => `<option value="${i}">${lv.name} · ${fmtCents(lv.cents)}</option>`).join('');
el.logOpen.addEventListener('click', openLog);
el.logClose.addEventListener('click', () => el.logDlg.close());
el.logDlg.addEventListener('click', (e) => { if (e.target === el.logDlg) el.logDlg.close(); }); // backdrop
el.logLevel.addEventListener('change', renderLog);
el.logPeriod.addEventListener('change', renderLog);
el.logExport.addEventListener('click', () => log.exportCSV());
el.logClear.addEventListener('click', () => {
  const n = log.entries().length;
  if (n && confirm(`Delete all ${n} logged answers? This can't be undone.`)) { log.clear(); renderLog(); }
});

// ---------- input ----------
el.play.addEventListener('click', primary);
el.replay.addEventListener('click', replay);
el.lower.addEventListener('click', () => answer(-1));
el.higher.addEventListener('click', () => answer(1));
[el.optDyn, el.optLow, el.optAuto].forEach((o) => o.addEventListener('change', () => { save(); render(); }));

// After a mouse/touch click, drop focus so Space goes back to Play/Next.
document.addEventListener('click', (e) => {
  const b = e.target.closest('button, input');
  if (b && e.detail > 0) b.blur();
});

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || el.logDlg.open) return;
  const onControl = e.target.closest && e.target.closest('button, input');
  switch (e.key) {
    case ' ':
    case 'Enter':
      if (onControl) return; // native activation of the focused control
      e.preventDefault();
      primary();
      break;
    case 'ArrowUp': case 'k': case 'w':
      e.preventDefault(); answer(1); break;
    case 'ArrowDown': case 'j': case 's':
      e.preventDefault(); answer(-1); break;
    case 'r': case 'R':
      replay(); break;
    case 'l': case 'L':
      openLog(); break;
    default:
      if (/^[1-5]$/.test(e.key)) el.levels.children[Number(e.key) - 1].click();
  }
});

buildLevels();
render();
// Download samples in the background so the first Play is instant.
if ('requestIdleCallback' in window) requestIdleCallback(prefetchSamples, { timeout: 1500 });
else setTimeout(prefetchSamples, 300);
