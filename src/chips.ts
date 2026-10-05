// The chips under the readout cards: one for each switch and each state that changes in the span on screen, read at the playhead.
// The core decides which channels they are, their order, the limits and where each changes; this module reads that answer
// at a time and draws it. No samples are read here.

import { $, S, chipsKey, el, fmt, replaySpan } from './state';
import type { Chips, StateRow, SwitchRow } from './types';

/** One chip: a switch or a state from the core's answer. */
export type Chip = { kind: 'switch'; row: SwitchRow } | { kind: 'state'; row: StateRow };

/** The chips in S.chips, only when they are for the log and span on screen. Everything that shows or reads chips goes through here. */
export const shownChips = (): Chips | null => (S.chips && S.focus && S.chipsFor === chipsKey(S.focus) ? S.chips : null);

/** Switches first, then states, each in the core's order: first change in the span. */
export const chipList = (c: Chips | null): Chip[] =>
  c
    ? [...c.switches.rows.map((row): Chip => ({ kind: 'switch', row })), ...c.states.rows.map((row): Chip => ({ kind: 'state', row }))]
    : [];

/**
 * Whether t is inside a stretch [start, end]. A stretch ends where the next begins, so its end belongs to the next;
 * one that ends where the span ends keeps that end.
 */
const inside = (s: readonly number[], t: number, spanEnd: number) => s[0] <= t && (t < s[1] || (t === s[1] && t === spanEnd));

/** What a chip reads at time t: On, Off, a state's value, or – where the channel has no samples. */
export function chipText(chip: Chip, t: number, spanEnd: number): string {
  if (chip.row.gaps.some(g => inside(g, t, spanEnd))) return '–';
  if (chip.kind === 'switch') return chip.row.on.some(s => inside(s, t, spanEnd)) ? 'On' : 'Off';
  // the last section that starts at or before t; before the first one, the nearest: the first
  const secs = chip.row.sections;
  let v = secs.length ? secs[0][2] : NaN;
  for (const s of secs) if (s[0] <= t) v = s[2];
  return fmt(v);
}

/** The answer the chips on screen were built from, and whether the box was holding its height for an answer on its way. */
let built: Chips | null = null;
let held = false;
/** The chips on screen, in the order of chipList, each with the element its reading goes in. */
let shown: { chip: Chip; box: HTMLButtonElement; vl: HTMLElement }[] = [];

/** Build the chips for an answer. `hold`: an answer is on its way, so the box keeps its height and the traces under it stay put. */
function renderChips(c: Chips | null, hold: boolean): void {
  const box = $('chips');
  box.style.minHeight = hold && !box.hidden ? box.offsetHeight + 'px' : '';
  box.textContent = '';
  shown = [];
  built = c;
  held = hold;
  for (const chip of chipList(c)) {
    const b = el('button', 'chip');
    b.type = 'button';
    if (chip.kind === 'switch') {
      b.appendChild(el('span', 'dot')).setAttribute('aria-hidden', 'true');
      if (chip.row.also.length) b.title = 'Also logged as ' + chip.row.also.join(', ');
    }
    b.appendChild(el('span', 'nm', chip.row.name));
    const vl = b.appendChild(el('b', 'vl', '–'));
    box.appendChild(b);
    shown.push({ chip, box: b, vl });
  }
  box.hidden = !shown.length && !box.style.minHeight;
}

/** Bring the chips up to date: rebuilt when the answer changes, then each reads the playhead. Runs on every draw. */
export function updateChips(): void {
  const c = shownChips();
  const hold = !c && S.chipsShow && !!S.focus;
  if (c !== built || hold !== held) renderChips(c, hold);
  const f = S.focus;
  if (!f) return;
  const spanEnd = replaySpan(f)[1];
  for (const s of shown) {
    const txt = chipText(s.chip, S.t, spanEnd);
    if (s.vl.textContent !== txt) s.vl.textContent = txt;
    if (s.chip.kind === 'switch') s.box.classList.toggle('on', txt === 'On');
  }
}

/** What the note under the traces says about chips left out by the core's limits. */
export function chipsNote(): string {
  const c = shownChips();
  const more = c ? c.switches.more + c.states.more : 0;
  if (!more) return '';
  return ' ' + more + (more === 1 ? ' more changes in this span and is not shown.' : ' more change in this span and are not shown.');
}
