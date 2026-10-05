# Replay State Chips Implementation Plan

> **For agentic workers:** Execute this plan with the `convergence-loop` skill, task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the switch rows under the replay traces with chips under the readout cards for every switch and state that changes in the span on screen, with ticks above the time axis, a chip that can be chosen to shade the traces, Previous change and Next change in the transport, a replay that fits the window, and the four items carried in from the reviews of the switch rows fixes.

**Architecture:** The core gains a state rule (`crates/core/src/states.rs`) beside the switch rule, a small shared module (`crates/core/src/span.rs`: a channel traced over the log as sections of one reading, the span it is clipped to, and the limit rule both kinds use), and a `chips` command (`crates/core/src/chips.rs`, through `Session::dispatch`) that answers `{ switches: { rows, more }, states: { rows, more } }` for a span. The golden snapshot reads neither, so it does not change. In the UI a new module, `src/chips.ts`, reads the core's answer at the playhead, builds the chips, keeps the chosen chip and finds the change to step to; `src/charts.ts` draws the ticks and the shading from the same answer and reads no samples for them. The switch rows, their pointer handling and their extra canvas height go. The plot height becomes the tallest from 34 to 53 px that fits the replay in the window, cards are drawn only for readouts without a trace, and the transport is sticky.

**Tech Stack:** Rust 2021 (`logviewer-core`: serde, serde_json), TypeScript 5.9 on canvas 2D with no framework, Vite 7, Playwright (Chromium) for the UI test in `tests/ui.mjs` against the real core over HTTP, Prettier and rustfmt. The Tauri shell and `logviewer-dev` forward `dispatch` and need no change.

**Spec:** `docs/superpowers/specs/2026-10-04-replay-state-chips-design.md`. Background: `docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md` and `docs/superpowers/plans/2026-10-04-switch-rows-fixes.md` (the switch rule and the grouping, which the chips keep).

**Starting point:** a new branch cut from the head of `ui-review-fixes` once the final review of `docs/superpowers/plans/2026-10-04-ui-review-fixes.md` is done; it does not wait for that branch to merge. That plan adds `src/messages.ts` (`say`, `progress`, `fail(text, { label, run })`, `clearMessage(prefix)`), the contrast helpers `textContrast` and `tokenContrast` in `tests/ui.mjs`, and code elsewhere in `src/app.ts`, `index.html`, `src/styles.css` and `tests/ui.mjs`. This plan locates code by quoting it, never by line number. Where a quote is not found exactly, find the one statement it names; do not edit anything else around it.

## Global Constraints

- Never refresh `crates/core/tests/golden.json` and never run with `UPDATE_GOLDEN=1`. The golden test must pass unchanged after every task. It reads `overview` and `dyno` only; if it fails, stop and report it.
- Every command goes through `Session::dispatch` (`crates/core/src/session.rs`) and is exposed in `src/api.ts`. This plan adds `chips`; Task 4 removes `switches`, its only user then being gone.
- All numbers are computed in `crates/core`. The core decides what is a switch, what is a state, the groups, the spans, the sections, the gaps, the change times, the order and the limits. The UI reads that answer at a time, formats it and draws it; it reads no samples for chips, ticks or shading.
- `!(x > y)` comparisons in the core are deliberate: they are also true for NaN. The exceptions this plan adds are two conditions of the state rule, which must be false for NaN: the range width, `max - min <= MAX_WIDTH`, never `!(max - min > MAX_WIDTH)`; and the rate, `changes as f64 <= MAX_RATE * duration`, never `!(…)` and never a division.
- The red (`--crit`) is the redline and risk in findings only. It is not used for a chip, a tick, the shading, the step buttons or a failed request.
- Text is at least 4.5:1 against what it sits on; a line or a mark on a chart is at least 3:1 (WCAG formula).
- No rule in `src/styles.css` outside the token blocks at its top carries a raw colour. The two dark blocks always carry the same values. This plan adds no token.
- Messages to the person go through `src/messages.ts`. Nothing writes to `#status` directly.
- No new dependency. No framework.
- UI copy is minimal and direct, no metaphors. Use these strings exactly: `Show switches and states that change`; ` 3 more change in this span and are not shown.` and ` 1 more changes in this span and is not shown.` (leading space, the number as counted); `Also logged as ` followed by the other names joined by `, `; `On`, `Off`, `–` (en dash); `Previous change`, `Next change`; `Switches and states failed: ` followed by the error; `Try again`; the chips' group label `Switches and states at the playhead`. `No readouts in this view. Open Channels and add some.` stays as it is.
- Geometry, exactly: the trace label row 17 px, the gap 6 px, the band of ticks 12 px, a tick 4 px, a chosen chip's tick 8 px, the time axis 22 px, the plot 34 to 53 px; the shading is run A at alpha 0.12; a chip has 8px corners.
- Shell: run `export PATH="$HOME/.cargo/bin:$PATH"` first in every shell.
- Checks before every commit, all of them, in every task: `cargo fmt --check`, `cargo clippy -p logviewer-core -- -D warnings`, `npm run test:core`, `npm run check`, `npx prettier --check "src/**/*.ts" tests`, and the UI test: `npm run build && cargo build --release -p logviewer-dev && npm run test:ui` (it uses port 1439 and must end with `all checks passed`).
- If Prettier or rustfmt reports a file, run `npm run format` or `cargo fmt` and confirm with `git diff --stat` that only files this task names changed.
- TDD: each task writes its test first, runs it and sees the failure this plan states, writes the code, and runs it again to see it pass. Where a new test pins behaviour that already holds, the plan says it passes at once.
- In the UI test a new check fails as a `FAIL` line in the red run, never by hanging or throwing: clicks on elements that do not exist yet are guarded, and waits go through `until`, which answers false.
- Stage only the files a task names, by name. Never `git add -A` or `git add .`. Never stage `.claude/`, `skills-lock.json`, or files under `docs/superpowers/specs/` that the task does not name.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not push and do not merge.
- Search with `rg` and `fd`, never `grep` or `find`.
- The app is built for Safari 15.0: `vite.config.ts` targets `safari15`, and `src-tauri/tauri.conf.json` sets the minimum systems to macOS 11.0 and iOS 15.0. Call no built-in that came later. `Object.hasOwn`, `Array.prototype.at`, `findLast` and `structuredClone` all came with Safari 15.4; the build lowers syntax and adds no missing function, and `npm run check` does not catch it.

## Review Focus

Each of these has a test in the task that owns the code.

1. Two chips that change at the same sample: Next change stops there once and then moves on, it does not stop twice or skip (Task 6, `once where two change together`).
2. A switch or a state that changes on the last sample of the span, with the span's end rounded through f32 by the UI: the core keeps the change, and the chip reads the new value at the end of the span (Task 2, `a_change_on_the_last_sample_survives_the_ui_rounding_its_time` in `states.rs`; Task 4, the hand-made chip read at the end).
3. The playhead in a stretch where the channel has no samples: the chip reads `–`; a state's gap is clipped like a switch's (Task 2, `sections_gaps_and_changes_over_the_whole_log`; Task 4, the hand-made chips).
4. A window too short for the replay even at 34 px plots: the plots stay 34 px, the page scrolls, and the transport stays in view (Task 7, `when it cannot fit`).
5. The chosen chip goes away: chips for the same span arrive without it, the setting is turned off, or the span changes. The choice clears and its shading and dark ticks go (Task 5).
6. A declared range with a bound at the ECU's no-reading value (a NaN width): not a state (Task 2, `a_declared_range_with_a_missing_bound_is_not_narrow`).
7. A log of zero length (one sample, or every sample at one time): the rate condition divides by nothing and gives no state (Task 2, `a_channel_that_changes_more_than_twice_a_second_is_not_a_state`).

## Measured on the sample logs

