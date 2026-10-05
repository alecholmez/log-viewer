# Replay: switches and states as chips

Status: approved by the owner on 2026-10-04 from a live prototype of four directions. It replaces the switch rows under the replay traces (`2026-10-04-replay-switch-rows-design.md`), which shipped the same day and were hard to read: the tooltip sat on the rows, the marks through the traces followed the pointer, and the rows looked like an afterthought.

## Why

The switch and state data is good. Rows under the traces were the wrong display for it:

- Marks that follow the pointer repaint the whole chart for every row the pointer crosses. Moving across the rows was jarring.
- Rows cost height under the traces for values that are only ever one of a few words or numbers.
- State channels (Gear, Engine State, Idle Control State) had no display at all.

A switch or a state is an indicator reading. The replay already shows readings at the playhead as cards. The chips put switches and states beside them.

## The rule this design keeps

**Nothing large reacts to pointing.** In the replay, a mark on the traces comes from a click and stays until it is cleared. Pointing may change a control's own hover style and show a plain browser tooltip, nothing more.

## What it shows

### Chips

- Under the readout cards, one chip for each switch and each state that changes in the span on screen.
- A switch chip: a dot, the name, and `On` or `Off`. The dot is filled while the switch is on. Where the switch has no sample the chip reads `–`.
- A state chip: the name and the value at the playhead.
- The chips follow the playhead as it is scrubbed or played, as the readout cards do.
- Switches come first, in order of first change in the span; then states, in order of first change.
- A switch that is logged under other names carries them in the chip's `title`: `Also logged as AVI6 Switch State, Clutch Switch Input State`.
- By RPM: the chips still read at the playhead. The ticks and the shading are not drawn, because they are positions in time.

### Ticks

- One line of short ticks directly above the time axis, a tick at every change of every chip shown.
- The chosen chip's ticks are darker and taller.

### Choosing a chip

- Clicking a chip chooses it; clicking it again clears it. One chip is chosen at a time.
- The chosen channel is shaded behind every trace: for a switch, the sections where it is on; for a state, every other section, with each section's value written at its start in the first trace. A thin edge marks each change.
- The shading is a tint of the run A colour, so it cannot be mistaken for the grey of the selected pull.
- The choice survives scrubbing and playing. It is cleared when the span on screen changes or the chip is no longer shown.

### Stepping

- Two buttons in the transport: `Previous change` and `Next change`.
- They move the playhead to the previous or next change of the chosen chip, or of any chip shown when none is chosen.

### The setting

- The checkbox in the Channels picker reads `Show switches and states that change`. Its saved key stays `switches`, on unless it is `false`.
- With it off there are no chips, no ticks and no request to the core.

### The note

- When more channels change than are shown: ` 3 more change in this span and are not shown.` (` 1 more changes in this span and is not shown.`)

## What goes

- The rows under the traces, their readouts and the note about By RPM hiding them.
- Pointing at a row: the tooltip, the lines through the traces, `S.swHover`, `switchRowAt`.
- The trace canvas no longer changes height with the switches, which removes the height dip when the span changes (issue 4).

## The core

All of this is computed in `crates/core`; the UI formats and draws.

### What is a state

A channel is a state in a log when all of these hold:

- it is not a switch;
- the ECU gives it no unit: in NSP, `Type : Raw` or `Type : Gear`;
- every sample it has is a whole number;
- it takes between two and eight different values in the log;
- its declared range (`DisplayMaxMin` in NSP) is no wider than 128;
- it changes no more than twice a second on average over the log: a channel that changes more often is a signal, not a state;
- it is not one of the logger's own channels: in NSP, a name that starts `Data Log `.

On the sample logs this keeps eleven names. Seven are the ones the prototype showed: Gear, Engine State, Idle Control State, Ignition Active Table, Launch Control State, Traction Control State and Drive By Wire Throttle Motor Direction. Four more meet the same rule: Drive By Wire 1 Pin 2 Output State, Start Button Next Expected Action Channel, Manifold Pressure Filter Scale and Last Engine Limiting Function.

It leaves out:

- Trigger Synchronisation State, which reads 4 and 5 and changes 2.4 to 3.7 times a second in every sample log. The next most frequent, Drive By Wire Throttle Motor Direction, changes 1.2 times a second at most;
- Data Log Status and Data Log Memory State, which describe the logger and not the car;
- counters (Trigger Tooth Count), diagnostics with a ±4096 range, and bit-flag channels such as O2 Control State and Cruise Control Disable Reason.

Those can still be added as readouts by hand.

