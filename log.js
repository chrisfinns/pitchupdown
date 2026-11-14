// Answer log: records every answer and finds the notes you keep missing.
// Stored in this browser only (localStorage).

import { LEVELS, keyName, noteName, fmtCents } from './music.js';

const KEY = 'pitchupdown.log.v1';
const MAX = 5000;          // keep the most recent answers
const MIN_TRIES = 5;       // a note needs this many tries before it can be flagged
const Z = 1.2816;          // 90% one-sided confidence for the "clearly below" test
const LOUD_DIFF = 0.15;    // velocity gap that counts as "louder" / "softer"

let cache = null;

export function entries() {
  if (!cache) {
    try { cache = JSON.parse(localStorage.getItem(KEY)) || []; } catch { cache = []; }
    if (!Array.isArray(cache)) cache = [];
  }
  return cache;
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* storage unavailable or full */ }
}

const r3 = (x) => Math.round(x * 1000) / 1000;

/** Record one answered trial. */
export function record(trial, answer) {
  const list = entries();
  list.push({
    t: Date.now(),
    l: LEVELS.findIndex((lv) => lv.cents === trial.cents),
    c: trial.cents,
    m1: r3(trial.m1),
    d: trial.dir,
    a: answer,
    v1: r3(trial.v1),
    v2: r3(trial.v2),
  });
  if (list.length > MAX) list.splice(0, list.length - MAX);
  persist();
}

export function clear() {
  cache = [];
  persist();
}

const m2Of = (e) => e.m1 + (e.d * e.c) / 100;
const ok = (e) => e.a === e.d;

function filter(list, level, period) {
  let since = 0;
  if (period === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); since = d.getTime(); }
  else if (period !== 'all') since = Date.now() - Number(period) * 86400000;
  return list.filter((e) => e.t >= since && (level === 'all' || e.l === Number(level)));
}

function tally(list) {
  const n = list.length;
  const c = list.reduce((s, e) => s + (ok(e) ? 1 : 0), 0);
  return { n, c, acc: n ? c / n : 0 };
}

