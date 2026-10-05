// The app: loads the library from the core, renders the panels and wires the controls.

import { api, inTauri, isMobile, onLogsChanged, pickFolder } from './api';
import { atRunRpm, draw3d, drawDyno, drawTraces, dropTraceCache, dynoHover, refit, t3Hover, tableScale, trX, traceLayout } from './charts';
import { stepTarget, updateChips, wireChips } from './chips';
import { atRpm, buildLog, chanMeta, clamp, fixTable, valAt } from './data';
import { clearMessage, fail, progress, say, wireMessages } from './messages';
import {
  $,
  AZ0,
  CALC,
  CATALOG,
  DEFAULT_VIEW,
  EL0,
  LB,
  MODEL_DEFAULT,
  MODEL_FIELDS,
  ORD,
  RUN,
  S,
  SMOOTH_DEFAULT,
  SMOOTH_RPM,
  VEH_DEFAULT,
  VEH_IDS,
  chInfo,
  chipsKey,
  chipsWanted,
  copyView,
  css,
  curTable,
  curView,
  el,
  fmt,
  focusLog,
  focusPull,
  focusSpan,
  hideTip,
  inkOn,
  lengthLabel,
  logDefault,
  logName,
  pullDefault,
  pullName,
  replaySpan,
  resetTheme,
  series,
  showTip,
  theme,
} from './state';
import type { TipRow } from './state';
import type { DynoOut, Finding, Log, Occurrence, Pull, Settings, Sev, Table, TraceDef, Vehicle } from './types';

const input = (id: string) => $<HTMLInputElement>(id);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Bring a panel into view. The scroll is animated unless the system asks for reduced motion. */
const scrollTo = (id: string) =>
  $(id).scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });

// ---------- settings ----------

/** How each failure that offers Try again starts. The same request succeeding later clears a message that starts with it. */
const SETTINGS_FAILED = 'Settings were not saved: ';
const DYNO_FAILED = 'Power estimate failed: ';
const LIBRARY_FAILED = 'The library could not be opened: ';

let settingsReady = false;
let saveTimer = 0;

function collectSettings(): Settings {
  const veh: Record<string, string> = {};
  for (const k in VEH_IDS) veh[k] = vehOk[k];
  return {
    veh,
    model: S.model,
    speedSrc: S.speedSrc,
    smooth: S.smooth,
    views: S.views,
    viewName: S.viewName,
    working: S.rview,
    names: S.names,
    watchDir: S.watchDir,
    switches: S.chipsShow,
  };
}
function writeSettings(): void {
  api.setSettings(collectSettings()).then(
    () => clearMessage(SETTINGS_FAILED),
    e => fail(SETTINGS_FAILED + errText(e), { label: 'Try again', run: writeSettings }),
  );
}
function flushSettings(): void {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = 0;
  writeSettings();
}
/** Settings are written a moment after the last change, so typing in a field is one write. */
function saveSettings(): void {
  if (!settingsReady) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushSettings, 400);
}

// ---------- model ----------

/**
 * The last valid text of each vehicle field: the defaults until the saved settings arrive.
 * The estimate and the saved settings use these, never a value outside a field's range.
 */
const vehOk: Record<string, string> = Object.fromEntries(Object.entries(VEH_DEFAULT).map(([k, v]) => [k, String(v)]));

/** Whether a field's text is a value the estimate can use. A number field carries its range in the page; the others take any text. */
function fieldValid(inp: HTMLInputElement): boolean {
  if (inp.type !== 'number') return true;
  const v = parseFloat(inp.value);
  return v === v && v >= +inp.min && v <= +inp.max;
}

const plain = (s: string) => Number(s).toLocaleString('en-US', { maximumFractionDigits: 3 });

/**
 * Take a field's text if it is valid; otherwise keep the last valid one in use.
 * `tell` shows the line under a field that is not valid. It is false while the field is being typed in,
 * so the line does not appear on the way to a valid number; a line already showing stays until the value is valid.
 */
function checkField(k: string, tell: boolean): void {
  const inp = input(VEH_IDS[k]);
  const hintId = inp.id + '-hint';
  let hint = document.getElementById(hintId);
  if (fieldValid(inp)) {
    vehOk[k] = inp.value;
    hint?.remove();
    inp.removeAttribute('aria-invalid');
    inp.removeAttribute('aria-describedby');
    return;
  }
  if (!hint) {
    if (!tell) return;
    hint = el('p', 'field-hint');
    hint.id = hintId;
    inp.after(hint);
    inp.setAttribute('aria-invalid', 'true');
    inp.setAttribute('aria-describedby', hintId);
  }
  hint.textContent = 'Enter ' + plain(inp.min) + ' to ' + plain(inp.max) + '. Using ' + plain(vehOk[k]) + '.';
}

function readVeh(): Vehicle {
  const n = (k: string, d: number) => {
    const v = parseFloat(vehOk[k]);
    return v === v ? v : d;
  };
  const D = VEH_DEFAULT as Record<string, number>;
  return {
    mass: (n('curb', D.curb) + n('driver', 0)) * LB,
    unc: n('unc', 0) * LB,
    cda: n('cd', D.cd) * n('area', D.area) * 0.09290304,
    crr: n('crr', D.crr),
    ie: n('ie', D.ie),
    mrot: n('rot', 0) * LB,
    window: n('win', D.win),
    smooth: SMOOTH_RPM[S.smooth],
    tire: vehOk.tire,
    fd: n('fd', NaN),
    gears: vehOk.gears
      .split(/[,\s]+/)
      .map(Number)
      .filter(x => x > 0),
    speedSrc: S.speedSrc,
  };
}

/** Findings arrive with log keys; the UI wants the logs themselves. */
function attach(findings: Finding[]): Finding[] {
  const byKey = new Map(S.logs.map(l => [l.key, l]));
  for (const f of findings) {
    if (f.logKey) f.log = byKey.get(f.logKey);
    for (const o of f.occurrences || []) o.log = byKey.get(o.logKey);
  }
  return findings;
}

function leaveFinding(): void {
  if (!S.fview) return;
  S.fview = null;
  S.rev++;
  renderViewSel();
  syncPicker();
  renderReadouts();
}
/** Editing channels while a finding is shown turns the finding's channels into the working view. */
function adoptFinding(): void {
  if (!S.fview) return;
  S.rview = copyView(S.fview);
  S.fview = null;
}

/** Read the library from the core and rebuild everything that depends on it. */
async function reload(): Promise<void> {
  const metas = await api.logs();
  const have = new Map(S.logs.map(l => [l.key, l]));
  const logs: Log[] = [];
  for (const m of metas) logs.push(have.get(m.key) ?? buildLog(m, await api.logData(m.key)));
  const ov = await api.overview();
  const byKey = new Map(logs.map(l => [l.key, l]));

  S.logs = logs;
  S.pulls = ov.pulls.map(p => ({ ...p, log: byKey.get(p.logKey)! }));
  S.tables = { coarse: fixTable(ov.coarse), fine: fixTable(ov.fine) };
  S.findings = attach(ov.findings);
  S.pullRule = ov.pullRule;
  S.noPulls = new Map(ov.noPulls.map(r => [r.logKey, r.reason]));
  $('sub').textContent = logs.length
    ? logs.length +
      (logs.length === 1 ? ' log · ' : ' logs · ') +
      S.pulls.length +
      (S.pulls.length === 1 ? ' pull' : ' pulls') +
      (ov.ethanol !== null ? ' · E' + fmt(ov.ethanol) + ' on the flex sensor' : '')
    : 'No logs yet';

  // pulls are new objects after every reload: carry selections over by key
  const same = (p: Pull | null) => (p && S.pulls.find(q => q.key === p.key)) || null;
  S.runs = S.runs.map(same);
  if (S.focus && !byKey.has(S.focus.log.key)) {
    S.focus = null;
    S.fview = null;
  }
  if (S.focus) S.focus.pull = same(S.focus.pull);
  if (!S.runs[0] && S.pulls.length) {
    // start on the strongest pull, with another in the same gear beside it
    const byGain = S.pulls.slice().sort((x, y) => y.gain - x.gain);
    const best = byGain[0];
    const others = S.runs.slice(1).map(p => (p === best ? null : p));
    if (!others[0] && !others[1]) others[0] = byGain.find(p => p !== best && p.gear === best.gear) || null;
    S.runs = [best, ...others];
    leaveFinding();
    focusPull(best);
  }
  if (!S.focus && S.logs.length) {
    // the replayed log is gone: the replay shows run A, which opens no log the person left closed
    if (S.runs[0]) focusPull(S.runs[0]);
    else focusLog(S.logs[0]);
  }
  S.rev++;
  renderViewSel();
  buildPicker();
  renderLogs();
  buildGrid();
  await recompute();
}

