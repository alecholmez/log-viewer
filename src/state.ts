// App state, constants and the small helpers every part of the UI uses.

import { chan, chanMeta, clamp } from './data';
import type { Dyno, DynoOut, Finding, Log, Pull, Sev, Switches, Table, TraceDef, Vehicle, View } from './types';

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export const fmt = (v: number | null | undefined, d = 0) =>
  v !== null && v !== undefined && v === v ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–';

export const LB = 0.45359237;
export const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
export const RUN = ['A', 'B', 'C'];
export const AZ0 = -0.62;
export const EL0 = 0.5;

// ---------- vehicles ----------

export interface CatalogEntry {
  id: string;
  name: string;
  curb: number;
  cd: number;
  area: number;
  tire: string;
  fd: number;
  gears: string;
}

const BRZ_GEARS = '3.626, 2.188, 1.541, 1.213, 1.000, 0.767';

/** Sample catalog. Only the 2013 BRZ is checked against a manufacturer sheet; every field stays editable. */
export const CATALOG: CatalogEntry[] = [
  {
    id: 'zc6-13',
    name: 'Subaru BRZ / Scion FR-S, 2013–2016, 6MT',
    curb: 2762,
    cd: 0.28,
    area: 21.0,
    tire: '215/45R17',
    fd: 4.1,
    gears: BRZ_GEARS,
  },
  {
    id: 'zc6-17',
    name: 'Subaru BRZ / Toyota 86, 2017–2020, 6MT',
    curb: 2789,
    cd: 0.28,
    area: 21.0,
    tire: '215/45R17',
    fd: 4.3,
    gears: BRZ_GEARS,
  },
  {
    id: 'zd8-22',
    name: 'Subaru BRZ / Toyota GR86, 2022 on, 6MT',
    curb: 2815,
    cd: 0.28,
    area: 21.2,
    tire: '215/40R18',
    fd: 4.1,
    gears: BRZ_GEARS,
  },
  {
    id: 'a80',
    name: 'Toyota Supra Turbo (A80), 6MT',
    curb: 3450,
    cd: 0.32,
    area: 20.9,
    tire: '255/40R17',
    fd: 3.13,
    gears: '3.827, 2.360, 1.685, 1.312, 1.000, 0.793',
  },
  {
    id: 'nd',
    name: 'Mazda MX-5 (ND) 2.0, 6MT',
    curb: 2341,
    cd: 0.36,
    area: 19.0,
    tire: '205/45R17',
    fd: 2.87,
    gears: '5.087, 2.991, 2.035, 1.594, 1.286, 1.000',
  },
  {
    id: 's550',
    name: 'Ford Mustang GT (S550), 6MT',
    curb: 3705,
    cd: 0.35,
    area: 24.2,
    tire: '255/40R19',
    fd: 3.55,
    gears: '3.657, 2.430, 1.686, 1.315, 1.000, 0.651',
  },
];

/** Vehicle form fields, as typed. */
export const VEH_DEFAULT: Record<string, string | number> = {
  curb: 2762,
  driver: 140,
  tire: '215/45R17',
  fd: 4.44,
  gears: BRZ_GEARS,
  cd: 0.28,
  area: 21.0,
  unc: 100,
  crr: 0.012,
  rot: 88,
  ie: 0.14,
  win: 0.3,
};
/** Smoothing levels of the power curve: the half-width in rpm the core fits power over. 0 is off. */
export const SMOOTH_RPM: Record<string, number> = { off: 0, low: 150, med: 250, high: 400 };
export const SMOOTH_DEFAULT = 'med';
export const MODEL_DEFAULT = 'zc6-13';
/** The fields a catalog model fills. Editing one of them makes the model "Custom". */
export const MODEL_FIELDS = ['curb', 'tire', 'fd', 'gears', 'cd', 'area'] as const;
export const VEH_IDS: Record<string, string> = {
  curb: 'v-curb',
  driver: 'v-driver',
  tire: 'v-tire',
  fd: 'v-fd',
  gears: 'v-gears',
  cd: 'v-cd',
  area: 'v-area',
  unc: 'v-unc',
  crr: 'v-crr',
  rot: 'v-rot',
  ie: 'v-ie',
  win: 'v-win',
};

