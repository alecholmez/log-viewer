// Shapes shared with the Rust core. Field names match what `Session::dispatch` returns.

export interface ChannelMeta {
  name: string;
  unit: string;
  /** decimals to show */
  d: number;
  /** set for channels that never change; they are not in the data blob */
  value?: number | null;
  constant: boolean;
}

export interface LogMeta {
  key: string;
  name: string;
  start: string;
  /** the log's start as a local date and time with no zone, "2026-04-17T13:45:37"; null when the log does not say */
  startedAt: string | null;
  n: number;
  hz: number;
  duration: number;
  channels: ChannelMeta[];
}

/** Channels the UI reads directly. A channel the log does not have is all NaN. */
export interface KeyChannels {
  rpm: Float32Array;
  map: Float32Array;
  baro: Float32Array;
  vss: Float32Array;
  ign: Float32Array;
  lam: Float32Array;
  lamT: Float32Array;
  stft: Float32Array;
  ltft: Float32Array;
}

export interface Log {
  key: string;
  name: string;
  start: string;
  /** the log's start as a local date and time with no zone, "2026-04-17T13:45:37"; null when the log does not say */
  startedAt: string | null;
  n: number;
  hz: number;
  duration: number;
  /** seconds from the first sample */
  t: Float32Array;
  names: string[];
  meta: Map<string, ChannelMeta>;
  cols: Map<string, Float32Array>;
  ch: KeyChannels;
  /** values this app derives, built on first use */
  calc: Record<string, Float32Array>;
}

export interface PullDto {
  key: string;
  logKey: string;
  i0: number;
  i1: number;
  gear: number;
  t0: number;
  t1: number;
  rpm0: number;
  rpm1: number;
  dur: number;
  gain: number;
  peakPedal: number;
  peakTps: number;
  peakMap: number;
}
export interface Pull extends PullDto {
  log: Log;
}

export interface Pt {
  i: number;
  t: number;
  rpm: number;
  hp: number;
  tq: number;
}

export interface Dyno {
  core: Pt[];
  kmhPerKrpm: number | null;
  peakHp: Pt | null;
  peakTq: Pt | null;
  fuelCheck: { bsfc: number; n: number; eth: number; lo: number; hi: number } | null;
  speedCheck: { ecu: number; gear: number; diff: number } | null;
  /** power and torque spread onto the log's sample index, built on first use */
  arr?: Record<string, Float32Array>;
}

export interface TraceDef {
  a: string;
  /** drawn dashed on the same axis */
  b?: string;
  lo?: number;
  hi?: number;
  /** the channel a finding is about, as opposed to context */
  key?: boolean;
}

export type Sev = 'crit' | 'warn' | 'info' | 'good';

export interface Occurrence {
  logKey: string;
  t0: number;
  t1: number;
  at: number;
  label: string;
  log?: Log;
}

export interface Finding {
  sev: Sev;
  area: string;
  title: string;
  evidence: string[];
  why?: string;
  steps?: string[];
  channels?: TraceDef[];
  logKey?: string;
  t0?: number;
  t1?: number;
  at?: number;
  occurrences?: Occurrence[];
  table?: 'ign' | 'fuel';
  /** the stretch of run A's power curve the finding is about, as computed before smoothing, and the point it names */
  dyno?: { at: Pt; pts: Pt[] };
  log?: Log;
}

export interface Table {
  rpmAx: number[];
  mapAx: number[];
  /** [map][rpm], NaN where empty */
  ign: number[][];
  fuel: number[][];
  cnt: number[][];
  fcnt: number[][];
}

/** Why one log has no pull. */
export interface NoPull {
  logKey: string;
  /** one line that starts "No pulls:" */
  reason: string;
}

export interface Overview {
  pulls: PullDto[];
  coarse: Table;
  fine: Table;
  findings: Finding[];
  samples: number;
  hz: number | null;
  ethanol: number | null;
  /** the sentence that says what a pull is, written from the core's rule */
  pullRule: string;
  /** why each log with no pull has none, in the library's order */
  noPulls: NoPull[];
}

export interface DynoOut {
  runs: (Dyno | null)[];
  band: { lo: Pt[]; hi: Pt[] } | null;
  checks: Finding[];
}

/**
 * One switch chip of the replay: a group of on/off channels that are one signal over the whole log, shown because
 * its named channel changes inside the span. Everything but `also` comes from the named channel alone.
 * Times are log seconds, clipped to the span.
 */
export interface SwitchRow {
  /** the channel the row is built from: the shortest name in its group */
  name: string;
  /** the other channels in the group, shortest name first; their changes can be a sample off the named channel's */
  also: string[];
  /** [start, end] while the named channel is on; one that starts on the last sample of the span has no length */
  on: [number, number][];
  /** [start, end] where the named channel has no samples */
  gaps: [number, number][];
  /** when the named channel changes */
  changes: number[];
}

export interface Switches {
  rows: SwitchRow[];
  /** signals whose named channel changes inside the span and that were left out by the core's limit (`MAX_SWITCHES` in `switches.rs`) */
  more: number;
}

/**
 * One state chip: a channel that holds one of a few whole-number readings (Gear, Engine State), shown because it changes
 * inside the span. Times are log seconds, clipped to the span.
 */
export interface StateRow {
  name: string;
  /** [start, end, reading] from one change to the next; one that starts on the last sample of the span has no length */
  sections: [number, number, number][];
  /** [start, end] where the channel has no samples */
  gaps: [number, number][];
  /** when the channel changes */
  changes: number[];
}

export interface States {
  rows: StateRow[];
  /** states that change inside the span and that were left out by the core's limit (`MAX_STATES` in `states.rs`) */
  more: number;
}

/** The switches and the states that change in a span: what the replay's chips show. */
export interface Chips {
  switches: Switches;
  states: States;
}

/** Vehicle in SI units, as the core wants it. */
export interface Vehicle {
  mass: number;
  unc: number;
  cda: number;
  crr: number;
  ie: number;
  mrot: number;
  window: number;
  /** rpm, half-width of the smoothing along the power curve; 0 is off */
  smooth: number;
  tire: string;
  fd: number | null;
  gears: number[];
  speedSrc: string;
}

export interface View {
  traces: TraceDef[];
  readouts: string[];
}

/** Everything the app remembers between launches. Stored by the core as settings.json. */
export interface Settings {
  veh?: Record<string, string>;
  model?: string;
  speedSrc?: string;
  smooth?: string;
  views?: Record<string, View>;
  viewName?: string;
  working?: View;
  names?: { logs: Record<string, string>; pulls: Record<string, string> };
  watchDir?: string;
  /** "Show switches and states that change" in the Channels picker; on unless this is false */
  switches?: boolean;
}
