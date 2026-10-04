// The message area: one line fixed to the bottom of the window.
// A result clears itself, work under way stays until the next message, and a failure stays until it is dismissed.

import { $ } from './state';

/** How long a result stays, in ms: on its own, and when it carries an action such as Undo. */
const STAY = 5000;
const STAY_WITH_ACTION = 10000;

/** A button beside a message, such as Try again or Undo. */
export interface Action {
  label: string;
  run: () => void;
}
type Kind = 'result' | 'progress' | 'failure';

let timer = 0;
/** How long the message on screen stays, in ms. 0: it does not clear itself. */
let stay = 0;
let action: Action | null = null;
/** Whether the pointer is over the area, and whether focus is inside it. The clock does not run while either is true. */
let pointerOver = false;
let focusInside = false;

function startClock(): void {
  clearTimeout(timer);
  timer = stay && !pointerOver && !focusInside ? window.setTimeout(() => clearMessage(), stay) : 0;
}

/**
 * Show or hide one of the area's buttons. Focus is taken off a button before it is hidden:
 * an engine may send no focusout for a focused button that stops being drawn, and `focusInside` would then stay true.
 */
function setHidden(b: HTMLElement, hidden: boolean): void {
  if (hidden && b === document.activeElement) b.blur();
  b.hidden = hidden;
}

function show(kind: Kind, text: string, act?: Action): void {
  if (!text) return clearMessage();
  action = act ?? null;
  stay = kind === 'result' ? (act ? STAY_WITH_ACTION : STAY) : 0;
  $('status').textContent = text;
  $('msg').classList.add('on');
  $('msg').classList.toggle('fail', kind === 'failure');
  const ab = $('msg-act');
  setHidden(ab, !act);
  ab.textContent = act ? act.label : '';
  setHidden($('msg-x'), kind !== 'failure');
  startClock();
}

/** Something finished. The message clears itself. */
export const say = (text: string, act?: Action) => show('result', text, act);
/** Work is under way. The message stays until the next one. */
export const progress = (text: string) => show('progress', text);
/** Something failed. The message stays until it is dismissed, or until `clearMessage` is called for it. */
export const fail = (text: string, act?: Action) => show('failure', text, act);

/**
 * Clear the message. With a prefix, only a message that starts with it:
 * a request that succeeds clears its own earlier failure and leaves any other message alone.
 */
export function clearMessage(prefix = ''): void {
  const st = $('status');
  if (prefix && !st.textContent?.startsWith(prefix)) return;
  clearTimeout(timer);
  timer = 0;
  stay = 0;
  action = null;
  // a cleared area stops receiving pointer events, so its pointerleave may never come
  pointerOver = false;
  st.textContent = '';
  $('msg').classList.remove('on', 'fail');
  setHidden($('msg-act'), true);
  setHidden($('msg-x'), true);
}

/** Wire the message area's buttons, and hold its clock while the pointer is over it or focus is inside it, for any message. */
export function wireMessages(): void {
  const box = $('msg');
  $('msg-x').addEventListener('click', () => clearMessage());
  $('msg-act').addEventListener('click', () => {
    const a = action;
    clearMessage();
    a?.run();
  });
  const track = (set: () => void) => () => {
    set();
    startClock();
  };
  box.addEventListener(
    'pointerenter',
    track(() => (pointerOver = true)),
  );
  box.addEventListener(
    'pointerleave',
    track(() => (pointerOver = false)),
  );
  box.addEventListener(
    'focusin',
    track(() => (focusInside = true)),
  );
  box.addEventListener(
    'focusout',
    track(() => (focusInside = false)),
  );
}
