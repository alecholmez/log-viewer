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

function startClock(): void {
  clearTimeout(timer);
  timer = stay ? window.setTimeout(() => clearMessage(), stay) : 0;
}

function show(kind: Kind, text: string, act?: Action): void {
  if (!text) return clearMessage();
  action = act ?? null;
  stay = kind === 'result' ? (act ? STAY_WITH_ACTION : STAY) : 0;
  $('status').textContent = text;
  $('msg').classList.add('on');
  $('msg').classList.toggle('fail', kind === 'failure');
  const ab = $('msg-act');
  ab.hidden = !act;
  ab.textContent = act ? act.label : '';
  $('msg-x').hidden = kind !== 'failure';
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
  st.textContent = '';
  $('msg').classList.remove('on', 'fail');
  $('msg-act').hidden = true;
  $('msg-x').hidden = true;
}

/** Wire the message area's buttons, and stop its clock while the pointer or the focus is on it. */
export function wireMessages(): void {
  const box = $('msg');
  $('msg-x').addEventListener('click', () => clearMessage());
  $('msg-act').addEventListener('click', () => {
    const a = action;
    clearMessage();
    a?.run();
  });
  const hold = () => clearTimeout(timer);
  box.addEventListener('pointerenter', hold);
  box.addEventListener('focusin', hold);
  box.addEventListener('pointerleave', startClock);
  box.addEventListener('focusout', startClock);
}