function setRun(slot: number, p: Pull): void {
  if (S.runs[0] === p) return;
  const was = S.runs[slot] === p;
  S.runs = S.runs.map((q, i) => (i && q === p ? null : q));
  if (slot === 0) {
    leaveFinding();
    S.runs[0] = p;
    focusPull(p);
  } else S.runs[slot] = was ? null : p;
  renderLogs();
  void recompute();
}

let dynSeq = 0;
let dynKeys: (string | null)[] = [null, null, null];

/** Ask the core for the virtual dyno on the selected runs with the vehicle as entered. */
async function recompute(): Promise<void> {
  const v = (S.veh = readVeh());
  $('v-win-out').textContent = v.window.toFixed(2);
  saveSettings();
  const keys = S.runs.map(p => (p ? p.key : null));
  // a result for a different pull must not be shown against this one while the new result is on its way
  S.dyn = S.dyn.map((d, i) => (keys[i] === dynKeys[i] ? d : null));
  dynKeys = keys;
  const seq = ++dynSeq;
  let out: DynoOut;
  try {
    out = await api.dyno(v, keys);
  } catch (e) {
    // a request that a newer one has replaced does not report: its failure is not about what is on screen
    if (seq === dynSeq) fail(DYNO_FAILED + errText(e), { label: 'Try again', run: () => void recompute() });
    return;
  }
  if (seq !== dynSeq) return;
  clearMessage(DYNO_FAILED);
  S.dyn = out.runs;
  S.band = out.band;
  S.runFindings = attach(out.checks);
  S.rev++;
  renderStats();
  renderFindings();
  renderDynoTable();
  renderVehSum();
  renderReadouts();
  drawAll();
}

// ---------- logs and pulls ----------

/** The control in the log list with this `data-fid`, if the list has one: how focus finds its control again in a rebuilt list. */
function byFid(fid: string): HTMLElement | undefined {
  return [...$('logs').querySelectorAll<HTMLElement>('[data-fid]')].find(e => e.dataset.fid === fid);
}

/**
 * Put a name field in place of what `holder` holds. `from` is the Rename button the edit started from: the field takes its
 * `data-fid`, so when the list is rebuilt after the edit, focus goes back to that button. Leaving the field by Tab carries
 * focus on to the control it was going to.
 */
function startRename(
  holder: HTMLElement,
  current: string | undefined,
  fallback: string,
  commit: (v: string | null) => void,
  from: HTMLElement,
): void {
  const inp = el('input', 'rename');
  inp.type = 'text';
  inp.value = current || '';
  inp.placeholder = fallback;
  inp.setAttribute('aria-label', 'Name');
  if (from.dataset.fid) inp.dataset.fid = from.dataset.fid;
  holder.textContent = '';
  holder.appendChild(inp);
  inp.focus();
  inp.select();
  let done = false;
  const finish = (ok: boolean, next?: EventTarget | null) => {
    if (done) return;
    done = true;
    commit(ok ? inp.value.trim() : null);
    // leaving the field by Tab, or onto another control, rebuilt the list under the control focus was going to: it gets
    // focus again in the new list, found by its data-fid
    const fid = next instanceof HTMLElement ? next.dataset.fid : undefined;
    if (fid) byFid(fid)?.focus({ preventScroll: true });
  };
  inp.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    // the key is spent here: focus moves to the Rename button as the list is rebuilt, and the key must not press it
    e.preventDefault();
    finish(e.key === 'Enter');
  });
  inp.addEventListener('blur', e => finish(true, e.relatedTarget));
}

/** A text action in the list. `fid` names it, so that it gets focus back when the list is rebuilt. */
function linkBtn(label: string, fid: string, onClick: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = el('button', 'icon-btn', label);
  b.type = 'button';
  b.dataset.fid = fid;
  b.addEventListener('click', () => onClick(b));
  return b;
}

/**
 * A log was removed from place `at` in the list. Focus goes to the log that took its place, or to the one before it when it
 * was last, or to Add logs when none is left.
 */
function focusAfterRemoval(at: number): void {
  const next = S.logs[Math.min(at, S.logs.length - 1)];
  const control = next ? byFid((S.pulls.some(p => p.log === next) ? 'replay|' : 'open|') + next.key) : $('start-add');
  control?.focus({ preventScroll: true });
}

async function removeLog(log: Log): Promise<void> {
  try {
    const at = S.logs.indexOf(log);
    await api.removeLog(log.key);
    delete S.names.logs[log.key];
    for (const p of S.pulls) if (p.log === log) delete S.names.pulls[p.key];
    await reload();
    // the control that had focus went with the log
    focusAfterRemoval(at);
    say('Removed ' + log.name + ' from the library. The original file is untouched.');
  } catch (e) {
    fail(errText(e));
  }
}

/** Logs with no pull that are open, by key. Not saved: every launch starts with them closed. */
const openLogs = new Set<string>();
/** The key of the log the replay showed when the list last looked, so a log opens once when the replay comes to it. */
let replayedLog = '';

/**
 * Bring the list in line with what is open. The log the replay has come to opens, so its actions are at hand; the person
 * can close it again. Each log with no pull is shown open or closed in place, so a button that has focus keeps it.
 */
function syncLogs(): void {
  const key = S.focus ? S.focus.log.key : '';
  if (key !== replayedLog) {
    replayedLog = key;
    if (key) openLogs.add(key);
  }
  document.querySelectorAll<HTMLButtonElement>('#logs .log-toggle').forEach(b => {
    const open = openLogs.has(b.dataset.key!);
    b.setAttribute('aria-expanded', String(open));
    b.querySelector<HTMLElement>('.meta')!.hidden = open;
    $(b.getAttribute('aria-controls')!).hidden = !open;
  });
}

/** Replay, Rename and Remove for a log. Rename puts the name field in `holder`, in place of the title. */
function logActions(log: Log, holder: HTMLElement): HTMLElement {
  const acts = el('div', 'links');
  acts.appendChild(
    linkBtn('Replay', 'replay|' + log.key, () => {
      leaveFinding();
      focusLog(log);
      renderStats();
      drawAll();
      scrollTo('replay-panel');
    }),
  );
  acts.appendChild(
    linkBtn('Rename', 'rename|' + log.key, b =>
      // renaming starts from the log's name, or from its date and time; leaving that, or nothing, keeps no name
      startRename(
        holder,
        logName(log),
        logDefault(log),
        v => {
          if (v !== null) {
            if (v && v !== logDefault(log)) S.names.logs[log.key] = v;
            else delete S.names.logs[log.key];
            saveSettings();
          }
          renderLogs();
          renderStats();
        },
        b,
      ),
    ),
  );
  // removing takes two clicks: the first arms the button for a few seconds
  acts.appendChild(
    linkBtn('Remove', 'remove|' + log.key, b => {
      if (b.dataset.armed) return void removeLog(log);
      b.dataset.armed = '1';
      b.textContent = 'Confirm';
      window.setTimeout(() => {
        delete b.dataset.armed;
        b.textContent = 'Remove';
      }, 3000);
    }),
  );
  return acts;
}

/** What any log shows under its title: its length (after its date and time when the person named it), its actions, and its file name. */
function logHead(log: Log, txt: HTMLElement, holder: HTMLElement): HTMLElement {
  const head = el('div', 'log-head');
  txt.appendChild(el('div', 'meta', (S.names.logs[log.key] ? logDefault(log) + ' · ' : '') + lengthLabel(log.duration)));
  head.appendChild(txt);
  head.appendChild(logActions(log, holder));
  // the file name on its own line, unless the log is titled by it
  if (log.startedAt) {
    const file = el('div', 'file', log.name);
    file.title = log.name;
    head.appendChild(file);
  }
  return head;
}

/**
 * One pull: its name, its gear and RPM range under it when the person named it, then two lines of facts that never wrap,
 * when and how long and then the load; at the right A, B and C, with Rename under them.
 */