// ---------- channels and views ----------

export interface ChInfo {
  label: string;
  unit: string;
  d: number;
}

/** Values the app derives. Ids start with calc: so they cannot collide with ECU channel names. */
export const CALC: Record<string, ChInfo> = {
  'calc:whp': { label: 'Est. wheel power', unit: 'whp', d: 0 },
  'calc:tq': { label: 'Est. torque', unit: 'lb-ft', d: 0 },
  'calc:boost': { label: 'Boost', unit: 'psi', d: 1 },
  'calc:mph': { label: 'Road speed', unit: 'mph', d: 0 },
};

/** Plain labels for the channels most people look at. Everything else shows its NSP name. */
const ALIAS: Record<string, string> = {
  RPM: 'Engine speed',
  'Drive By Wire Accelerator Pedal Position': 'Accelerator pedal',
  'Throttle Position': 'Throttle plate',
  'Manifold Pressure': 'Manifold pressure',
  'Barometric Pressure': 'Barometer',
  'Wideband O2 Overall': 'Lambda',
  'Target Lambda': 'Lambda target',
  'Ignition Angle': 'Ignition advance',
  'Knock Sensor 1 Knock Signal': 'Knock signal',
  'Knock Threshold': 'Knock threshold',
};

export const DEFAULT_VIEW: View = {
  traces: [
    { a: 'RPM' },
    { a: 'Drive By Wire Accelerator Pedal Position', b: 'Throttle Position', lo: 0, hi: 100 },
    { a: 'Manifold Pressure', b: 'Barometric Pressure' },
    { a: 'Wideband O2 Overall', b: 'Target Lambda' },
    { a: 'Ignition Angle' },
    { a: 'Knock Sensor 1 Knock Signal', b: 'Knock Threshold' },
  ],
  readouts: [
    'RPM',
    'calc:mph',
    'calc:boost',
    'Wideband O2 Overall',
    'Target Lambda',
    'Ignition Angle',
    'Drive By Wire Accelerator Pedal Position',
    'Throttle Position',
    'calc:whp',
    'calc:tq',
  ],
};
export const copyView = (v: View): View => JSON.parse(JSON.stringify({ traces: v.traces, readouts: v.readouts }));

// ---------- state ----------

/** What replay is showing: a pull, a finding's span, or a whole log. */
export interface Focus {
  log: Log;
  /** window shown */
  w0: number;
  w1: number;
  /** span marked inside the window, NaN for a whole log */
  m0: number;
  m1: number;
  pull: Pull | null;
  label: string;
}

/** The stretch of the focused log the replay shows, in log seconds. The traces and the switch rows both read it here, so they always show the same stretch. */
export const replaySpan = (f: Focus): [number, number] => [f.w0, f.w1];

/** Names the log and span the replay shows. Switch rows are kept with this key, so they are drawn only against the span they were asked for. */
export const switchKey = (f: Focus): string => [f.log.key, ...replaySpan(f)].join('|');

/** The channels behind a finding, shown in place of the user's view until they leave it. */
export interface FindingView extends View {
  title: string;
  sev: Sev;
  /** flagged channel ids */
  keys: string[];
}

export interface Cell {
  r: number;
  m: number;
  v: number;
  d: number;
}