Measured for this plan by a Python script that mirrors the parser and the rules in `crates/core` (`haltech.rs` for the header and scaling, `switches.rs` for the switch rule and the grouping, the spec's state rule and limits), run over `testdata/logs`. Its switch answers were checked against the current core's own `switches` command on a copy of `logviewer-dev`: they agree (20 switch names, 12 signals, the six rows of the default pull, the Thermofan group in the 1:55 pm log).

- **The state rule keeps 11 channel names**, as the design says: Gear, Engine State, Idle Control State, Ignition Active Table, Launch Control State, Traction Control State, Drive By Wire Throttle Motor Direction, Drive By Wire 1 Pin 2 Output State (6 logs), Start Button Next Expected Action Channel (4), Manifold Pressure Filter Scale (2) and Last Engine Limiting Function (1).
- Rates, counted as the core counts them (changes between consecutive present readings that differ, over the whole log, divided by its last time less its first): Trigger Synchronisation State changes 2.44 to 3.70 times a second in every log and is the only channel the rate condition removes. The next highest of all the candidates, in any log, is Drive By Wire Throttle Motor Direction at 1.16 (1:46 pm). Data Log Status and Data Log Memory State are removed by the name condition alone.
- Drive By Wire Throttle Motor Direction is a switch in the 1:36 pm log (it reads only 0 and 1 there) and a state in the other six logs that have it. The 1:36 pm log has no state.
- Time Since Engine Limiter: type `Time_ms_as_s`, declared `2147483647,-1`, held as `[-0.001, NaN]` in every sample log.
- In every 2 s window of every sample log, at most 8 states change, so no state is ever left out of such a window: absence from its answer is proof a channel is not a state there.
- The default pull (2nd gear, `PCLog_2026-04-17_0145pm.csv`, 31.251 s to 34.91 s, shown from 29.751 s to 36.41 s):
  - switches, in order: Decel Detected, Drive By Wire 1 Pin 1 Output State, Clutch State, Gear Upshift State, Stepper 1 Pin 2 Output State, Predicted MAP Active; none left out.
  - states, in order: Drive By Wire Throttle Motor Direction, Engine State, Idle Control State, Ignition Active Table, Gear, Traction Control State, Manifold Pressure Filter Scale; none left out. 13 chips, and no note.
  - Gear: sections `[29.751, 31.251, 1]`, `[31.251, 35.817, 2]`, `[35.817, 36.41, 3]`, changes 31.251 and 35.817.
  - Idle Control State: sections from 29.751 reading -7, -9 from 29.918, -3 from 29.963, -7 from 30.679, -3 from 35.058, -7 from 35.534.
  - Traction Control State: 12 changes, 32.631, 32.676, 32.916, 32.961, 33.34, 33.393, 33.453, 33.53, 33.627, 35.008, 35.957, 36.005; it reads 0 from the start of the span to 32.631.
  - The chips read, in order, at 30.3 s: `On,Off,On,Off,Off,Off,1,2,-3,2,1,0,1`; at 33 s: `Off,On,Off,Off,On,Off,2,3,-7,0,2,0,1`.
  - Every change in the span: 29.918, 29.963, 30.06, 30.116, 30.581, 30.626, 30.679, 31.206, 31.251, 31.299, 32.579, 32.631, 32.676, 32.916, 32.961, 33.293, 33.34, 33.393, 33.453, 33.53, 33.627, 34.96, 35.008, 35.058, 35.447, 35.534, 35.576, 35.777, 35.817, 35.865, 35.957, 36.005, 36.145, 36.338. Clutch State changes at 29.963, 31.206, 34.96, 35.777; Stepper 1 Pin 2 Output State at 32.579.
  - Narrowed by 2 s at each end (31.751 s to 34.41 s): Stepper 1 Pin 2 Output State, Predicted MAP Active, Traction Control State; none left out.
- The 1:42 pm log, whole: no switch; one state, Idle Control State (sections `[0, 0.081, -1]`, `[0.081, 18.371, 1]`).
- The 1:44 pm log, whole: 9 switches, all shown (AVI1 Switch State, Brake Pedal State, Drive By Wire 1 Pin 1 Output State, Decel Detected, Clutch State, Gear Upshift State, Brake Pressure Front Switch State, Predicted MAP Active, Stepper 1 Pin 2 Output State); 11 states, of which 8 are kept: Launch Control State, Engine State, Drive By Wire 1 Pin 2 Output State, Start Button Next Expected Action Channel, Traction Control State, Gear, Manifold Pressure Filter Scale, Last Engine Limiting Function; 3 left out (Ignition Active Table 29 changes, Idle Control State 39, Drive By Wire Throttle Motor Direction 55; the most changes kept is Engine State's 28).
- The 1:44 pm 2nd gear pull (12.093 s to 16.282 s): states Idle Control State, Drive By Wire Throttle Motor Direction, Engine State, Ignition Active Table, Gear (sections `[t0, 12.093, 1]`, `[12.093, 17.376, 2]`, `[17.376, t1, 3]`); none left out.
- The 1:45 pm log, whole (the test renames it Back road): 8 switches (Stepper 1 Pin 2 Output State, Predicted MAP Active, Drive By Wire 1 Pin 1 Output State, Clutch State, Decel Detected, Gear Upshift State, AVI1 Switch State, Brake Pedal State) and 8 of 10 states (Manifold Pressure Filter Scale, Drive By Wire 1 Pin 2 Output State, Engine State, Ignition Active Table, Idle Control State, Gear, Start Button Next Expected Action Channel, Launch Control State); 2 left out (Drive By Wire Throttle Motor Direction 32 changes, Traction Control State 44).
- The 1:55 pm log, whole: Thermofan 2 Output State carries Thermofan 1 Idle Up Active, Thermofan 2 Idle Up Active and Digital Pulse Output 2 Output State; on from 60.909 s to the end, 69.663 s.

## Decisions

Where the design is silent or the measurements disagree with it, this plan decides:

1. **The state rule as the spec now has it**, all seven conditions, with every expected value measured under it (above): eleven names on the sample logs. The rate condition counts changes over the whole log, as the core's trace counts them, and is compared as a product so it needs no division; the logger's own channels are known by NSP's name prefix, which lives in `haltech.rs`.
2. **No declared range passes the width test.** As for switches, a log that declares no range leaves it to the samples.
3. **"No unit" is NSP knowledge**, so it lives in `haltech.rs` as `has_no_unit(ty)`: `Type : Raw` or `Type : Gear`. Another ECU gets its own.
4. **A new command, `chips`, answering `{ switches: { rows, more }, states: { rows, more } }`.** The switches part is exactly the old `switches` reply, so the switch command tests keep their shape; each limit is counted on its own. The UI adds the two counts for the note. The golden snapshot reads neither. The `switches` command stays until the UI stops calling it in Task 4.
5. **One shared module, `span.rs`.** A switch's on spans are the sections of its trace that read 1, so one `trace()` serves both kinds; the span's snapping and clipping (generic over `[f64; 2]` and `[f64; 3]`), the change times and the limit rule are shared too.
6. **The limit rule applies to switches as well** (the design: "a limit for each kind"). On the sample logs this changes one answer: the whole 1:44 pm log now shows all 9 switches.
7. **Names from the rows era stay** in the answer: `Row` and `Rows` in `switches.rs`, `SwitchRow` and `Switches` in `src/types.ts`. They name entries of the answer; renaming would touch every test for no behaviour. The state counterparts are `StateRow` and `StateRows` (`States` in TypeScript).
8. **The new cache on `Log` is `chip_states`.** `Log.states` already holds the findings' own list of state names.
9. **How a stretch is read at its edges:** `[start, end)`, so a change time reads the new value; a stretch that ends where the span ends keeps that end, so a zero-length section on the last sample is read there. A state before its first section reads the first, after its last the last.
10. **A state's value is written with `fmt`**, as the log has it: `-7`, `16`.
11. **A chip is known by its name.** A channel is a switch or a state in a log, never both.
12. **Shading a state:** the 2nd, 4th, … section in the span are shaded. Values are written at `y0 + 3` in the first trace, in `--ink` bold 11 px, only where the section is wide enough for the text and 6 px.
13. **The band of ticks is always reserved**, in both axis modes, so the canvas height never depends on the chips. A 1 px `--rule` line marks the time axis, and ticks stand on it.
14. **The values tooltip over the traces stays.** The design's "What goes" lists only the rows' pointing; the tooltip and the hover line belong to the traces.
15. **The step buttons are disabled when there is no change that way**, and stepping stops playback. They compare strictly, so two chips that change at the same sample are one stop.
16. **While the chips for a new span are on their way, the chips box keeps its height** (empty), so the traces under it do not move twice. A failed request leaves it so until Try again, a new span, or the setting turned off.
17. **The plot height is fitted when the room can change**, not on every draw: it is measured from the page as laid out when a box above the traces (the transport, the view bar, the cards, the chips, the picker) or the window changes size, and when the number of traces changes, and it is kept in between (`fitted` and `refit` in `src/charts.ts`). This plan first worked it out on every draw; that was changed before Task 7 was built, because a draw runs on every frame while the replay plays.
18. **The choice survives By RPM and back**: the span on screen does not change.
19. **A finding's view has a trace for every readout**, so it shows no card row; its flags remain on the traces. The UI test's finding check follows (Task 7).
20. **The UI test closes Channels for the chip checks** and opens it again for the checkbox: with the picker closed the replay fits at 53 px at 1400 × 1000 for every span the test shows, so "one height across spans" is a fixed number, not a coincidence of clamping.
21. **The chip's value has a minimum width of 3ch**, so `On`, `Off` and two-digit values do not reflow the chips while the replay plays.
22. **The screenshot script chooses the Clutch State chip** before the replay shot, so the website shows the shading.

## File structure

- `crates/core/src/span.rs` (new): `Trace` and `trace()`, `Span` (`new`, `snap`, `samples`, `clip`, `times`), `changes_in`, the `Changing` trait and `keep()`.
- `crates/core/src/states.rs` (new): the state rule, `State`, `StateRow`, `StateRows`, `states()`, `MAX_STATES`.
- `crates/core/src/chips.rs` (new): `Chips` and `chips()`, the answer for a span.
- `crates/core/src/switches.rs`: the switch rule and the grouping; built on `span.rs`; `MAX_SWITCHES`.
- `crates/core/src/log.rs`: `chip_states` cache; the `built` test module that makes logs for library tests.
- `crates/core/src/haltech.rs`: `has_no_unit`.
- `crates/core/src/session.rs`: the `chips` command.
- `crates/core/tests/common/mod.rs`: the sample-pull helpers, shared.
- `crates/core/tests/chips.rs` (new): the `chips` command's states and shape. `crates/core/tests/switches.rs`: its switches.
- `src/chips.ts` (new): reading, building and choosing chips; the step target.
- `src/charts.ts`: no rows; ticks, shading, the fitted plot height.
- `src/app.ts`: `syncChips`, the step buttons, cards only for readouts without a trace.
- `src/state.ts`, `src/types.ts`, `src/api.ts`, `index.html`, `src/styles.css`, `tests/ui.mjs`, `tests/site-shots.mjs`, and the notes.

---

### Task 1: Carried in from the reviews: names, visibility, the NaN bound and a known limit

**Files:**
- Modify: `crates/core/src/switches.rs` (`Switch`, `Group`, `declares_on_off`)
- Modify: `crates/core/src/log.rs` (the doc of `ranges`, a test)
- Modify: `docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md` (one "Known limit" line)
- Test: `crates/core/src/log.rs`, `crates/core/tests/switches.rs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `pub(crate) struct Switch` and `pub(crate) struct Group` in `crates/core/src/switches.rs`; `fn no_range_or_on_off(range: Option<[f64; 2]>) -> bool` in place of `declares_on_off`. Task 2 makes `is_switch` `pub(crate)`.

- [ ] **Step 1: Pin the NaN bound and the known limit**

In `crates/core/src/log.rs`, inside `mod tests`, after the test `a_declared_range_is_scaled_like_the_samples` add:

```rust
    /// Time Since Engine Limiter declares `2147483647,-1` in every sample log. Its maximum is the ECU's no-reading value.
    #[test]
    fn a_bound_at_the_no_reading_value_is_not_a_number() {
        let text = "%DataLog%\n\
            Channel : RPM\nType : EngineSpeed\nDisplayMaxMin : 20000,0\n\
            Channel : Vehicle Speed\nType : Speed\nDisplayMaxMin : 4000,0\n\
            Channel : Time Since Engine Limiter\nType : Time_ms_as_s\nDisplayMaxMin : 2147483647,-1\n\
            12:00:00.000,3000,0,0\n";
        let log = Log::from_raw(parse_nsp_csv(text, "t.csv").unwrap()).unwrap();
        let [min, max] = log.ranges[2].unwrap();
        assert_eq!(min, -0.001);
        assert!(max.is_nan(), "{max}");
    }
```

In `crates/core/tests/switches.rs`, after the test `a_state_that_declares_0_to_2_and_reads_0_and_1_is_still_a_switch` add:

```rust
/// Known limit of the grouping rule: in the 1:55 pm log four channels each change once, at the same sample, so the rule
/// takes them for one signal. Thermofan 2 Output State, the shortest name, carries the other three.
#[test]
fn four_channels_that_change_once_at_the_same_sample_are_one_switch() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let log = log_key(&mut s, "PCLog_2026-04-17_0155pm.csv");
    let reply = rows(&mut s, &log, 0.0, 69.663);
    let rows = reply["rows"].as_array().unwrap();
    let fan = rows.iter().find(|r| r["name"] == "Thermofan 2 Output State");
    assert_eq!(
        fan,
        Some(&json!({
            "name": "Thermofan 2 Output State",
            "also": [
                "Thermofan 1 Idle Up Active",
                "Thermofan 2 Idle Up Active",
                "Digital Pulse Output 2 Output State"
            ],
            "on": [[60.909, 69.663]],
            "gaps": [],
            "changes": [60.909],
        }))
    );
}
```

- [ ] **Step 2: Run the tests**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cargo test --release -p logviewer-core --no-fail-fast a_bound_at_the_no_reading_value four_channels_that_change_once`

Expected: both pass at once. They pin behaviour this task documents; the change below is names, visibility and docs.

- [ ] **Step 3: Visibility and the name of the range check**

In `crates/core/src/switches.rs`:

Replace

```rust
/// One on/off channel of a log, over the whole log.
#[derive(Clone, Debug)]
pub struct Switch {
```

with

```rust
/// One on/off channel of a log, over the whole log.
#[derive(Clone, Debug)]
pub(crate) struct Switch {
```

Replace

```rust
/// The switch channels of a log that are one signal, and the channel their row is built from.
#[derive(Clone, Debug)]
pub struct Group {
```

with

```rust
/// The switch channels of a log that are one signal, and the channel their row is built from.
#[derive(Clone, Debug)]
pub(crate) struct Group {
```

Replace

```rust
fn is_switch(a: &[f64], range: Option<[f64; 2]>) -> bool {
    declares_on_off(range) && reads_on_off(a)
}

/// NSP declares `1,0` or `2,0` for a switch, and a wider range for a state or a count that can read only 0 and 1 in one log.
/// A log that declares no range leaves it to the samples.
fn declares_on_off(range: Option<[f64; 2]>) -> bool {
```

with

```rust
fn is_switch(a: &[f64], range: Option<[f64; 2]>) -> bool {
    no_range_or_on_off(range) && reads_on_off(a)
}

/// True when the log declares no range for the channel, or one within 0 to 2. NSP declares `1,0` or `2,0` for a switch,
/// and a wider range for a state or a count that can read only 0 and 1 in one log. A log that declares no range leaves it
/// to the samples. A NaN bound fails both comparisons, so such a channel is not a switch.
fn no_range_or_on_off(range: Option<[f64; 2]>) -> bool {
```

- [ ] **Step 4: Say what a NaN bound means**

In `crates/core/src/log.rs`, replace

```rust
    /// per channel, the range the log's header declares, as [min, max] in engineering units; None when it declares none
    pub ranges: Vec<Option<[f64; 2]>>,
```

with

```rust
    /// per channel, the range the log's header declares, as [min, max] in engineering units; None when it declares none.
    /// A bound written as the ECU's no-reading value is NaN, and means wider than anything: a rule that reads a range must
    /// be false for NaN (`width <= limit`, not `!(width > limit)`). Time Since Engine Limiter declares `2147483647,-1` in
    /// every sample log and is held as [-0.001, NaN].
    pub ranges: Vec<Option<[f64; 2]>>,
```

- [ ] **Step 5: Write the known limit into the spec**

In `docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md`, after the line that ends `when that channel changes inside the span. The design said "identical across the whole log"; see Why.)` add:

```markdown
  Known limit: in the 1:55 pm log, Thermofan 2 Output State, Thermofan 1 Idle Up Active, Thermofan 2 Idle Up Active and Digital Pulse Output 2 Output State each change once, at the same sample, and are one switch. Channels that change once together cannot be told from one signal logged twice. Pinned by `four_channels_that_change_once_at_the_same_sample_are_one_switch` in `crates/core/tests/switches.rs`.
```

- [ ] **Step 6: Run the checks and see everything pass**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cargo fmt --check && cargo clippy -p logviewer-core -- -D warnings && npm run test:core && npm run check && npx prettier --check "src/**/*.ts" tests && npm run build && cargo build --release -p logviewer-dev && npm run test:ui`

Expected: the core tests pass, and the UI test ends with `all checks passed`.

- [ ] **Step 7: Commit**

```bash
git add crates/core/src/switches.rs crates/core/src/log.rs crates/core/tests/switches.rs docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md
git commit -m "Switches: names and notes carried in from the fixes reviews

Group and Switch are crate-private, the range check is named for what it
also accepts, a NaN bound is documented and pinned, and the Thermofan group
in the 1:55 pm log is pinned as a known limit of the grouping rule.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: States in the core, and one limit rule for both kinds

**Files:**
- Create: `crates/core/src/span.rs`
- Create: `crates/core/src/states.rs`
- Modify: `crates/core/src/switches.rs` (built on `span.rs`; `MAX_SWITCHES`; the limit rule; `is_switch` crate-visible; its tests use the shared builder)
- Modify: `crates/core/src/log.rs` (`chip_states`; the `built` test module)
- Modify: `crates/core/src/haltech.rs` (`has_no_unit`, `is_logger_channel`)
- Modify: `crates/core/src/lib.rs` (modules and their list)
- Modify: `crates/core/src/session.rs` (`MAX_ROWS` becomes `MAX_SWITCHES`)
- Modify: `src/types.ts` (one doc comment)
- Test: `crates/core/src/states.rs`, `crates/core/src/switches.rs`, `crates/core/tests/switches.rs`

**Interfaces:**
- Consumes, from Task 1: `pub(crate) struct Switch`, `pub(crate) struct Group`, `no_range_or_on_off`.
- Produces, in `crates/core/src/span.rs` (all `pub(crate)`):
  - `struct Trace { changes: Vec<usize>, sections: Vec<[f64; 3]>, gaps: Vec<[f64; 2]> }` and `fn trace(t: &[f64], a: &[f64]) -> Trace`
  - `struct Span` with `fn new(t0: f64, t1: f64) -> Option<Span>`, `fn snap(self, x: f64) -> f64`, `fn samples(self, t: &[f64]) -> Range<usize>`, `fn clip<const N: usize>(self, spans: &[[f64; N]]) -> Vec<[f64; N]>`, `fn times(self, t: &[f64], changes: &[usize]) -> Vec<f64>`
  - `fn changes_in(changes: &[usize], inside: &Range<usize>) -> Vec<usize>`
  - `trait Changing { fn name(&self) -> &str; fn changes(&self) -> &[usize]; }` and `fn keep<T: Changing>(found: Vec<T>, limit: usize) -> (Vec<T>, usize)`
- Produces, in `crates/core/src/states.rs`: `pub const MAX_STATES: usize = 8`, `pub struct StateRow { pub name: String, pub sections: Vec<[f64; 3]>, pub gaps: Vec<[f64; 2]>, pub changes: Vec<f64> }`, `pub struct StateRows { pub rows: Vec<StateRow>, pub more: usize }`, `pub fn states(log: &Log, t0: f64, t1: f64, limit: usize) -> StateRows`, `pub(crate) struct State`.
- Produces, in `crates/core/src/switches.rs`: `pub const MAX_SWITCHES: usize = 12` in place of `MAX_ROWS`; `pub(crate) fn is_switch`.
- Produces, in `crates/core/src/haltech.rs`: `pub fn has_no_unit(ty: &str) -> bool` and `pub fn is_logger_channel(name: &str) -> bool`.
- Produces, in `crates/core/src/log.rs`: `pub(crate) chip_states: OnceLock<Vec<State>>`; `#[cfg(test)] pub(crate) mod built` with `X`, `Typed`, `typed_at`, `typed`, `log_at`, `log`.

- [ ] **Step 1: The test builder, and the failing tests**

In `crates/core/src/log.rs`, before `#[cfg(test)]\nmod tests {`, add:

```rust
/// Logs built in library tests, as the parser would build them.
#[cfg(test)]
pub(crate) mod built {
    use super::Log;
    use crate::haltech::{Col, RawLog};

    /// What NSP writes for "no reading".
    pub(crate) const X: f64 = 2_147_483_647.0;

    /// A channel's name, its NSP `Type`, the range its header declares as [min, max] in raw units, and its raw samples.
    pub(crate) type Typed<'a> = (&'a str, &'a str, Option<[f64; 2]>, &'a [f64]);

    /// A log with the given sample times in milliseconds: RPM and Vehicle Speed, which every log needs, then the given channels.
    pub(crate) fn typed_at(t_ms: Vec<f64>, channels: &[Typed]) -> Log {
        let mut names = vec!["RPM".to_string(), "Vehicle Speed".to_string()];
        let mut types = vec!["Raw".to_string(), "Raw".to_string()];
        let mut ranges = vec![None, None];
        let mut cols = vec![Col::Const(3000.0), Col::Const(0.0)];
        for &(name, ty, range, v) in channels {
            assert_eq!(v.len(), t_ms.len(), "{name}");
            names.push(name.to_string());
            types.push(ty.to_string());
            ranges.push(range);
            // as the parser does: a channel that never changes is stored once
            cols.push(if v.iter().all(|&x| x == v[0]) {
                Col::Const(v[0])
            } else {
                Col::Series(v.to_vec())
            });
        }
        Log::from_raw(RawLog {
            name: "built.csv".into(),
            start: "built".into(),
            names,
            types,
            ranges,
            t_ms,
            cols,
        })
        .unwrap()
    }

    /// The same, with one sample a second from 0 s: the index of a sample is its time in seconds.
    pub(crate) fn typed(channels: &[Typed]) -> Log {
        let n = channels[0].3.len();
        typed_at((0..n).map(|i| i as f64 * 1000.0).collect(), channels)
    }

    /// Channels of type Raw that declare no range, at the given sample times in milliseconds.
    pub(crate) fn log_at(t_ms: Vec<f64>, channels: &[(&str, &[f64])]) -> Log {
        let raw: Vec<Typed> = channels.iter().map(|&(name, v)| (name, "Raw", None, v)).collect();
        typed_at(t_ms, &raw)
    }

    /// Channels of type Raw that declare no range, one sample a second from 0 s.
    pub(crate) fn log(channels: &[(&str, &[f64])]) -> Log {
        let n = channels[0].1.len();
        log_at((0..n).map(|i| i as f64 * 1000.0).collect(), channels)
    }
}
```

In `crates/core/src/switches.rs`, in `mod tests`, replace everything from the line `    use crate::haltech::{Col, RawLog};` through the end of the `whole` helper:

```rust
    use crate::haltech::{Col, RawLog};

    /// What NSP writes for "no reading".
    const X: f64 = 2_147_483_647.0;
```

…(the `log_at`, `log`, `Declared` and `declared` helpers as they stand)…

```rust
    /// The rows for the whole of a log.
    fn whole(log: &Log) -> Rows {
        switches(log, 0.0, log.duration(), MAX_ROWS)
    }
```

with

```rust
    use crate::log::built::{log, log_at, typed, Typed, X};

    /// A channel's name, the range the log's header declares for it, and its samples. Type Raw: raw and engineering units agree.
    type Declared<'a> = (&'a str, Option<[f64; 2]>, &'a [f64]);

    /// Channels of type Raw, each with a declared range.
    fn declared(channels: &[Declared]) -> Log {
        let raw: Vec<Typed> = channels.iter().map(|&(name, range, v)| (name, "Raw", range, v)).collect();
        typed(&raw)
    }

    /// The rows for the whole of a log.
    fn whole(log: &Log) -> Rows {
        switches(log, 0.0, log.duration(), MAX_SWITCHES)
    }
```

In the same module replace every other `MAX_ROWS` with `MAX_SWITCHES` (`rg -n MAX_ROWS crates/core/src/switches.rs` lists them). Replace the test `rows_come_in_order_of_first_change_and_stop_at_the_limit` with:

```rust
    #[test]
    fn rows_come_in_order_of_first_change_and_ties_at_the_limit_keep_the_earliest() {
        // ten switches, each on for one second, two seconds apart so that no two are one signal;
        // the higher the number, the earlier it changes
        let series: Vec<(String, Vec<f64>)> = (0..10)
            .map(|k| {
                let mut v = vec![0.0; 24];
                v[22 - 2 * k] = 1.0;
                (format!("Switch {k}"), v)
            })
            .collect();
        let channels: Vec<(&str, &[f64])> = series
            .iter()
            .map(|(n, v)| (n.as_str(), v.as_slice()))
            .collect();
        let l = log(&channels);

        let r = whole(&l);
        assert_eq!(
            names(&r),
            [
                "Switch 9", "Switch 8", "Switch 7", "Switch 6", "Switch 5", "Switch 4", "Switch 3",
                "Switch 2", "Switch 1", "Switch 0"
            ]
        );
        assert_eq!(r.more, 0);

        // each changes twice: the tie goes to the earliest first change
        let r = switches(&l, 0.0, 23.0, 3);
        assert_eq!(names(&r), ["Switch 9", "Switch 8", "Switch 7"]);
        assert_eq!(r.more, 7);
    }

    #[test]
    fn when_more_switches_change_than_the_limit_the_ones_that_change_least_are_kept() {
        let l = log(&[
            ("Busy", &[0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0]),
            ("Late", &[0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0]),
            ("Early", &[0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0]),
        ]);
        assert_eq!(names(&whole(&l)), ["Busy", "Early", "Late"]);
        // Busy changes four times, the others once: they are kept, still in order of first change
        let r = switches(&l, 0.0, 7.0, 2);
        assert_eq!(names(&r), ["Early", "Late"]);
        assert_eq!(r.more, 1);
    }
```

Create `crates/core/src/states.rs` holding only its tests for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::log::built::{log_at, typed, typed_at, X};

    fn names(r: &StateRows) -> Vec<&str> {
        r.rows.iter().map(|row| row.name.as_str()).collect()
    }

    /// The states that change across the whole of a log.
    fn whole(log: &Log) -> StateRows {
        states(log, 0.0, log.duration(), MAX_STATES)
    }

    #[test]
    fn gear_engine_state_and_idle_control_state_are_states() {
        let l = typed(&[
            ("Gear", "Gear", Some([-8.0, 10.0]), &[1.0, 1.0, 2.0, 2.0, 3.0]),
            ("Engine State", "Raw", Some([0.0, 4.0]), &[2.0, 3.0, 3.0, 2.0, 3.0]),
            ("Idle Control State", "Raw", Some([-9.0, 3.0]), &[-7.0, -9.0, -3.0, -7.0, -7.0]),
        ]);
        // in order of first change, ties by name
        assert_eq!(names(&whole(&l)), ["Engine State", "Idle Control State", "Gear"]);
    }

    /// Each condition of the rule keeps a channel out; two channels beside them pass.
    #[test]
    fn a_state_is_a_whole_number_channel_with_no_unit_a_few_values_and_a_narrow_range() {
        let l = typed(&[
            // a switch is not a state
            ("Clutch State", "Raw", Some([0.0, 1.0]), &[0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0]),
            // a unit: whole numbers once scaled (1 and 2 %), still not a state
            ("Boost Duty", "Percentage", Some([0.0, 1000.0]), &[10.0, 20.0, 10.0, 20.0, 10.0, 20.0, 10.0, 20.0, 10.0, 20.0]),
            // a sample that is not a whole number
            ("Half Steps", "Raw", None, &[0.0, 0.5, 1.0, 0.5, 0.0, 0.5, 1.0, 0.5, 0.0, 1.0]),
            // nine values, as a counter has
            ("Tooth Count", "Raw", None, &[0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 0.0]),
            // eight values and a declared range exactly 128 wide: a state
            ("Eight", "Raw", Some([0.0, 128.0]), &[0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 0.0, 1.0]),
            // a diagnostic's range
            ("Error", "Raw", Some([-4096.0, 4096.0]), &[0.0, 1.0, 2.0, 1.0, 0.0, 1.0, 2.0, 1.0, 0.0, 1.0]),
            // one wider than 128
            ("Wide", "Raw", Some([0.0, 129.0]), &[0.0, 1.0, 2.0, 1.0, 0.0, 1.0, 2.0, 1.0, 0.0, 1.0]),
            // no declared range: the samples decide. 0 and 2 is not a switch
            ("No range", "Raw", None, &[0.0, 2.0, 0.0, 2.0, 0.0, 2.0, 0.0, 2.0, 0.0, 2.0]),
            // one value only, with a missing sample: stored as a series, still not a state
            ("One value", "Raw", None, &[3.0, X, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0]),
        ]);
        assert_eq!(names(&whole(&l)), ["Eight", "No range"]);
    }

    /// Four samples a second for 2 s: at most four changes, twice a second, is a state.
    #[test]
    fn a_channel_that_changes_more_than_twice_a_second_is_not_a_state() {
        let t_ms: Vec<f64> = (0..9).map(|i| i as f64 * 250.0).collect();
        let l = typed_at(
            t_ms,
            &[
                // eight changes in 2 s: four a second
                ("Busy", "Raw", None, &[2.0, 3.0, 2.0, 3.0, 2.0, 3.0, 2.0, 3.0, 2.0]),
                // five changes: two and a half a second
                ("Five", "Raw", None, &[2.0, 3.0, 2.0, 2.0, 3.0, 3.0, 2.0, 2.0, 3.0]),
                // four changes: exactly twice a second
                ("Four", "Raw", None, &[2.0, 2.0, 3.0, 3.0, 2.0, 2.0, 3.0, 3.0, 2.0]),
            ],
        );
        assert_eq!(names(&whole(&l)), ["Four"]);
        // a log of zero length: nothing may change in it, and nothing is divided by its length
        let l = typed_at(vec![0.0, 0.0], &[("Mode", "Raw", None, &[2.0, 3.0])]);
        assert_eq!(l.duration(), 0.0);
        assert!(!changes_rarely(1, l.duration()));
        assert!(!changes_rarely(1, f64::NAN));
        assert_eq!(names(&states(&l, 0.0, 0.0, MAX_STATES)), Vec::<&str>::new());
    }

    /// The logger's own channels describe the log, not the car.
    #[test]
    fn the_loggers_own_channels_are_not_states() {
        let l = typed(&[
            ("Data Log Status", "Raw", Some([0.0, 6.0]), &[0.0, 1.0, 2.0, 1.0, 0.0]),
            ("Log Status", "Raw", Some([0.0, 6.0]), &[0.0, 1.0, 2.0, 1.0, 0.0]),
        ]);
        assert_eq!(names(&whole(&l)), ["Log Status"]);
    }

    /// Time Since Engine Limiter declares `2147483647,-1` in every sample log: [-0.001, NaN] once scaled. A NaN bound
    /// means wider than anything. The same range on a channel of type Raw pins that rule on its own.
    #[test]
    fn a_declared_range_with_a_missing_bound_is_not_narrow() {
        let l = typed(&[
            ("Time Since Engine Limiter", "Time_ms_as_s", Some([-1.0, X]), &[-1.0, -1.0, 0.0, 50.0, 100.0]),
            ("Limit", "Raw", Some([-1.0, X]), &[0.0, 1.0, 2.0, 1.0, 0.0]),
            ("Same values, no range", "Raw", None, &[0.0, 1.0, 2.0, 1.0, 0.0]),
        ]);
        assert!(l.ranges[3].unwrap()[1].is_nan());
        assert!(!declares_narrow(Some([-0.001, f64::NAN])));
        assert_eq!(names(&whole(&l)), ["Same values, no range"]);
    }

    #[test]
    fn sections_gaps_and_changes_over_the_whole_log() {
        let l = typed(&[
            ("Gear", "Gear", None, &[1.0, 1.0, 2.0, X, X, 2.0, 3.0, 3.0]),
            // a log that starts with nothing: a gap, and no change where the first reading arrives
            ("Mode", "Raw", None, &[X, 4.0, 4.0, 5.0, 5.0, 5.0, 4.0, 4.0]),
        ]);
        assert_eq!(
            whole(&l),
            StateRows {
                rows: vec![
                    StateRow {
                        name: "Gear".into(),
                        // a stretch of missing samples does not end a section
                        sections: vec![[0.0, 2.0, 1.0], [2.0, 6.0, 2.0], [6.0, 7.0, 3.0]],
                        gaps: vec![[3.0, 5.0]],
                        changes: vec![2.0, 6.0],
                    },
                    StateRow {
                        name: "Mode".into(),
                        sections: vec![[1.0, 3.0, 4.0], [3.0, 6.0, 5.0], [6.0, 7.0, 4.0]],
                        gaps: vec![[0.0, 1.0]],
                        changes: vec![3.0, 6.0],
                    },
                ],
                more: 0,
            }
        );
    }

    #[test]
    fn sections_are_clipped_to_the_span() {
        let l = typed(&[("Gear", "Gear", None, &[1.0, 1.0, 2.0, 2.0, 2.0, 3.0, 3.0, 3.0])]);
        let r = states(&l, 2.0, 6.0, MAX_STATES);
        // the section that ends as the span starts is left out; the last is cut at the end of the span
        assert_eq!(r.rows[0].sections, [[2.0, 5.0, 2.0], [5.0, 6.0, 3.0]]);
        assert_eq!(r.rows[0].changes, [2.0, 5.0]);
        // between two changes nothing changes: no chip
        assert_eq!(states(&l, 2.5, 4.5, MAX_STATES).rows, vec![]);
    }

    /// The UI keeps a log's times as f32 and sends them back as the ends of the span.
    #[test]
    fn a_change_on_the_last_sample_survives_the_ui_rounding_its_time() {
        let l = log_at(
            vec![0.0, 23_000.0, 46_000.0, 69_743.0],
            &[("Mode", &[1.0, 1.0, 1.0, 2.0])],
        );
        let t1 = 69.743_f32 as f64;
        let r = states(&l, 0.0, t1, MAX_STATES);
        assert_eq!(r.rows[0].changes, [t1]);
        // the last section starts on the last sample of the span and has no length
        assert_eq!(r.rows[0].sections, [[0.0, t1, 1.0], [t1, t1, 2.0]]);
    }

    #[test]
    fn when_more_states_change_than_the_limit_the_ones_that_change_least_are_kept() {
        let l = typed(&[
            ("Busy", "Raw", None, &[2.0, 3.0, 2.0, 3.0, 2.0, 2.0, 2.0, 2.0]),
            ("Calm", "Raw", None, &[7.0, 7.0, 7.0, 7.0, 7.0, 8.0, 8.0, 8.0]),
            ("Quiet", "Raw", None, &[5.0, 5.0, 5.0, 6.0, 6.0, 6.0, 6.0, 6.0]),
        ]);
        assert_eq!(names(&whole(&l)), ["Busy", "Quiet", "Calm"]);
        // Busy changes four times, the others once: they are kept, still in order of first change
        let r = states(&l, 0.0, 7.0, 2);
        assert_eq!(names(&r), ["Quiet", "Calm"]);
        assert_eq!(r.more, 1);
    }

    /// Two states that change together but read different values are two chips.
    #[test]
    fn states_are_not_grouped() {
        let l = typed(&[
            ("Engine State", "Raw", Some([0.0, 4.0]), &[2.0, 3.0, 3.0, 2.0]),
            ("Ignition Active Table", "Raw", Some([-1.0, 6.0]), &[0.0, 2.0, 2.0, 0.0]),
        ]);
        assert_eq!(names(&whole(&l)), ["Engine State", "Ignition Active Table"]);
    }

    #[test]
    fn a_span_that_is_backwards_or_not_a_number_gives_nothing() {
        let l = typed(&[("Gear", "Gear", None, &[1.0, 2.0, 3.0, 2.0])]);
        let none = StateRows {
            rows: vec![],
            more: 0,
        };
        assert_eq!(states(&l, 3.0, 0.0, MAX_STATES), none);
        assert_eq!(states(&l, f64::NAN, 3.0, MAX_STATES), none);
        assert_eq!(states(&l, 0.0, f64::NAN, MAX_STATES), none);
    }
}
```

In `crates/core/src/lib.rs`, add `pub mod states;` after `pub mod session;`.

In `crates/core/tests/switches.rs`, replace the test `a_whole_log_is_cut_at_eight_rows_and_says_how_many_are_left_out` with:

```rust
/// Nine switches change across the whole 1:44 pm log, fewer than the limit: all nine, in order of first change.
#[test]
fn a_whole_log_shows_all_nine_of_its_switches() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let log = log_key(&mut s, "PCLog_2026-04-17_0144pm.csv");
    let reply = rows(&mut s, &log, 0.0, 75.441);
    assert_eq!(
        names(&reply),
        [
            "AVI1 Switch State",
            "Brake Pedal State",
            "Drive By Wire 1 Pin 1 Output State",
            "Decel Detected",
            "Clutch State",
            "Gear Upshift State",
            "Brake Pressure Front Switch State",
            "Predicted MAP Active",
            "Stepper 1 Pin 2 Output State",
        ]
    );
    assert_eq!(reply["more"], 0);
}
```

- [ ] **Step 2: Run the core tests and see them fail**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cargo test --release -p logviewer-core --no-fail-fast`

