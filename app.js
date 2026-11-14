import { Piano, midiToFreq, inharmonicity } from './audio.js';

const LEVELS = [
  { short: '½', unit: 'step', name: 'Half step', cents: 100 },
  { short: '¼', unit: 'tone', name: 'Quarter tone', cents: 50 },
  { short: '⅛', unit: 'tone', name: 'Eighth tone', cents: 25 },
  { short: '1/16', unit: 'tone', name: 'Sixteenth tone', cents: 12.5 },
  { short: '1/32', unit: 'tone', name: 'Thirty-second tone', cents: 6.25 },
];

const NOTE_DUR = 1.0;   // seconds each note sounds
const GAP = 0.3;        // silence between notes
const LEVEL_UP = 5;     // correct in a row to move up
const LEVEL_DOWN = 3;   // misses in a row to move down

// Start-pitch range (MIDI). Singable core A2–E5; optional low extension C2–G#2.
const CORE = [45, 76];
const LOW = [36, 45];
const LOW_CHANCE = 0.2;

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

const $ = (id) => document.getElementById(id);
const el = {
  levels: $('levels'), levelName: $('levelName'),
  play: $('play'), playLabel: $('playLabel'), replay: $('replay'),
  dot1: $('dot1'), dot2: $('dot2'),
  lower: $('lower'), higher: $('higher'),
  feedback: $('feedback'), detail: $('detail'),
  streak: $('streak'), best: $('best'), acc: $('acc'), pips: $('pips'), pipsLabel: $('pipsLabel'),
  optDyn: $('optDyn'), optLow: $('optLow'), optAuto: $('optAuto'),
};

// ---------- persistence (best effort) ----------
const STORE = 'pitchupdown.v1';
function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      level: state.level, best: state.best, perLevel: state.perLevel,
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
  streak: 0,
  runUp: 0,     // consecutive correct at this level
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
let piano = null;
function ensureAudio() {
  if (!ctx) {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* iOS mute switch */ }
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    piano = new Piano(ctx);
  }
  if (ctx.state !== 'running') ctx.resume();
}

// ---------- helpers ----------
const rand = (a, b) => a + Math.random() * (b - a);

function noteName(m) {
  const n = Math.round(m);
  const cents = Math.round((m - n) * 100);
  const name = NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
  if (cents === 0) return name;
  return `${name} ${cents > 0 ? '+' : '−'}${Math.abs(cents)}¢`;
}

const fmtCents = (c) => `${+c.toFixed(2)}¢`;

function newTrial() {
  const cents = LEVELS[state.level].cents;
  const [lo, hi] = el.optLow.checked && Math.random() < LOW_CHANCE ? LOW : CORE;
  const m1 = rand(lo, hi); // continuous: start pitch lands anywhere, off the keyboard grid
  const dir = Math.random() < 0.5 ? 1 : -1;
  const m2 = m1 + (dir * cents) / 100;
  const vary = el.optDyn.checked;
  const v1 = vary ? rand(0.3, 1) : 0.7;
  const v2 = vary ? rand(0.3, 1) : 0.7;
  return { m1, m2, dir, cents, v1, v2, B: inharmonicity(midiToFreq(m1)) };
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
function playTrial() {
  const t = state.trial;
  ensureAudio();
  clearTimers();
  piano.stopAll();

  const start = ctx.currentTime + 0.08;
  const t2 = start + NOTE_DUR + GAP;
  piano.play(midiToFreq(t.m1), start, { velocity: t.v1, duration: NOTE_DUR, B: t.B });
  piano.play(midiToFreq(t.m2), t2, { velocity: t.v2, duration: NOTE_DUR, B: t.B });

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
  const rec = state.perLevel[state.level];
  rec.t++;
  if (ok) rec.c++;

  const actual = t.dir > 0 ? el.higher : el.lower;
  const chosen = dir > 0 ? el.higher : el.lower;
  actual.classList.add('right');
  if (!ok) chosen.classList.add('wrong');

  const moved = `${t.dir > 0 ? 'up' : 'down'} ${fmtCents(t.cents)}`;
  const detail = `${noteName(t.m1)} → ${noteName(t.m2)}`;

  let note = '';
  if (ok) {
    state.streak++;
    state.best = Math.max(state.best, state.streak);
    state.runUp++;
    state.runDown = 0;
    if (el.optAuto.checked && state.runUp >= LEVEL_UP && state.level < LEVELS.length - 1) {
      setLevel(state.level + 1);
      note = ` · Level up: ${LEVELS[state.level].name}`;
    }
    setFeedback('good', `Correct — it went ${moved}`, detail + note);
  } else {
    state.streak = 0;
    state.runUp = 0;
    state.runDown++;
    if (el.optAuto.checked && state.runDown >= LEVEL_DOWN && state.level > 0) {
      setLevel(state.level - 1);
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
  state.runUp = 0;
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
        piano?.stopAll();
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
  el.pips.innerHTML = auto
    ? Array.from({ length: LEVEL_UP }, (_, i) => `<i class="pip${i < state.runUp ? ' on' : ''}"></i>`).join('')
    : `<b>${rec.c}/${rec.t}</b>`;
  el.pipsLabel.textContent = auto ? 'To level up' : 'Correct';
}

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
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
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
    default:
      if (/^[1-5]$/.test(e.key)) el.levels.children[Number(e.key) - 1].click();
  }
});

buildLevels();
render();