export const S = {
  logs: [] as Log[],
  pulls: [] as Pull[],
  /** run A is replayed; B and C overlay */
  runs: [null, null, null] as (Pull | null)[],
  dyn: [null, null, null] as (Dyno | null)[],
  band: null as DynoOut['band'],
  veh: null as Vehicle | null,
  findings: [] as Finding[],
  runFindings: [] as Finding[],
  view: 'both' as 'both' | 'hp' | 'tq',
  showTable: false,
  tables: null as { coarse: Table; fine: Table } | null,
  tmode: 'ign' as 'ign' | 'fuel',
  tview: { ign: '3d', fuel: 'grid' } as Record<'ign' | 'fuel', '3d' | 'grid'>,
  tres: 'coarse' as 'coarse' | 'fine',
  az: AZ0,
  el: EL0,
  focus: null as Focus | null,
  /** replay position, seconds in the focused log */
  t: 0,
  playing: false,
  speed: 1,
  speedSrc: 'ecu',
  /** smoothing level of the power curve, a key of SMOOTH_RPM */
  smooth: SMOOTH_DEFAULT,
  hoverRpm: null as number | null,
  hoverX: null as number | null,
  xmode: 'time' as 'time' | 'rpm',
  /** the user's working view */
  rview: copyView(DEFAULT_VIEW),
  viewName: 'Default',
  views: {} as Record<string, View>,
  names: { logs: {} as Record<string, string>, pulls: {} as Record<string, string> },
  model: MODEL_DEFAULT,
  t3hit: [] as { x: number; y: number; c: Cell }[],
  t3hover: null as Cell | null,
  /** bumped whenever the cached trace drawing is stale */
  rev: 0,
  fview: null as FindingView | null,
  watchDir: '',
  /** switch rows for the span on screen, as the core returned them; null when there are none to draw */
  sw: null as Switches | null,
  /** the `switchKey` of the log and span the rows in `sw` are for; empty when there are none */
  swFor: '',
  /** what each switch row reads at the playhead, as last drawn: On, Off, or – where there are no samples */
  swNow: [] as string[],
  /** "Show switches that change" in the Channels picker */
  swShow: true,
  /** index of the switch row the pointer is on */
  swHover: null as number | null,
};

/** The view on screen: a finding's own channels while one is being shown, otherwise the user's working view. */
export const curView = (): View => S.fview || S.rview;
export const curTable = (): Table | null => (S.tables ? S.tables[S.tres] : null);

// ---------- names ----------

export function logDefault(log: Log): string {
  const m = /_(\d\d)(\d\d)(am|pm)/i.exec(log.name);
  return m ? +m[1] + ':' + m[2] + ' ' + m[3].toLowerCase() + ' log' : log.name.replace(/\.csv$/i, '');
}
export const logName = (log: Log) => S.names.logs[log.key] || logDefault(log);
export const pullDefault = (p: Pull) => (ORD[p.gear] || 'Gear ' + p.gear) + ' gear · ' + fmt(p.rpm0) + '–' + fmt(p.rpm1) + ' rpm';
export const pullName = (p: Pull) => S.names.pulls[p.key] || pullDefault(p);

// ---------- channels ----------

export function chInfo(log: Log, id: string): ChInfo {
  if (CALC[id]) return CALC[id];
  const m = chanMeta(log, id);
  return { label: ALIAS[id] || id, unit: m.unit, d: m.d };
}

/** Samples for a channel id on a log. `runIdx` picks which run's dyno result feeds the calc: power channels. */
export function series(log: Log, id: string, runIdx?: number): Float32Array | null {
  if (id === 'calc:boost' || id === 'calc:mph') {
    if (!log.calc[id]) {
      const a = new Float32Array(log.n);
      const c = log.ch;
      for (let i = 0; i < log.n; i++) a[i] = id === 'calc:boost' ? (c.map[i] - (c.baro[i] || 101.3)) * 0.1450377 : c.vss[i] * 0.6213712;
      log.calc[id] = a;
    }
    return log.calc[id];
  }
  if (id === 'calc:whp' || id === 'calc:tq') {
    const r = runIdx !== undefined ? runIdx : S.runs.findIndex(p => p && p.log === log);
    const d = r >= 0 ? S.dyn[r] : null;
    if (!d) return null;
    if (!d.arr) {
      d.arr = { 'calc:whp': new Float32Array(log.n).fill(NaN), 'calc:tq': new Float32Array(log.n).fill(NaN) };
      for (const p of d.core) {
        d.arr['calc:whp'][p.i] = p.hp;
        d.arr['calc:tq'][p.i] = p.tq;
      }
    }
    return d.arr[id];
  }
  return chan(log, id);
}

// ---------- replay focus ----------

