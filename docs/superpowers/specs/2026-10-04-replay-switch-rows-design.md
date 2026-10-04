# Replay: switch rows

Status: design, waiting for review. Nothing here is built.

## Why

Many logged channels are switches: clutch, brake, launch control, decel cut, cam control output. They read 0 or 1.
Drawn as a line graph a switch is a square wave that takes a full trace lane and says little.
What matters is when it turned on and off during the pull, against the other traces.

In the eight sample logs, 19 on/off channels change at least once and 131 never change. Some are the same signal under several names
(Clutch State, AVI6 Switch State and Clutch Switch Input State are identical sample for sample).

## What the user sees

Under the traces in the replay, a block of thin rows, one per switch, sharing the time axis and the playhead.

- A row is a label on the left, a bar across the time axis that is filled while the switch is on, and `On` or `Off` at the playhead on the right.
- Rows appear on their own. A switch gets a row when it changes inside the time span the replay is showing. A switch that stays on or off for the whole span gets no row.
- Signals that are identical across the whole log share one row. The row carries the shortest name; the tooltip lists the others.
- At most 8 rows, in order of first change. If more qualify, the note under the traces says how many are not shown.
- Pointing at a row draws a thin vertical line through the traces at each of its changes. No other row draws these, so the traces stay clean.
- A stretch with no samples is left empty, and the readout shows a dash there.
- By RPM mode hides the rows: a switch against engine speed is not a timeline. The note says so.
- One control, a checkbox in the Channels picker: "Show switches that change". On by default, saved with the other settings.
- A switch the user adds as a trace from the picker is still drawn as a trace. The rows do not replace that.

## What counts as a switch

Decided in the core, from the data, because NSP exports switches as plain numbers with no type that marks them.

- Every sample in the whole log that is present is exactly 0 or 1, and both values occur.
- A channel with any other value, or with one value only, is not a switch.

## Out of scope

- Channels with a small set of states (gear, launch control state, active table). They need value labels the log does not carry. They stay as traces.
- Choosing, reordering or colouring rows by hand.

## How it is built

Numbers come from the core; the UI draws.

- `crates/core/src/switches.rs`, new. `switches(log, t0, t1, limit)` returns rows:
  `{ name, also: [names], on: [[start, end], ...], gaps: [[start, end], ...], more }`, times in log seconds, clipped to the span.
  Finding the switch channels and grouping identical ones is done once per log and kept with it.
- `Session::dispatch` gets a `switches` command with `log`, `t0`, `t1`. `src/api.ts` exposes it.
- `src/charts.ts`: the trace drawing reserves a band under the last trace and draws the rows with the same x scale. The playhead already spans the canvas.
  The readout at the playhead is found from the spans the core returned; no samples are read in the UI.
- `src/app.ts`: asks for the rows when the replay span changes, and holds the checkbox state in settings.
- `index.html`, `src/styles.css`: the checkbox, and the row label and readout styles.

## Edge cases

- Span with no qualifying switch: no band, no extra height.
- A switch whose only change falls exactly on the edge of the span counts as changing.
- Missing samples never start or end an `on` span by themselves; they produce a gap.

## Tests

- Core, on built logs: 0/1 channel that changes is found; constant channel is not; a channel with a 2 in it is not; missing samples make a gap;
  identical channels merge and keep the shortest name; a change outside the span gives no row; the limit and the count of rows left out.
- Core, on the sample logs: the default pull of the 1:45 pm log returns rows, and Clutch State carries its two duplicates.
- UI test: rows are drawn for the default pull, the readout flips between On and Off as the playhead moves across a change,
  By RPM hides them, and the checkbox turns them off and is remembered after a reload.
- The golden snapshot is left alone: new values go in their own test, so the file is not rewritten on another CPU.