function pullRow(p: Pull): HTMLLIElement {
  const slot = S.runs.indexOf(p);
  const row = el('li', 'pull' + (slot >= 0 ? ' on' : ''));
  const txt = el('div', 'pull-text');
  const pt = el('div', 'ttl', pullName(p));
  txt.appendChild(pt);
  // a pull the person named keeps its gear and RPM range under the name
  if (S.names.pulls[p.key]) txt.appendChild(el('div', 'meta fact', pullDefault(p)));
  // a fact the log does not have is left out with its separator, and a line with nothing on it is not drawn
  const line = (facts: (string | null)[]) => {
    const text = facts.filter(f => f !== null).join(' · ');
    if (text) txt.appendChild(el('div', 'meta fact', text));
  };
  const known = (v: number | null): v is number => v !== null && v === v;
  line(['at ' + p.t0.toFixed(1) + ' s', p.dur.toFixed(1) + ' s']);
  line([known(p.peakPedal) ? 'accelerator ' + fmt(p.peakPedal) + '%' : null, known(p.peakMap) ? fmt(p.peakMap) + ' kPa' : null]);
  const side = el('div', 'pull-side');
  const ab = el('div', 'ab');
  RUN.forEach((nm, i) => {
    const b = el('button', 'r' + i, nm);
    b.type = 'button';
    b.dataset.fid = 'run' + i + '|' + p.key;
    b.setAttribute('aria-pressed', String(slot === i));
    b.setAttribute('aria-label', i ? 'Overlay as run ' + nm : 'Replay as run A');
    if (i && slot === 0) b.disabled = true;
    b.addEventListener('click', () => setRun(i, p));
    ab.appendChild(b);
  });
  side.appendChild(ab);
  side.appendChild(
    linkBtn('Rename', 'rename|' + p.key, b =>
      startRename(
        pt,
        S.names.pulls[p.key],
        pullDefault(p),
        v => {
          if (v !== null) {
            if (v) S.names.pulls[p.key] = v;
            else delete S.names.pulls[p.key];
            saveSettings();
          }
          if (S.focus && S.focus.pull === p) S.focus.label = pullName(p) + ' · ' + logName(p.log);
          renderLogs();
          renderStats();
        },
        b,
      ),
    ),
  );
  row.appendChild(txt);
  row.appendChild(side);
  return row;
}

function renderLogs(): void {
  const ol = $('logs');
  // the list is rebuilt from scratch: a control in it that has focus gets focus back in the new list, found by its data-fid
  const had = ol.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.fid : undefined;
  ol.textContent = '';
  // an empty library shows one panel that says how to start, in place of the charts
  document.querySelector('.app')!.classList.toggle('no-logs', !S.logs.length);
  $('start').hidden = S.logs.length > 0;
  // what a pull is: one line under the panel title while the library has logs
  $('pull-rule').textContent = S.pullRule;
  $('pull-rule').hidden = !S.logs.length;
  if (!S.logs.length) {
    const li = el('li', 'empty');
    li.appendChild(el('p', '', 'Logs you add are listed here.'));
    ol.appendChild(li);
    return;
  }
  S.logs.forEach((log, n) => {
    const li = el('li', 'log');
    const pulls = S.pulls.filter(p => p.log === log).sort((a, b) => a.t0 - b.t0);
    if (pulls.length) {
      // a log with pulls is always open: its lines, then its pulls
      const txt = el('div', 'log-text');
      const ttl = el('div', 'ttl', logName(log));
      txt.appendChild(ttl);
      li.appendChild(logHead(log, txt, ttl));
      const pl = el('ol', 'pulls');
      for (const p of pulls) pl.appendChild(pullRow(p));
      li.appendChild(pl);
    } else {
      // a log with no pull is one line, the title, the length and "No pulls", until it is opened; the whole line is the button
      const holder = el('div', 'log-title');
      const toggle = el('button', 'log-toggle');
      toggle.type = 'button';
      toggle.dataset.key = log.key;
      toggle.dataset.fid = 'open|' + log.key;
      // the file name, which tells apart two logs from the same minute and is the whole name of a log with no date
      toggle.title = log.name;
      toggle.setAttribute('aria-controls', 'log-more-' + n);
      toggle.appendChild(el('span', 'ttl', logName(log)));
      toggle.appendChild(el('span', 'meta', lengthLabel(log.duration) + ' · No pulls'));
      toggle.addEventListener('click', () => {
        if (!openLogs.delete(log.key)) openLogs.add(log.key);
        syncLogs();
      });
      holder.appendChild(toggle);
      li.appendChild(holder);
      const more = el('div', 'log-more');
      more.id = 'log-more-' + n;
      more.appendChild(logHead(log, el('div', 'log-text'), holder));
      more.appendChild(el('p', 'meta why', S.noPulls.get(log.key) ?? ''));
      li.appendChild(more);
    }
    ol.appendChild(li);
  });
  syncLogs();
  if (had) byFid(had)?.focus({ preventScroll: true });
}

/**
 * Scroll the list so run A's pull is in view: the list's own box only, never the page, and without animation. Nothing
 * when there is no run A. The box is the rail beside the charts, or the list itself in one column.
 */
function showRunA(): void {
  const p = S.runs[0];
  const row = p && byFid('run0|' + p.key)?.closest('.pull');
  let box = row ? row.parentElement : null;
  while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
  if (!row || !box) return;
  const r = row.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  // the part of the box on screen: the rail can reach below the window until the page scrolls
  const top = Math.max(b.top, 0);
  const bottom = Math.min(b.bottom, window.innerHeight);
  if (r.bottom > bottom) box.scrollTop += r.bottom - bottom + 12;
  else if (r.top < top) box.scrollTop -= top - r.top + 12;
}

// ---------- stats, legend, findings ----------

function renderStats(): void {
  const st = $('stats');
  const lg = $('legend');
  st.textContent = '';
  lg.textContent = '';
  S.runs.forEach((p, r) => {
    const d = S.dyn[r];
    if (!p || !d || !d.peakHp || !d.peakTq) return;
    const s = el('div', 'stat');
    const who = el('div', 'who');
    const nums = el('div', 'nums');
    who.appendChild(el('span', 'key r' + r));
    who.appendChild(document.createTextNode('Run ' + RUN[r] + ' · ' + pullName(p) + ' · ' + logName(p.log)));
    const b1 = el('span', 'big', fmt(d.peakHp.hp));
    b1.appendChild(el('small', '', 'whp'));
    const b2 = el('span', 'big', fmt(d.peakTq.tq));
    b2.appendChild(el('small', '', 'lb-ft'));
    nums.appendChild(b1);
    nums.appendChild(el('span', 'at', 'at ' + fmt(Math.round(d.peakHp.rpm / 10) * 10)));
    nums.appendChild(b2);
    nums.appendChild(el('span', 'at', 'at ' + fmt(Math.round(d.peakTq.rpm / 10) * 10) + ' rpm'));
    s.appendChild(who);
    s.appendChild(nums);
    st.appendChild(s);
  });
  const item = (cls: string, text: string) => {
    const s = el('span');
    s.appendChild(el('span', 'key ' + cls));
    s.appendChild(document.createTextNode(text));
    lg.appendChild(s);
  };
  const v = S.veh;
  if (S.dyn.some(Boolean)) {
    if (S.view !== 'tq') item('solid', 'Power, whp');
    if (S.view !== 'hp') item('dash', 'Torque, lb-ft');
    if (S.band && v && S.view !== 'tq') item('band', 'Run A power if weight is off by ± ' + fmt(v.unc / LB) + ' lb');
    for (const f of S.runFindings)
      if (f.dyno) item('mark ' + f.sev, f.title + (S.smooth === 'off' ? '' : '. Thin line: the curve before smoothing'));
  }
  $('dyno-note').textContent = v
    ? 'Computed for ' +
      fmt(v.mass / LB) +
      ' lb with driver. A street pull cannot measure road gradient or wind, so the difference between runs on the same road is more reliable than either peak.'
    : '';
  $('replay-what').textContent = S.focus ? S.focus.label : '';
  // the list follows what the replay shows: a log with no pull opens when the replay comes to it
  syncLogs();
  $('find-run-h').textContent = S.runs[0] ? 'Run A · ' + pullName(S.runs[0]) : 'Run A';
}

function renderVehSum(): void {
  const v = S.veh;
  if (!v) return;
  const p = S.runs[0];
  const d = S.dyn[0];
  let s = 'Total ' + fmt(v.mass / LB) + ' lb.';
  if (p && d && d.speedCheck)
    s +=
      ' In ' +
      ORD[p.gear] +
      ' gear the gearing gives ' +
      d.speedCheck.gear.toFixed(2) +
      ' km/h per 1,000 rpm; the ECU logged ' +
      d.speedCheck.ecu.toFixed(2) +
      '.';
  else if (p) s += ' Enter tire size, final drive and gear ratios to check the ECU speed channel.';
  $('veh-sum').textContent = s;
  const bad = document.querySelectorAll('#veh-dlg [aria-invalid="true"]').length;
  $('veh-btn-txt').textContent =
    'Vehicle · ' + fmt(v.mass / LB) + ' lb' + (bad ? ' · check ' + bad + (bad === 1 ? ' field' : ' fields') : '');
}