// Upper end of the Wilson score interval for c successes out of n.
function wilsonUpper(c, n) {
  const p = c / n, z2 = Z * Z;
  return (p + z2 / (2 * n) + Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

function analyze(list) {
  // Your accuracy per level is the baseline: a note tested mostly at hard levels
  // should be compared with what you score at those levels.
  const overall = tally(list).acc;
  const levelAcc = LEVELS.map((_, i) => {
    const t = tally(list.filter((e) => e.l === i));
    return t.n ? t.acc : overall;
  });

  const notes = new Map();
  for (const e of list) {
    const k = Math.round(e.m1);
    if (!notes.has(k)) notes.set(k, { midi: k, n: 0, c: 0, exp: 0, missUp: 0, missDown: 0 });
    const s = notes.get(k);
    s.n++;
    s.exp += levelAcc[e.l] ?? overall;
    if (ok(e)) s.c++;
    else if (e.d > 0) s.missUp++;
    else s.missDown++;
  }
  const rows = [...notes.values()].sort((a, b) => a.midi - b.midi);
  rows.forEach((r) => {
    r.acc = r.c / r.n;
    r.expected = r.exp / r.n;
    // Flag only when the note is clearly below your usual accuracy, not just unlucky.
    r.trouble = r.n >= MIN_TRIES && wilsonUpper(r.c, r.n) < r.expected;
  });
  const trouble = rows.filter((r) => r.trouble).sort((a, b) => (a.acc - a.expected) - (b.acc - b.expected));

  const patterns = [
    ['Went up', list.filter((e) => e.d > 0)],
    ['Went down', list.filter((e) => e.d < 0)],
    ['Low · C2–G♯2', list.filter((e) => Math.round(e.m1) < 45)],
    ['Middle · A2–B3', list.filter((e) => Math.round(e.m1) >= 45 && Math.round(e.m1) < 60)],
    ['High · C4 and up', list.filter((e) => Math.round(e.m1) >= 60)],
    ['2nd note louder', list.filter((e) => e.v2 - e.v1 > LOUD_DIFF)],
    ['2nd note softer', list.filter((e) => e.v1 - e.v2 > LOUD_DIFF)],
  ].map(([label, l]) => ({ label, ...tally(l) }));

  const levels = LEVELS.map((lv, i) => ({ label: `${lv.name} · ${fmtCents(lv.cents)}`, ...tally(list.filter((e) => e.l === i)) }));

  return { total: tally(list), rows, trouble, patterns, levels };
}

// ---------- rendering ----------

const pct = (x) => `${Math.round(x * 100)}%`;
const WARN = '<svg class="warn" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18h.01"/></svg>';

function bar(acc, n, c, flagged) {
  return `<span class="abar${flagged ? ' flag' : ''}" title="${c} of ${n} correct" role="img" aria-label="${pct(acc)} correct">`
    + `<span class="abar-fill" style="width:${(acc * 100).toFixed(1)}%"></span><span class="abar-chance"></span></span>`;
}

function statRows(items) {
  return items.filter((p) => p.n > 0).map((p) => `
    <div class="prow">
      <span class="prow-label">${p.label}</span>
      ${bar(p.acc, p.n, p.c, false)}
      <span class="prow-val">${pct(p.acc)} <small>(${p.n})</small></span>
    </div>`).join('');
}

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

export function renderLog(container, { level = 'all', period = 'all' } = {}) {
  const list = filter(entries(), level, period);
  if (!list.length) {
    container.innerHTML = `<p class="empty">${entries().length ? 'No answers match these filters.' : 'No answers logged yet. Play a few rounds and your mistakes will show up here.'}</p>`;
    return;
  }
  const a = analyze(list);

  const troubleHtml = a.trouble.length
    ? `<div class="chips">${a.trouble.map((r) => `
        <span class="chip">${WARN}<b>${keyName(r.midi)}</b> ${pct(r.acc)} <small>${r.c}/${r.n}</small></span>`).join('')}</div>`
    : `<p class="muted">No clear trouble notes yet. A note is flagged once it's clearly below your usual accuracy, which takes at least ${MIN_TRIES} tries on it.</p>`;

  const tableHtml = `
    <table class="ntable">
      <thead><tr><th>Note</th><th class="num">Tries</th><th>Correct</th><th class="num" title="Misses when it went up">Miss ↑</th><th class="num" title="Misses when it went down">Miss ↓</th></tr></thead>
      <tbody>${a.rows.map((r) => `
        <tr${r.trouble ? ' class="trouble"' : ''}>
          <td class="note">${keyName(r.midi)}${r.trouble ? ` ${WARN}<span class="sr">trouble note</span>` : ''}</td>
          <td class="num">${r.n}</td>
          <td><div class="accc">${bar(r.acc, r.n, r.c, r.trouble)}<span class="accv">${pct(r.acc)}</span></div></td>
          <td class="num">${r.missUp || '·'}</td>
          <td class="num">${r.missDown || '·'}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  const recentHtml = list.slice(-20).reverse().map((e) => {
    const good = ok(e);
    const when = new Date(e.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return `<li class="${good ? 'good' : 'bad'}">
      <span class="mark" aria-label="${good ? 'Correct' : 'Missed'}">${good ? '✓' : '✗'}</span>
      <span class="rnotes">${esc(noteName(e.m1))} → ${esc(noteName(m2Of(e)))}</span>
      <span class="rmeta">${e.d > 0 ? '↑' : '↓'} ${fmtCents(e.c)}${good ? '' : ` · you said ${e.a > 0 ? '↑' : '↓'}`}</span>
      <time>${when}</time>
    </li>`;
  }).join('');

  container.innerHTML = `
    <p class="summary"><b>${a.total.n}</b> answers · <b>${pct(a.total.acc)}</b> correct</p>

    <h3>Trouble notes</h3>
    ${troubleHtml}
    ${a.trouble.length ? '<p class="hint">Worst first, compared with your accuracy at the same levels.</p>' : ''}

    <h3>By starting note</h3>
    <p class="hint">The tick on each bar marks 50%, which is guessing.</p>
    ${tableHtml}

    <h3>Patterns</h3>
    <div class="prows">${statRows(a.patterns)}</div>
    ${level === 'all' ? `<h3>By level</h3><div class="prows">${statRows(a.levels)}</div>` : ''}

    <h3>Recent</h3>
    <ol class="recent">${recentHtml}</ol>`;
}

export function exportCSV() {
  const head = 'time,level,step_cents,direction,answer,correct,note1,note2,midi1,midi2,velocity1,velocity2';
  const rows = entries().map((e) => [
    new Date(e.t).toISOString(),
    LEVELS[e.l]?.name ?? '',
    e.c,
    e.d > 0 ? 'up' : 'down',
    e.a > 0 ? 'up' : 'down',
    ok(e) ? 1 : 0,
    `"${noteName(e.m1)}"`,
    `"${noteName(m2Of(e))}"`,
    e.m1,
    r3(m2Of(e)),
    e.v1,
    e.v2,
  ].join(','));
  const blob = new Blob([[head, ...rows].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pitchupdown-log-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
