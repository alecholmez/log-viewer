// Canvas drawing: the power chart, the replay traces and the 3D table.

import { atRpm, clamp, curveAtTime, idxAt, quant, valAt } from './data';
import { $, RUN, S, chInfo, css, curTable, curView, fmt, hideTip, mix, niceStep, prep, series, showTip, theme } from './state';
import type { Cell, ChInfo, RGB, TipRow } from './state';
import type { Log, Pt, Pull, Table, TraceDef } from './types';

const TAU = 6.2832;

// ---------- power chart ----------

let dynoGeom: { l: number; pw: number; x0: number; x1: number } | null = null;

export function drawDyno(): void {
  if (S.showTable) return;
  const { ctx, w, h } = prep($<HTMLCanvasElement>('dyno-cv'));
  const th = theme();
  const cores: Pt[][] = S.dyn.map(d => (d ? d.core : []));
  const all = cores.flat();
  ctx.font = '12px ' + th.body;
  if (!all.length) {
    ctx.fillStyle = th.ink2;
    ctx.fillText(S.logs.length ? 'Pick a pull as run A.' : 'Add a log to see estimated power.', 12, 24);
    dynoGeom = null;
    return;
  }
  const m = { l: 40, r: 50, t: 10, b: 30 };
  const pw = w - m.l - m.r;
  const ph = h - m.t - m.b;
  const x0 = Math.floor(Math.min(...all.map(p => p.rpm)) / 500) * 500;
  const x1 = Math.ceil(Math.max(...all.map(p => p.rpm)) / 500) * 500;
  let ymax = 0;
  for (const p of all) {
    if (S.view !== 'tq') ymax = Math.max(ymax, p.hp);
    if (S.view !== 'hp') ymax = Math.max(ymax, p.tq);
  }
  if (S.band && S.view !== 'tq') for (const p of S.band.hi) ymax = Math.max(ymax, p.hp);
  const ys = niceStep(ymax * 1.06, 5);
  const y1 = Math.ceil((ymax * 1.06) / ys) * ys;
  const X = (r: number) => m.l + ((r - x0) / (x1 - x0)) * pw;
  const Y = (v: number) => m.t + ph - (v / y1) * ph;
  dynoGeom = { l: m.l, pw, x0, x1 };

  // axes
  ctx.lineWidth = 1;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillStyle = th.ink3;
  ctx.font = '11.5px ' + th.body;
  for (let v = 0; v <= y1 + 1e-6; v += ys) {
    const y = Math.round(Y(v)) + 0.5;
    ctx.strokeStyle = v === 0 ? th.rule : th.grid;
    ctx.beginPath();
    ctx.moveTo(m.l, y);
    ctx.lineTo(m.l + pw, y);
    ctx.stroke();
    ctx.fillText(fmt(v), m.l - 7, y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const xs = pw / ((x1 - x0) / 500) < 46 ? 1000 : 500;
  for (let r = Math.ceil(x0 / xs) * xs; r <= x1; r += xs) {
    const x = Math.round(X(r)) + 0.5;
    ctx.strokeStyle = th.grid;
    ctx.beginPath();
    ctx.moveTo(x, m.t + ph);
    ctx.lineTo(x, m.t + ph + 4);
    ctx.stroke();
    ctx.fillText(fmt(r), x, m.t + ph + 7);
  }
  ctx.textAlign = 'right';
  ctx.fillText('rpm', m.l + pw, m.t + ph + 19);

  // weight-uncertainty band on run A
  if (S.band && S.view !== 'tq' && S.band.lo.length) {
    ctx.beginPath();
    S.band.hi.forEach((p, i) => (i ? ctx.lineTo(X(p.rpm), Y(p.hp)) : ctx.moveTo(X(p.rpm), Y(p.hp))));
    for (let i = S.band.lo.length - 1; i >= 0; i--) ctx.lineTo(X(S.band.lo[i].rpm), Y(S.band.lo[i].hp));
    ctx.closePath();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = th.run[0];
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  const line = (c: Pt[], key: 'hp' | 'tq', color: string, dash: boolean) => {
    if (!c.length) return;
    ctx.beginPath();
    c.forEach((p, i) => (i ? ctx.lineTo(X(p.rpm), Y(p[key])) : ctx.moveTo(X(p.rpm), Y(p[key]))));
    ctx.setLineDash(dash ? [6, 4] : []);
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.setLineDash([]);
  };
  for (let r = 2; r >= 0; r--) if (S.view !== 'hp') line(cores[r], 'tq', th.run[r], true);
  for (let r = 2; r >= 0; r--) if (S.view !== 'tq') line(cores[r], 'hp', th.run[r], false);

  // direct labels at the end of run A
  const A = cores[0];
  if (A.length) {
    const last = A[A.length - 1];
    const lx = X(last.rpm) + 7;
    let yh = Y(last.hp);
    let yt = Y(last.tq);
    if (S.view === 'both' && Math.abs(yh - yt) < 13) {
      const mid = (yh + yt) / 2;
      if (yh < yt) {
        yh = mid - 6.5;
        yt = mid + 6.5;
      } else {
        yh = mid + 6.5;
        yt = mid - 6.5;
      }
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = th.ink2;
    ctx.font = '700 11.5px ' + th.body;
    if (S.view !== 'tq') ctx.fillText('whp', lx, yh);
    if (S.view !== 'hp') ctx.fillText('lb-ft', lx, yt);
  }

  const dot = (x: number, y: number, color: string) => {
    ctx.beginPath();
    ctx.arc(x, y, 6.5, 0, TAU);
    ctx.fillStyle = th.surface;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, TAU);
    ctx.fillStyle = color;
    ctx.fill();
  };
  // replay position on run A
  const rNow = S.focus && S.runs[0] && S.focus.log === S.runs[0].log ? curveAtTime(A, S.t, 'rpm') : NaN;
  if (rNow === rNow) {
    const x = X(rNow);
    ctx.strokeStyle = th.ink;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, m.t);
    ctx.lineTo(x, m.t + ph);
    ctx.stroke();
    ctx.setLineDash([]);
    if (S.view !== 'hp') dot(x, Y(curveAtTime(A, S.t, 'tq')), th.run[0]);
    if (S.view !== 'tq') dot(x, Y(curveAtTime(A, S.t, 'hp')), th.run[0]);
  }
  if (S.hoverRpm !== null) {
    const x = Math.round(X(S.hoverRpm)) + 0.5;
    ctx.strokeStyle = th.ink3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, m.t);
    ctx.lineTo(x, m.t + ph);
    ctx.stroke();
    for (let r = 2; r >= 0; r--) {
      for (const key of ['tq', 'hp'] as const) {
        if ((key === 'tq' && S.view === 'hp') || (key === 'hp' && S.view === 'tq')) continue;
        const v = atRpm(cores[r], S.hoverRpm, key);
        if (v === v) dot(x, Y(v), th.run[r]);
      }
    }
  }
}

export function dynoHover(e: PointerEvent): void {
  if (!dynoGeom) return;
  const r = $('dyno-cv').getBoundingClientRect();
  const g = dynoGeom;
  const x = e.clientX - r.left;
  if (x < g.l || x > g.l + g.pw) {
    S.hoverRpm = null;
    hideTip();
    drawDyno();
    return;
  }
  const rpm = Math.round((g.x0 + ((x - g.l) / g.pw) * (g.x1 - g.x0)) / 10) * 10;
  const th = theme();
  const rows: TipRow[] = [];
  const hp: number[] = [];
  S.hoverRpm = rpm;
  S.dyn.forEach((d, i) => {
    const v = d ? atRpm(d.core, rpm, 'hp') : NaN;
    hp.push(v);
    if (d && v === v) {
      rows.push({ label: RUN[i] + ' power', value: fmt(v) + ' whp', color: th.run[i] });
      rows.push({ label: RUN[i] + ' torque', value: fmt(atRpm(d.core, rpm, 'tq')) + ' lb-ft', color: th.run[i], dash: true });
    }
  });
  for (let i = 1; i < 3; i++) {
    if (hp[0] === hp[0] && hp[i] === hp[i])
      rows.push({ label: 'A − ' + RUN[i], value: (hp[0] - hp[i] >= 0 ? '+' : '−') + fmt(Math.abs(hp[0] - hp[i])) + ' whp' });
  }
  if (!rows.length) rows.push({ label: 'No run covers this RPM', value: '' });
  showTip(e.clientX, e.clientY, fmt(rpm) + ' rpm', rows);
  drawDyno();
}

// ---------- traces ----------

/** Trace geometry: left gutter, right gutter for live values, label row, panel height, gap, time axis. */
export const TG = { l: 46, r: 92, lab: 17, ph: 53, gap: 6, axis: 22 };

interface Span {
  log: Log;
  i0: number;
  i1: number;
  /** run index in RPM mode */
  r?: number;
  first: boolean;
}
interface Panel extends TraceDef {
  y0: number;
  vlo: number;
  vhi: number;
  ia: ChInfo;
  ib: ChInfo | null;
}
export interface TraceLayout {
  pw: number;
  rpmMode: boolean;
  spans: Span[];
  x0: number;
  x1: number;
  X: (v: number) => number;
  panels: Panel[];
}

let trCache: { key: string; off: HTMLCanvasElement } | null = null;
let trGeom: TraceLayout | null = null;
export const traceLayout = () => trGeom;
export const dropTraceCache = () => {
  trCache = null;
};

function trLayout(w: number): TraceLayout {
  const f = S.focus!;
  const pw = w - TG.l - TG.r;
  const rpmMode = S.xmode === 'rpm';
  const spans: Span[] = [];
  let x0: number;
  let x1: number;
  if (rpmMode) {
    S.runs.forEach((p, r) => {
      if (p) spans.push({ log: p.log, i0: p.i0, i1: p.i1, r, first: r === 0 });
    });
    let a = Infinity;
    let b = -Infinity;
    for (const sp of spans) {
      for (let j = sp.i0; j <= sp.i1; j++) {
        const v = sp.log.ch.rpm[j];
        if (v < a) a = v;
        if (v > b) b = v;
      }
    }
    x0 = Math.floor(a / 500) * 500;
    x1 = Math.ceil(b / 500) * 500;
  } else {
    spans.push({ log: f.log, i0: idxAt(f.log, f.w0), i1: Math.min(f.log.n - 1, idxAt(f.log, f.w1) + 1), first: true });
    x0 = f.w0;
    x1 = f.w1;
  }
  const X = (v: number) => TG.l + ((v - x0) / (x1 - x0 || 1)) * pw;
  // y range per panel from whatever will be drawn
  const panels = curView().traces.map((p, i): Panel => {
    let lo = Infinity;
    let hi = -Infinity;
    const ia = chInfo(f.log, p.a);
    const lam = ia.unit === 'λ';
    const eat = (arr: Float32Array | null, i0: number, i1: number) => {
      if (!arr) return;
      for (let j = i0; j <= i1; j++) {
        let v = arr[j];
        if (v !== v) continue;
        if (lam) v = clamp(v, 0.6, 1.3);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    };
    for (const sp of spans) {
      eat(series(sp.log, p.a, sp.r), sp.i0, sp.i1);
      if (p.b && sp.first) eat(series(sp.log, p.b, sp.r), sp.i0, sp.i1);
    }
    if (p.lo !== undefined && p.hi !== undefined) {
      lo = p.lo;
      hi = p.hi;
    } else if (lo === Infinity) {
      lo = 0;
      hi = 1;
    } else {
      const pad = (hi - lo || Math.abs(hi) * 0.1 || 1) * 0.1;
      lo -= pad;
      hi += pad;
    }
    return { ...p, y0: i * (TG.lab + TG.ph + TG.gap) + TG.lab, vlo: lo, vhi: hi, ia, ib: p.b ? chInfo(f.log, p.b) : null };
  });
  return { pw, rpmMode, spans, x0, x1, X, panels };
}

const panelY = (p: Panel, v: number) => p.y0 + TG.ph - ((clamp(v, p.vlo, p.vhi) - p.vlo) / (p.vhi - p.vlo || 1)) * TG.ph;

export function drawTraces(): void {
  const wrap = $('tr-wrap');
  const n = curView().traces.length;
  const hpx = Math.max(1, n) * (TG.lab + TG.ph + TG.gap) + TG.axis + 4;
  if (wrap.style.height !== hpx + 'px') wrap.style.height = hpx + 'px';
  const cv = $<HTMLCanvasElement>('tr-cv');
  const { ctx, w, h, dpr } = prep(cv);
  const th = theme();
  const f = S.focus;
  const msg = (t: string) => {
    ctx.fillStyle = th.ink2;
    ctx.font = '12px ' + th.body;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(t, 12, 24);
    trGeom = null;
    $('tr-note').textContent = '';
  };
  if (!f) return msg('Add a log to replay it.');
  if (!n) return msg('No traces in this view. Open Channels and add some.');
  if (S.xmode === 'rpm' && !S.runs[0]) return msg('By RPM needs at least one pull selected as a run.');
  const L = trLayout(w);
  const key = [w, h, dpr, S.rev, S.xmode, th.surface].join('|');
  const bottom = L.panels[n - 1].y0 + TG.ph;
  const top = L.panels[0].y0;
  trGeom = L;

  // everything that does not move with the playhead is drawn once and cached
  if (!trCache || trCache.key !== key) {
    const off = document.createElement('canvas');
    off.width = cv.width;
    off.height = cv.height;
    const c = off.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const p of L.panels) {
      const flag = S.fview && p.key ? (S.fview.sev === 'crit' ? th.crit : S.fview.sev === 'warn' ? th.warn : th.ink2) : null;
      if (!L.rpmMode && f.m0 === f.m0) {
        c.fillStyle = flag || th.inset;
        c.globalAlpha = flag ? 0.2 : 1;
        c.fillRect(L.X(f.m0), p.y0, Math.max(2, L.X(f.m1) - L.X(f.m0)), TG.ph);
        c.globalAlpha = 1;
      }
      c.lineWidth = 1;
      c.strokeStyle = th.grid;
      c.beginPath();
      c.moveTo(TG.l, p.y0 + 0.5);
      c.lineTo(TG.l + L.pw, p.y0 + 0.5);
      c.stroke();
      c.strokeStyle = th.rule;
      c.beginPath();
      c.moveTo(TG.l, p.y0 + TG.ph + 0.5);
      c.lineTo(TG.l + L.pw, p.y0 + TG.ph + 0.5);
      c.stroke();

      const lbl = p.ia.label + (p.ia.unit && p.ia.unit !== 'λ' ? ', ' + p.ia.unit : '');
      const lx = TG.l + (flag ? 13 : 0);
      if (flag) {
        c.beginPath();
        c.arc(TG.l + 4.5, p.y0 - 9, 4.5, 0, TAU);
        c.fillStyle = flag;
        c.fill();
        c.strokeStyle = th.ink2;
        c.lineWidth = 0.75;
        c.stroke();
        c.font = '700 11px ' + th.body;
        c.fillStyle = th.ink2;
        c.textAlign = 'right';
        c.textBaseline = 'alphabetic';
        c.fillText('Flagged by this finding', TG.l + L.pw, p.y0 - 5);
      }
      c.font = '700 11.5px ' + th.body;
      c.fillStyle = flag ? th.ink : th.ink2;
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      c.fillText(lbl, lx, p.y0 - 5);
      if (p.ib) {
        const tw = c.measureText(lbl).width;
        c.font = '11.5px ' + th.body;
        c.fillStyle = th.ink3;
        c.fillText('   dashed: ' + p.ib.label.toLowerCase(), lx + tw, p.y0 - 5);
      }
      c.font = '11px ' + th.body;
      c.fillStyle = th.ink3;
      c.textAlign = 'right';
      c.textBaseline = 'top';
      c.fillText(fmt(p.vhi, p.ia.d), TG.l - 6, p.y0 + 1);
      c.textBaseline = 'bottom';
      c.fillText(fmt(p.vlo, p.ia.d), TG.l - 6, p.y0 + TG.ph);

      c.save();
      c.beginPath();
      c.rect(TG.l, p.y0, L.pw, TG.ph);
      c.clip();
      const path = (sp: Span, arr: Float32Array | null, color: string, dash: boolean, lw: number) => {
        if (!arr) return;
        const xs = L.rpmMode ? sp.log.ch.rpm : sp.log.t;
        c.beginPath();
        let pen = false;
        for (let j = sp.i0; j <= sp.i1; j++) {
          const v = arr[j];
          if (v !== v) {
            pen = false;
            continue;
          }
          const x = L.X(xs[j]);
          const y = panelY(p, v);
          if (pen) c.lineTo(x, y);
          else {
            c.moveTo(x, y);
            pen = true;
          }
        }
        c.setLineDash(dash ? [5, 4] : []);
        c.lineWidth = lw;
        c.lineJoin = 'round';
        c.strokeStyle = color;
        c.stroke();
        c.setLineDash([]);
      };
      for (let k = L.spans.length - 1; k >= 0; k--) {
        const sp = L.spans[k];
        if (p.b && sp.first) path(sp, series(sp.log, p.b, sp.r), th.ink3, true, 1.5);
      }
      for (let k = L.spans.length - 1; k >= 0; k--) {
        const sp = L.spans[k];
        path(sp, series(sp.log, p.a, sp.r), th.run[sp.r || 0], false, 2);
      }
      c.restore();
    }

    // x axis
    c.font = '11px ' + th.body;
    c.fillStyle = th.ink3;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.strokeStyle = th.rule;
    c.lineWidth = 1;
    const tick = (x: number, text: string) => {
      c.beginPath();
      c.moveTo(Math.round(x) + 0.5, bottom);
      c.lineTo(Math.round(x) + 0.5, bottom + 4);
      c.stroke();
      c.fillText(text, x, bottom + 7);
    };
    if (L.rpmMode) {
      const st = L.pw / ((L.x1 - L.x0) / 500) < 46 ? 1000 : 500;
      for (let r = Math.ceil(L.x0 / st) * st; r <= L.x1; r += st) tick(L.X(r), fmt(r) + (r + st > L.x1 ? ' rpm' : ''));
    } else {
      const span = L.x1 - L.x0;
      const st = niceStep(span, Math.max(3, Math.floor(L.pw / 70)));
      for (let s = 0; s <= span + 1e-6; s += st) tick(L.X(L.x0 + s), (st < 1 ? s.toFixed(1) : s) + ' s');
      // markers where findings sit in this window
      const marks: { log?: Log; at?: number; sev?: string }[] = [...S.runFindings];
      for (const g of S.findings) marks.push(...(g.occurrences || [g]));
      for (const g of marks) {
        if (g.log !== f.log || g.at === undefined || g.at < f.w0 || g.at > f.w1) continue;
        if (g.sev && g.sev !== 'warn' && g.sev !== 'crit') continue;
        const x = L.X(g.at);
        c.fillStyle = g.sev === 'warn' ? th.warn : th.crit;
        c.beginPath();
        c.moveTo(x, bottom + 1);
        c.lineTo(x - 4.5, bottom + 8);
        c.lineTo(x + 4.5, bottom + 8);
        c.closePath();
        c.fill();
        c.strokeStyle = th.ink2;
        c.lineWidth = 0.75;
        c.stroke();
        c.strokeStyle = th.rule;
        c.lineWidth = 1;
      }
    }
    trCache = { key, off };
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(trCache.off, 0, 0);
  ctx.restore();

  if (S.hoverX !== null) {
    const x = Math.round(L.X(S.hoverX)) + 0.5;
    ctx.strokeStyle = th.ink3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  }
  // playhead: run A's log in RPM mode, the focused log in time mode
  let head: { log: Log; x: number } | null;
  if (L.rpmMode) head = f.pull === S.runs[0] && S.t >= f.m0 && S.t <= f.m1 ? { log: f.log, x: L.X(valAt(f.log, f.log.ch.rpm, S.t)) } : null;
  else head = { log: f.log, x: L.X(S.t) };
  if (head) {
    ctx.strokeStyle = th.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(head.x, top - 4);
    ctx.lineTo(head.x, bottom);
    ctx.stroke();
  }
  const runIdx = L.rpmMode ? 0 : undefined;
  for (const p of L.panels) {
    const v = head ? valAt(head.log, series(head.log, p.a, runIdx), S.t) : NaN;
    if (head && v === v) {
      const y = panelY(p, v);
      ctx.beginPath();
      ctx.arc(head.x, y, 5.5, 0, TAU);
      ctx.fillStyle = th.surface;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(head.x, y, 3.5, 0, TAU);
      ctx.fillStyle = th.run[0];
      ctx.fill();
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = th.ink;
    ctx.font = '900 16px ' + th.disp;
    ctx.fillText(fmt(v, p.ia.d), TG.l + L.pw + 10, p.y0 + TG.ph / 2 - (p.ib ? 5 : 0));
    if (p.ib && p.b && head) {
      ctx.font = '11px ' + th.body;
      ctx.fillStyle = th.ink3;
      const vb = valAt(head.log, series(head.log, p.b, runIdx), S.t);
      ctx.fillText(fmt(vb, p.ib.d) + ' ' + p.ib.label.toLowerCase().split(' ').pop(), TG.l + L.pw + 10, p.y0 + TG.ph / 2 + 12);
    }
  }
  $('tr-note').textContent = L.rpmMode
    ? 'Each selected run is drawn against its own RPM in its run colour. Click to move the playhead on run A.'
    : 'Click or drag to move the playhead.' + (f.m0 === f.m0 ? ' The shaded span is the selected pull or finding.' : '');
}

/** Pointer position on the trace x axis, in seconds or RPM. */
export function trX(e: PointerEvent): number {
  const r = $('tr-cv').getBoundingClientRect();
  const L = trGeom!;
  return clamp(L.x0 + ((e.clientX - r.left - TG.l) / L.pw) * (L.x1 - L.x0), L.x0, L.x1);
}

/** Value of a channel on one run at a given RPM. */
export function atRunRpm(p: Pull, arr: Float32Array | null, rpm: number): number {
  if (!arr) return NaN;
  const x = p.log.ch.rpm;
  for (let j = p.i0 + 1; j <= p.i1; j++) {
    if (x[j] >= rpm && x[j - 1] <= rpm) {
      const f = x[j] === x[j - 1] ? 0 : (rpm - x[j - 1]) / (x[j] - x[j - 1]);
      return arr[j - 1] + (arr[j] - arr[j - 1]) * f;
    }
  }
  return NaN;
}

// ---------- ignition and fuel tables ----------

/** Fuel colour range in percent: wide enough for most cells, capped so a few bad cells do not flatten the rest. */
function fuelRange(T: Table): number {
  const a: number[] = [];
  for (const row of T.fuel) for (const v of row) if (v === v) a.push(Math.abs(v));
  return a.length ? clamp(Math.ceil(quant(a, 0.9) / 5) * 5, 5, 25) : 10;
}

export interface TableScale {
  fuel: boolean;
  grid: number[][];
  dmin: number;
  dmax: number;
  R: number;
  color: (v: number) => RGB;
  empty: boolean;
}

export function tableScale(T: Table): TableScale {
  const fuel = S.tmode === 'fuel';
  const grid = fuel ? T.fuel : T.ign;
  let dmin = Infinity;
  let dmax = -Infinity;
  for (const row of grid) {
    for (const v of row) {
      if (v !== v) continue;
      if (v < dmin) dmin = v;
      if (v > dmax) dmax = v;
    }
  }
  const R = fuel ? fuelRange(T) : 0;
  const th = theme();
  const color = (v: number) =>
    fuel
      ? v < 0
        ? mix(th.divMid, th.divNeg, clamp(-v / R, 0, 1))
        : mix(th.divMid, th.divPos, clamp(v / R, 0, 1))
      : mix(th.seqLo, th.seqHi, dmax > dmin ? (v - dmin) / (dmax - dmin) : 0.5);
  return { fuel, grid, dmin, dmax, R, color, empty: dmin === Infinity };
}

export function draw3d(): void {
  if (S.tview[S.tmode] !== '3d') return;
  const cv = $<HTMLCanvasElement>('t3-cv');
  const { ctx, w, h } = prep(cv);
  const th = theme();
  const T = curTable();
  S.t3hit = [];
  if (!T) return;
  const sc = tableScale(T);
  const fuel = sc.fuel;
  const nr = T.rpmAx.length;
  const nm = T.mapAx.length;
  if (sc.empty) {
    ctx.fillStyle = th.ink2;
    ctx.font = '12px ' + th.body;
    ctx.fillText(S.logs.length ? 'No cells have enough samples yet.' : 'Add a log to fill the table.', 12, 24);
    return;
  }
  const zs = fuel ? (sc.R > 10 ? 10 : 5) : 10;
  const z0 = fuel ? -sc.R : Math.min(0, sc.dmin);
  const z1 = fuel ? sc.R : Math.max(zs, Math.ceil(sc.dmax / zs) * zs);
  const W = 2;
  const D = 1.36;
  const H = 1.05;
  const ca = Math.cos(S.az);
  const sa = Math.sin(S.az);
  const ce = Math.cos(S.el);
  const se = Math.sin(S.el);
  // rotate about the vertical axis, then tilt; the third value is depth for sorting
  const P = (x: number, y: number, z: number) => {
    const Xr = x * ca - y * sa;
    const Yr = x * sa + y * ca;
    return [Xr, Yr * se - z * ce, Yr];
  };
  let bx0 = Infinity;
  let bx1 = -Infinity;
  let by0 = Infinity;
  let by1 = -Infinity;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const z of [0, H]) {
        const p = P(sx * (W / 2 + 0.26), sy * (D / 2 + 0.26), z);
        bx0 = Math.min(bx0, p[0]);
        bx1 = Math.max(bx1, p[0]);
        by0 = Math.min(by0, p[1]);
        by1 = Math.max(by1, p[1]);
      }
    }
  }
  const scl = Math.min((w - 16) / (bx1 - bx0), (h - 12) / (by1 - by0));
  const ox = w / 2 - ((bx0 + bx1) / 2) * scl;
  const oy = h / 2 - ((by0 + by1) / 2) * scl;
  const pr = (x: number, y: number, z: number) => {
    const p = P(x, y, z);
    return [ox + p[0] * scl, oy + p[1] * scl, p[2]];
  };
  const fx = (r: number) => (r / (nr - 1) - 0.5) * W;
  const fy = (m: number) => (0.5 - m / (nm - 1)) * D;
  const fz = (v: number) => ((clamp(v, z0, z1) - z0) / (z1 - z0)) * H;
  const rStep = T.rpmAx[1] - T.rpmAx[0];
  const mStep = T.mapAx[1] - T.mapAx[0];
  const rIdx = (rpm: number) => (rpm - T.rpmAx[0]) / rStep;
  const mIdx = (kpa: number) => (kpa - T.mapAx[0]) / mStep;
  const poly = (pts: number[][]) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
  };
  const seg = (a: number[], b: number[]) => {
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  };
  const hx = W / (nr - 1) / 2;
  const hy = D / (nm - 1) / 2;
  const zBase = fz(fuel ? 0 : z0);

  // base plane: zero advance for ignition, zero correction for fuel
  poly([
    pr(-W / 2 - hx, -D / 2 - hy, zBase),
    pr(W / 2 + hx, -D / 2 - hy, zBase),
    pr(W / 2 + hx, D / 2 + hy, zBase),
    pr(-W / 2 - hx, D / 2 + hy, zBase),
  ]);
  ctx.fillStyle = th.inset;
  ctx.fill();
  ctx.strokeStyle = th.rule;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = th.grid;
  for (let rpm = 1000; rpm <= 6000; rpm += 1000) seg(pr(fx(rIdx(rpm)), -D / 2 - hy, zBase), pr(fx(rIdx(rpm)), D / 2 + hy, zBase));
  for (let k = 40; k <= 160; k += 40) seg(pr(-W / 2 - hx, fy(mIdx(k)), zBase), pr(W / 2 + hx, fy(mIdx(k)), zBase));

  // axis labels on the edges facing the viewer
  const sxn = sa >= 0 ? 1 : -1;
  const syn = ca >= 0 ? 1 : -1;
  const yE = syn * (D / 2 + hy + 0.12);
  const xE = sxn * (W / 2 + hx + 0.14);
  ctx.font = '11px ' + th.body;
  ctx.fillStyle = th.ink3;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let rpm = 1000; rpm <= 6000; rpm += 1000) {
    const p = pr(fx(rIdx(rpm)), yE, zBase);
    ctx.fillText(String(rpm / 1000) + (rpm === 6000 ? 'k rpm' : 'k'), p[0], p[1]);
  }
  for (let k = 40; k <= 160; k += 40) {
    const p = pr(xE, fy(mIdx(k)), zBase);
    ctx.fillText(String(k) + (k === 160 ? ' kPa' : ''), p[0], p[1]);
  }
  // value axis on the left-most side corner
  const c1 = [-sxn * (W / 2 + hx), syn * (D / 2 + hy)];
  const c2 = [sxn * (W / 2 + hx), -syn * (D / 2 + hy)];
  const post = pr(c1[0], c1[1], 0)[0] < pr(c2[0], c2[1], 0)[0] ? c1 : c2;
  ctx.strokeStyle = th.rule;
  seg(pr(post[0], post[1], 0), pr(post[0], post[1], H));
  ctx.textAlign = 'right';
  for (let v = z0; v <= z1 + 1e-6; v += zs) {
    const t = pr(post[0], post[1], fz(v));
    seg([t[0] - 4, t[1]], t);
    ctx.fillText((fuel && v > 0 ? '+' : '') + fmt(v) + (fuel ? '%' : '°'), t[0] - 7, t[1]);
  }

  // one bar per cell, drawn back to front
  const cells: Cell[] = [];
  for (let m = 0; m < nm; m++) {
    for (let r = 0; r < nr; r++) {
      const v = sc.grid[m][r];
      if (v === v) cells.push({ r, m, v, d: P(fx(r), fy(m), 0)[2] });
    }
  }
  cells.sort((a, b) => a.d - b.d);
  const gx = hx * 0.86;
  const gy = hy * 0.86;
  for (const c of cells) {
    const x = fx(c.r);
    const y = fy(c.m);
    const zv = fz(c.v);
    const za = Math.min(zBase, zv);
    const zb = Math.max(zBase, zv);
    const col = sc.color(c.v);
    ctx.lineWidth = 0.75;
    ctx.strokeStyle = th.surface;
    ctx.lineJoin = 'round';
    if (zb - za > 0.004) {
      poly([pr(x + sxn * gx, y - gy, za), pr(x + sxn * gx, y + gy, za), pr(x + sxn * gx, y + gy, zb), pr(x + sxn * gx, y - gy, zb)]);
      ctx.fillStyle = css(col, 0.66);
      ctx.fill();
      ctx.stroke();
      poly([pr(x - gx, y + syn * gy, za), pr(x + gx, y + syn * gy, za), pr(x + gx, y + syn * gy, zb), pr(x - gx, y + syn * gy, zb)]);
      ctx.fillStyle = css(col, 0.82);
      ctx.fill();
      ctx.stroke();
    }
    poly([pr(x - gx, y - gy, zb), pr(x + gx, y - gy, zb), pr(x + gx, y + gy, zb), pr(x - gx, y + gy, zb)]);
    ctx.fillStyle = css(col);
    ctx.fill();
    ctx.stroke();
    const top = pr(x, y, zb);
    S.t3hit.push({ x: top[0], y: top[1], c });
    if (S.t3hover && S.t3hover.r === c.r && S.t3hover.m === c.m) {
      ctx.strokeStyle = th.ink;
      ctx.lineWidth = 1.75;
      ctx.stroke();
    }
  }

  // run A's path across the table
  const A = S.runs[0];
  if (A) {
    const cc = A.log.ch;
    const pts: number[][] = [];
    for (let i = A.i0; i <= A.i1; i++) {
      if (cc.map[i] !== cc.map[i]) continue;
      pts.push(pr(fx(clamp(rIdx(cc.rpm[i]), 0, nr - 1)), fy(clamp(mIdx(cc.map[i]), 0, nm - 1)), fuel ? zBase : fz(cc.ign[i]) || zBase));
    }
    const stroke = (color: string, lw: number) => {
      ctx.beginPath();
      pts.forEach((t, i) => (i ? ctx.lineTo(t[0], t[1]) : ctx.moveTo(t[0], t[1])));
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    };
    if (pts.length > 1) {
      stroke(th.surface, 4.5);
      stroke(th.ink, 1.75);
    }
  }

  // replay position
  const f = S.focus;
  if (f) {
    const cc = f.log.ch;
    const i = idxAt(f.log, S.t);
    const rpm = cc.rpm[i];
    const kpa = cc.map[i];
    if (rpm > 400 && kpa === kpa) {
      const val = fuel ? ((cc.lam[i] / cc.lamT[i]) * (1 + (cc.stft[i] || 0) / 100) * (1 + (cc.ltft[i] || 0) / 100) - 1) * 100 : cc.ign[i];
      const x = fx(clamp(rIdx(rpm), 0, nr - 1));
      const y = fy(clamp(mIdx(kpa), 0, nm - 1));
      const b0 = pr(x, y, zBase);
      const b1 = pr(x, y, val === val ? fz(val) : zBase);
      ctx.strokeStyle = th.ink;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      seg(b0, b1);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(b1[0], b1[1], 7.5, 0, TAU);
      ctx.fillStyle = th.surface;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(b1[0], b1[1], 5, 0, TAU);
      ctx.fillStyle = th.ink;
      ctx.fill();
      const txt = val === val ? (fuel ? (val >= 0 ? '+' : '−') + fmt(Math.abs(val), 1) + '%' : fmt(val, 1) + '°') : '–';
      ctx.font = '700 12.5px ' + th.body;
      const tw = ctx.measureText(txt).width;
      const lx = clamp(b1[0] + 11, 4, w - tw - 10);
      const ly = clamp(b1[1] - 12, 12, h - 12);
      ctx.fillStyle = th.surface;
      ctx.globalAlpha = 0.88;
      ctx.fillRect(lx - 4, ly - 9, tw + 8, 18);
      ctx.globalAlpha = 1;
      ctx.fillStyle = th.ink;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, lx, ly);
    }
  }
}

export function t3Hover(e: PointerEvent): void {
  const r = $('t3-cv').getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  const T = curTable();
  let best: Cell | null = null;
  let bd = 18 * 18;
  for (const hpt of S.t3hit) {
    const d = (hpt.x - x) * (hpt.x - x) + (hpt.y - y) * (hpt.y - y);
    if (d < bd) {
      bd = d;
      best = hpt.c;
    }
  }
  const prev = S.t3hover;
  S.t3hover = best;
  if (best && T) {
    const fuel = S.tmode === 'fuel';
    showTip(e.clientX, e.clientY, fmt(T.rpmAx[best.r]) + ' rpm · ' + T.mapAx[best.m] + ' kPa', [
      {
        label: fuel ? 'Fuel correction' : 'Ignition advance',
        value: fuel ? (best.v >= 0 ? '+' : '−') + fmt(Math.abs(best.v), 1) + '%' : fmt(best.v, 1) + '° BTDC',
      },
      { label: 'Samples', value: fmt((fuel ? T.fcnt : T.cnt)[best.m][best.r]) },
    ]);
  } else hideTip();
  if (prev?.r !== best?.r || prev?.m !== best?.m) draw3d();
}