const SEV: Record<Sev, [string, string]> = { good: ['✓', 'OK'], warn: ['!', 'Check'], crit: ['!', 'Risk'], info: ['i', 'Note'] };

/** Jump to a finding: the table it points at, or the moment in the log with the finding's channels on screen. */
function showFinding(f: Finding, o?: Occurrence): void {
  if (f.table) {
    S.tmode = f.table;
    S.tview[f.table] = 'grid';
    buildGrid();
    drawAll();
    scrollTo('table-panel');
    return;
  }
  const src = o || f;
  if (!src.log) return;
  const at = src.at ?? 0;
  if (f.area === 'Run' && S.runs[0]) {
    focusPull(S.runs[0]);
    S.t = clamp(at, S.focus!.w0, S.focus!.w1);
  } else focusSpan(src.log, src.t0 ?? at, src.t1 ?? at, at, f.title);
  if (S.xmode === 'rpm' && !S.focus!.pull) {
    S.xmode = 'time';
    syncSeg('data-xmode', 'time');
  }
  if (f.channels) {
    const log = S.focus!.log;
    const has = (id: string) => !!series(log, id);
    const traces: TraceDef[] = [];
    for (const c of f.channels) {
      if (!has(c.a)) continue;
      const tr: TraceDef = { a: c.a };
      if (c.key) tr.key = true;
      if (c.b && has(c.b)) tr.b = c.b;
      if (c.lo !== undefined) {
        tr.lo = c.lo;
        tr.hi = c.hi;
      }
      traces.push(tr);
    }
    const readouts: string[] = [];
    for (const tr of traces) for (const id of [tr.a, tr.b]) if (id && !readouts.includes(id)) readouts.push(id);
    const keys = traces.filter(t => t.key).flatMap(t => (t.b ? [t.a, t.b] : [t.a]));
    S.fview = { title: f.title, sev: f.sev, traces, readouts, keys };
    S.rev++;
    renderViewSel();
    syncPicker();
    renderReadouts();
    viewMsg('Showing the channels behind this finding. Flagged channels come first.');
  }
  renderStats();
  drawAll();
  scrollTo('replay-panel');
}

function findingNode(f: Finding): HTMLLIElement {
  const li = el('li', 'finding ' + f.sev);
  const det = el('details');
  const sum = el('summary');
  const body = el('div', 'fbody');
  const head = el('span', 'fhead');
  det.open = f.sev === 'crit';
  sum.appendChild(el('span', 'ico', SEV[f.sev][0]));
  head.appendChild(el('strong', '', f.title));
  head.appendChild(el('span', 'tag', SEV[f.sev][1] + (f.area && f.area !== 'Run' ? ' · ' + f.area : '')));
  head.appendChild(el('span', 'lead', f.evidence[0] || ''));
  sum.appendChild(head);
  det.appendChild(sum);
  const ul = el('ul');
  for (const e of f.evidence) ul.appendChild(el('li', '', e));
  body.appendChild(ul);
  if (f.why) {
    const p = el('p', 'why');
    p.appendChild(el('b', '', 'Why it matters: '));
    p.appendChild(document.createTextNode(f.why));
    body.appendChild(p);
  }
  if (f.steps && f.steps.length) {
    body.appendChild(el('p', 'do', 'What to change'));
    const ol = el('ol', 'steps');
    for (const s of f.steps) ol.appendChild(el('li', '', s));
    body.appendChild(ol);
  }
  const acts = el('div', 'acts');
  const add = (label: string, o?: Occurrence) => {
    const b = el('button', 'btn sm', label);
    b.type = 'button';
    b.addEventListener('click', () => showFinding(f, o));
    acts.appendChild(b);
  };
  if (f.occurrences && f.occurrences.length > 1) {
    for (const o of f.occurrences.slice(0, 8)) if (o.log) add(o.label + ', ' + logName(o.log) + ' ' + o.at.toFixed(0) + ' s', o);
  } else if (f.table) add(f.table === 'fuel' ? 'Open fuel table' : 'Open ignition table');
  else if (f.log) add('Show in replay');
  if (acts.childElementCount) body.appendChild(acts);
  det.appendChild(body);
  li.appendChild(det);
  return li;
}

/**
 * Fill a findings list as two columns, the first half by count in the first.
 * Each column is its own list, so a finding stays in its column when another opens or closes.
 */
function fillFindings(box: HTMLElement, findings: Finding[], none: string): void {
  box.textContent = '';
  const column = (items: Finding[]) => {
    const ul = el('ul', 'fcol');
    for (const f of items) ul.appendChild(findingNode(f));
    box.appendChild(ul);
    return ul;
  };
  if (!findings.length) return void column([]).appendChild(el('li', 'hint', none));
  const half = Math.ceil(findings.length / 2);
  column(findings.slice(0, half));
  if (findings.length > 1) column(findings.slice(half));
}

function renderFindings(): void {
  fillFindings($('find-all'), S.findings, 'Nothing flagged across these logs.');
  fillFindings($('find-run'), S.runFindings, 'Pick a pull as run A to check it.');
  const all = S.findings.concat(S.runFindings);
  const n = (k: Sev) => all.filter(f => f.sev === k).length;
  $('find-sum').textContent = all.length
    ? n('crit') + ' risk · ' + n('warn') + ' to check · ' + n('info') + ' notes · ' + n('good') + ' OK'
    : '';
}

function renderDynoTable(): void {
  const wrap = $('dyno-tbl');
  wrap.hidden = !S.showTable;
  $('dyno-wrap').hidden = S.showTable;
  if (!S.showTable) return;
  wrap.textContent = '';
  const cores = S.dyn.map(d => (d ? d.core : null));
  const all = cores.flatMap(c => c || []);
  if (!all.length) return;
  const lo = Math.ceil(Math.min(...all.map(p => p.rpm)) / 250) * 250;
  const hi = Math.floor(Math.max(...all.map(p => p.rpm)) / 250) * 250;
  const tb = el('table', 'data-tbl');
  const hr = el('tr');
  hr.appendChild(el('th', '', 'RPM'));
  cores.forEach((c, r) => {
    if (!c) return;
    hr.appendChild(el('th', '', RUN[r] + ' whp'));
    hr.appendChild(el('th', '', RUN[r] + ' lb-ft'));
  });
  const thead = el('thead');
  thead.appendChild(hr);
  tb.appendChild(thead);
  const body = el('tbody');
  for (let rpm = lo; rpm <= hi; rpm += 250) {
    const tr = el('tr');
    tr.appendChild(el('td', '', fmt(rpm)));
    for (const c of cores) {
      if (!c) continue;
      tr.appendChild(el('td', '', fmt(atRpm(c, rpm, 'hp'))));
      tr.appendChild(el('td', '', fmt(atRpm(c, rpm, 'tq'))));
    }
    body.appendChild(tr);
  }
  tb.appendChild(body);
  wrap.appendChild(tb);
}

// ---------- readouts and channel picker ----------

let roEls: { id: string; n: HTMLElement; d: number }[] = [];

function renderReadouts(): void {
  const box = $('readouts');
  box.textContent = '';
  roEls = [];
  const log = S.focus ? S.focus.log : S.logs[0];
  if (!log) return;
  const view = curView();
  // a channel with a trace has its value at the playhead beside the trace already: no card for it
  const traced = new Set(view.traces.flatMap(t => (t.b ? [t.a, t.b] : [t.a])));
  for (const id of view.readouts.filter(id => !traced.has(id))) {
    const inf = chInfo(log, id);
    const d = el('div', 'ro');
    const lb = el('div', 'lb', inf.label);
    const v = el('div', 'vl');
    const n = el('span', '', '–');
    lb.title = inf.label;
    if (S.fview && S.fview.keys.includes(id)) {
      d.classList.add('flag', S.fview.sev);
      lb.title += ' (flagged by this finding)';
    }
    v.appendChild(n);
    if (inf.unit) v.appendChild(el('small', '', inf.unit));
    d.appendChild(lb);
    d.appendChild(v);
    box.appendChild(d);
    roEls.push({ id, n, d: inf.d });
  }
  if (!view.readouts.length) box.appendChild(el('p', 'hint', 'No readouts in this view. Open Channels and add some.'));
  // a view whose every readout has a trace has no card row
  box.hidden = !box.childElementCount;
}