The last two conditions were added on 2026-10-04, when the rule was measured over every channel for the build plan. Without them the rule kept fourteen names, and on the default pull it showed Data Log Status, Data Log Memory State and Manifold Pressure Filter Scale while leaving Traction Control State out for the limit of eight.

States are not grouped. Two states that change together but read different values are two chips.

### What the core answers for a span

- The switches that change in the span, as today: name, other names, on spans, gaps, changes. Grouping and the switch rule are as fixed by `2026-10-04-switch-rows-fixes.md`.
- The states that change in the span: name, sections as `[start, end, value]`, gaps, changes. Times are clipped to the span.
- A limit for each kind: twelve switches and eight states. When more change, the ones with the fewest changes in the span are kept, ties by first change then name, and the rest are counted. The kept ones are still returned in order of first change.

## Fitting the screen

From the UI review of 2026-10-04 (https://claude.ai/artifact/RNaXck6LX1briQPyayHxZ9), finding 16, which the owner put in the same piece of work as the chips: from Play to the bottom of the last trace is 879 px on a 900 px window, and the chips add a row.

- **Cards only where there is no trace.** A readout card is not shown for a channel that also has a trace in the view: its value at the playhead is already written beside the trace. The view's list of readouts does not change; this is what is drawn. In the default view six of the ten cards go. A view whose every readout has a trace shows no card row. `No readouts in this view. Open Channels and add some.` stays for a view with no readouts at all.
- **Traces that fit.** A trace's plot is 53 px tall today. It becomes the tallest height from 34 to 53 px at which the replay, from the transport to the time axis, fits the window. When it does not fit at 34 px either, the plot is 34 px and the page scrolls.
- **The transport stays in view.** While any part of the replay panel is on screen, the transport (Play, Restart, the step buttons, speed, position, clock) stays at the top edge of the window and the rest of the panel scrolls under it.
- The switch rows no longer take height under the traces, which gives back about 26 px a row.

Tested in the UI test: with the default view and pull at 1440 × 900, the distance from the top of the transport to the bottom of the trace canvas is no more than the window's height; at 1440 × 700 the plots are shorter than at 900 and not under 34 px; with the page scrolled to the last trace, the Play button is still inside the window.

## Carried in from the reviews of the switch rows fixes

These were set aside by those reviews (issue 10 on GitHub) for this work, because this is where they start to matter.

- **A declared range can hold a missing bound.** `Log.ranges` turns a bound at the ECU's no-reading value into NaN: in every sample log, Time Since Engine Limiter declares `2147483647,-1` and becomes `[-0.001, NaN]`. The state rule reads the range's width, so it must be written to fail for a NaN width (`width <= 128.0`, which is false for NaN; not `!(width > 128.0)`, which is true for it). The field's doc says a NaN bound means "wider than anything", and a test pins that Time Since Engine Limiter is not a state.
- **A known limit of the grouping rule is written down and pinned.** In the 1:55 pm log, Thermofan 2 Output State, Thermofan 1 Idle Up Active, Thermofan 2 Idle Up Active and Digital Pulse Output 2 Output State each change once, at the same sample, and are one switch. One command test on that log, and one "Known limit" line in `2026-10-04-replay-switch-rows-design.md`.
- `Group` and `Switch` in `switches.rs` become `pub(crate)`, and `declares_on_off` gets a name that says it is also true when no range is declared, now that a second rule reads the range.

## Edge cases

- A span with no switch or state that changes: no chips, no ticks, no note.
- A log with no switches or states: the same.
- The playhead outside every section of a chip (it can be, at the very ends of the span): the chip reads its nearest section.
- A state that has no sample at the playhead reads `–`.
- An answer that arrives for a span that is no longer on screen is dropped, as today.
- A failed request leaves the chips empty and says so once in the message area (`fail` in `src/messages.ts`), with `Try again`; the message clears when chips arrive, and when the setting is turned off or the log goes.

## Testing

- Core: library tests for the state rule and the limit, and command tests on the sample pulls, including that Gear reads 1, 2, 3 across the default pull.
- UI test: the chips for the default pull and what they read at two playhead positions; a chip flips while the replay plays; choosing a chip shades the traces and darkens its ticks, and choosing it again clears both; the step buttons land on changes; By RPM draws no ticks or shading; the checkbox turns everything off without a request; the rows are gone and the trace canvas keeps one height across spans.
- The site's replay screenshot is retaken.

## Not in this design

- Zoom. It follows, and reads `replaySpan` as the traces do. Whether chips are chosen for the zoomed span or for the pull is decided there.
- Names for state values. NSP logs carry the numbers only.
- Choosing by hand which switches and states get chips. The Channels picker can already add any channel as a readout.
- Grouping states that are the same signal.
