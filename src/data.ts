// Log data on the UI side: the core sends channel metadata as JSON and samples as one f32 blob.

import type { ChannelMeta, Log, LogMeta, Pt, Table } from './types';

/** NSP channel names the UI reads by role. Other ECUs will map their own names onto the same roles. */
const KEY = {
  rpm: 'RPM',
  map: 'Manifold Pressure',
  baro: 'Barometric Pressure',
  vss: 'Vehicle Speed',
  ign: 'Ignition Angle',
  lam: 'Wideband O2 Overall',
  lamT: 'Target Lambda',
  stft: 'O2 Control Bank 1 Short Term Fuel Trim',
  ltft: 'O2 Control Bank 1 Long Term Fuel Trim',
} as const;

export function buildLog(m: LogMeta, blob: ArrayBuffer): Log {
  const series = m.channels.filter(c => !c.constant);
  if (blob.byteLength !== (1 + series.length) * m.n * 4) throw new Error('Log data for ' + m.name + ' has the wrong size.');
  const all = new Float32Array(blob);
  const cols = new Map<string, Float32Array>();
  series.forEach((c, k) => cols.set(c.name, all.subarray((k + 1) * m.n, (k + 2) * m.n)));
  const log: Log = {
    key: m.key,
    name: m.name,
    start: m.start,
    startedAt: m.startedAt,
    n: m.n,
    hz: m.hz,
    duration: m.duration,
    t: all.subarray(0, m.n),
    names: m.channels.map(c => c.name),
    meta: new Map(m.channels.map(c => [c.name, c])),
    cols,
    ch: null as never,
    calc: {},
  };
  const get = (name: string) => chan(log, name) ?? new Float32Array(m.n).fill(NaN);
  log.ch = {
    rpm: get(KEY.rpm),
    map: get(KEY.map),
    baro: get(KEY.baro),
    vss: get(KEY.vss),
    ign: get(KEY.ign),
    lam: get(KEY.lam),
    lamT: get(KEY.lamT),
    stft: get(KEY.stft),
    ltft: get(KEY.ltft),
  };
  return log;
}

/** A channel in engineering units, or null if the log does not have it. */
export function chan(log: Log, name: string): Float32Array | null {
  const got = log.cols.get(name);
  if (got) return got;
  const m = log.meta.get(name);
  if (!m) return null;
  // a channel that never changes: materialise it once
  const a = new Float32Array(log.n).fill(m.value ?? NaN);
  log.cols.set(name, a);
  return a;
}

const NO_META: ChannelMeta = { name: '', unit: '', d: 0, constant: true };
export const chanMeta = (log: Log, name: string): ChannelMeta => log.meta.get(name) ?? NO_META;

/** JSON has no NaN: the core's empty cells arrive as null. */
export function fixTable(t: Table): Table {
  const nan = (g: (number | null)[][]) => g.map(row => row.map(v => (v === null ? NaN : v)));
  return { ...t, ign: nan(t.ign), fuel: nan(t.fuel) };
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Index of the last sample at or before t. */
export function idxAt(log: Log, t: number): number {
  let lo = 0;
  let hi = log.n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (log.t[m] <= t) lo = m;
    else hi = m;
  }
  return lo;
}

/** A channel's value at time t, interpolated between samples. */
export function valAt(log: Log, arr: Float32Array | null, t: number): number {
  if (!arr) return NaN;
  const i = idxAt(log, t);
  const j = Math.min(log.n - 1, i + 1);
  const a = arr[i];
  const b = arr[j];
  if (a !== a) return b;
  if (b !== b || log.t[j] === log.t[i]) return a;
  return a + (b - a) * clamp((t - log.t[i]) / (log.t[j] - log.t[i]), 0, 1);
}

/** A dyno curve's value at time t. */
export function curveAtTime(core: Pt[], t: number, key: 'rpm' | 'hp' | 'tq'): number {
  if (!core.length || t < core[0].t || t > core[core.length - 1].t) return NaN;
  for (let i = 1; i < core.length; i++) {
    if (core[i].t >= t) {
      const a = core[i - 1];
      const b = core[i];
      const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return a[key] + (b[key] - a[key]) * f;
    }
  }
  return NaN;
}

/** A dyno curve's value at an engine speed. */
export function atRpm(core: Pt[], rpm: number, key: 'hp' | 'tq'): number {
  if (!core.length || rpm < core[0].rpm || rpm > core[core.length - 1].rpm) return NaN;
  for (let i = 1; i < core.length; i++) {
    if (core[i].rpm >= rpm) {
      const a = core[i - 1];
      const b = core[i];
      const f = b.rpm === a.rpm ? 0 : (rpm - a.rpm) / (b.rpm - a.rpm);
      return a[key] + (b[key] - a[key]) * f;
    }
  }
  return NaN;
}

export function quant(values: number[], q: number): number {
  const a = values.filter(v => v === v).sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : NaN;
}