Expected: the crate does not compile: `cannot find value MAX_SWITCHES`, and in `states.rs` `cannot find function states`, `cannot find type StateRows`, `cannot find value MAX_STATES`, `cannot find function declares_narrow`, `cannot find function changes_rarely`.

- [ ] **Step 3: The shared module**

Create `crates/core/src/span.rs`:

```rust
//! What the replay's switch and state chips share: a channel traced over the whole log as sections of one reading, the
//! span on screen that its sections are clipped to, and the rule for how many are shown.

use std::cmp::Ordering;
use std::ops::Range;

/// Seconds. The UI holds times as f32, so an end of the span it asks for can miss a sample time by a rounding error.
/// A time this close to an end of the span is on that end. NSP times are whole milliseconds.
const EDGE: f64 = 0.0005;

/// A channel over the whole log: where its reading changes, the sections of one reading, and the stretches with no samples.
#[derive(Clone, Debug)]
pub(crate) struct Trace {
    /// sample index of every change: the first sample that shows the new reading. The first reading of a log is not a change.
    pub(crate) changes: Vec<usize>,
    /// [start, end, reading] in log seconds, from one change to the next; the last runs to the end of the log.
    /// A stretch of missing samples does not end one.
    pub(crate) sections: Vec<[f64; 3]>,
    /// [start, end] in log seconds of every stretch of missing samples
    pub(crate) gaps: Vec<[f64; 2]>,
}

/// Trace a channel's readings `a` at the sample times `t` (log seconds).
pub(crate) fn trace(t: &[f64], a: &[f64]) -> Trace {
    let mut tr = Trace {
        changes: Vec::new(),
        sections: Vec::new(),
        gaps: Vec::new(),
    };
    let end = t[t.len() - 1];
    // the last reading that was present, where its section started, where the gap after it started
    let (mut last, mut from, mut gap_from) = (f64::NAN, 0.0, None);
    for (i, &v) in a.iter().enumerate() {
        if v.is_nan() {
            gap_from.get_or_insert(t[i]);
            continue;
        }
        if let Some(g) = gap_from.take() {
            tr.gaps.push([g, t[i]]);
        }
        if v == last {
            continue;
        }
        if !last.is_nan() {
            tr.changes.push(i);
            tr.sections.push([from, t[i], last]);
        }
        (from, last) = (t[i], v);
    }
    if let Some(g) = gap_from {
        tr.gaps.push([g, end]);
    }
    if !last.is_nan() {
        tr.sections.push([from, end, last]);
    }
    tr
}

/// The span asked for, in log seconds, both ends included.
#[derive(Clone, Copy)]
pub(crate) struct Span {
    t0: f64,
    t1: f64,
}

impl Span {
    /// None when the span is backwards or an end is not a number.
    pub(crate) fn new(t0: f64, t1: f64) -> Option<Span> {
        // also true when either end is NaN
        if !(t0 <= t1) {
            return None;
        }
        Some(Span { t0, t1 })
    }

    /// A time within `EDGE` of an end of the span is on that end.
    pub(crate) fn snap(self, x: f64) -> f64 {
        if (x - self.t0).abs() <= EDGE {
            self.t0
        } else if (x - self.t1).abs() <= EDGE {
            self.t1
        } else {
            x
        }
    }

    /// Indexes of the samples inside the span.
    pub(crate) fn samples(self, t: &[f64]) -> Range<usize> {
        t.partition_point(|&x| x < self.t0 - EDGE)..t.partition_point(|&x| x <= self.t1 + EDGE)
    }

    /// The parts inside this span of stretches that start with [start, end, …]; anything after the end is kept as it is.
    /// One that ends as this span starts is left out: what follows it starts there. One that starts as this span ends is
    /// kept, with no length. `N` is 2 or more.
    pub(crate) fn clip<const N: usize>(self, spans: &[[f64; N]]) -> Vec<[f64; N]> {
        spans
            .iter()
            .copied()
            .map(|mut s| {
                s[0] = self.snap(s[0]);
                s[1] = self.snap(s[1]);
                s
            })
            .filter(|s| s[1] > self.t0 && s[0] <= self.t1)
            .map(|mut s| {
                s[0] = s[0].max(self.t0);
                s[1] = s[1].min(self.t1);
                s
            })
            .collect()
    }

    /// Log seconds of the changes at the given sample indexes, on the span's ends where they are within `EDGE` of them.
    pub(crate) fn times(self, t: &[f64], changes: &[usize]) -> Vec<f64> {
        changes.iter().map(|&i| self.snap(t[i])).collect()
    }
}

/// The changes at the samples `inside`. A change on the first sample of the span counts.
pub(crate) fn changes_in(changes: &[usize], inside: &Range<usize>) -> Vec<usize> {
    changes.iter().copied().filter(|i| inside.contains(i)).collect()
}

/// Something that changes inside the span: what it is called, and the sample indexes of its changes there, never empty.
pub(crate) trait Changing {
    fn name(&self) -> &str;
    fn changes(&self) -> &[usize];
}

/// Order of first change inside the span, then name, so the order never depends on channel order.
fn by_first_change<T: Changing>(a: &T, b: &T) -> Ordering {
    (a.changes()[0].cmp(&b.changes()[0])).then_with(|| a.name().cmp(b.name()))
}

/// At most `limit` of `found`, in order of first change, and how many were left out. When more change, the ones with
/// the fewest changes in the span are kept, ties by first change then name.
pub(crate) fn keep<T: Changing>(mut found: Vec<T>, limit: usize) -> (Vec<T>, usize) {
    let more = found.len().saturating_sub(limit);
    if more > 0 {
        found.sort_by(|a, b| {
            (a.changes().len().cmp(&b.changes().len())).then_with(|| by_first_change(a, b))
        });
        found.truncate(limit);
    }
    found.sort_by(by_first_change);
    (found, more)
}
```

- [ ] **Step 4: Switches on the shared module, with the new limit**

In `crates/core/src/switches.rs`:

Replace the module doc's first line `//! Switch rows for the replay: on/off channels as bars on the time axis.` with `//! On/off channels for the replay's chips: which channels are switches, which are one signal, and what each does in a span.`

Replace

```rust
use std::ops::Range;

use serde::Serialize;

use crate::log::Log;

/// The most rows the replay shows.
pub const MAX_ROWS: usize = 8;

/// Seconds. The UI holds times as f32, so an end of the span it asks for can miss a sample time by a rounding error.
/// A time this close to an end of the span is on that end. NSP times are whole milliseconds.
const EDGE: f64 = 0.0005;
```

with

```rust
use std::ops::Range;

use serde::Serialize;

use crate::log::Log;
use crate::span::{changes_in, keep, trace, Changing, Span, Trace};