function updateReadouts(): void {
  const f = S.focus;
  if (!f) return;
  for (const r of roEls) {
    const v = valAt(f.log, series(f.log, r.id), S.t);
    let txt = fmt(v, r.d);
    if (r.id === 'calc:boost' && v === v) txt = (v >= 0 ? '+' : '−') + fmt(Math.abs(v), 1);
    if (r.n.textContent !== txt) r.n.textContent = txt;
  }
}

interface PickRow {
  id: string;
  row: HTMLElement;
  vv: HTMLElement;
  bt: HTMLButtonElement;
  br: HTMLButtonElement;
  d: number;
  unit: string;
  constant: boolean;
  text: string;
}
let pick: PickRow[] = [];
let pickLog: Log | null = null;
let lastPick = 0;

function buildPicker(): void {
  const list = $('pick-list');
  const log = S.focus ? S.focus.log : S.logs[0];
  list.textContent = '';
  pick = [];
  pickLog = log || null;
  if (!log) return;
  for (const id of Object.keys(CALC).concat(log.names)) {
    const inf = chInfo(log, id);
    const row = el('div', 'pk');
    const nm = el('span', 'nm', inf.label);
    const vv = el('span', 'vv', '');
    const bt = el('button', 'btn sm', 'Trace');
    const br = el('button', 'btn sm', 'Readout');
    if (inf.label !== id && !CALC[id]) nm.appendChild(el('small', '', id));
    nm.title = id;
    bt.type = br.type = 'button';
    bt.addEventListener('click', () => {
      adoptFinding();
      const k = S.rview.traces.findIndex(p => p.a === id);
      if (k >= 0) S.rview.traces.splice(k, 1);
      else S.rview.traces.push({ a: id });
      viewChanged();
    });
    br.addEventListener('click', () => {
      adoptFinding();
      const k = S.rview.readouts.indexOf(id);
      if (k >= 0) S.rview.readouts.splice(k, 1);
      else S.rview.readouts.push(id);
      viewChanged();
    });
    row.appendChild(nm);
    row.appendChild(vv);
    row.appendChild(bt);
    row.appendChild(br);
    list.appendChild(row);
    pick.push({
      id,
      row,
      vv,
      bt,
      br,
      d: inf.d,
      unit: inf.unit,
      constant: !CALC[id] && chanMeta(log, id).constant,
      text: (inf.label + ' ' + id).toLowerCase(),
    });
  }
  syncPicker();
  filterPicker();
}

function syncPicker(): void {
  const v = curView();
  for (const p of pick) {
    p.bt.setAttribute('aria-pressed', String(v.traces.some(t => t.a === p.id)));
    p.br.setAttribute('aria-pressed', String(v.readouts.includes(p.id)));
  }
}

function filterPicker(): void {
  const q = input('pick-q').value.trim().toLowerCase();
  const hideConst = input('pick-chg').checked;
  let shown = 0;
  for (const p of pick) {
    const on = (!q || p.text.includes(q)) && !(hideConst && p.constant && !q);
    p.row.hidden = !on;
    if (on) shown++;
  }
  $('pick-count').textContent = shown + ' of ' + pick.length + ' channels';
  lastPick = 0;
}

/** Live values in the channel picker, a few times a second while it is open. */
function updatePicker(now: number): void {
  if ($('picker').hidden || !S.focus || now - lastPick < 160) return;
  lastPick = now;
  const log = S.focus.log;
  if (pickLog !== log) {
    const sameChannels = pickLog && pickLog.names.length === log.names.length && pickLog.names.every((n, i) => n === log.names[i]);
    if (!sameChannels) return buildPicker();
    pickLog = log;
  }
  for (const p of pick) {
    if (p.row.hidden) continue;
    const v = valAt(log, series(log, p.id), S.t);
    const txt = fmt(v, p.d) + (p.unit && v === v ? ' ' + p.unit : '');
    if (p.vv.textContent !== txt) p.vv.textContent = txt;
  }
}

// ---------- saved views ----------

const FINDING_OPTION = '\u0000finding';

/**
 * Whether a view is saved under this name. Its own key only: "constructor" and "toString" are on every object and are not saved views.
 * Not `Object.hasOwn`: the app is built for Safari 15.0 (iOS 15.0, macOS 11), and that function came with Safari 15.4.
 */
const isSavedView = (nm: string): boolean => Object.prototype.hasOwnProperty.call(S.views, nm);

/** The name Save view is asking about before it replaces that view, and the clock that withdraws the question. */
let replaceAsked = '';
let replaceTimer = 0;

/** Put Save view back as it was, if it is asking before replacing a view. */
function disarmReplace(): void {
  if (!replaceAsked) return;
  replaceAsked = '';
  clearTimeout(replaceTimer);
  $('view-save').textContent = 'Save view';
}

/**
 * Write the line beside the view buttons. Every message but the Replace question withdraws that question first,
 * so the button never says Replace beside another message and the question's clock never clears one.
 */
function viewMsg(text: string): void {
  disarmReplace();
  $('view-msg').textContent = text;
}

function viewChanged(): void {
  S.rev++;
  viewMsg('Unsaved changes');
  renderViewSel();
  syncPicker();
  renderReadouts();
  drawAll();
  saveSettings();
}

function renderViewSel(): void {
  const sel = $<HTMLSelectElement>('view-sel');
  sel.textContent = '';
  for (const nm of ['Default'].concat(Object.keys(S.views).sort())) {
    const o = el('option', '', nm);
    o.value = nm;
    sel.appendChild(o);
  }
  if (S.fview) {
    const o = el('option', '', 'Finding: ' + S.fview.title);
    o.value = FINDING_OPTION;
    sel.appendChild(o);
    sel.value = o.value;
  } else sel.value = isSavedView(S.viewName) || S.viewName === 'Default' ? S.viewName : 'Default';
  $<HTMLButtonElement>('view-del').disabled = !!S.fview || sel.value === 'Default';
  const back = $('view-back');
  back.hidden = !S.fview;
  back.textContent = 'Back to ' + S.viewName;
}

function loadView(nm: string): void {
  if (nm === FINDING_OPTION) return;
  S.fview = null;
  S.viewName = nm;
  S.rview = copyView(nm === 'Default' ? DEFAULT_VIEW : S.views[nm]);
  viewMsg('');
  input('view-name').value = nm === 'Default' ? '' : nm;
  S.rev++;
  renderViewSel();
  syncPicker();
  renderReadouts();
  drawAll();
  saveSettings();
}

function syncTransport(): void {
  const f = S.focus;
  if (!f) return;
  input('scrub').value = String(Math.round(((S.t - f.w0) / (f.w1 - f.w0 || 1)) * 1000));
  $('clock').textContent = (S.t - f.w0).toFixed(2) + ' / ' + (f.w1 - f.w0).toFixed(2) + ' s';
  $<HTMLButtonElement>('step-prev').disabled = stepTarget(S.t, -1) === null;
  $<HTMLButtonElement>('step-next').disabled = stepTarget(S.t, 1) === null;
  const pb = $('play');
  const lbl = S.playing ? 'Pause' : 'Play';
  if (pb.textContent !== lbl) pb.textContent = lbl;
}

// ---------- ignition and fuel tables ----------

function syncSeg(attr: string, val: string): void {
  document.querySelectorAll('[' + attr + ']').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute(attr) === val)));
}

function syncTableControls(): void {
  syncSeg('data-tmode', S.tmode);
  syncSeg('data-tview', S.tview[S.tmode]);
  syncSeg('data-tres', S.tres);
  const g = S.tview[S.tmode] === 'grid';
  const T = curTable();
  $('h-t3').textContent = S.tmode === 'fuel' ? 'Fuel table' : 'Ignition table';
  $('t3-wrap').hidden = g;
  $('t3-grid').hidden = !g;
  if (!T) return;
  const sc = tableScale(T);
  const ramp = $('ramp');
  ramp.className = 'ramp' + (sc.fuel ? ' div' : '');
  ramp.hidden = sc.empty;
  $('ramp-lo').textContent = sc.fuel ? '−' + sc.R + '% remove fuel' : fmt(sc.dmin) + '° BTDC';
  $('ramp-hi').textContent = sc.fuel ? '+' + sc.R + '% add fuel' : fmt(sc.dmax) + '° BTDC';
  let filled = 0;
  for (const row of sc.grid) for (const v of row) if (v === v) filled++;
  const where =
    filled +
    ' of ' +
    T.rpmAx.length * T.mapAx.length +
    ' cells have data. ' +
    (g ? 'The outlined cell is the replay position.' : 'The line is run A. Drag to rotate.');
  $('t3-note').textContent = !S.logs.length
    ? ''
    : sc.fuel
      ? 'Correction the fuel table needs in each cell: measured lambda against target, with O2 trims included. Positive adds fuel. Steady samples only: coolant above 70 °C, throttle and MAP settled, 1 s clear of any fuel cut, 0.15 s sensor delay, at least 8 samples. ' +
        where
      : 'Mean logged ignition advance in each cell, from all logs. ' + where;
}

