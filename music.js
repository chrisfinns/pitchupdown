// Shared music helpers: difficulty levels and note naming.

export const LEVELS = [
  { short: '½', unit: 'step', name: 'Half step', cents: 100 },
  { short: '¼', unit: 'tone', name: 'Quarter tone', cents: 50 },
  { short: '⅛', unit: 'tone', name: 'Eighth tone', cents: 25 },
  { short: '1/16', unit: 'tone', name: 'Sixteenth tone', cents: 12.5 },
  { short: '1/32', unit: 'tone', name: 'Thirty-second tone', cents: 6.25 },
];

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

// Name of a piano key from an integer MIDI number, e.g. 42 -> "F♯2".
export const keyName = (n) => NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);

// Name of any pitch, with its offset from the nearest key: "F♯2 −12¢".
export function noteName(m) {
  const n = Math.round(m);
  const cents = Math.round((m - n) * 100);
  if (cents === 0) return keyName(n);
  return `${keyName(n)} ${cents > 0 ? '+' : '−'}${Math.abs(cents)}¢`;
}

export const fmtCents = (c) => `${+c.toFixed(2)}¢`;