/// The most switch chips the replay shows.
pub const MAX_SWITCHES: usize = 12;
```

Replace

```rust
/// A switch: the range the log declares for it, if any, lies within 0 to 2, and its samples read 0 and 1.
fn is_switch(a: &[f64], range: Option<[f64; 2]>) -> bool {
```

with

```rust
/// A switch: the range the log declares for it, if any, lies within 0 to 2, and its samples read 0 and 1.
pub(crate) fn is_switch(a: &[f64], range: Option<[f64; 2]>) -> bool {
```

Replace the whole function that starts `/// Changes, on spans and gaps of one switch channel over the whole log.\nfn trace(j: usize, t: &[f64], a: &[f64]) -> Switch {` (through its closing `}`) with:

```rust
/// Changes, on spans and gaps of one switch channel over the whole log.
fn switch(j: usize, t: &[f64], a: &[f64]) -> Switch {
    let Trace {
        changes,
        sections,
        gaps,
    } = trace(t, a);
    // the switch is on through each section that reads 1
    let on = (sections.iter())
        .filter(|s| s[2] == 1.0)
        .map(|s| [s[0], s[1]])
        .collect();
    Switch {
        j,
        changes,
        on,
        gaps,
    }
}
```

In `all`, replace `.map(|j| trace(j, &log.t, log.chan_at(j)))` with `.map(|j| switch(j, &log.t, log.chan_at(j)))`.

Delete the `Span` struct and its `impl Span { … }` block (from `/// The span asked for, in log seconds, both ends included.` through the closing `}` of the `impl`).

Replace

```rust
/// The groups whose named channel changes at the samples `inside`, in order of its first change there.
/// A change on the first sample of the span counts.
fn changing<'a>(log: &'a Log, inside: &Range<usize>) -> Vec<Found<'a>> {
    let mut found: Vec<Found> = (all(log).iter())
        .filter_map(|group| {
            let changes: Vec<usize> = (group.switch.changes.iter())
                .copied()
                .filter(|i| inside.contains(i))
                .collect();
            (!changes.is_empty()).then_some(Found { group, changes })
        })
        .collect();
    // rows that first change at the same sample are in name order, so the order never depends on channel order
    found.sort_by(|a, b| {
        (a.changes[0].cmp(&b.changes[0])).then_with(|| a.group.name.cmp(&b.group.name))
    });
    found
}

/// The switches that change between `t0` and `t1` (log seconds, both ends included), in order of first change,
/// at most `limit` of them. Each group of channels that are one signal has one row, built from its named channel.
pub fn switches(log: &Log, t0: f64, t1: f64, limit: usize) -> Rows {
    // also true when either end is NaN
    if !(t0 <= t1) {
        return Rows {
            rows: Vec::new(),
            more: 0,
        };
    }
    let span = Span { t0, t1 };
    let inside = span.samples(&log.t);
    let found = changing(log, &inside);
    let more = found.len().saturating_sub(limit);
    let rows = found
        .into_iter()
        .take(limit)
        .map(|f| Row {
            name: f.group.name.clone(),
            also: f.group.also.clone(),
            on: span.clip(&f.group.switch.on),
            gaps: span.clip(&f.group.switch.gaps),
            changes: f.changes.iter().map(|&i| span.snap(log.t[i])).collect(),
        })
        .collect();
    Rows { rows, more }
}
```

with

```rust
impl Changing for Found<'_> {
    fn name(&self) -> &str {
        &self.group.name
    }
    fn changes(&self) -> &[usize] {
        &self.changes
    }
}

/// The groups whose named channel changes at the samples `inside`. A change on the first sample of the span counts.
fn changing<'a>(log: &'a Log, inside: &Range<usize>) -> Vec<Found<'a>> {
    (all(log).iter())
        .filter_map(|group| {
            let changes = changes_in(&group.switch.changes, inside);
            (!changes.is_empty()).then_some(Found { group, changes })
        })
        .collect()
}

/// The switches that change between `t0` and `t1` (log seconds, both ends included), in order of first change,
/// at most `limit` of them: when more change, the ones that change least in the span are kept.
/// Each group of channels that are one signal has one row, built from its named channel.
pub fn switches(log: &Log, t0: f64, t1: f64, limit: usize) -> Rows {
    let Some(span) = Span::new(t0, t1) else {
        return Rows {
            rows: Vec::new(),
            more: 0,
        };
    };
    let inside = span.samples(&log.t);
    let (found, more) = keep(changing(log, &inside), limit);
    let rows = found
        .into_iter()
        .map(|f| Row {
            name: f.group.name.clone(),
            also: f.group.also.clone(),
            on: span.clip(&f.group.switch.on),
            gaps: span.clip(&f.group.switch.gaps),
            changes: span.times(&log.t, &f.changes),
        })
        .collect();
    Rows { rows, more }
}
```

In the doc of `Rows`, the field doc `/// signals whose named channel changes inside the span and that were left out by the limit` stays.

- [ ] **Step 5: The state rule**

In `crates/core/src/haltech.rs`, after the function `to_eng`, add:

```rust
/// NSP gives a state or a count no unit: its `Type` is `Raw` or `Gear`. Inferred from the sample logs.
pub fn has_no_unit(ty: &str) -> bool {
    matches!(ty, "Raw" | "Gear")
}

/// The logger's own channels, which describe the log rather than the car: in NSP their names start `Data Log `
/// (Data Log Status, Data Log Memory State).
pub fn is_logger_channel(name: &str) -> bool {
    name.starts_with("Data Log ")
}
```

At the top of `crates/core/src/states.rs`, above `#[cfg(test)]`, add:

```rust
//! State channels for the replay's chips: channels that hold one of a few whole-number readings, such as Gear, Engine
//! State or Idle Control State.
//!
//! A channel is a state in a log when it is not a switch, the ECU gives it no unit, every sample it has is a whole
//! number, it takes between two and eight different readings in the log, the range the log's header declares for it,
//! if it declares one, is no wider than 128, it changes no more than twice a second on average over the log, and it is
//! not one of the logger's own channels. States are not grouped: two that change together are two chips.
//! Which channels are states, and their traces, are worked out once per log and kept with it.

use serde::Serialize;

use crate::haltech::{has_no_unit, is_logger_channel};
use crate::log::Log;
use crate::span::{changes_in, keep, trace, Changing, Span, Trace};
use crate::switches::is_switch;

/// The most state chips the replay shows.
pub const MAX_STATES: usize = 8;
/// The most different readings a state takes in a log.
const MAX_READINGS: usize = 8;
/// The widest range a state may declare. Counters and diagnostics declare far wider ones (4096 either side, 524288).
const MAX_WIDTH: f64 = 128.0;
/// The most changes a second, on average over the log, that a state makes. A channel that changes more often is a
/// signal, not a state: Trigger Synchronisation State changes 2.4 to 3.7 times a second in the sample logs, the next most
/// frequent candidate 1.2 at most.
const MAX_RATE: f64 = 2.0;

/// One state channel of a log, over the whole log.
#[derive(Clone, Debug)]
pub(crate) struct State {
    name: String,
    trace: Trace,
}

/// One state chip: a state channel that changes inside the span.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct StateRow {
    pub name: String,
    /// [start, end, reading] in log seconds, from one change to the next, clipped to the span.
    /// One that starts on the last sample of the span has no length.
    pub sections: Vec<[f64; 3]>,
    /// [start, end] in log seconds where the channel has no samples, clipped to the span
    pub gaps: Vec<[f64; 2]>,
    /// log seconds of every change inside the span
    pub changes: Vec<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct StateRows {
    pub rows: Vec<StateRow>,
    /// states that change inside the span and that were left out by the limit
    pub more: usize,
}

/// The rule in the module doc for channel `j` of the log, all but the rate, which needs the channel's trace.
fn is_state(log: &Log, j: usize) -> bool {
    if log.is_const(j) || !has_no_unit(&log.types[j]) || is_logger_channel(&log.names[j]) {
        return false;
    }
    let (a, range) = (log.chan_at(j), log.ranges[j]);
    !is_switch(a, range) && reads_a_few_whole_numbers(a) && declares_narrow(range)
}

/// Every sample that is present is a whole number, and they take two to `MAX_READINGS` different values.
fn reads_a_few_whole_numbers(a: &[f64]) -> bool {
    let mut seen: Vec<f64> = Vec::new();
    for &v in a.iter().filter(|v| !v.is_nan()) {
        if v.fract() != 0.0 {
            return false;
        }
        if !seen.contains(&v) {
            if seen.len() == MAX_READINGS {
                return false;
            }
            seen.push(v);
        }
    }
    seen.len() >= 2
}

/// The declared range, if any, is no wider than `MAX_WIDTH`; with none declared the samples decide. A bound at the ECU's
/// no-reading value is NaN and means wider than anything. `<=` is false for NaN, so such a range is not narrow:
/// written this way on purpose, not as `!(width > MAX_WIDTH)`.
fn declares_narrow(range: Option<[f64; 2]>) -> bool {
    range.is_none_or(|[min, max]| max - min <= MAX_WIDTH)
}

/// No more than `MAX_RATE` changes a second on average over a log `duration` seconds long. Written as a product, not
/// a rate, so nothing is divided: a log of zero length (one sample, or every sample at one time) allows no change, and a
/// channel that changes at all fails. `<=` is false for NaN, so a duration that is not a number fails too; written this
/// way on purpose, not as `!(changes > MAX_RATE * duration)`.
fn changes_rarely(changes: usize, duration: f64) -> bool {
    changes as f64 <= MAX_RATE * duration
}

/// Every state channel of the log. Found on first use and kept with the log.
fn all(log: &Log) -> &[State] {
    log.chip_states.get_or_init(|| {
        (0..log.names.len())
            .filter(|&j| is_state(log, j))
            .map(|j| State {
                name: log.names[j].clone(),
                trace: trace(&log.t, log.chan_at(j)),
            })
            .filter(|state| changes_rarely(state.trace.changes.len(), log.duration()))
            .collect()
    })
}

/// A state that changes inside the span.
struct Found<'a> {
    state: &'a State,
    /// sample indexes of its changes inside the span, never empty
    changes: Vec<usize>,
}

impl Changing for Found<'_> {
    fn name(&self) -> &str {
        &self.state.name
    }
    fn changes(&self) -> &[usize] {
        &self.changes
    }
}

/// The states that change between `t0` and `t1` (log seconds, both ends included), in order of first change,
/// at most `limit` of them: when more change, the ones that change least in the span are kept.
pub fn states(log: &Log, t0: f64, t1: f64, limit: usize) -> StateRows {
    let Some(span) = Span::new(t0, t1) else {
        return StateRows {
            rows: Vec::new(),
            more: 0,
        };
    };
    let inside = span.samples(&log.t);
    let found = (all(log).iter())
        .filter_map(|state| {
            let changes = changes_in(&state.trace.changes, &inside);
            (!changes.is_empty()).then_some(Found { state, changes })
        })
        .collect();
    let (found, more) = keep(found, limit);
    let rows = found
        .into_iter()
        .map(|f| StateRow {
            name: f.state.name.clone(),
            sections: span.clip(&f.state.trace.sections),
            gaps: span.clip(&f.state.trace.gaps),
            changes: span.times(&log.t, &f.changes),
        })
        .collect();
    StateRows { rows, more }
}
```

- [ ] **Step 6: Keep the states with the log, and list the modules**

In `crates/core/src/log.rs`:

Replace `use crate::switches::Group;` with:

```rust
use crate::states::State;
use crate::switches::Group;
```

Replace

```rust
    /// the on/off channels, grouped into signals, found on first use
    pub(crate) switches: OnceLock<Vec<Group>>,
}
```

with

```rust
    /// the on/off channels, grouped into signals, found on first use
    pub(crate) switches: OnceLock<Vec<Group>>,
    /// the state channels for the replay's chips, found on first use. `states` above is the findings' own list.
    pub(crate) chip_states: OnceLock<Vec<State>>,
}
```

In `Log::from_raw`, replace `            switches: OnceLock::new(),\n        })` with:

```rust
            switches: OnceLock::new(),
            chip_states: OnceLock::new(),
        })
```

In `crates/core/src/lib.rs`, replace

```rust
//! - `switches`: on/off channels and when they change, for the replay's switch rows.
```

with

```rust
//! - `span`: what switches and states share: a channel traced over the log, the span on screen, the limit.
//! - `switches`: on/off channels, which of them are one signal, and what they do in a span.
//! - `states`: channels that hold one of a few whole-number readings, such as Gear.
```

and add `mod span;` after `pub mod session;` (`pub mod states;` is there from Step 1).

In `crates/core/src/session.rs`, replace `use crate::switches::{switches, MAX_ROWS};` with `use crate::switches::{switches, MAX_SWITCHES};` and, in the `"switches"` arm, `switches(log, t0, t1, MAX_ROWS)` with `switches(log, t0, t1, MAX_SWITCHES)`.

In `src/types.ts`, in `interface Switches`, replace the doc comment of `more` with:

```ts
  /** signals whose named channel changes inside the span and that were left out by the core's limit (`MAX_SWITCHES` in `switches.rs`) */
```

- [ ] **Step 7: Run the checks and see everything pass**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cargo fmt --check && cargo clippy -p logviewer-core -- -D warnings && npm run test:core && npm run check && npx prettier --check "src/**/*.ts" tests && npm run build && cargo build --release -p logviewer-dev && npm run test:ui`

Expected: every core test passes, the golden test unchanged; the UI test ends with `all checks passed` (the UI still asks `switches`; no span the UI test shows has more than eight switches, so its rows do not change).

- [ ] **Step 8: Commit**

```bash
git add crates/core/src/span.rs crates/core/src/states.rs crates/core/src/switches.rs crates/core/src/log.rs crates/core/src/haltech.rs crates/core/src/lib.rs crates/core/src/session.rs crates/core/tests/switches.rs src/types.ts
git commit -m "Core: state channels, and one limit rule for switches and states

A state is a channel with no unit, whole-number samples, two to eight
readings, a declared range no wider than 128 (a NaN bound is not narrow),
no more than two changes a second over the log, and not a Data Log channel.
Switches and states share one trace, the span they are clipped to, and the
limit: twelve switches and eight states, keeping those that change least.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The `chips` command

**Files:**
- Create: `crates/core/src/chips.rs`
- Modify: `crates/core/src/lib.rs`, `crates/core/src/session.rs` (the `chips` arm)
- Modify: `crates/core/tests/common/mod.rs` (the sample-pull helpers, moved here)
- Modify: `crates/core/tests/switches.rs` (uses the moved helpers)
- Create: `crates/core/tests/chips.rs`
- Modify: `src/types.ts` (`StateRow`, `States`, `Chips`), `src/api.ts` (`chips`)
- Test: `crates/core/tests/chips.rs`

**Interfaces:**
- Consumes, from Task 2: `switches(log, t0, t1, MAX_SWITCHES) -> Rows`, `states(log, t0, t1, MAX_STATES) -> StateRows`.
- Produces, in `crates/core/src/chips.rs`: `pub struct Chips { pub switches: Rows, pub states: StateRows }`, `pub fn chips(log: &Log, t0: f64, t1: f64) -> Chips`. In `dispatch`: command `chips` with `log`, `t0`, `t1`, answering `{ "switches": { "rows": [...], "more": n }, "states": { "rows": [{ "name", "sections", "gaps", "changes" }], "more": n } }`.
- Produces, in `crates/core/tests/common/mod.rs`: `pub const PULL_PAD: f64`, `pub fn log_key(s: &mut Session, file: &str) -> String`, `pub fn replay_span(s: &mut Session, pull: &Value) -> (String, f64, f64)`, `pub fn default_pull(s: &mut Session) -> (String, f64, f64)`, `pub fn pull(s: &mut Session, key: &str) -> (String, f64, f64)`.
- Produces, in `src/types.ts`: `interface StateRow { name: string; sections: [number, number, number][]; gaps: [number, number][]; changes: number[] }`, `interface States { rows: StateRow[]; more: number }`, `interface Chips { switches: Switches; states: States }`. In `src/api.ts`: `api.chips(log: string, t0: number, t1: number): Promise<Chips>`. Task 4 uses all three.

- [ ] **Step 1: Share the pull helpers and write the failing tests**

In `crates/core/tests/common/mod.rs`, replace `use serde_json::Value;` with `use serde_json::{json, Value};` and add at the end:

```rust
/// Seconds shown either side of a pull. Copies the UI's rule for the span of a pull (`focusPull` in `src/state.ts`).
pub const PULL_PAD: f64 = 1.5;

/// The key of a sample log, by its file name.
pub fn log_key(s: &mut Session, file: &str) -> String {
    let logs = call(s, "logs", json!({})).unwrap();
    let log = logs.as_array().unwrap().iter().find(|l| l["name"] == file);
    log.expect("sample log")["key"]
        .as_str()
        .unwrap()
        .to_string()
}

/// A pull's log and the span the replay shows for it: the pull with `PULL_PAD` either side, kept inside the log,
/// as the UI does.
pub fn replay_span(s: &mut Session, pull: &Value) -> (String, f64, f64) {
    let log = pull["logKey"].as_str().unwrap().to_string();
    let logs = call(s, "logs", json!({})).unwrap();
    let meta = logs.as_array().unwrap().iter().find(|l| l["key"] == log);
    let duration = meta.unwrap()["duration"].as_f64().unwrap();
    let (t0, t1) = (pull["t0"].as_f64().unwrap(), pull["t1"].as_f64().unwrap());
    (log, (t0 - PULL_PAD).max(0.0), (t1 + PULL_PAD).min(duration))
}

/// The pull the app opens on: the one with the largest RPM gain.
pub fn default_pull(s: &mut Session) -> (String, f64, f64) {
    let overview = call(s, "overview", json!({})).unwrap();
    let pulls = overview["pulls"].as_array().unwrap();
    let gain = |p: &&Value| p["gain"].as_f64().unwrap();
    let p = pulls
        .iter()
        .max_by(|a, b| gain(a).total_cmp(&gain(b)))
        .unwrap()
        .clone();
    replay_span(s, &p)
}

/// The pull with the given key.
pub fn pull(s: &mut Session, key: &str) -> (String, f64, f64) {
    let overview = call(s, "overview", json!({})).unwrap();
    let pulls = overview["pulls"].as_array().unwrap();
    let p = pulls
        .iter()
        .find(|p| p["key"] == key)
        .expect("sample pull")
        .clone();
    replay_span(s, &p)
}
```

In `crates/core/tests/switches.rs`, delete the local `log_key`, `PULL_PAD`, `replay_span`, `default_pull` and `pull` (with their doc comments), and replace `use common::{call, sample_session};` with `use common::{call, default_pull, log_key, pull, sample_session, PULL_PAD};`.

Create `crates/core/tests/chips.rs`:

```rust
//! The replay's chips through the `chips` command the UI calls, on the sample logs: the states, and the answer's shape.
//! The switches in the answer are tested in switches.rs.

mod common;

use common::{call, default_pull, log_key, pull, sample_session};
use logviewer_core::Session;
use serde_json::{json, Value};

fn chips(s: &mut Session, log: &str, t0: f64, t1: f64) -> Value {
    call(s, "chips", json!({ "log": log, "t0": t0, "t1": t1 })).unwrap()
}

fn state_names(reply: &Value) -> Vec<&str> {
    let rows = reply["states"]["rows"].as_array().unwrap();
    rows.iter().map(|r| r["name"].as_str().unwrap()).collect()
}

#[test]
fn the_default_pull_gets_its_states_in_order_of_first_change() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let (log, t0, t1) = default_pull(&mut s);
    let reply = chips(&mut s, &log, t0, t1);
    assert_eq!(
        state_names(&reply),
        [
            "Drive By Wire Throttle Motor Direction",
            "Engine State",
            "Idle Control State",
            "Ignition Active Table",
            "Gear",
            "Traction Control State",
            "Manifold Pressure Filter Scale",
        ]
    );
    assert_eq!(reply["states"]["more"], 0);
}

#[test]
fn gear_reads_1_2_3_across_the_default_pull() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let (log, t0, t1) = default_pull(&mut s);
    let reply = chips(&mut s, &log, t0, t1);
    assert_eq!(
        reply["states"]["rows"][4],
        json!({
            "name": "Gear",
            "sections": [[t0, 31.251, 1.0], [31.251, 35.817, 2.0], [35.817, t1, 3.0]],
            "gaps": [],
            "changes": [31.251, 35.817],
        })
    );
}

#[test]
fn idle_control_state_reads_its_negative_values() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let (log, t0, t1) = default_pull(&mut s);
    let reply = chips(&mut s, &log, t0, t1);
    assert_eq!(
        reply["states"]["rows"][2],
        json!({
            "name": "Idle Control State",
            "sections": [
                [t0, 29.918, -7.0],
                [29.918, 29.963, -9.0],
                [29.963, 30.679, -3.0],
                [30.679, 35.058, -7.0],
                [35.058, 35.534, -3.0],
                [35.534, t1, -7.0]
            ],
            "gaps": [],
            "changes": [29.918, 29.963, 30.679, 35.058, 35.534],
        })
    );
}

#[test]
fn the_1_44_pm_2nd_gear_pull_gets_five_states() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let (log, t0, t1) = pull(&mut s, "PCLog_2026-04-17_0144pm.csv|20260417 01:44:01@12.1");
    let reply = chips(&mut s, &log, t0, t1);
    assert_eq!(
        state_names(&reply),
        [
            "Idle Control State",
            "Drive By Wire Throttle Motor Direction",
            "Engine State",
            "Ignition Active Table",
            "Gear",
        ]
    );
    assert_eq!(reply["states"]["more"], 0);
    assert_eq!(
        reply["states"]["rows"][4]["sections"],
        json!([[t0, 12.093, 1.0], [12.093, 17.376, 2.0], [17.376, t1, 3.0]])
    );
}

/// Eleven states change across the whole 1:44 pm log. The eight that change least are kept, in order of first change.
#[test]
fn a_whole_log_keeps_the_states_that_change_least() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let log = log_key(&mut s, "PCLog_2026-04-17_0144pm.csv");
    let reply = chips(&mut s, &log, 0.0, 75.441);
    assert_eq!(
        state_names(&reply),
        [
            "Launch Control State",
            "Engine State",
            "Drive By Wire 1 Pin 2 Output State",
            "Start Button Next Expected Action Channel",
            "Traction Control State",
            "Gear",
            "Manifold Pressure Filter Scale",
            "Last Engine Limiting Function",
        ]
    );
    // Ignition Active Table (29 changes), Idle Control State (39), Drive By Wire Throttle Motor Direction (55)
    assert_eq!(reply["states"]["more"], 3);
}

#[test]
fn the_1_42_pm_log_has_one_state_and_no_switch() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let log = log_key(&mut s, "PCLog_2026-04-17_0142pm.csv");
    let reply = chips(&mut s, &log, 0.0, 18.371);
    assert_eq!(reply["switches"], json!({ "rows": [], "more": 0 }));
    assert_eq!(state_names(&reply), ["Idle Control State"]);
    assert_eq!(
        reply["states"]["rows"][0],
        json!({
            "name": "Idle Control State",
            "sections": [[0.0, 0.081, -1.0], [0.081, 18.371, 1.0]],
            "gaps": [],
            "changes": [0.081],
        })
    );
}

/// Trigger Synchronisation State changes 2.4 to 3.7 times a second in every sample log, and Data Log Status and Data Log
/// Memory State are the logger's own: none of them is ever a state. At most eight states change in any 2 s of the sample
/// logs, so none is left out of a 2 s window and its answer lists every state that changes in it.
#[test]
fn signals_and_the_loggers_own_channels_are_never_states() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let logs = call(&mut s, "logs", json!({})).unwrap();
    let logs: Vec<(String, f64)> = (logs.as_array().unwrap().iter())
        .map(|l| (l["key"].as_str().unwrap().to_string(), l["duration"].as_f64().unwrap()))
        .collect();
    let mut seen = 0;
    for (log, duration) in logs {
        let mut t0 = 0.0;
        while t0 < duration {
            let reply = chips(&mut s, &log, t0, (t0 + 2.0).min(duration));
            assert_eq!(reply["states"]["more"], 0, "{log} at {t0} s");
            for name in state_names(&reply) {
                assert!(
                    !["Trigger Synchronisation State", "Data Log Status", "Data Log Memory State"].contains(&name),
                    "{name} in {log} at {t0} s"
                );
                seen += 1;
            }
            t0 += 2.0;
        }
    }
    // the windows did hold states
    assert!(seen > 0);
}

#[test]
fn traction_control_state_is_one_of_the_default_pulls_states() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let (log, t0, t1) = default_pull(&mut s);
    let reply = chips(&mut s, &log, t0, t1);
    let tcs = &reply["states"]["rows"][5];
    assert_eq!(tcs["name"], "Traction Control State");
    assert_eq!(
        tcs["changes"],
        json!([32.631, 32.676, 32.916, 32.961, 33.34, 33.393, 33.453, 33.53, 33.627, 35.008, 35.957, 36.005])
    );
    assert_eq!(tcs["sections"][0], json!([t0, 32.631, 0.0]));
}

/// The answer holds the switches, as the `switches` command gives them for the same span, and the states.
#[test]
fn the_answer_holds_the_switches_and_the_states_of_the_span() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let (log, t0, t1) = default_pull(&mut s);
    let reply = chips(&mut s, &log, t0, t1);
    let keys: Vec<&str> = reply.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(keys, ["states", "switches"]);
    let old = call(&mut s, "switches", json!({ "log": log, "t0": t0, "t1": t1 })).unwrap();
    assert_eq!(reply["switches"], old);
}

#[test]
fn the_same_span_gives_the_same_answer_every_time() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let (log, t0, t1) = default_pull(&mut s);
    let first = chips(&mut s, &log, t0, t1);
    // another span in between: what is found for the log is kept, the answer for a span is not
    chips(&mut s, &log, 0.0, 10.0);
    assert_eq!(chips(&mut s, &log, t0, t1), first);
}

#[test]
fn a_request_that_cannot_be_answered_says_why() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let log = log_key(&mut s, "PCLog_2026-04-17_0145pm.csv");
    let err = |s: &mut Session, args: Value| call(s, "chips", args).unwrap_err();
    assert_eq!(
        err(&mut s, json!({ "t0": 0.0, "t1": 1.0 })),
        "missing argument: log"
    );
    assert_eq!(
        err(&mut s, json!({ "log": log, "t1": 1.0 })),
        "missing argument: t0"
    );
    // JSON has no NaN: the UI's NaN arrives as null
    assert_eq!(
        err(&mut s, json!({ "log": log, "t0": 0.0, "t1": null })),
        "missing argument: t1"
    );
    assert_eq!(
        err(&mut s, json!({ "log": "gone", "t0": 0.0, "t1": 1.0 })),
        "That log is not loaded."
    );
}
```

- [ ] **Step 2: Run the new tests and see them fail**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cargo test --release -p logviewer-core --no-fail-fast --test chips --test switches`

Expected: `switches` passes (the helpers moved, nothing else changed). Every test in `chips` fails with a panic on `unknown command: chips`, except `a_request_that_cannot_be_answered_says_why`, which fails on its first `assert_eq!`: left `"unknown command: chips"`, right `"missing argument: log"`.

- [ ] **Step 3: The answer and the command**

Create `crates/core/src/chips.rs`:

```rust
//! The replay's chips for a span: the switches and the states that change in it, each kind cut at its own limit.

use serde::Serialize;

use crate::log::Log;
use crate::states::{states, StateRows, MAX_STATES};
use crate::switches::{switches, Rows, MAX_SWITCHES};

/// What the chips show for a span. Each kind counts its own chips left out.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Chips {
    pub switches: Rows,
    pub states: StateRows,
}

/// The switches and the states that change between `t0` and `t1` (log seconds, both ends included).
pub fn chips(log: &Log, t0: f64, t1: f64) -> Chips {
    Chips {
        switches: switches(log, t0, t1, MAX_SWITCHES),
        states: states(log, t0, t1, MAX_STATES),
    }
}
```

In `crates/core/src/lib.rs`, add `pub mod chips;` before `pub mod dyno;`, and after the `states` line of the module list add:

```rust
//! - `chips`: the replay's chips for a span: switches and states.
```

In `crates/core/src/session.rs`, add `use crate::chips::chips;` as the first of the `use crate::…` lines (before `use crate::dyno::…`). Replace

```rust
            "switches" => {
                let log = self.log(arg_str(&args, "log")?)?;
```

with

```rust
            "chips" => {
                let log = self.log(arg_str(&args, "log")?)?;
                let (t0, t1) = (arg_f64(&args, "t0")?, arg_f64(&args, "t1")?);
                ok(serde_json::to_value(chips(log, t0, t1)).map_err(|e| e.to_string())?)
            }
            // the UI's switch rows still ask for this; it goes when they do
            "switches" => {
                let log = self.log(arg_str(&args, "log")?)?;
```

- [ ] **Step 4: Expose it to the UI**

In `src/types.ts`, after `interface Switches { … }` add:

```ts
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
```

In `src/api.ts`, change the type import to `import type { Chips, DynoOut, LogMeta, Overview, Settings, Switches, Vehicle } from './types';` and after the `switches: …` entry add:

```ts
  /**
   * The switches and the states that change between t0 and t1 (seconds in the log), each in order of first change and
   * each cut at the core's limit. A span with t0 after t1 answers none of either.
   */
  chips: (log: string, t0: number, t1: number) => call<Chips>('chips', { log, t0, t1 }),
```

- [ ] **Step 5: Run the checks and see everything pass**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cargo fmt --check && cargo clippy -p logviewer-core -- -D warnings && npm run test:core && npm run check && npx prettier --check "src/**/*.ts" tests && npm run build && cargo build --release -p logviewer-dev && npm run test:ui`

Expected: every core test passes; the UI test ends with `all checks passed`.

- [ ] **Step 6: Commit**

```bash
git add crates/core/src/chips.rs crates/core/src/lib.rs crates/core/src/session.rs crates/core/tests/common/mod.rs crates/core/tests/switches.rs crates/core/tests/chips.rs src/types.ts src/api.ts
git commit -m "Core: the chips command, switches and states for a span

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Chips under the readout cards in place of the switch rows

**Files:**
- Create: `src/chips.ts`
- Modify: `src/charts.ts` (the rows, their pointing and their height go; a band of ticks is reserved; the note)
- Modify: `src/app.ts` (`syncChips`, `retryChips`, `drawAll`, the checkbox, the trace pointer handlers, `collectSettings`, `boot`, imports)
- Modify: `src/state.ts` (`chipsKey`, the `S` fields), `src/types.ts` (two doc comments), `src/api.ts` (`switches` goes)
- Modify: `index.html` (the checkbox label, the chips box), `src/styles.css` (the chip)
- Modify: `crates/core/src/session.rs` (the `switches` arm goes), `crates/core/tests/switches.rs`, `crates/core/tests/chips.rs`
- Test: `tests/ui.mjs`

**Interfaces:**
- Consumes, from Task 3: `api.chips(log, t0, t1): Promise<Chips>`, `Chips`, `StateRow`, `SwitchRow`.
- Produces, in `src/chips.ts`:
  - `export type Chip = { kind: 'switch'; row: SwitchRow } | { kind: 'state'; row: StateRow }`
  - `export const shownChips: () => Chips | null`
  - `export const chipList: (c: Chips | null) => Chip[]`
  - `export function chipText(chip: Chip, t: number, spanEnd: number): string`
  - `export function updateChips(): void`
  - `export function chipsNote(): string`
- Produces, in `src/state.ts`: `export const chipsKey: (f: Focus) => string`; `S.chips: Chips | null`, `S.chipsFor: string`, `S.chipsShow: boolean`. `S.sw`, `S.swFor`, `S.swNow`, `S.swShow`, `S.swHover` and `switchKey` are gone.
- Produces, in `src/charts.ts`: `TG.ticks` (12); `TraceLayout.axisY: number` in place of `rows` and `swY`. `SW`, `switchAt`, `switchRowAt` are gone.
- Produces, in the page: `#chips` (`div.chips`, `role="group"`), holding `button.chip` elements, each `span.dot` (switches only), `span.nm`, `b.vl`; a switch chip has class `on` while it reads On. Task 5 makes the chips choosable.

- [ ] **Step 1: Rewrite the replay checks in the UI test**

In `tests/ui.mjs`:

Replace the helper block that starts with the comment `  // geometry of the trace canvas, as in src/charts.ts: TG for the traces, SW for the switch rows under them` and ends with the line `  const rowsShown = (page, n) => until(page, n => window.__logViewer.swNow?.length === n, n);` with:

```js
  // geometry of the trace canvas, as in src/charts.ts: TG for the traces and the band of ticks above the time axis
  const TG = { l: 46, r: 92, lab: 17, gap: 6, ticks: 12, axis: 22 };
  /** The replay as it stands: the span, the core's chips, the chips on screen and what they read, the canvas and its plot height. */
  const replay = page =>
    page.evaluate(TG => {
      const s = window.__logViewer;
      const traces = (s.fview || s.rview).traces.length;
      const height = document.getElementById('tr-wrap').offsetHeight;
      const chips = [...document.querySelectorAll('#chips .chip')];
      const name = c => c.querySelector('.nm').textContent;
      return {
        log: s.focus.log.name,
        w0: s.focus.w0,
        w1: s.focus.w1,
        chips: s.chips,
        names: chips.map(name).join(),
        now: chips.map(c => c.querySelector('.vl').textContent).join(),
        titles: chips.map(c => c.title),
        on: chips.filter(c => c.classList.contains('on')).map(name).join(),
        pressed: chips.filter(c => c.getAttribute('aria-pressed') === 'true').map(name).join(),
        traces,
        height,
        ph: (height - 4 - TG.axis - TG.ticks) / traces - TG.lab - TG.gap,
        note: document.getElementById('tr-note').textContent,
        pw: document.getElementById('tr-cv').clientWidth - TG.l - TG.r,
      };
    }, TG);
  /** x on the canvas of a time in the span; y of the top of trace k's plot; y of the time axis. */
  const xAt = (r, t) => TG.l + ((t - r.w0) / (r.w1 - r.w0)) * r.pw;
  const plotTop = (r, k) => k * (TG.lab + r.ph + TG.gap) + TG.lab;
  const axisY = r => r.traces * (TG.lab + r.ph + TG.gap) - TG.gap + TG.ticks;
  /** Put the playhead at t and redraw: pressing By time redraws and moves nothing. Returns what the chips read there. */
  const playhead = async (page, t) => {
    await page.evaluate(t => (window.__logViewer.t = t), t);
    await page.click('[data-xmode="time"]');
    return (await replay(page)).now;
  };
  /** One pixel of the trace canvas, and a colour token from the stylesheet, both as [r, g, b, a]. */
  const pixel = (page, x, y) =>
    page.evaluate(
      ([x, y]) => [...document.getElementById('tr-cv').getContext('2d').getImageData(x, y, 1, 1).data],
      [Math.round(x), Math.round(y)],
    );
  const token = (page, name) =>
    page.evaluate(name => {
      const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim().slice(1);
      return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)).concat(255);
    }, name);
  const sameColour = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2);
  /** Waits for a condition in the page. Answers false, with no exception, when it does not come true. */
  const until = (page, fn, arg) =>
    page.waitForFunction(fn, arg, { timeout: 5000 }).then(
      () => true,
      () => false,
    );
  const chipsShown = (page, n) => until(page, n => document.querySelectorAll('#chips .chip').length === n, n);
  /** Click the chip with this exact name. False when there is none. */
  const clickChip = async (page, name) => {
    const chip = page.locator('#chips .chip').filter({ has: page.getByText(name, { exact: true }) });
    if (!(await chip.count())) return false;
    await chip.first().click();
    return true;
  };
  // the chips of the default pull and of the whole Back road log (the 1:45 pm log, renamed above), as the core orders them
  const DEFAULT_CHIPS =
    'Decel Detected,Drive By Wire 1 Pin 1 Output State,Clutch State,Gear Upshift State,Stepper 1 Pin 2 Output State,Predicted MAP Active,' +
    'Drive By Wire Throttle Motor Direction,Engine State,Idle Control State,Ignition Active Table,Gear,Traction Control State,Manifold Pressure Filter Scale';
  const WHOLE_CHIPS =
    'Stepper 1 Pin 2 Output State,Predicted MAP Active,Drive By Wire 1 Pin 1 Output State,Clutch State,Decel Detected,Gear Upshift State,AVI1 Switch State,Brake Pedal State,' +
    'Manifold Pressure Filter Scale,Drive By Wire 1 Pin 2 Output State,Engine State,Ignition Active Table,Idle Control State,Gear,Start Button Next Expected Action Channel,Launch Control State';
```

Replace everything from the comment line `  // switch rows, drawn from rows put in by hand so that every case is on screen: on, off, no samples, rows left out.` up to and including the statement that removes the expected aborted-request errors after the `Try again brings the rows back and clears the message` check (the multi-line `errors.splice(\n    errorsBeforeRetry,` … `);`) with:

```js
  // switch and state chips. Channels is closed for these checks: with it closed the replay fits the window at every span below
  if (await page.isVisible('#picker')) await page.click('#chan-btn');
  // the 1:42 pm log has no switch that changes, and one state that does
  await page.locator('.log-head', { hasText: '1:42 pm log' }).locator('button', { hasText: 'Replay' }).click();
  await chipsShown(page, 1);
  const bare = await replay(page);
  check(
    'a log with a state and no switch shows a chip for the state',
    bare.names === 'Idle Control State' && !/ more /.test(bare.note),
    bare.names + ' | ' + bare.note,
  );
  // chips put in by hand for the same span, so that every case is on screen: on, off, no samples, a state, chips left out
  const putChips = (swMore, stMore) =>
    page.evaluate(
      ([swMore, stMore]) => {
        const s = window.__logViewer;
        const end = s.focus.w1;
        s.chips = {
          switches: {
            rows: [
              // the second on span is 10 ms of an 18 s span
              {
                name: 'Clutch',
                also: ['Clutch Input', 'AVI6'],
                on: [
                  [4, 8],
                  [14, 14.01],
                ],
                gaps: [[10, 12]],
                changes: [4, 8, 14, 14.01],
              },
              { name: 'Fan', also: [], on: [[0, end]], gaps: [], changes: [0] },
            ],
            more: swMore,
          },
          states: {
            // the last section starts on the last sample of the span and has no length
            rows: [
              {
                name: 'Gear',
                sections: [
                  [0, 5, 1],
                  [5, 9, 2],
                  [9, end, -1],
                  [end, end, 4],
                ],
                gaps: [[15, 16]],
                changes: [5, 9, end],
              },
            ],
            more: stMore,
          },
        };
        s.rev++; // they are for the span on screen: chipsFor already names it
      },
      [swMore, stMore],
    );
  await putChips(2, 1);
  const read = [
    await playhead(page, 2),
    await playhead(page, 6),
    await playhead(page, 11),
    await playhead(page, 15.5),
    await playhead(page, bare.w1),
  ].join(' | ');
  check(
    'a chip reads On or Off, a state its value, a dash where there are no samples, and at the end of the span its last section',
    read === 'Off,On,1 | On,On,2 | –,On,-1 | Off,On,– | Off,On,4',
    read,
  );
  let drawn = await replay(page);
  check(
    'a switch chip has a dot that is filled while it is on, and its other names in its title',
    drawn.names === 'Clutch,Fan,Gear' && drawn.on === 'Fan' && drawn.titles.join('|') === 'Also logged as Clutch Input, AVI6||',
    JSON.stringify([drawn.names, drawn.on, drawn.titles]),
  );
  check('the note counts the chips left out', / 3 more change in this span and are not shown\.$/.test(drawn.note), drawn.note);
  await putChips(1, 0);
  await playhead(page, 6);
  drawn = await replay(page);
  check('and counts one as one', / 1 more changes in this span and is not shown\.$/.test(drawn.note), drawn.note);
  check('the trace canvas keeps its height with chips', drawn.height === bare.height, bare.height + ' -> ' + drawn.height);
  await shot(page, '06b-chips', true);
  // the rows under the traces are gone: pointing under the last trace shows the values tooltip, nothing about a switch
  await page.locator('#tr-cv').hover({ position: { x: xAt(drawn, 6), y: axisY(drawn) - 4 } });
  const tip = await page.evaluate(() => (document.getElementById('tip').hidden ? '' : document.getElementById('tip').innerText));
  const rowState = await page.evaluate(() => ['sw', 'swNow', 'swHover'].filter(k => k in window.__logViewer).join());
  await page.mouse.move(0, 0);
  check(
    'no switch rows, and no tooltip of their own',
    rowState === '' && /^\d+\.\d\d s\n/.test(tip) && !/Also logged as/.test(tip),
    JSON.stringify([rowState, tip]),
  );
  await page.evaluate(() => {
    const s = window.__logViewer;
    s.chips = null;
    s.rev++;
  });
  await page.click('[data-xmode="time"]');
  drawn = await replay(page);
  check('with no chips none are shown, and the traces keep their height', drawn.names === '' && drawn.height === bare.height, String(drawn.height));

  // chips from the core. The default pull is run A already, so make another pull run A and come back: that focuses it.
  const asked = [];
  page.on('request', q => /\/api\/chips$/.test(q.url()) && asked.push(JSON.parse(q.postData())));
  await page.locator('.pull', { hasText: '3rd gear · 2,974' }).locator('button.r0').click();
  await until(page, () => window.__logViewer.chips !== null);
  await page.locator('.pull', { hasText: '2,551–5,959' }).locator('button.r0').click();
  await chipsShown(page, 13);
  let pull = await replay(page);
  check(
    'the default pull shows its switches, then its states, each in order of first change',
    pull.names === DEFAULT_CHIPS && pull.height === bare.height,
    pull.names + ' ' + pull.height,
  );
  check('and leaves none out, so the note says nothing about them', !/ more /.test(pull.note), pull.note);
  check(
    'a switch logged under other names carries them in its title',
    pull.titles[2] === 'Also logged as AVI6 Switch State, Clutch Switch Input State' &&
      pull.titles[4] === 'Also logged as Cam Control Switched Output State Intake',
    JSON.stringify(pull.titles),
  );
  const chipInk = await textContrast(page, '#chips .chip');
  check('the text of every chip reads on it', chipInk.length === 13 && chipInk[0] >= 4.5, JSON.stringify(chipInk));
  const two = [await playhead(page, 30.3), await playhead(page, 33)];
  check(
    'the chips read the playhead',
    two[0] === 'On,Off,On,Off,Off,Off,1,2,-3,2,1,0,1' && two[1] === 'Off,On,Off,Off,On,Off,2,3,-7,0,2,0,1',
    two.join(' | '),
  );
  await shot(page, '06c-chips-pull', true);
  // a chip flips while the replay plays: the cam output, the fifth chip, comes on at 32.579 s
  const before = (await playhead(page, 32.4)).split(',')[4];
  await page.click('#play');
  const flipped = await until(page, () => document.querySelectorAll('#chips .chip .vl')[4]?.textContent === 'On');
  await page.click('#play');
  check('a chip flips while the replay plays', before === 'Off' && flipped, JSON.stringify([before, flipped]));
  check(
    'the chips are asked for once for each span, not on every frame',
    asked.length === 2 && asked[1].t0 === pull.w0 && asked[1].t1 === pull.w1,
    JSON.stringify(asked),
  );
  await page.click('[data-xmode="rpm"]');
  const byRpm = await replay(page);
  await page.click('[data-xmode="time"]');
  pull = await replay(page);
  check(
    'By RPM: the chips still read at the playhead, and nothing is asked again',
    byRpm.names === DEFAULT_CHIPS && byRpm.now === pull.now && byRpm.height === bare.height && asked.length === 2,
    JSON.stringify([byRpm.now, pull.now, byRpm.height, asked.length]),
  );
  // the chips follow the span on screen, whatever set it: narrow the span by hand and they are asked for again
  await page.evaluate(() => {
    const s = window.__logViewer;
    s.focus.w0 += 2;
    s.focus.w1 -= 2;
    s.rev++;
  });
  await page.click('[data-xmode="time"]');
  await chipsShown(page, 3);
  const narrow = await replay(page);
  check(
    'the chips follow the span on screen when it changes',
    asked.length === 3 &&
      asked[2].t0 === narrow.w0 &&
      asked[2].t1 === narrow.w1 &&
      narrow.names ===
        'Stepper 1 Pin 2 Output State,Predicted MAP Active,Traction Control State' &&
      !/ more /.test(narrow.note),
    JSON.stringify([asked.length, asked[2], narrow.names]),
  );
  // across the whole log the clutch channels part by a sample at a few changes; they are still one chip
  await page.locator('.log-head', { hasText: 'Back road' }).locator('button', { hasText: 'Replay' }).click();
  await chipsShown(page, 16);
  const whole = await replay(page);
  check(
    'a whole log shows the clutch once among its switches, the states that change least, and counts the rest',
    whole.names === WHOLE_CHIPS && / 2 more change in this span and are not shown\.$/.test(whole.note) && whole.height === bare.height,
    whole.names + ' | ' + whole.note + ' | ' + whole.height,
  );

  // while the dyno call for a new run A is on its way, a hover redraws the traces: chips of the old span must not appear
  let release;
  const gate = new Promise(r => (release = r));
  // the core's answer for the new span is held too, so only chips of the old span could be on screen
  await page.route(/\/api\/(dyno|chips)$/, async route => {
    await gate;
    await route.continue().catch(() => {}); // unrouting below may have let it through already
  });
  await page.locator('.pull', { hasText: '3rd gear · 2,974' }).locator('button.r0').click();
  await page.hover('#tr-cv', { position: { x: 120, y: 20 } });
  await page.mouse.move(130, 30);
  const mid = await replay(page);
  check(
    'chips of the previous span are not shown while the new run is loading',
    mid.names === '' && mid.height === bare.height,
    JSON.stringify([mid.names, mid.height]),
  );
  release();
  await page.unroute(/\/api\/(dyno|chips)$/);
  await page.waitForTimeout(600);

  // an answer that arrives after the user has moved to another span must not be shown for that span
  let held = 0;
  await page.route('**/api/chips', async route => {
    if (!held++) await new Promise(r => setTimeout(r, 800));
    await route.continue();
  });
  await page.locator('.log-head', { hasText: '1:44 pm log' }).locator('button', { hasText: 'Replay' }).click();
  await page.locator('.log-head', { hasText: '1:42 pm log' }).locator('button', { hasText: 'Replay' }).click();
  await page.waitForTimeout(1200);
  await page.unroute('**/api/chips');
  const late = await replay(page);
  check(
    'chips that arrive late for another span are dropped',
    late.log === 'PCLog_2026-04-17_0142pm.csv' && late.names === 'Idle Control State',
    JSON.stringify([late.log, late.names]),
  );

  // the checkbox in Channels turns the chips off without asking the core
  await page.locator('.log-head', { hasText: 'Back road' }).locator('button', { hasText: 'Replay' }).click();
  await chipsShown(page, 16);
  if (!(await page.isVisible('#picker'))) await page.click('#chan-btn');
  const askedBefore = asked.length;
  const box = page.locator('#pick-sw');
  const label = await page.evaluate(() => document.getElementById('pick-sw')?.parentElement.textContent.trim());
  if (await box.count()) await box.uncheck();
  const off = await replay(page);
  check(
    'the checkbox in Channels reads "Show switches and states that change" and turns the chips off',
    label === 'Show switches and states that change' &&
      off.chips === null &&
      off.names === '' &&
      (await page.isHidden('#chips')) &&
      asked.length === askedBefore,
    JSON.stringify([label, off.chips, off.names, asked.length - askedBefore]),
  );

  // a failed request says so in the message area; turning the setting off clears the message, and chips come back when it is on
  const errorsBefore = errors.length;
  await page.route('**/api/chips', route => route.abort(), { times: 1 });
  await box.check();
  const failShown = await until(page, () => /^Switches and states failed: /.test(document.getElementById('status').textContent));
  await box.uncheck();
  const clearedByOff = (await text(page, 'status')) === '';
  await box.check();
  const chipsBack = await chipsShown(page, 16);
  check(
    'a failed request says so, turning the setting off clears it, and the chips come back',
    failShown && clearedByOff && chipsBack,
    JSON.stringify([failShown, clearedByOff, chipsBack]),
  );
  // the browser reports the aborted request on the console; that one is expected
  errors.splice(errorsBefore, errors.length - errorsBefore, ...errors.slice(errorsBefore).filter(m => !/ERR_FAILED/.test(m)));
  // chips that arrive clear only their own failure: another message stays
  await page.evaluate(() => (document.getElementById('status').textContent = 'Added 1 log.'));
  await box.uncheck();
  await box.check();
  await chipsShown(page, 16);
  check('chips that arrive leave any other message alone', (await text(page, 'status')) === 'Added 1 log.', await text(page, 'status'));
  // Try again asks for the chips again
  await box.uncheck();
  const errorsBeforeRetry = errors.length;
  await page.route('**/api/chips', route => route.abort(), { times: 1 });
  await box.check();
  const failedAgain = await until(page, () => /^Switches and states failed: /.test(document.getElementById('status').textContent));
  const offered = await page.evaluate(() => {
    const b = document.getElementById('msg-act');
    return b && !b.hidden ? b.textContent : null;
  });
  if (offered) await page.click('#msg-act');
  const chipsAfterRetry = await chipsShown(page, 16);
  check(
    'Try again brings the chips back and clears the message',
    failedAgain && offered === 'Try again' && chipsAfterRetry && (await text(page, 'status')) === '',
    JSON.stringify([failedAgain, offered, chipsAfterRetry, await text(page, 'status')]),
  );
  errors.splice(
    errorsBeforeRetry,
    errors.length - errorsBeforeRetry,
    ...errors.slice(errorsBeforeRetry).filter(m => !/ERR_FAILED/.test(m)),
  );
```

The lines that follow it in the file (`await box.uncheck();`, the High smoothing click, the wait and `await page.close();`) stay.

Replace everything from the comment `  // the switch rows were turned off before the window closed: they stay off, and ticking the box brings them back` up to and including the statement `check('the lines go when the pointer moves up to the traces', …);` with:

```js
  // the chips were turned off before the window closed: they stay off, and ticking the box brings them back
  const kept = await page.evaluate(() => ({
    box: document.getElementById('pick-sw')?.checked,
    chips: window.__logViewer.chips,
    shown: document.querySelectorAll('#chips .chip').length,
  }));
  check('chips stay off after a reload', kept.box === false && kept.chips === null && kept.shown === 0, JSON.stringify(kept));
  await page.click('#chan-btn');
  if (await page.locator('#pick-sw').count()) await page.check('#pick-sw');
  check('and come back when the box is ticked', await chipsShown(page, 13));
  // a switch added as a trace is drawn as a trace and keeps its chip
  const beforeTrace = await replay(page);
  await page.fill('#pick-q', 'clutch state');
  const clutchTrace = page
    .locator('#pick-list .pk:not([hidden])', { has: page.locator('.nm[title="Clutch State"]') })
    .locator('button', { hasText: 'Trace' });
  await clutchTrace.click();
  const both = await replay(page);
  check(
    'a switch added as a trace keeps its chip',
    both.traces === beforeTrace.traces + 1 && both.names === beforeTrace.names && both.names.split(',')[2] === 'Clutch State',
    JSON.stringify([both.traces, both.names]),
  );
  await clutchTrace.click();
  await page.fill('#pick-q', '');
```

In the phone and tablet loop, replace

```js
    // the default pull is on screen with its six switch rows
    await rowsShown(page, 6);
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      rail: getComputedStyle(document.querySelector('.rail')).position,
      rows: window.__logViewer.swNow?.length,
    }));
    check(
      name + ' layout fits, switch rows included',
      m.sw <= m.cw && m.rail === (width < 860 ? 'static' : 'sticky') && m.rows === 6,
      JSON.stringify(m),
    );
```

with

```js
    // the default pull is on screen with its chips
    await chipsShown(page, 13);
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      rail: getComputedStyle(document.querySelector('.rail')).position,
      chips: document.querySelectorAll('#chips .chip').length,
    }));
    check(
      name + ' layout fits, chips included',
      m.sw <= m.cw && m.rail === (width < 860 ? 'static' : 'sticky') && m.chips === 13,
      JSON.stringify(m),
    );
```

- [ ] **Step 2: Run the UI test and see the new checks fail**

Run: `npm run build && cargo build --release -p logviewer-dev && npm run test:ui`

Expected: `FAIL` lines for the new checks, among them `a log with a state and no switch shows a chip for the state`, `a chip reads On or Off, …`, `the default pull shows its switches, then its states, …`, `the chips read the playhead`, `a chip flips while the replay plays`, `the checkbox in Channels reads "Show switches and states that change" …`, `Try again brings the chips back and clears the message`, `chips stay off after a reload`, and `phone layout fits, chips included`. These are `ok` already, because the rows meet them: `the trace canvas keeps its height with chips`, `with no chips none are shown, and the traces keep their height`, `chips of the previous span are not shown while the new run is loading`, `chips that arrive leave any other message alone`. No check throws; the run takes longer while `chipsShown` waits out its 5 s.

- [ ] **Step 3: The chips module**

Create `src/chips.ts`:

```ts
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
```

- [ ] **Step 4: State, types and the API**

In `src/state.ts`:

- In the type import from `./types`, replace `Switches` with `Chips` so it reads `import type { Chips, Dyno, DynoOut, Finding, Log, Pull, Sev, Table, TraceDef, Vehicle, View } from './types';`.
- Replace

```ts
/** The stretch of the focused log the replay shows, in log seconds. The traces and the switch rows both read it here, so they always show the same stretch. */
export const replaySpan = (f: Focus): [number, number] => [f.w0, f.w1];

/** Names the log and span the replay shows. Switch rows are kept with this key, so they are drawn only against the span they were asked for. */
export const switchKey = (f: Focus): string => [f.log.key, ...replaySpan(f)].join('|');
```

with

```ts
/** The stretch of the focused log the replay shows, in log seconds. The traces and the chips both read it here, so they always show the same stretch. */
export const replaySpan = (f: Focus): [number, number] => [f.w0, f.w1];

/** Names the log and span the replay shows. Chips are kept with this key, so they are shown only for the span they were asked for. */
export const chipsKey = (f: Focus): string => [f.log.key, ...replaySpan(f)].join('|');
```

- In `S`, replace the five fields from `/** switch rows for the span on screen, as the core returned them; null when there are none to draw */` through `swHover: null as number | null,` with:

```ts
  /** switch and state chips for the span on screen, as the core returned them; null when there are none to show */
  chips: null as Chips | null,
  /** the `chipsKey` of the log and span the chips in `chips` are for; empty when there are none */
  chipsFor: '',
  /** "Show switches and states that change" in the Channels picker */
  chipsShow: true,
```

In `src/types.ts`:

- Replace the doc above `export interface SwitchRow {` with:

```ts
/**
 * One switch chip of the replay: a group of on/off channels that are one signal over the whole log, shown because
 * its named channel changes inside the span. Everything but `also` comes from the named channel alone.
 * Times are log seconds, clipped to the span.
 */
```

- In `Settings`, replace `/** "Show switches that change" in the Channels picker; on unless this is false */` with `/** "Show switches and states that change" in the Channels picker; on unless this is false */`.

In `src/api.ts`, delete the `switches` entry with its doc comment, and remove `Switches` from the type import so it reads `import type { Chips, DynoOut, LogMeta, Overview, Settings, Vehicle } from './types';`.

- [ ] **Step 5: The canvas loses the rows**

In `src/charts.ts`:

Replace

```ts
  showTip,
  switchKey,
  theme,
} from './state';
import type { Cell, ChInfo, RGB, TipRow } from './state';
import type { Log, Pt, Pull, SwitchRow, Switches, Table, TraceDef } from './types';
```

with

```ts
  showTip,
  theme,
} from './state';
import type { Cell, ChInfo, RGB, TipRow } from './state';
import type { Log, Pt, Pull, Table, TraceDef } from './types';
```

and add `import { chipsNote } from './chips';` as the first import of the file.

Replace

```ts
/** Trace geometry: left gutter, right gutter for live values, label row, panel height, gap, time axis. */
export const TG = { l: 46, r: 92, lab: 17, ph: 53, gap: 6, axis: 22 };
/** Switch row geometry: space above the first row, then per row a line for the name, the bar, and space under it. */
export const SW = { top: 10, lab: 14, bar: 8, gap: 4 };
const SW_PITCH = SW.lab + SW.bar + SW.gap;
```

with

```ts
/** Trace geometry: left gutter, right gutter for live values, label row, panel height, gap, the band of ticks above the time axis, time axis. */
export const TG = { l: 46, r: 92, lab: 17, ph: 53, gap: 6, ticks: 12, axis: 22 };
```

In `interface TraceLayout`, replace

```ts
  /** switch rows drawn under the last panel */
  rows: SwitchRow[];
  /** y of the bottom of the last panel, where the switch rows start */
  swY: number;
```

with

```ts
  /** y of the time axis: under the last panel and the band of ticks */
  axisY: number;
```

Delete everything from the line `/** The switch rows to draw. By RPM has none: a switch against engine speed is not a timeline. */` through the closing `}` of `function switchNote(…)`.

In `trLayout`, replace

```ts
  const swY = panels.length * (TG.lab + TG.ph + TG.gap) - TG.gap;
  return { pw, rpmMode, spans, x0, x1, X, panels, rows: switchRows(), swY };
```

with

```ts
  const axisY = panels.length * (TG.lab + TG.ph + TG.gap) - TG.gap + TG.ticks;
  return { pw, rpmMode, spans, x0, x1, X, panels, axisY };
```

In `drawTraces`, replace

```ts
  // the rows go under traces: where a message stands in for the traces there are none
  const band = S.focus && n ? swHeight(switchRows().length) : 0;
  const hpx = Math.max(1, n) * (TG.lab + TG.ph + TG.gap) + band + TG.axis + 4;
```

with

```ts
  // the band of ticks is always there, so the canvas keeps one height whatever the chips
  const hpx = Math.max(1, n) * (TG.lab + TG.ph + TG.gap) + TG.ticks + TG.axis + 4;
```

In `msg`, delete the line `    S.swNow = [];`.

Replace

```ts
  // the time axis sits under the switch rows, so the rows share it with the traces
  const bottom = L.swY + swHeight(L.rows.length);
```

with `  const bottom = L.axisY;`.

Delete the block from `    // switch rows: the name, then a bar that is filled while the switch is on and empty where there are no samples` through the closing `}` of `    if (L.rows.length) { … }` (the rule drawn under the rows).

Delete the block from `  // the row the pointer is on marks each of its changes through the traces; no other row does, so the traces stay clean` through the closing `}` of its `if (pointed !== null && L.rows[pointed]) { … }`.

Delete the block from `  // what each switch reads at the playhead` through the closing `});` of `S.swNow.forEach(…)`.

Replace `    switchNote(L.rpmMode);` with `    chipsNote();`.

- [ ] **Step 6: The app asks for chips**

In `src/app.ts`:

- In the import from `./charts`, delete the lines `  switchAt,` and `  switchRowAt,`. After that import add `import { updateChips } from './chips';`.
- In the import from `./state`, delete `  switchKey,` and add `  chipsKey,` after `  chInfo,`.
- In `collectSettings`, replace `    switches: S.swShow,` with `    switches: S.chipsShow,`.
- Replace everything from `// ---------- switch rows ----------` through the closing `}` of `function retrySwitches(): void { … }` with:

```ts
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
  const key = f && S.chipsShow ? chipsKey(f) : '';
  if (key === chipsAsked) return;
  chipsAsked = key;
  const seq = ++chipsSeq;
  // chips for another span must not be shown for this one while the new chips are on their way
  S.chips = null;
  S.chipsFor = '';
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
```

- In `drawAll`, replace `  syncSwitches();` with `  syncChips();`, and after `  updateReadouts();` add `  updateChips();`.
- In the `pick-sw` handler, replace `    S.swShow = input('pick-sw').checked;` with `    S.chipsShow = input('pick-sw').checked;`.
- In the trace canvas `pointerdown` handler, replace

```ts
    S.hoverX = null;
    S.swHover = null;
    hideTip();
    scrub(e);
```

with

```ts
    S.hoverX = null;
    hideTip();
    scrub(e);
```

- In the `pointermove` handler, replace

```ts
    const x = trX(e);
    const k = switchRowAt(e);
    S.swHover = k;
    if (k !== null) {
      // on a switch row: what it reads there and its other names, with its changes marked through the traces
      const row = L.rows[k];
      S.hoverX = null;
      showTip(e.clientX, e.clientY, row.name, [
        { label: (x - L.x0).toFixed(2) + ' s', value: switchAt(row, x) },
        ...row.also.map(name => ({ label: 'Also logged as', value: name })),
      ]);
      drawTraces();
      return;
    }
    const th = theme();
```

with

```ts
    const x = trX(e);
    const th = theme();
```

- In the `pointerleave` handler, replace

```ts
    S.hoverX = null;
    S.swHover = null;
    hideTip();
    drawTraces();
```

with

```ts
    S.hoverX = null;
    hideTip();
    drawTraces();
```

- In `boot`, replace

```ts
  // on unless it was turned off: settings saved before the switch rows existed have no entry
  S.swShow = st.switches !== false;
  input('pick-sw').checked = S.swShow;
```

with

```ts
  // on unless it was turned off: settings saved before the setting existed have no entry
  S.chipsShow = st.switches !== false;
  input('pick-sw').checked = S.chipsShow;
```

Then run `rg -n "swShow|swHover|swNow|S\.sw\b|switchKey|switchAt|switchRowAt|syncSwitches|SW_FAILED|api\.switches" src` and confirm there is no match.

- [ ] **Step 7: The page and the chip's look**

In `index.html`, replace `<label class="chk"><input id="pick-sw" type="checkbox" checked> Show switches that change</label>` with `<label class="chk"><input id="pick-sw" type="checkbox" checked> Show switches and states that change</label>`, and replace `        <div class="readouts" id="readouts"></div>` with:

```html
        <div class="readouts" id="readouts"></div>
        <div class="chips" id="chips" role="group" aria-label="Switches and states at the playhead" hidden></div>
```

In `src/styles.css`:

- Replace `.btn,.seg button,.ab button,.icon-btn,.finding summary{transition:` with `.btn,.seg button,.ab button,.icon-btn,.finding summary,.chip{transition:` (the rest of the rule unchanged).
- Replace `.btn:active:not(:disabled),.seg button:active,.ab button:active{transform:translateY(1px)}` with `.btn:active:not(:disabled),.seg button:active,.ab button:active,.chip:active{transform:translateY(1px)}`.
- After the line that starts `.ro .vl small{` add:

```css
/* switch and state chips under the cards: a name and what it reads at the playhead. The value keeps a width, so the
   chips do not reflow as it changes; a switch leads with a dot that is filled while it is on */
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-width:0;font:inherit;font-size:12.5px;color:var(--ink-2);background:var(--surface);border:1px solid var(--rule);border-radius:8px;padding:3px 9px;cursor:pointer;white-space:nowrap}
.chip:hover{background:var(--inset)}
.chip .nm{overflow:hidden;text-overflow:ellipsis}
.chip .vl{display:inline-block;min-width:3ch;font-family:var(--font-display);font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}
.chip .dot{width:8px;height:8px;border-radius:50%;border:1.5px solid var(--ink-2);flex:none}
.chip.on .dot{background:var(--ink-2)}
```

- [ ] **Step 8: The core command goes**

In `crates/core/src/session.rs`, delete the `"switches"` arm with the comment above it (from `            // the UI's switch rows still ask for this; it goes when they do` through its closing `}`), and delete the line `use crate::switches::{switches, MAX_SWITCHES};`.

In `crates/core/tests/switches.rs`:

- Replace the module doc line with:

```rust
//! The switches in the replay's chips, through the `chips` command the UI calls, on the sample logs.
```

- Replace

```rust
fn rows(s: &mut Session, log: &str, t0: f64, t1: f64) -> Value {
    call(s, "switches", json!({ "log": log, "t0": t0, "t1": t1 })).unwrap()
}
```

with

```rust
/// The switches part of the chips for a span: `{ rows, more }`.
fn rows(s: &mut Session, log: &str, t0: f64, t1: f64) -> Value {
    call(s, "chips", json!({ "log": log, "t0": t0, "t1": t1 })).unwrap()["switches"].clone()
}
```

- Delete the test `a_request_that_cannot_be_answered_says_why` (the same test in `tests/chips.rs` covers the command).

In `crates/core/tests/chips.rs`, replace the test `the_answer_holds_the_switches_and_the_states_of_the_span` with:

```rust
/// The answer holds the switches and the states, each as `{ rows, more }`.
#[test]
fn the_answer_holds_the_switches_and_the_states_of_the_span() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let (log, t0, t1) = default_pull(&mut s);
    let reply = chips(&mut s, &log, t0, t1);
    let keys: Vec<&str> = reply.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(keys, ["states", "switches"]);
    assert_eq!(reply["switches"]["rows"].as_array().unwrap().len(), 6);
    assert_eq!(reply["switches"]["more"], 0);
}
```

- [ ] **Step 9: Run the checks and see everything pass**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cargo fmt --check && cargo clippy -p logviewer-core -- -D warnings && npm run test:core && npm run check && npx prettier --check "src/**/*.ts" tests && npm run build && cargo build --release -p logviewer-dev && npm run test:ui`

Expected: every core test passes; the UI test ends with `all checks passed`.

- [ ] **Step 10: Commit**

```bash
git add src/chips.ts src/charts.ts src/app.ts src/state.ts src/types.ts src/api.ts index.html src/styles.css crates/core/src/session.rs crates/core/tests/switches.rs crates/core/tests/chips.rs tests/ui.mjs
git commit -m "Replay: chips for switches and states in place of the switch rows

A chip for each switch and state that changes in the span sits under the
readout cards and reads the playhead. The rows, their tooltip and the lines
they drew through the traces are gone, and the trace canvas keeps one height.
The switches command goes; the UI asks for chips.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Ticks, and choosing a chip

**Files:**
- Modify: `src/chips.ts` (choosing: `chosenChip`, `chipShade`, `wireChips`; `renderChips` and `updateChips`)
- Modify: `src/charts.ts` (shading, edges, values, ticks, the axis line)
- Modify: `src/app.ts` (`syncChips` clears the choice; `wire` wires the chips)
- Modify: `src/state.ts` (`S.chosen`)
- Modify: `src/styles.css` (the chosen chip)
- Test: `tests/ui.mjs`

**Interfaces:**
- Consumes, from Task 4: `shownChips`, `chipList`, `Chip`, `updateChips`, `TG.ticks`, `TraceLayout.axisY`, `S.chips`.
- Produces, in `src/chips.ts`: `export function chosenChip(): Chip | null`, `export function chipShade(chip: Chip): [number, number][]`, `export function wireChips(redraw: () => void): void`. Each chip button carries `data-chip` (its name) and `aria-pressed`.
- Produces, in `src/state.ts`: `S.chosen: string | null`, the name of the chosen chip. Task 6 reads it through `chosenChip()`.
- Produces, in `src/charts.ts`: `TG.tick` (4) and `TG.tickChosen` (8).

- [ ] **Step 1: Add the failing checks**

In `tests/ui.mjs`, after the `check('By RPM: the chips still read at the playhead, and nothing is asked again', …);` statement add:

```js
  /** How many pixels of a row of the trace canvas, across the plot, are not the panel colour. */
  const marked = (page, y, r) =>
    page.evaluate(
      ([y, l, pw]) => {
        const d = document.getElementById('tr-cv').getContext('2d').getImageData(l, y, pw, 1).data;
        const s = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim().slice(1);
        const bg = [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16));
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 6) n++;
        return n;
      },
      [Math.round(y), TG.l, Math.round(r.pw)],
    );
  // choosing a chip: it is shaded behind every trace in a tint of run A with an edge at each change, and its ticks are darker and taller
  const [ink, ink3, runA] = [await token(page, '--ink'), await token(page, '--ink-3'), await token(page, '--run-a')];
  const tinted = p => p[2] - p[0] >= 10; // blue over red: run A's tint, not the grey of the selected pull
  const chosen = () => page.evaluate(() => window.__logViewer.chosen);
  await playhead(page, 36.2); // clear of every pixel read below
  const choseClutch = await clickChip(page, 'Clutch State');
  pull = await replay(page);
  const top0 = plotTop(pull, 0) + 2; // in the first plot, under its top line and above anything written in it
  const ax = axisY(pull);
  const clutchMarks = {
    pressed: pull.pressed,
    chosen: await chosen(),
    on: tinted(await pixel(page, xAt(pull, 30.5), top0)),
    off: tinted(await pixel(page, xAt(pull, 33), top0)),
    edge: sameColour(await pixel(page, xAt(pull, 29.963), top0), runA),
    tall: sameColour(await pixel(page, xAt(pull, 31.206), ax - 6), ink),
    short: sameColour(await pixel(page, xAt(pull, 31.251), ax - 6), ink),
    tick: sameColour(await pixel(page, xAt(pull, 31.251), ax - 2), ink3),
    ink: (await textContrast(page, '#chips .chip[aria-pressed="true"]'))[0] >= 4.5,
  };
  check(
    'choosing a switch chip shades where it is on, edges its changes and makes its ticks darker and taller',
    choseClutch &&
      clutchMarks.pressed === 'Clutch State' &&
      clutchMarks.chosen === 'Clutch State' &&
      clutchMarks.on &&
      !clutchMarks.off &&
      clutchMarks.edge &&
      clutchMarks.tall &&
      !clutchMarks.short &&
      clutchMarks.tick &&
      clutchMarks.ink,
    JSON.stringify(clutchMarks),
  );
  // the choice survives scrubbing and playing
  const cv = await page.locator('#tr-cv').boundingBox();
  await page.mouse.click(cv.x + xAt(pull, 34), cv.y + top0 + 10);
  await page.click('#play');
  await page.waitForTimeout(200);
  await page.click('#play');
  check('the choice survives scrubbing and playing', (await chosen()) === 'Clutch State', String(await chosen()));
  // a state chip: every other section is shaded, and each section's value is written at its start in the first trace
  // text drawn on canvases that are not in the page: the traces' cached layer, not the power chart or the table
  await page.evaluate(() => {
    window.__texts = [];
    window.__fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, x, y, ...rest) {
      if (!this.canvas.isConnected) window.__texts.push([String(t), Math.round(x), Math.round(y)]);
      return window.__fillText.call(this, t, x, y, ...rest);
    };
  });
  await clickChip(page, 'Gear');
  pull = await replay(page);
  const labels = await page.evaluate(y => [...new Set(window.__texts.filter(([, , ty]) => ty === y).map(([t]) => t))].join(), plotTop(pull, 0) + 3);
  await page.evaluate(() => (CanvasRenderingContext2D.prototype.fillText = window.__fillText));
  const gearMarks = {
    pressed: pull.pressed,
    labels,
    second: tinted(await pixel(page, xAt(pull, 33), top0)),
    first: tinted(await pixel(page, xAt(pull, 30.5), top0)),
  };
  check(
    'choosing a state chip, one at a time, shades every other section and writes each value at its start',
    gearMarks.pressed === 'Gear' && gearMarks.labels === '1,2,3' && gearMarks.second && !gearMarks.first,
    JSON.stringify(gearMarks),
  );
  await clickChip(page, 'Gear');
  pull = await replay(page);
  const cleared = {
    pressed: pull.pressed,
    chosen: await chosen(),
    shade: tinted(await pixel(page, xAt(pull, 33), top0)),
    tall: sameColour(await pixel(page, xAt(pull, 31.251), ax - 6), ink),
  };
  check(
    'choosing it again clears the shading and the dark ticks',
    cleared.pressed === '' && cleared.chosen === null && !cleared.shade && !cleared.tall,
    JSON.stringify(cleared),
  );
  // By RPM: no ticks and no shading, and the choice is kept for By time
  await clickChip(page, 'Clutch State');
  await page.click('[data-xmode="rpm"]');
  const rpmMarks = { band: await marked(page, ax - 2, pull), plot: await marked(page, top0, pull), chosen: await chosen() };
  await page.click('[data-xmode="time"]');
  const timeBand = await marked(page, ax - 2, pull);
  check(
    'By RPM draws no ticks and no shading, and keeps the choice',
    rpmMarks.band <= 3 && rpmMarks.plot <= 3 && rpmMarks.chosen === 'Clutch State' && timeBand > 15,
    JSON.stringify([rpmMarks, timeBand]),
  );
  // the choice clears when its chip is no longer shown
  await page.evaluate(() => {
    const s = window.__logViewer;
    window.__answer = s.chips;
    s.chips = { ...s.chips, switches: { ...s.chips.switches, rows: s.chips.switches.rows.filter(r => r.name !== 'Clutch State') } };
    s.rev++;
  });
  await page.click('[data-xmode="time"]');
  const gone = await chosen();
  await page.evaluate(() => {
    const s = window.__logViewer;
    s.chips = window.__answer;
    s.rev++;
  });
  await page.click('[data-xmode="time"]');
  check('the choice clears when its chip is no longer shown', gone === null, String(gone));
  await clickChip(page, 'Stepper 1 Pin 2 Output State'); // still shown in the narrower span below
```

After the `check('the chips follow the span on screen when it changes', …);` statement add:

```js
  check('the choice clears when the span on screen changes', (await chosen()) === null && narrow.pressed === '', String(await chosen()));
```

- [ ] **Step 2: Run the UI test and see the new checks fail**

Run: `npm run build && cargo build --release -p logviewer-dev && npm run test:ui`

Expected `FAIL` lines: `choosing a switch chip shades where it is on, …`, `the choice survives scrubbing and playing`, `choosing a state chip, one at a time, …`, `choosing it again clears the shading and the dark ticks`, `By RPM draws no ticks and no shading, and keeps the choice`, `the choice clears when its chip is no longer shown`, `the choice clears when the span on screen changes`. (`S.chosen` does not exist yet, so it reads `undefined`.) Every older check stays `ok`.

- [ ] **Step 3: Choosing, in the chips module**

In `src/state.ts`, in `S`, after `chipsShow: true,` add:

```ts
  /** the name of the chosen chip, whose stretches are shaded behind the traces; null when none is chosen */
  chosen: null as string | null,
```

In `src/chips.ts`:

In `renderChips`, replace

```ts
    const b = el('button', 'chip');
    b.type = 'button';
```

with

```ts
    const b = el('button', 'chip');
    b.type = 'button';
    b.dataset.chip = chip.row.name;
    b.setAttribute('aria-pressed', 'false');
```

Replace the whole `updateChips` function with:

```ts
/** Bring the chips up to date: rebuilt when the answer changes, then each reads the playhead. Runs on every draw. */
export function updateChips(): void {
  const c = shownChips();
  const hold = !c && S.chipsShow && !!S.focus;
  if (c !== built || hold !== held) {
    renderChips(c, hold);
    // the choice goes with its chip
    if (S.chosen !== null && !chipList(c).some(chip => chip.row.name === S.chosen)) {
      S.chosen = null;
      S.rev++;
    }
  }
  const f = S.focus;
  if (!f) return;
  const spanEnd = replaySpan(f)[1];
  for (const s of shown) {
    const txt = chipText(s.chip, S.t, spanEnd);
    if (s.vl.textContent !== txt) s.vl.textContent = txt;
    if (s.chip.kind === 'switch') s.box.classList.toggle('on', txt === 'On');
    const pressed = String(s.chip.row.name === S.chosen);
    if (s.box.getAttribute('aria-pressed') !== pressed) s.box.setAttribute('aria-pressed', pressed);
  }
}

/** The chosen chip, when it is shown. */
export function chosenChip(): Chip | null {
  if (S.chosen === null) return null;
  return chipList(shownChips()).find(chip => chip.row.name === S.chosen) ?? null;
}

/** The stretches of a chosen chip to shade, in log seconds: where a switch is on, and every other section of a state. */
export function chipShade(chip: Chip): [number, number][] {
  if (chip.kind === 'switch') return chip.row.on;
  return chip.row.sections.filter((_, k) => k % 2 === 1).map(([a, b]): [number, number] => [a, b]);
}

/** Clicking a chip chooses it; clicking it again clears it. One chip is chosen at a time. */
export function wireChips(redraw: () => void): void {
  $('chips').addEventListener('click', e => {
    const name = (e.target as HTMLElement).closest<HTMLElement>('.chip')?.dataset.chip;
    if (name === undefined) return;
    S.chosen = S.chosen === name ? null : name;
    S.rev++;
    redraw();
  });
}
```

- [ ] **Step 4: The app clears the choice with the span, and wires the chips**

In `src/app.ts`:

- Change the import from `./chips` to `import { updateChips, wireChips } from './chips';`.
- In `syncChips`, replace

```ts
  S.chips = null;
  S.chipsFor = '';
  S.rev++;
  if (!f || !key) {
```

with

```ts
  S.chips = null;
  S.chipsFor = '';
  // a choice is for one span
  S.chosen = null;
  S.rev++;
  if (!f || !key) {
```

- In `wire`, after the `pick-sw` change handler (the statement that ends with `drawAll();\n  });` after `S.chipsShow = input('pick-sw').checked;`) add `  wireChips(drawAll);`.

- [ ] **Step 5: Shading, values and ticks on the canvas**

In `src/charts.ts`:

Change the chips import to `import { chipList, chipShade, chipsNote, chosenChip, shownChips } from './chips';`.

Replace

```ts
/** Trace geometry: left gutter, right gutter for live values, label row, panel height, gap, the band of ticks above the time axis, time axis. */
export const TG = { l: 46, r: 92, lab: 17, ph: 53, gap: 6, ticks: 12, axis: 22 };
```

with

```ts
/**
 * Trace geometry: left gutter, right gutter for live values, label row, panel height, gap, the band of ticks above the
 * time axis, a tick and a chosen chip's tick, time axis.
 */
export const TG = { l: 46, r: 92, lab: 17, ph: 53, gap: 6, ticks: 12, tick: 4, tickChosen: 8, axis: 22 };
/** How strongly the chosen chip's stretches are tinted with run A. */
const SHADE_ALPHA = 0.12;
```

In `drawTraces`, in the cached drawing, replace

```ts
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const p of L.panels) {
```

with

```ts
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the chosen chip, shaded behind every trace. By RPM has none: its stretches are positions in time
    const chosen = L.rpmMode ? null : chosenChip();
    const shade = chosen ? chipShade(chosen) : [];
    for (const p of L.panels) {
```

Replace

```ts
        c.fillRect(L.X(f.m0), p.y0, Math.max(2, L.X(f.m1) - L.X(f.m0)), TG.ph);
        c.globalAlpha = 1;
      }
```

with

```ts
        c.fillRect(L.X(f.m0), p.y0, Math.max(2, L.X(f.m1) - L.X(f.m0)), TG.ph);
        c.globalAlpha = 1;
      }
      if (chosen) {
        // a tint of run A, so it cannot be taken for the grey of the selected pull, and a thin edge at each change
        c.fillStyle = th.run[0];
        c.globalAlpha = SHADE_ALPHA;
        for (const [a, b] of shade) c.fillRect(L.X(a), p.y0, Math.max(1, L.X(b) - L.X(a)), TG.ph);
        c.globalAlpha = 1;
        c.strokeStyle = th.run[0];
        c.lineWidth = 1;
        c.beginPath();
        for (const t of chosen.row.changes) {
          const x = Math.round(L.X(t)) + 0.5;
          c.moveTo(x, p.y0);
          c.lineTo(x, p.y0 + TG.ph);
        }
        c.stroke();
      }
```

Replace

```ts
        path(sp, series(sp.log, p.a, sp.r), th.run[sp.r || 0], false, 2);
      }
      c.restore();
    }
```

with

```ts
        path(sp, series(sp.log, p.a, sp.r), th.run[sp.r || 0], false, 2);
      }
      c.restore();
      if (chosen?.kind === 'state' && p === L.panels[0]) {
        // each section's value at its start, where the section has room for it
        c.font = '700 11px ' + th.body;
        c.fillStyle = th.ink;
        c.textAlign = 'left';
        c.textBaseline = 'top';
        for (const [a, b, v] of chosen.row.sections) {
          const txt = fmt(v);
          const x = L.X(a) + 3;
          if (L.X(b) - x >= c.measureText(txt).width + 3) c.fillText(txt, x, p.y0 + 3);
        }
      }
    }

    // the time axis, and above it a tick at every change of every chip shown, the chosen chip's darker and taller.
    // By RPM has no ticks: they are positions in time
    c.strokeStyle = th.rule;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(TG.l, bottom + 0.5);
    c.lineTo(TG.l + L.pw, bottom + 0.5);
    c.stroke();
    if (!L.rpmMode) {
      const ticks = (times: number[], h: number, color: string) => {
        c.strokeStyle = color;
        c.beginPath();
        for (const t of times) {
          const x = Math.round(L.X(t)) + 0.5;
          c.moveTo(x, bottom - h);
          c.lineTo(x, bottom);
        }
        c.stroke();
      };
      const others = chipList(shownChips()).filter(chip => chip.row.name !== chosen?.row.name);
      ticks(
        others.flatMap(chip => chip.row.changes),
        TG.tick,
        th.ink3,
      );
      if (chosen) ticks(chosen.row.changes, TG.tickChosen, th.ink);
    }
```

(After Task 4 the panel loop is followed directly by `    // x axis`; the new block sits between them.)

- [ ] **Step 6: The chosen chip's look**

In `src/styles.css`, after the rule `.chip:hover{background:var(--inset)}` add:

```css
.chip[aria-pressed="true"]{background:var(--sel);color:var(--sel-ink);font-weight:700}
```

- [ ] **Step 7: Run the checks and see everything pass**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cargo fmt --check && cargo clippy -p logviewer-core -- -D warnings && npm run test:core && npm run check && npx prettier --check "src/**/*.ts" tests && npm run build && cargo build --release -p logviewer-dev && npm run test:ui`

Expected: `all checks passed`.

- [ ] **Step 8: Commit**

```bash
git add src/chips.ts src/charts.ts src/app.ts src/state.ts src/styles.css tests/ui.mjs
git commit -m "Replay: ticks above the time axis, and a chip that can be chosen

A tick marks every change of every chip shown. Clicking a chip shades it
behind the traces in a tint of run A, edges its changes, writes a state's
values in the first trace and makes its ticks darker and taller. The choice
holds while scrubbing and playing and clears with the span or the chip.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Previous change and Next change

**Files:**
- Modify: `index.html` (two buttons in the transport)
- Modify: `src/chips.ts` (`stepTarget`)
- Modify: `src/app.ts` (`step`, `syncTransport`, `wire`)
- Test: `tests/ui.mjs`

**Interfaces:**
- Consumes, from Task 5: `chosenChip()`, `chipList`, `shownChips`.
- Produces, in `src/chips.ts`: `export function stepTarget(t: number, dir: 1 | -1): number | null`.
- Produces, in the page: `#step-prev` and `#step-next`, `button.btn`, disabled when there is no change that way.

- [ ] **Step 1: Add the failing checks**

In `tests/ui.mjs`, after the `check('the choice clears when its chip is no longer shown', gone === null, String(gone));` statement and before `await clickChip(page, 'Stepper 1 Pin 2 Output State');` add:

```js
  // stepping: Previous change and Next change move the playhead to a change of the chosen chip, or of any chip shown
  const stepTo = async id => {
    if (!(await page.locator('#' + id).count())) return null;
    await page.click('#' + id);
    return page.evaluate(() => window.__logViewer.t);
  };
  const disabled = id => page.evaluate(id => !!document.getElementById(id)?.disabled, id);
  const stepLabels = await page.evaluate(() => [...document.querySelectorAll('#step-prev,#step-next')].map(b => b.textContent).join());
  await playhead(page, 30.5);
  const anyChip = [await stepTo('step-next'), await stepTo('step-next')];
  await playhead(page, 33);
  anyChip.push(await stepTo('step-prev'));
  check(
    'with no chip chosen, the step buttons land on the changes of every chip, once where two change together',
    stepLabels === 'Previous change,Next change' && JSON.stringify(anyChip) === '[30.581,30.626,32.961]',
    JSON.stringify([stepLabels, anyChip]),
  );
  await clickChip(page, 'Clutch State');
  await playhead(page, 33);
  const clutchSteps = [await stepTo('step-next'), await stepTo('step-next'), await disabled('step-next'), await stepTo('step-prev')];
  await page.click('#play');
  await page.waitForTimeout(200);
  const stepped = await stepTo('step-prev');
  const playing = await page.evaluate(() => window.__logViewer.playing);
  await clickChip(page, 'Clutch State');
  check(
    'with a chip chosen they land on its changes, stop at its last, and stop the replay',
    JSON.stringify(clutchSteps) === '[34.96,35.777,true,34.96]' && stepped === 34.96 && playing === false,
    JSON.stringify([clutchSteps, stepped, playing]),
  );
```

- [ ] **Step 2: Run the UI test and see the new checks fail**

Run: `npm run build && cargo build --release -p logviewer-dev && npm run test:ui`

Expected `FAIL` lines: `with no chip chosen, the step buttons land on the changes of every chip, …` and `with a chip chosen they land on its changes, …`. Every older check stays `ok`.

- [ ] **Step 3: The step target**

In `src/chips.ts`, after `chipShade` add:

```ts
/**
 * The change to step to from t: the first after it (dir 1) or the last before it (dir -1), of the chosen chip, or of any
 * chip shown when none is chosen. Null when there is none that way. Two chips that change at the same time are one stop.
 */
export function stepTarget(t: number, dir: 1 | -1): number | null {
  const chosen = chosenChip();
  let best: number | null = null;
  for (const chip of chosen ? [chosen] : chipList(shownChips()))
    for (const x of chip.row.changes)
      if (dir > 0 ? x > t && (best === null || x < best) : x < t && (best === null || x > best)) best = x;
  return best;
}
```

- [ ] **Step 4: The buttons**

In `index.html`, replace `          <button class="btn" id="restart" type="button">Restart</button>` with:

```html
          <button class="btn" id="restart" type="button">Restart</button>
          <button class="btn" id="step-prev" type="button">Previous change</button>
          <button class="btn" id="step-next" type="button">Next change</button>
```

In `src/app.ts`:

- Change the import from `./chips` to `import { stepTarget, updateChips, wireChips } from './chips';`.
- In `syncTransport`, after `  $('clock').textContent = …;` add:

```ts
  $<HTMLButtonElement>('step-prev').disabled = stepTarget(S.t, -1) === null;
  $<HTMLButtonElement>('step-next').disabled = stepTarget(S.t, 1) === null;
```

- After `function retryChips(): void { … }` add:

```ts
/** Move the playhead to the previous or next change of the chips, and stop playing. */
function step(dir: 1 | -1): void {
  const to = stepTarget(S.t, dir);
  if (to === null) return;
  S.t = to;
  S.playing = false;
  drawAll();
}
```

- In `wire`, after `  wireChips(drawAll);` add:

```ts
  $('step-prev').addEventListener('click', () => step(-1));
  $('step-next').addEventListener('click', () => step(1));
```

- [ ] **Step 5: Run the checks and see everything pass**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cargo fmt --check && cargo clippy -p logviewer-core -- -D warnings && npm run test:core && npm run check && npx prettier --check "src/**/*.ts" tests && npm run build && cargo build --release -p logviewer-dev && npm run test:ui`

Expected: `all checks passed`.

- [ ] **Step 6: Commit**

```bash
git add index.html src/chips.ts src/app.ts tests/ui.mjs
git commit -m "Replay: Previous change and Next change in the transport

They move the playhead to the changes of the chosen chip, or of every chip
shown when none is chosen, and stop the replay.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Fitting the screen

**Files:**
- Modify: `src/charts.ts` (`TG`, `fitPh`, `trLayout`, `panelY`, `drawTraces`)
- Modify: `src/app.ts` (`renderReadouts`; redraw on resize and when the boxes above the traces change size)
- Modify: `index.html` (ids on the transport and the view bar)
- Modify: `src/styles.css` (the sticky transport)
- Test: `tests/ui.mjs`

**Interfaces:**
- Consumes, from Task 5: `TG` with `tick` and `tickChosen`; from Task 6: the step buttons in the transport.
- Produces, in `src/charts.ts`: `TG.phMin` (34) and `TG.phMax` (53) in place of `TG.ph`; `TraceLayout.ph: number`; `trLayout(w: number, ph: number)`; `panelY(L: TraceLayout, p: Panel, v: number)`.
- Produces, in the page: `#transport`, `#viewbar`; `#readouts` is `hidden` when it holds nothing.

**Estimates, not measurements** (worked out from the CSS; the planner could not run the UI test). At 1440 px wide the replay panel's content is about 1022 px. Above the traces sit the transport (about 46 px with its margin), the view bar (63), one row of four cards (67) and the default pull's 13 chips: about 2560 px of chips, so three rows, the third half full (about 102 px with the margin; 70 if they fit in two). That is about 278 px (246 with two rows). Six traces at 53 px take 6 × 76 + 38 = 494 px: 772 px in all, so at 1440 × 900 the plots are 53 px with about 128 px to spare. At 1440 × 700 the room is 700 − 278 − 38 = 384 px, so the plots are 41 px (46 with two rows of chips): inside 34 to 53 either way. With Channels open (its list about 420 px) nothing fits at 700, so the plots are 34 px. In the main test page (1400 × 1000, Channels closed, seven traces of the Warm-up view), the tallest case is the Back road log with 16 chips in about four rows: 310 + 7 × 76 + 38 = 880 px, under 1000, so every span shows 53 px plots and one canvas height. If the run disagrees, trust the run, keep the checks' meaning, and adjust only the numbers they compare against.

- [ ] **Step 1: Add the failing checks**

In `tests/ui.mjs`, replace the finding view check

```js
  const fv = await page.evaluate(() => {
    const s = window.__logViewer;
    return {
      title: s.fview && s.fview.title,
      keys: s.fview ? s.fview.keys : [],
      flagged: document.querySelectorAll('.ro.flag').length,
      sel: document.getElementById('view-sel').selectedOptions[0].textContent,
    };
  });
  check('finding view shows flagged channels', fv.keys.length > 0 && fv.flagged > 0 && /^Finding: /.test(fv.sel), JSON.stringify(fv));
```

with

```js
  const fv = await page.evaluate(() => {
    const s = window.__logViewer;
    return {
      title: s.fview && s.fview.title,
      keys: s.fview ? s.fview.keys : [],
      cards: document.querySelectorAll('#readouts .ro').length,
      cardRow: !document.getElementById('readouts').hidden,
      sel: document.getElementById('view-sel').selectedOptions[0].textContent,
    };
  });
  // every readout of a finding's view has a trace, so there is no card row; the flags are on the traces
  check(
    'finding view shows its flagged channels as traces, with no card row',
    fv.keys.length > 0 && fv.cards === 0 && !fv.cardRow && /^Finding: /.test(fv.sel),
    JSON.stringify(fv),
  );
```

Before the comment `  // phone and tablet widths, dark mode:` add:

```js
  // fitting the screen: with the default view and pull, the replay from the transport to the time axis fits the window,
  // with plots from 34 to 53 px; when it cannot, the page scrolls and the transport stays at the top of the window
  const fit = async (width, height, picker = false) => {
    page = await open({ viewport: { width, height } });
    await settle(page);
    await page.selectOption('#view-sel', 'Default');
    await chipsShown(page, 13);
    if (picker) await page.click('#chan-btn');
    await page.evaluate(() => document.getElementById('replay-panel').scrollIntoView({ block: 'start' }));
    await settle(page);
    const r = await replay(page);
    const span = await page.evaluate(() =>
      Math.round(document.getElementById('tr-wrap').getBoundingClientRect().bottom - document.querySelector('#replay-panel .transport').getBoundingClientRect().top),
    );
    const cards = await page.evaluate(() => [...document.querySelectorAll('#readouts .ro .lb')].map(e => e.textContent).join());
    await page.evaluate(() => document.getElementById('tr-wrap').scrollIntoView({ block: 'end' }));
    await settle(page);
    const play = await page.evaluate(() => {
      const b = document.getElementById('play').getBoundingClientRect();
      return b.top >= 0 && b.bottom <= innerHeight;
    });
    await page.close();
    return { ph: r.ph, span, cards, play };
  };
  const at900 = await fit(1440, 900);
  check('at 1440 × 900 the replay fits from the transport to the time axis', at900.span <= 900 && at900.ph === 53, JSON.stringify(at900));
  check('a card only for a readout without a trace', at900.cards === 'Road speed,Boost,Est. wheel power,Est. torque', at900.cards);
  const at700 = await fit(1440, 700);
  check(
    'at 1440 × 700 the plots are shorter, not under 34 px, and the replay still fits',
    at700.ph < at900.ph && at700.ph >= 34 && at700.span <= 700,
    JSON.stringify(at700),
  );
  const tight = await fit(1440, 700, true);
  check(
    'when it cannot fit, the plots are 34 px and Play stays in the window as the page scrolls',
    tight.ph === 34 && tight.span > 700 && tight.play,
    JSON.stringify(tight),
  );
```

- [ ] **Step 2: Run the UI test and see the new checks fail**

Run: `npm run build && cargo build --release -p logviewer-dev && npm run test:ui`

Expected `FAIL` lines: `finding view shows its flagged channels as traces, with no card row`, `a card only for a readout without a trace`, `at 1440 × 700 the plots are shorter, …`, `when it cannot fit, …`. `at 1440 × 900 the replay fits from the transport to the time axis` is `ok` already: at that size the replay fits at 53 px even with ten cards.

- [ ] **Step 3: Cards only where there is no trace**

In `src/app.ts`, in `renderReadouts`, replace

```ts
  for (const id of curView().readouts) {
    const inf = chInfo(log, id);
```

with

```ts
  const view = curView();
  // a channel with a trace has its value at the playhead beside the trace already: no card for it
  const traced = new Set(view.traces.flatMap(t => (t.b ? [t.a, t.b] : [t.a])));
  for (const id of view.readouts.filter(id => !traced.has(id))) {
    const inf = chInfo(log, id);
```

and replace

```ts
  if (!curView().readouts.length) box.appendChild(el('p', 'hint', 'No readouts in this view. Open Channels and add some.'));
}
```

with

```ts
  if (!view.readouts.length) box.appendChild(el('p', 'hint', 'No readouts in this view. Open Channels and add some.'));
  // a view whose every readout has a trace has no card row
  box.hidden = !box.childElementCount;
}
```

In `wire`, replace

```ts
  const ro = new ResizeObserver(() => drawAll());
  for (const id of ['dyno-wrap', 't3-wrap', 'tr-wrap']) ro.observe($(id));
```

with

```ts
  const ro = new ResizeObserver(() => drawAll());
  // the cards, the chips and the picker above the traces change the room the traces have
  for (const id of ['dyno-wrap', 't3-wrap', 'tr-wrap', 'readouts', 'chips', 'picker']) ro.observe($(id));
  // so does the window's height, which no observed box follows
  window.addEventListener('resize', () => drawAll());
```

- [ ] **Step 4: Plots that fit**

In `index.html`, replace `        <div class="transport">` with `        <div class="transport" id="transport">` and `        <div class="viewbar">` with `        <div class="viewbar" id="viewbar">`.

In `src/charts.ts`:

Replace

```ts
export const TG = { l: 46, r: 92, lab: 17, ph: 53, gap: 6, ticks: 12, tick: 4, tickChosen: 8, axis: 22 };
```

with

```ts
export const TG = { l: 46, r: 92, lab: 17, phMin: 34, phMax: 53, gap: 6, ticks: 12, tick: 4, tickChosen: 8, axis: 22 };
```

and in the doc comment above it replace `label row, panel height, gap,` with `label row, the least and the most panel height, gap,`.

In `interface TraceLayout`, after `  pw: number;` add:

```ts
  /** height of each trace's plot, fitted to the window */
  ph: number;
```

After the `TraceLayout` interface's closing `}` and the `trCache`/`trGeom` lines, before `function trLayout`, add:

```ts
/**
 * The plot height at which the replay, from the top of the transport to the time axis, fits the window: the tallest from
 * TG.phMin to TG.phMax. When it does not fit at TG.phMin either, TG.phMin, and the page scrolls.
 */
function fitPh(n: number): number {
  const transport = $('transport');
  // what sits between the transport and the traces: the view bar, the picker when open, the cards and the chips.
  // Measured from the view bar, which scrolls with the page: the transport can be held at the top of the window
  const above =
    transport.offsetHeight +
    parseFloat(getComputedStyle(transport).marginBottom) +
    $('tr-wrap').getBoundingClientRect().top -
    $('viewbar').getBoundingClientRect().top;
  const room = window.innerHeight - above - TG.ticks - TG.axis - 4;
  return clamp(Math.floor(room / n) - TG.lab - TG.gap, TG.phMin, TG.phMax);
}
```

Replace `function trLayout(w: number): TraceLayout {` with `function trLayout(w: number, ph: number): TraceLayout {`. In `trLayout`, replace

```ts
    return { ...p, y0: i * (TG.lab + TG.ph + TG.gap) + TG.lab, vlo: lo, vhi: hi, ia, ib: p.b ? chInfo(f.log, p.b) : null };
```

with

```ts
    return { ...p, y0: i * (TG.lab + ph + TG.gap) + TG.lab, vlo: lo, vhi: hi, ia, ib: p.b ? chInfo(f.log, p.b) : null };
```

and replace

```ts
  const axisY = panels.length * (TG.lab + TG.ph + TG.gap) - TG.gap + TG.ticks;
  return { pw, rpmMode, spans, x0, x1, X, panels, axisY };
```

with

```ts
  const axisY = panels.length * (TG.lab + ph + TG.gap) - TG.gap + TG.ticks;
  return { pw, ph, rpmMode, spans, x0, x1, X, panels, axisY };
```

Replace

```ts
const panelY = (p: Panel, v: number) => p.y0 + TG.ph - ((clamp(v, p.vlo, p.vhi) - p.vlo) / (p.vhi - p.vlo || 1)) * TG.ph;
```

with

```ts
const panelY = (L: TraceLayout, p: Panel, v: number) => p.y0 + L.ph - ((clamp(v, p.vlo, p.vhi) - p.vlo) / (p.vhi - p.vlo || 1)) * L.ph;
```

and change its two callers in `drawTraces`, `const y = panelY(p, v);` inside `path` and `const y = panelY(p, v);` at the playhead dot, to `const y = panelY(L, p, v);`.

In `drawTraces`, replace

```ts
  // the band of ticks is always there, so the canvas keeps one height whatever the chips
  const hpx = Math.max(1, n) * (TG.lab + TG.ph + TG.gap) + TG.ticks + TG.axis + 4;
```

with

```ts
  // the band of ticks is always there, so the canvas height depends on the window and what is above it, never on the chips' answer
  const ph = fitPh(Math.max(1, n));
  const hpx = Math.max(1, n) * (TG.lab + ph + TG.gap) + TG.ticks + TG.axis + 4;
```

replace `  const L = trLayout(w);` with `  const L = trLayout(w, ph);`, and then replace every remaining `TG.ph` in `drawTraces` with `L.ph` (`rg -n "TG\.ph" src/charts.ts` must then list nothing).

- [ ] **Step 5: The transport stays in view**

In `src/styles.css`, replace

```css
.transport{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;margin-bottom:10px}
```

with

```css
/* the transport stays at the top edge of the window while the replay panel is on screen; the rest of the panel scrolls under it */
.transport{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;position:sticky;top:env(safe-area-inset-top,0px);z-index:5;background:var(--surface);padding:6px 0;margin:-6px 0 4px}
```

- [ ] **Step 6: Run the checks and see everything pass**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cargo fmt --check && cargo clippy -p logviewer-core -- -D warnings && npm run test:core && npm run check && npx prettier --check "src/**/*.ts" tests && npm run build && cargo build --release -p logviewer-dev && npm run test:ui`

Expected: `all checks passed`. If a check that compares canvas heights across spans fails (`the trace canvas keeps its height with chips`, `the default pull shows …`, `a whole log shows …`), Channels was open during it: the replay checks close it first (Task 4) so the replay fits at 53 px at 1400 × 1000; find what opened it rather than loosening the check.

- [ ] **Step 7: Commit**

```bash
git add src/charts.ts src/app.ts index.html src/styles.css tests/ui.mjs
git commit -m "Replay: fit the window

A card is drawn only for a readout without a trace. Plots are the tallest
from 34 to 53 px at which the replay, from the transport to the time axis,
fits the window, and the transport stays at the top of the window while the
replay is on screen.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Notes, the design system, and the screenshot script

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `DESIGN.md`
- Modify: `docs/superpowers/specs/2026-10-04-replay-state-chips-design.md` (status line)
- Modify: `docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md` (status line)
- Modify: `tests/site-shots.mjs`

**Interfaces:**
- Consumes: everything above. Produces nothing code relies on.

- [ ] **Step 1: The screenshot script chooses a chip**

In `tests/site-shots.mjs`, replace

```js
    const [readouts, traces] = [await box('#readouts'), await box('#tr-wrap')];
```

with

```js
    // the clutch chip chosen, so the picture shows the shading behind the traces
    await page.locator('#chips .chip').filter({ has: page.getByText('Clutch State', { exact: true }) }).click();
    await page.waitForTimeout(300);
    const [readouts, traces] = [await box('#readouts'), await box('#tr-wrap')];
```

Do not run `npm run site:shots` in this plan.

- [ ] **Step 2: CLAUDE.md**

Replace the four lines from `- Replay: on/off channels are rows under the traces, appearing on their own for any switch that changes in the span on screen.` through `  Still to design: channels with a small set of states (gear, launch control state, active table). They need value labels the log does not carry, so they stay as traces.` with:

```markdown
- Replay: switches and states are chips under the readout cards, read at the playhead, with a tick above the time axis at every change; a chosen chip is shaded behind the traces, and Previous change and Next change step through the changes. Built from `docs/superpowers/specs/2026-10-04-replay-state-chips-design.md` by `docs/superpowers/plans/2026-10-04-replay-state-chips.md`; seen in the browser test, not yet in the native window. They replaced the switch rows (`docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md`).
  The traces and the chips take the stretch of the log they show from `replaySpan` in `src/state.ts`, so a zoom changes one place.
  A readout card is drawn only for a channel with no trace, the plots are 34 to 53 px tall so the replay fits the window, and the transport stays at the top of the window while the replay is on screen.
  The website's replay screenshot predates the chips and must be retaken after the merge: `npm run site:shots`; the image's height changes, so its `height` in `site/index.html` must follow.
```

If the UI review bullet reads `Still to do, in order: the replay's height with the chips, the log list,`, replace `the replay's height with the chips, ` with nothing, so it reads `Still to do, in order: the log list,`.

Replace the rule that starts `- Switch rows: what is a switch (samples of 0 and 1, and a declared \`DisplayMaxMin\` within 0 to 2),` (the whole bullet) with:

```markdown
- Switches and states: what is a switch (samples of 0 and 1, and a declared `DisplayMaxMin` within 0 to 2), which channels are one signal (grouped once per log: same start, same changes each at most one sample apart, missing at the same samples) and a switch chip's spans are decided in `crates/core/src/switches.rs`; what is a state (not a switch, `Type` Raw or Gear, whole numbers, two to eight values, a declared range no wider than 128 where a NaN bound fails, no more than two changes a second over the log, not a `Data Log ` channel) and its sections in `crates/core/src/states.rs`, with the NSP parts (`has_no_unit`, `is_logger_channel`) in `haltech.rs`; the span, the order and the limits (twelve switches and eight states, keeping those that change least) in `crates/core/src/span.rs`. A switch chip is built from the group's shortest name alone. `src/chips.ts` and `src/charts.ts` read and draw what the core returns and read no samples for it. Their values are tested in `crates/core/tests/switches.rs` and `crates/core/tests/chips.rs`, not in the golden snapshot.
```

- [ ] **Step 3: README.md**

Replace `  src/switches.rs    on/off channels and when they change, for the replay's switch rows` with:

```
  src/span.rs        what switches and states share: a channel traced over the log, the span on screen, the limit
  src/switches.rs    on/off channels: which are switches, which are one signal, what they do in a span
  src/states.rs      channels that hold one of a few whole-number readings, such as Gear
  src/chips.rs       the replay's chips for a span: switches and states
```

Replace `  charts.ts          power chart, replay traces, 3D table` with:

```
  charts.ts          power chart, replay traces, 3D table
  chips.ts           the replay's chips: what each reads at the playhead, the chosen chip, stepping
```

Replace `` `dyno`, `switches` and so on `` with `` `dyno`, `chips` and so on ``.

Replace `# core against a snapshot from the real logs; library import, duplicates, watch folder; switch rows` with `# core against a snapshot from the real logs; library import, duplicates, watch folder; switches and states`, and `# drives the UI in a browser: import, dyno, findings, views, replay, switch rows, phone and tablet widths` with `# drives the UI in a browser: import, dyno, findings, views, replay and its chips, phone and tablet widths`.

Replace the bullet that starts `- Under the replay traces, on/off channels are drawn as switch rows:` (the whole bullet) with:

```markdown
- Under the readout cards in the replay, a chip for each switch and each state that changes in the span on screen reads it at the playhead: `On` or `Off` for a switch, the logged number for a state. NSP does not mark its switches, so the core reads them from the log: a channel is a switch when every sample it has in the log is exactly 0 or 1, both occur, and the range the log's header declares for it (`DisplayMaxMin`) lies within 0 to 2. A state that declares 0 to 2 and reads only 0 and 1 in one log is taken for a switch in that log. The same signal is often logged under several names: channels that start in the same state and make the same changes, each at most one sample apart, across the whole log are one signal and share one chip, named for the channel with the shortest name; the chip's tooltip lists the others. A channel is a state when it is not a switch, has no unit (`Type : Raw` or `Gear`), every sample is a whole number, it takes two to eight values in the log, its declared range is no wider than 128, it changes no more than twice a second on average over the log, and it is not one of the logger's own channels (a name that starts `Data Log `). At most twelve switches and eight states are shown, the ones that change least when more change, and the note under the traces counts the rest. A tick above the time axis marks every change. Clicking a chip shades it behind the traces (where a switch is on; every other section of a state, with each value written in the first trace); **Previous change** and **Next change** move the playhead to its changes, or to any chip's when none is chosen. By RPM keeps the chips and draws no ticks or shading. **Show switches and states that change** in Channels turns them off. A readout card is shown only for a channel without a trace: a traced channel's value is written beside its trace.
```

- [ ] **Step 4: DESIGN.md**

In section 4, after the **Message** line add:

```markdown
- **Chip.** A switch or a state read at the replay's playhead: the name in `body` text and the reading in bold `ink` figures, on `surface-card` with a `hairline-strong` outline and 8px corners. A switch chip leads with a dot that is filled while it is on. A chosen chip is a `selected` chip, as a selected control is. The chosen channel is shaded behind the traces in a tint of `run-a`, never in the grey of the selected pull; never red.
```

- [ ] **Step 5: The specs' status lines**

In `docs/superpowers/specs/2026-10-04-replay-state-chips-design.md`, replace `Status: approved by the owner on 2026-10-04 from a live prototype of four directions.` with:

```markdown
Status: approved by the owner on 2026-10-04 from a live prototype of four directions; built by `docs/superpowers/plans/2026-10-04-replay-state-chips.md`, which lists the decisions taken where this design is silent.
```

In `docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md`, replace `Status: built, by` (the start of line 3) with:

```markdown
Status: replaced by `2026-10-04-replay-state-chips-design.md` (plan `docs/superpowers/plans/2026-10-04-replay-state-chips.md`): the switch rule and the grouping below still hold for the chips; the rows, their pointing and their limit of eight are gone. First built by
```

The rest of that line, naming the two earlier plans, stays as it is.

- [ ] **Step 6: Run the checks and see everything pass**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cargo fmt --check && cargo clippy -p logviewer-core -- -D warnings && npm run test:core && npm run check && npx prettier --check "src/**/*.ts" tests && npm run build && cargo build --release -p logviewer-dev && npm run test:ui`

Expected: `all checks passed`. Then `rg -n "switch rows|Switch rows|MAX_ROWS|swShow|switchKey" src crates README.md CLAUDE.md DESIGN.md` lists only the CLAUDE.md line that says the chips replaced the switch rows.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md README.md DESIGN.md docs/superpowers/specs/2026-10-04-replay-state-chips-design.md docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md tests/site-shots.mjs
git commit -m "Notes: the replay's chips; the chip in the design system

The website's replay screenshot predates the chips and is to be retaken
with npm run site:shots after the merge.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

After the merge, the website's replay screenshot must be retaken (`npm run site:shots`) and its `height` in `site/index.html` set to the size the script prints. That is not part of this plan.