export function focusPull(p: Pull): void {
  const t = p.log.t;
  S.focus = {
    log: p.log,
    w0: Math.max(t[0], p.t0 - 1.5),
    w1: Math.min(t[p.log.n - 1], p.t1 + 1.5),
    m0: p.t0,
    m1: p.t1,
    pull: p,
    label: pullName(p) + ' · ' + logName(p.log),
  };
  S.t = p.t0 + p.dur * 0.62;
  S.playing = false;
  S.rev++;
}
export function focusSpan(log: Log, t0: number, t1: number, at: number, label: string): void {
  const t = log.t;
  S.focus = {
    log,
    w0: Math.max(t[0], t0 - 3),
    w1: Math.min(t[log.n - 1], t1 + 3),
    m0: t0,
    m1: t1,
    pull: null,
    label: label + ' · ' + logName(log),
  };
  S.t = clamp(at, S.focus.w0, S.focus.w1);
  S.playing = false;
  S.rev++;
}
export function focusLog(log: Log): void {
  const t = log.t;
  S.focus = { log, w0: t[0], w1: t[log.n - 1], m0: NaN, m1: NaN, pull: null, label: 'Whole log · ' + logName(log) };
  S.t = t[0];
  S.playing = false;
  S.rev++;
}

// ---------- canvas helpers ----------

export interface Theme {
  surface: string;
  inset: string;
  ink: string;
  ink2: string;
  ink3: string;
  grid: string;
  rule: string;
  run: string[];
  seqLo: string;
  seqHi: string;
  divNeg: string;
  divMid: string;
  divPos: string;
  warn: string;
  crit: string;
  note: string;
  body: string;
  disp: string;
}

let TH: Theme | null = null;
/** Colours and fonts read from the CSS tokens, so canvas drawing follows light and dark mode. */
export function theme(): Theme {
  if (TH) return TH;
  const cs = getComputedStyle(document.documentElement);
  const g = (n: string) => cs.getPropertyValue(n).trim();
  TH = {
    surface: g('--surface'),
    inset: g('--inset'),
    ink: g('--ink'),
    ink2: g('--ink-2'),
    ink3: g('--ink-3'),
    grid: g('--grid'),
    rule: g('--rule'),
    run: [g('--run-a'), g('--run-b'), g('--run-c')],
    seqLo: g('--seq-lo'),
    seqHi: g('--seq-hi'),
    divNeg: g('--div-neg'),
    divMid: g('--div-mid'),
    divPos: g('--div-pos'),
    warn: g('--warn'),
    crit: g('--crit'),
    note: g('--note'),
    body: g('--font-body'),
    disp: g('--font-display'),
  };
  return TH;
}
export const resetTheme = () => {
  TH = null;
};

export type RGB = number[];
const rgb = (h: string): RGB => {
  h = h.replace('#', '');
  if (h.length === 3)
    h = h
      .split('')
      .map(c => c + c)
      .join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
export const mix = (a: string, b: string, f: number): RGB => {
  const x = rgb(a);
  const y = rgb(b);
  return [0, 1, 2].map(i => Math.round(x[i] + (y[i] - x[i]) * f));
};
export const css = (c: RGB, k = 1) => 'rgb(' + c.map(v => Math.round(v * k)).join(',') + ')';

/** Size a canvas to its box at the device's pixel density and clear it. */
export function prep(cv: HTMLCanvasElement) {
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = Math.max(60, Math.round(r.width));
  const h = Math.max(60, Math.round(r.height));
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h, dpr };
}

export function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

// ---------- tooltip ----------

export interface TipRow {
  label: string;
  value: string;
  color?: string;
  dash?: boolean;
}

export function showTip(x: number, y: number, head: string, rows: TipRow[]): void {
  const tip = $('tip');
  tip.textContent = '';
  if (head) tip.appendChild(el('div', 'th', head));
  for (const r of rows) {
    const row = el('div', 'tr');
    const k = el('span', 'tk');
    if (r.color) {
      const i = el('i');
      i.style.borderTopColor = r.color;
      if (r.dash) i.style.borderTopStyle = 'dashed';
      k.appendChild(i);
    }
    k.appendChild(document.createTextNode(r.label));
    row.appendChild(k);
    row.appendChild(el('b', '', r.value));
    tip.appendChild(row);
  }
  tip.hidden = false;
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  tip.style.left = clamp(x + 14, 6, window.innerWidth - tw - 6) + 'px';
  tip.style.top = clamp(y - th - 12, 6, window.innerHeight - th - 6) + 'px';
}
export const hideTip = () => {
  $('tip').hidden = true;
};

export type { TraceDef };