let grid: { cells: HTMLTableCellElement[][]; T: Table; now: HTMLTableCellElement | null } | null = null;

function buildGrid(): void {
  const wrap = $('t3-grid');
  const T = curTable();
  wrap.textContent = '';
  grid = null;
  if (!T) return syncTableControls();
  const sc = tableScale(T);
  const tb = el('table', 'cell-tbl');
  const cells: HTMLTableCellElement[][] = [];
  for (let m = T.mapAx.length - 1; m >= 0; m--) {
    const tr = el('tr');
    tr.appendChild(el('th', 'ax', String(T.mapAx[m])));
    cells[m] = [];
    for (let r = 0; r < T.rpmAx.length; r++) {
      const v = sc.grid[m][r];
      const td = el('td');
      if (v === v) {
        const c = sc.color(v);
        td.style.background = css(c);
        td.style.color = inkOn(c);
        td.textContent = sc.fuel ? (v >= 0.5 ? '+' : v <= -0.5 ? '−' : '') + Math.abs(Math.round(v)) : String(Math.round(v));
        td.title =
          fmt(T.rpmAx[r]) +
          ' rpm, ' +
          T.mapAx[m] +
          ' kPa: ' +
          (sc.fuel ? (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '% fuel, ' + T.fcnt[m][r] : v.toFixed(1) + '° BTDC, ' + T.cnt[m][r]) +
          ' samples';
      }
      tr.appendChild(td);
      cells[m][r] = td;
    }
    tb.appendChild(tr);
  }
  const fr = el('tr');
  fr.appendChild(el('th', 'ax', 'kPa \\ rpm'));
  for (const r of T.rpmAx) fr.appendChild(el('th', '', T.rpmAx.length > 13 && r % 500 ? '' : (r / 1000).toFixed(1) + 'k'));
  tb.appendChild(fr);
  wrap.appendChild(tb);
  grid = { cells, T, now: null };
  syncTableControls();
}

/** Outline the grid cell the replay position is in. */
function updateGridNow(): void {
  const g = grid;
  const f = S.focus;
  if (!g || !f || S.tview[S.tmode] !== 'grid') return;
  const rpm = valAt(f.log, f.log.ch.rpm, S.t);
  const kpa = valAt(f.log, f.log.ch.map, S.t);
  let td: HTMLTableCellElement | null = null;
  if (rpm > 400 && kpa === kpa) {
    const near = (ax: number[], v: number) => {
      let b = 0;
      let d = 1e9;
      ax.forEach((x, i) => {
        if (Math.abs(x - v) < d) {
          d = Math.abs(x - v);
          b = i;
        }
      });
      return b;
    };
    td = g.cells[near(g.T.mapAx, kpa)][near(g.T.rpmAx, rpm)];
  }
  if (td !== g.now) {
    if (g.now) g.now.classList.remove('now');
    if (td) td.classList.add('now');
    g.now = td;
  }
}

// ---------- switch and state chips ----------

let chipsAsked = '';
let chipsSeq = 0;
/** How the message starts while a request for chips has failed. */
const CHIPS_FAILED = 'Switches and states failed: ';

/**
 * Ask the core for the chips of the span on screen. Runs on every draw and asks once per span.
 * A failed request is not retried until the span, the log or "Show switches and states that change" changes, or Try again:
 * retrying here would send a request on every frame while the replay plays.
 */
function syncChips(): void {
  const f = S.focus;
  const key = f && chipsWanted() ? chipsKey(f) : '';
  if (key === chipsAsked) return;
  chipsAsked = key;
  const seq = ++chipsSeq;
  // chips for another span must not be shown for this one while the new chips are on their way
  S.chips = null;
  S.chipsFor = '';
  // a choice is for one span
  S.chosen = null;
  S.rev++;
  if (!f || !key) {
    // the setting is off or there is no log: an earlier failure no longer holds
    clearMessage(CHIPS_FAILED);
    return;
  }
  const [t0, t1] = replaySpan(f);
  api.chips(f.log.key, t0, t1).then(
    c => {
      if (seq !== chipsSeq) return;
      S.chips = c;
      S.chipsFor = key;
      S.rev++;
      // an earlier failure no longer holds once chips arrive; any other message stays
      clearMessage(CHIPS_FAILED);
      drawAll();
    },
    e => {
      if (seq === chipsSeq) fail(CHIPS_FAILED + errText(e), { label: 'Try again', run: retryChips });
    },
  );
}
/** Ask again for the chips of the span on screen, after a request for them failed. */
function retryChips(): void {
  chipsAsked = '';
  drawAll();
}

/** Move the playhead to the previous or next change of the chips, and stop playing. */
function step(dir: 1 | -1): void {
  const to = stepTarget(S.t, dir);
  if (to === null) return;
  S.t = to;
  S.playing = false;
  drawAll();
}

// ---------- frame loop ----------

/** The replay's chips and traces. Both show the span in S.focus, so neither is drawn without the other. */
function drawReplay(): void {
  updateChips();
  drawTraces();
}

function drawAll(): void {
  syncChips();
  syncTransport();
  updateReadouts();
  drawDyno();
  draw3d();
  updateGridNow();
  drawReplay();
  updatePicker(performance.now());
}

let lastTs = 0;
function frame(ts: number): void {
  if (S.playing && S.focus) {
    S.t += Math.min(0.1, (ts - lastTs) / 1000) * S.speed;
    if (S.t >= S.focus.w1) {
      S.t = S.focus.w1;
      S.playing = false;
    }
    drawAll();
  }
  lastTs = ts;
  requestAnimationFrame(frame);
}

// ---------- importing logs ----------

let busy = false;

async function addFiles(files: File[]): Promise<void> {
  if (busy || !files.length) return;
  busy = true;
  let added = 0;
  const errs: string[] = [];
  const before = S.pulls.length;
  for (const f of files) {
    progress('Reading ' + f.name);
    try {
      await api.loadText(f.name, await f.text());
      added++;
    } catch (e) {
      // a refusal that already names the file is shown as it is
      const why = errText(e);
      errs.push(why.includes(f.name) ? why : f.name + ': ' + why);
    }
  }
  try {
    if (added) await reload();
    const pulls = S.pulls.length - before;
    const text =
      (added ? 'Added ' + added + (added > 1 ? ' logs, ' : ' log, ') + pulls + ' new ' + (pulls === 1 ? 'pull' : 'pulls') + '. ' : '') +
      errs.join(' ');
    // a refused file is a failure, so the refusal stays on screen
    if (errs.length) fail(text);
    else say(text);
  } catch (e) {
    fail(errText(e));
  }
  busy = false;
}

let lastScan = 0;
/** The text of the last scan failure shown; '' once a scan has worked. */
let scanFailure = '';

/**
 * Import NSP logs that appeared in the watch folder. A quiet scan is one the person did not ask for, made when the
 * window comes to the front: it says only what is new.
 */
async function scanWatch(quiet: boolean): Promise<void> {
  if (!S.watchDir || busy) return;
  busy = true;
  lastScan = Date.now();
  try {
    const r = await api.scanDir(S.watchDir);
    if (r.added.length) await reload();
    const text =
      (r.added.length
        ? 'Added ' + r.added.length + (r.added.length > 1 ? ' logs' : ' log') + ' from the watch folder. '
        : 'No new logs in the watch folder. ') + r.errors.join(' ');
    if (r.errors.length) scanFailed(text, quiet);
    else {
      scanWorked();
      if (r.added.length || !quiet) say(text);
    }
  } catch (e) {
    scanFailed(errText(e), quiet);
  }
  busy = false;
}

/** Show a scan's failure. A quiet scan does not show the text the person has been shown already. */
function scanFailed(text: string, quiet: boolean): void {
  if (quiet && text === scanFailure) return;
  scanFailure = text;
  fail(text);
}

/** A scan with no failure clears the failure of an earlier one, if it is still on screen. */
function scanWorked(): void {
  if (scanFailure) clearMessage(scanFailure);
  scanFailure = '';
}

function renderWatch(): void {
  const on = !!S.watchDir;
  $('watch-path').textContent = on
    ? S.watchDir + '. New NSP logs here are added when the app opens or comes to the front.'
    : 'Pick the folder where NSP logs arrive, such as a Google Drive or iCloud Drive folder synced from the tuning laptop. New logs are added on their own.';
  $('watch-scan').hidden = !on;
  $('watch-stop').hidden = !on;
  $('watch-pick').textContent = on ? 'Change folder' : 'Choose folder';
  input('watch-in').value = S.watchDir;
}

function setWatch(dir: string): void {
  S.watchDir = dir.trim();
  renderWatch();
  saveSettings();
  void scanWatch(false);
}

// ---------- events ----------

function wire(): void {
  wireMessages();
  const segs = (attr: string, fn: (v: string) => void) =>
    document.querySelectorAll('[' + attr + ']').forEach(b =>
      b.addEventListener('click', () => {
        const v = b.getAttribute(attr)!;
        syncSeg(attr, v);
        fn(v);
      }),
    );

  $('play').addEventListener('click', () => {
    const f = S.focus;
    if (!f) return;
    if (!S.playing && S.t >= f.w1 - 0.01) S.t = f.w0;
    S.playing = !S.playing;
    lastTs = performance.now();
    syncTransport();
  });
  $('restart').addEventListener('click', () => {
    if (!S.focus) return;
    S.t = S.focus.w0;
    drawAll();
  });
  input('scrub').addEventListener('input', e => {
    const f = S.focus;
    if (!f) return;
    S.playing = false;
    S.t = f.w0 + (+(e.target as HTMLInputElement).value / 1000) * (f.w1 - f.w0);
    drawAll();
  });
  segs('data-speed', v => {
    S.speed = +v;
  });
  segs('data-view', v => {
    S.view = v as typeof S.view;
    renderStats();
    drawDyno();
  });
  segs('data-tmode', v => {
    S.tmode = v as typeof S.tmode;
    S.t3hover = null;
    buildGrid();
    drawAll();
  });
  segs('data-tview', v => {
    S.tview[S.tmode] = v as '3d' | 'grid';
    syncTableControls();
    drawAll();
  });
  segs('data-tres', v => {
    S.tres = v as typeof S.tres;
    S.t3hover = null;
    buildGrid();
    drawAll();
  });
  segs('data-xmode', v => {
    S.xmode = v as typeof S.xmode;
    S.hoverX = null;
    S.rev++;
    drawAll();
  });
  segs('data-speed-src', v => {
    S.speedSrc = v;
    void recompute();
  });
  segs('data-smooth', v => {
    S.smooth = v;
    void recompute();
  });
  $('tbl-btn').addEventListener('click', e => {
    const b = e.currentTarget as HTMLElement;
    S.showTable = !S.showTable;
    b.setAttribute('aria-pressed', String(S.showTable));
    b.textContent = S.showTable ? 'Chart' : 'Table';
    renderDynoTable();
    drawDyno();
  });

  // vehicle dialog
  const modelSel = $<HTMLSelectElement>('v-model');
  for (const k of Object.keys(VEH_IDS)) {
    const inp = input(VEH_IDS[k]);
    inp.addEventListener('input', () => {
      if ((MODEL_FIELDS as readonly string[]).includes(k)) {
        S.model = 'custom';
        modelSel.value = 'custom';
      }
      checkField(k, false);
      void recompute();
    });
    // leaving a field that is not valid shows what it takes
    inp.addEventListener('change', () => {
      checkField(k, true);
      renderVehSum();
    });
  }
  modelSel.addEventListener('change', () => {
    S.model = modelSel.value;
    const c = CATALOG.find(x => x.id === S.model);
    if (c)
      for (const k of MODEL_FIELDS) {
        input(VEH_IDS[k]).value = String(c[k]);
        checkField(k, true);
      }
    void recompute();
  });
  const dlg = $<HTMLDialogElement>('veh-dlg');
  $('veh-btn').addEventListener('click', () => dlg.showModal());
  $('veh-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => {
    if (e.target === dlg) dlg.close();
  });

  // channels and views
  $('chan-btn').addEventListener('click', e => {
    const p = $('picker');
    p.hidden = !p.hidden;
    (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(!p.hidden));
    lastPick = 0;
    if (!p.hidden) {
      updatePicker(performance.now());
      if (!isMobile) input('pick-q').focus();
    }
  });
  input('pick-q').addEventListener('input', filterPicker);
  input('pick-chg').addEventListener('change', filterPicker);
  input('pick-sw').addEventListener('change', () => {
    S.chipsShow = input('pick-sw').checked;
    saveSettings();
    drawAll();
  });
  wireChips(drawAll);
  $('step-prev').addEventListener('click', () => step(-1));
  $('step-next').addEventListener('click', () => step(1));
  $<HTMLSelectElement>('view-sel').addEventListener('change', e => loadView((e.target as HTMLSelectElement).value));
  $('view-back').addEventListener('click', () => {
    leaveFinding();
    viewMsg('');
    drawAll();
  });
  $('view-save').addEventListener('click', () => {
    const nm = input('view-name').value.trim();
    if (!nm || nm === 'Default') {
      viewMsg('Type a name for the view first.');
      input('view-name').focus();
      return;
    }
    // saving over another view asks first; saving the view that is loaded is how its changes are kept.
    if (isSavedView(nm) && nm !== S.viewName && replaceAsked !== nm) {
      viewMsg('A view called “' + nm + '” exists. Replace it?');
      replaceAsked = nm;
      $('view-save').textContent = 'Replace';
      replaceTimer = window.setTimeout(() => viewMsg(''), 5000);
      return;
    }
    adoptFinding();
    S.views[nm] = copyView(S.rview);
    S.viewName = nm;
    S.rev++;
    renderViewSel();
    syncPicker();
    renderReadouts();
    drawAll();
    saveSettings();
    viewMsg('Saved “' + nm + '”.');
  });
  input('view-name').addEventListener('input', () => {
    if (replaceAsked) viewMsg('');
  });
  $('view-del').addEventListener('click', () => {
    const nm = $<HTMLSelectElement>('view-sel').value;
    if (nm === 'Default' || nm === FINDING_OPTION) return;
    const kept = S.views[nm];
    delete S.views[nm];
    loadView('Default');
    say('Deleted “' + nm + '”.', {
      label: 'Undo',
      run: () => {
        // a view saved under the name since then is not replaced
        if (isSavedView(nm)) return;
        S.views[nm] = kept;
        loadView(nm);
      },
    });
  });

  // power chart
  const dc = $('dyno-cv');
  dc.addEventListener('pointermove', dynoHover);
  dc.addEventListener('pointerleave', () => {
    S.hoverRpm = null;
    hideTip();
    drawDyno();
  });

  // traces: drag to scrub, hover for values
  const tc = $('tr-cv');
  let scrubbing = false;
  const scrub = (e: PointerEvent) => {
    const x = trX(e);
    const f = S.focus!;
    if (S.xmode === 'rpm') {
      const p = S.runs[0];
      if (!p) return;
      if (f.pull !== p) focusPull(p);
      const tt = atRunRpm(p, p.log.t, x);
      if (tt === tt) S.t = tt;
      renderStats();
    } else S.t = x;
  };
  tc.addEventListener('pointerdown', e => {
    if (!traceLayout()) return;
    scrubbing = true;
    S.playing = false;
    try {
      tc.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
    S.hoverX = null;
    hideTip();
    scrub(e);
    drawAll();
  });
  tc.addEventListener('pointermove', e => {
    const L = traceLayout();
    if (!L || !S.focus) return;
    if (scrubbing) {
      scrub(e);
      drawAll();
      return;
    }
    if (e.pointerType === 'touch') return;
    const x = trX(e);
    const th = theme();
    const log = S.focus.log;
    const rows: TipRow[] = [];
    S.hoverX = x;
    for (const p of L.panels) {
      if (L.rpmMode) {
        const vals = L.spans.map(sp => RUN[sp.r!] + ' ' + fmt(atRunRpm(S.runs[sp.r!]!, series(sp.log, p.a, sp.r), x), p.ia.d));
        rows.push({ label: p.ia.label, value: vals.join(' · ') });
      } else
        rows.push({
          label: p.ia.label,
          value: fmt(valAt(log, series(log, p.a), x), p.ia.d) + (p.ia.unit ? ' ' + p.ia.unit : ''),
          color: th.run[0],
        });
    }
    showTip(e.clientX, e.clientY, L.rpmMode ? fmt(Math.round(x / 10) * 10) + ' rpm' : (x - L.x0).toFixed(2) + ' s', rows);
    drawReplay();
  });
  const endScrub = () => {
    scrubbing = false;
  };
  tc.addEventListener('pointerup', endScrub);
  tc.addEventListener('pointercancel', endScrub);
  tc.addEventListener('pointerleave', () => {
    S.hoverX = null;
    hideTip();
    drawReplay();
  });

  // 3D table: drag or arrow keys to rotate
  const t3 = $('t3-cv');
  let drag: { x: number; y: number; az: number; el: number } | null = null;
  t3.addEventListener('pointerdown', e => {
    drag = { x: e.clientX, y: e.clientY, az: S.az, el: S.el };
    t3.classList.add('dragging');
    hideTip();
    try {
      t3.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
  });
  t3.addEventListener('pointermove', e => {
    if (drag) {
      S.az = drag.az + (e.clientX - drag.x) * 0.01;
      S.el = clamp(drag.el + (e.clientY - drag.y) * 0.006, 0.22, 1.3);
      draw3d();
    } else t3Hover(e);
  });
  const endDrag = () => {
    drag = null;
    t3.classList.remove('dragging');
  };
  t3.addEventListener('pointerup', endDrag);
  t3.addEventListener('pointercancel', endDrag);
  t3.addEventListener('pointerleave', () => {
    if (drag) return;
    S.t3hover = null;
    hideTip();
    draw3d();
  });
  t3.addEventListener('dblclick', () => {
    S.az = AZ0;
    S.el = EL0;
    draw3d();
  });
  t3.addEventListener('keydown', e => {
    const k = e.key;
    if (k === 'ArrowLeft') S.az -= 0.1;
    else if (k === 'ArrowRight') S.az += 0.1;
    else if (k === 'ArrowUp') S.el = clamp(S.el + 0.06, 0.22, 1.3);
    else if (k === 'ArrowDown') S.el = clamp(S.el - 0.06, 0.22, 1.3);
    else if (k === 'Home') {
      S.az = AZ0;
      S.el = EL0;
    } else return;
    e.preventDefault();
    draw3d();
  });

  // keyboard: space plays and pauses unless a control has focus
  window.addEventListener('keydown', e => {
    const t = e.target as HTMLElement;
    if (e.key !== ' ' || /^(INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY)$/.test(t.tagName) || dlg.open) return;
    e.preventDefault();
    $('play').click();
  });

  // importing
  const file = input('file');
  for (const id of ['add-btn', 'start-add']) $(id).addEventListener('click', () => file.click());
  $('start-files').hidden = !isMobile;
  file.addEventListener('change', () => {
    void addFiles(Array.from(file.files || []));
    file.value = '';
  });
  window.addEventListener('dragover', e => {
    e.preventDefault();
    document.body.classList.add('dropping');
  });
  window.addEventListener('dragleave', e => {
    if (!e.relatedTarget) document.body.classList.remove('dropping');
  });
  window.addEventListener('drop', e => {
    e.preventDefault();
    document.body.classList.remove('dropping');
    if (e.dataTransfer && e.dataTransfer.files.length) void addFiles(Array.from(e.dataTransfer.files));
  });
  onLogsChanged(msg => {
    reload().then(
      () => say(msg),
      e => fail(errText(e)),
    );
  });

  // watch folder: desktop only, a phone has no folder to watch
  if (!isMobile) {
    $('watch').hidden = false;
    $('watch-pick').hidden = !inTauri;
    input('watch-in').hidden = inTauri;
    $('watch-pick').addEventListener('click', async () => {
      try {
        const dir = await pickFolder();
        if (dir) setWatch(dir);
      } catch (e) {
        fail(errText(e));
      }
    });
    input('watch-in').addEventListener('keydown', e => {
      if (e.key === 'Enter') setWatch(input('watch-in').value);
    });
    $('watch-scan').addEventListener('click', () => void scanWatch(false));
    $('watch-stop').addEventListener('click', () => {
      S.watchDir = '';
      renderWatch();
      saveSettings();
      say('Stopped watching. Logs already added stay in the library.');
    });
    window.addEventListener('focus', () => {
      if (Date.now() - lastScan > 5000) void scanWatch(true);
    });
  }

  // redraw on resize, theme change and when the fonts arrive
  const redraw = () => {
    resetTheme();
    dropTraceCache();
    if (S.tables) buildGrid();
    drawAll();
  };
  const ro = new ResizeObserver(() => drawAll());
  for (const id of ['dyno-wrap', 't3-wrap', 'tr-wrap']) ro.observe($(id));
  // the boxes above the traces set the room the traces have; so does the window's height, which no observed box follows
  const room = new ResizeObserver(() => {
    refit();
    drawAll();
  });
  for (const id of ['transport', 'viewbar', 'readouts', 'chips', 'picker']) room.observe($(id));
  window.addEventListener('resize', () => {
    refit();
    drawAll();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
  void document.fonts.ready.then(redraw);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSettings();
  });
}

// ---------- boot ----------

/**
 * Read the library for the first time. Once the fonts are in, scrolls the list to run A, once: it is not scrolled again
 * when the library changes. A failure offers to try again.
 */
async function openLibrary(): Promise<void> {
  try {
    await reload();
    clearMessage(LIBRARY_FAILED);
    // the list opens on run A, once: after this the person is looking at the list already. Measured once the fonts are in
    await document.fonts.ready;
    showRunA();
  } catch (e) {
    $('sub').textContent = 'The library could not be opened';
    fail(LIBRARY_FAILED + errText(e), { label: 'Try again', run: () => void openLibrary() });
  }
}

export async function boot(): Promise<void> {
  const sel = $<HTMLSelectElement>('v-model');
  for (const c of CATALOG) {
    const o = el('option', '', c.name);
    o.value = c.id;
    sel.appendChild(o);
  }
  const oc = el('option', '', 'Custom');
  oc.value = 'custom';
  sel.appendChild(oc);
  wire();

  let st: Settings = {};
  try {
    st = (await api.getSettings()) || {};
  } catch (e) {
    fail('Could not read saved settings: ' + errText(e));
  }
  const veh = { ...VEH_DEFAULT, ...(st.veh || {}) };
  for (const k in VEH_IDS) {
    // a saved value that is out of range is shown with its line, and the default is used
    input(VEH_IDS[k]).value = String(veh[k]);
    checkField(k, true);
  }
  S.model = st.model || MODEL_DEFAULT;
  sel.value = S.model;
  if (sel.value !== S.model) sel.value = S.model = 'custom';
  S.speedSrc = st.speedSrc === 'gear' ? 'gear' : 'ecu';
  syncSeg('data-speed-src', S.speedSrc);
  // Object.keys, not `in`: a hand-edited "constructor" or "toString" is on every object and is not a level
  S.smooth = st.smooth && Object.keys(SMOOTH_RPM).includes(st.smooth) ? st.smooth : SMOOTH_DEFAULT;
  syncSeg('data-smooth', S.smooth);
  S.views = st.views && typeof st.views === 'object' ? st.views : {};
  S.names = { logs: { ...(st.names?.logs || {}) }, pulls: { ...(st.names?.pulls || {}) } };
  S.viewName = st.viewName && (st.viewName === 'Default' || isSavedView(st.viewName)) ? st.viewName : 'Default';
  if (st.working && Array.isArray(st.working.traces) && Array.isArray(st.working.readouts)) S.rview = copyView(st.working);
  else S.rview = copyView(S.viewName === 'Default' ? DEFAULT_VIEW : S.views[S.viewName]);
  input('view-name').value = S.viewName === 'Default' ? '' : S.viewName;
  S.watchDir = typeof st.watchDir === 'string' ? st.watchDir : '';
  // on unless it was turned off: settings saved before the setting existed have no entry
  S.chipsShow = st.switches !== false;
  input('pick-sw').checked = S.chipsShow;
  settingsReady = true;
  renderWatch();
  renderViewSel();

  await openLibrary();
  syncTableControls();
  requestAnimationFrame(frame);
  if (!isMobile && S.watchDir) void scanWatch(true);
}

// kept for tests and for poking at state from the console
(window as unknown as { __logViewer: typeof S }).__logViewer = S;
