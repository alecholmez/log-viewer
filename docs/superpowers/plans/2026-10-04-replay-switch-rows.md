# Replay Switch Rows Implementation Plan

> **For agentic workers:** Execute this plan with the owner's `convergence-loop` skill, task by task. Never use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Under the replay traces, draw one thin row for each on/off channel that changes in the stretch of the log on screen, sharing the traces' time axis and playhead.

**Architecture:** `crates/core/src/switches.rs` finds a log's switch channels once (every sample that is present is exactly 0 or 1, and both occur) and, for a span, returns the ones that change as rows of on spans, gaps and change times: channels that read the same share a row, rows come in order of first change, and at most eight are returned with a count of the rest. A `switches` command on `Session::dispatch` carries the rows to the UI, where `src/charts.ts` draws them from the spans alone and `src/app.ts` asks for them whenever the span on screen changes. The span on screen is one value, `replaySpan` in `src/state.ts`, read by the traces and the rows alike.

**Tech Stack:** Rust 2021 (`logviewer-core`: serde, serde_json), TypeScript 5.9 on canvas 2D with no framework, Vite 7, Playwright (Chromium) for the UI test, Prettier and rustfmt. The Tauri shell and `logviewer-dev` forward `dispatch` and need no change.

**Spec:** docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md

## Global Constraints

- Numbers: all numbers are computed in `crates/core`; the UI only formats and draws. For switch rows that means detection, merging of channels that read the same, spans, gaps, change times, ordering and the row limit are core work, and the UI reads no samples.
- Commands: every platform goes through `Session::dispatch` (`crates/core/src/session.rs`). The command is added there, then exposed in `src/api.ts`. `src-tauri` and `crates/devserver` are not touched.
- NaN: `!(x > y)` style comparisons in the core are deliberate. They are also true for NaN, which is a missing sample. Keep them.
- Copy: UI copy is minimal and direct, with no metaphors or analogies. The strings in this plan are used verbatim: `Show switches that change`, `On`, `Off`, `–` (an en dash), `Also logged as`, ` By RPM hides the switch rows.`, ` 3 more switches change in this span and are not shown.`, ` 1 more switch changes in this span and is not shown.`
- Golden snapshot: do not refresh `crates/core/tests/golden.json` and never run with `UPDATE_GOLDEN=1`. On this CPU it rewrites thousands of last digits. New values go in their own test files.
- TDD: every task writes a failing test first, runs it and sees the failure this plan states, writes the minimal code, and runs it again to see it pass.
- Shell: run `export PATH="$HOME/.cargo/bin:$PATH"` first in every shell.
- Core tests: `cargo test --release -p logviewer-core --no-fail-fast`
- UI test: `npm run build && cargo build --release -p logviewer-dev && npm run test:ui`. It starts its own server on port 1439 and stops with "Port 1439 is in use" if an earlier run left one behind.
- Type check: `npx tsc --noEmit`
- Formatting and lint: `npx prettier --check "src/**/*.ts" tests`, `cargo fmt --check`, `cargo clippy --release -p logviewer-core -- -D warnings`
- Branch: every commit goes on the feature branch `switch-rows`, never on `main`. Do not push and do not merge.
- Commits: each task ends with one commit whose message ends with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Stage the files the task names, never `git add -A`: the working tree holds untracked `.claude/` and `skills-lock.json`, and this plan until the owner commits it. None of them is part of a task's commit.
- Colours: use the existing CSS variables through `theme()` in `src/state.ts` (`--ink`, `--ink-2`, `--inset`, `--grid`, `--rule`). No new colours, no new variables, no change to `src/styles.css`. Nothing here styles a control: selected controls use `--sel` and `--sel-ink`, and this plan adds none. Tests read colours from the stylesheet at run time and never hard-code a value: the palette was restyled while this plan was written and may move again.
- One span: the stretch of the log on screen is one value, `replaySpan(focus)` in `src/state.ts` (Task 4). The traces and the switch rows both read it there, and nothing reads a pull's own start and end for the rows. A zoom feature follows this plan and will change that one place.
- Search: `rg` and `fd`, never `grep` or `find`.
- Spec corrections that bind every task (reasons under "Where the plan departs from the spec"): channels share a row when they read the same at every sample of the span asked for, not across the whole log; the reply is `{ rows: [{ name, also, on, gaps, changes }], more }`; a row's name sits on its own line above its bar.

## Review Focus

- The same signal under several names parts by one sample somewhere else in the log, as the three clutch channels do in every sample log that has them: inside a span where they read the same they must be one row. Pinned in Task 1 (`channels_are_compared_across_the_span_not_the_whole_log`) and Task 2 (`clutch_state_carries_its_two_duplicates`).
- A switch that is on for one sample of a long span (the upshift signal is on for 48 ms of a 45 s log) is narrower than a pixel: its bar must still show. Pinned in Task 3 ("a switch that is on for one sample still shows").
- The user moves to another pull or log before the rows for the last one arrive: the late answer must not be drawn against the new span. Pinned in Task 4 ("rows that arrive late for another span are dropped").
- The rows are asked for on every frame while the replay plays, instead of once for each span. Pinned in Task 4 ("the rows are asked for once for each span, not on every frame").
- The UI holds times as f32, so the end of a whole-log span falls just short of the last sample (69.743 s becomes 69.74299621582031): a change on that sample must still count, and nothing in the reply may fall outside the span asked for. Pinned in Task 1 (`a_change_on_the_last_sample_survives_the_ui_rounding_its_time`).

---

## Where the plan departs from the spec

Four points. The spec was approved before the sample logs and the drawing code were checked against it. Each point is where the logs or the code said otherwise. Task 5 records them in the spec as "As built" notes.

1. **The same across the span, not across the whole log.** The spec says "Signals that are identical across the whole log share one row", and its test wants Clutch State to carry two duplicates in the default pull of the 1:45 pm log. In that log Clutch State, AVI6 Switch State and Clutch Switch Input State part by one sample at 8.4 s, 26.6 s and 37.7 s, and read the same from 29.751 s to 36.41 s, which is the default pull's span. No sample log has all three the same from end to end. Compared across the whole log, the default pull would show nine switches, one over the limit, three of them the same clutch bar. Compared across the span, it shows six rows and Clutch State carries both duplicates, which is the spec's own test. So channels are compared at the samples inside the span asked for. Which channels are switches is still worked out once per log and kept with it.
2. **The reply.** The spec's rows are `{ name, also, on, gaps, more }`. `more` counts rows that were left out, so it sits beside the rows and not in each one. Each row also carries `changes`, the times it changes: the UI draws a line at each change of the row the pointer is on, and it cannot tell a change from the edge of a span that was clipped. The reply is `{ rows: [{ name, also, on, gaps, changes }], more }`.
3. **The label.** The spec says "a label on the left". The gutter left of the traces is 46 px, too narrow for "Drive By Wire 1 Pin 1 Output State". The name is drawn left-aligned on its own line above the bar, the way a trace's label is drawn above its panel.
4. **No CSS.** The spec lists `src/styles.css` for "the row label and readout styles". The label and the readout are canvas text in the theme's colours, as the trace labels and values are, and the checkbox uses the existing `.chk` class. `src/styles.css` does not change.

One thing the spec leaves open and the plan decides: two rows whose first change is on the same sample come in name order, so the order never depends on the order of channels in the file.

## What was checked on the sample logs

The code in this plan was run on a copy of the repository at commit 30045aa, task by task. The red and green results quoted in the tasks are from that run.

- The pull the app opens on is 2nd gear, 2,551 to 5,959 rpm, in `PCLog_2026-04-17_0145pm.csv`, from 31.251 s to 34.91 s. The replay shows 29.751 s to 36.41 s.
- In that span six rows come back, in this order: Decel Detected, Drive By Wire 1 Pin 1 Output State, Clutch State (also AVI6 Switch State and Clutch Switch Input State), Gear Upshift State, Stepper 1 Pin 2 Output State (also Cam Control Switched Output State Intake), Predicted MAP Active. Clutch State is on from 29.963 s to 31.206 s and from 34.96 s to 35.777 s.
- Across the whole 1:45 pm log (45.384 s), eleven switches change: eight rows and three left out, and no two share a row.
- `PCLog_2026-04-17_0142pm.csv` has no switch that changes. The UI test uses it as the log with no rows.
- Not found in the sample logs: a missing sample in any switch channel. Gaps are tested on logs built in the test (Task 1) and on rows put in by hand (Task 3), never on real data.
- Not reproduced: the spec's count of "19 on/off channels change at least once and 131 never change". This count found 22 channel names that are switches in at least one log. No test depends on either number.
- Not checked: the native window (Tauri), Windows and iOS. The UI was checked in Chromium through `tests/ui.mjs` only.

## Files

| File | Task | What it gains |
| --- | --- | --- |
| `crates/core/src/switches.rs` (new) | 1 | what is a switch, its changes, on spans and gaps, the rows for a span, and the unit tests on built logs |
| `crates/core/src/lib.rs`, `crates/core/src/log.rs` | 1 | the module, and the per-log store of switches on `Log` |
| `crates/core/tests/switches.rs` (new) | 2 | the command on the sample logs |
| `crates/core/src/session.rs` | 2 | the `switches` command, a number argument, one lookup of a log by key |
| `src/types.ts`, `src/api.ts` | 2, 4 | `SwitchRow`, `Switches`, `api.switches`; the `switches` setting |
| `src/state.ts` | 3, 4, 5 | `S.sw`, `S.swNow`; `replaySpan`, `S.swShow`; `S.swHover` |
| `src/charts.ts` | 3, 4, 5 | the rows under the traces, the readouts and the note; `replaySpan` in the layout; the row under the pointer and its lines |
| `src/app.ts` | 4, 5 | asking for the rows, the checkbox and its setting; the tooltip of a row |
| `index.html` | 4 | the checkbox |
| `tests/ui.mjs` | 3, 4, 5 | the checks |
| `README.md`, `CLAUDE.md`, the spec | 5 | the notes |

`src/styles.css`, `src-tauri` and `crates/devserver` do not change.

## How to read the edits

- Line numbers are for the files at commit 30045aa, before any task of this plan. Earlier tasks move later lines, so every edit quotes the text to find. Each quoted text occurs exactly once in its file.
- "Find" and "Replace with" blocks are exact, indentation included. An edit that adds lines repeats the line it is anchored to.
- The website's screenshots are not retaken by this plan. `site/img/replay.webp` will predate the rows; Task 5 says so in `CLAUDE.md`.

### Task 1: Core: the switches that change in a span

**Files:**
- Create: `crates/core/src/switches.rs`
- Modify: `crates/core/src/lib.rs` (lines 8, 19)
- Modify: `crates/core/src/log.rs` (lines 6, 52, 135)
- Test: `crates/core/src/switches.rs`, in a `#[cfg(test)] mod tests` at the end of the file, as `dyno.rs` and `fmt.rs` have

**Interfaces:**
- Consumes (all exist today): `logviewer_core::log::Log` with public fields `t: Vec<f64>` (seconds from the first sample), `names: Vec<String>`, `n: usize`; `Log::chan_at(&self, j: usize) -> &[f64]` (a channel in engineering units, NaN where a sample is missing); `Log::is_const(&self, j: usize) -> bool`; `Log::duration(&self) -> f64`; `Log::from_raw(raw: RawLog) -> Result<Log, String>`; `logviewer_core::haltech::{RawLog, Col}`.
- Produces, in `logviewer_core::switches`:

```rust
pub const MAX_ROWS: usize = 8;

pub struct Switch { /* private fields */ }

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Row {
    pub name: String,
    pub also: Vec<String>,
    pub on: Vec<[f64; 2]>,
    pub gaps: Vec<[f64; 2]>,
    pub changes: Vec<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Rows {
    pub rows: Vec<Row>,
    pub more: usize,
}

pub fn switches(log: &Log, t0: f64, t1: f64, limit: usize) -> Rows
```

  and on `Log`: `pub(crate) switches: OnceLock<Vec<Switch>>`. Serialized, `Rows` is `{"rows":[{"name":"…","also":["…"],"on":[[a,b]],"gaps":[[a,b]],"changes":[t]}],"more":0}`.

**Implementer:** implementer

**What the code decides.** These are the rules the tests pin. Times are log seconds.

- A switch is a channel that is not stored as a constant and whose every present sample, in engineering units, is exactly 0 or 1, with both present. A missing sample is NaN. A channel with any other value, or with one value only, is not a switch.
- A change is a present sample whose value differs from the last present sample before it. Its time is that sample's time. The first present sample of a log is not a change, and a missing sample is never one.
- An on span runs from the time of the first sample that reads 1 to the time of the next present sample that reads 0, or to the time of the log's last sample. Missing samples do not end it.
- A gap runs from the time of the first missing sample of a stretch to the time of the next present sample, or to the time of the log's last sample.
- A switch gets a row when at least one of its changes is inside the span `t0` to `t1`, both ends included. A time within 0.0005 s of an end of the span is on that end: the UI holds times as f32 and NSP times are whole milliseconds.
- Switches that read the same at every sample inside the span share one row; a missing sample matches a missing sample. The row's `name` is the shortest name, by characters, and a tie goes to the name that sorts first. `also` holds the others in the same order.
- Rows are in order of their first change inside the span. Rows that first change on the same sample are in name order. The first `limit` are returned and `more` counts the rest.
- `on` and `gaps` are clipped to the span. A span that ends as the span asked for starts is left out. One that starts as it ends is kept, with no length. `changes` holds only the changes inside the span.
- When `t0 <= t1` is not true, which includes either being NaN, there are no rows.

- [ ] **Step 1: Make the branch**

```bash
export PATH="$HOME/.cargo/bin:$PATH"
git switch -c switch-rows
git branch --show-current
```

Expected: `switch-rows`. If the branch already exists, `git switch switch-rows` instead. Never commit on `main`.

- [ ] **Step 2: Write the failing tests**

Create `crates/core/src/switches.rs` with the public types, a `switches` that finds nothing, and the tests. The tests build their logs with `Log::from_raw`; `2_147_483_647.0` is what NSP writes for "no reading" and becomes NaN.

```rust
//! Switch rows for the replay: on/off channels as bars on the time axis.
//!
//! NSP exports a switch as a plain number with no type that marks it, so a switch is found from its samples:
//! every sample that is present is exactly 0 or 1, and both occur. Which channels are switches is worked out
//! once per log and kept with it. Which of them change, and which read the same, is answered for a span.

use serde::Serialize;

use crate::log::Log;

/// The most rows the replay shows.
pub const MAX_ROWS: usize = 8;

/// One on/off channel of a log, over the whole log.
#[derive(Clone, Debug)]
pub struct Switch {
    /// channel index in the log
    j: usize,
    /// sample index of every change: the first sample that shows the new state
    changes: Vec<usize>,
    /// [start, end] in log seconds while the switch is on. A stretch of missing samples does not end one.
    on: Vec<[f64; 2]>,
    /// [start, end] in log seconds of every stretch of missing samples
    gaps: Vec<[f64; 2]>,
}

/// One row of the replay: a switch that changes inside the span.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Row {
    /// the shortest name among the channels that read the same across the span
    pub name: String,
    /// the other channels that read the same across the span, shortest name first
    pub also: Vec<String>,
    /// [start, end] in log seconds while the switch is on, clipped to the span
    pub on: Vec<[f64; 2]>,
    /// [start, end] in log seconds with no samples, clipped to the span
    pub gaps: Vec<[f64; 2]>,
    /// log seconds of every change inside the span
    pub changes: Vec<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Rows {
    pub rows: Vec<Row>,
    /// switches that change inside the span and were left out by the limit
    pub more: usize,
}

/// The switches that change between `t0` and `t1` (log seconds, both ends included), in order of first change,
/// at most `limit` of them. Channels that read the same at every sample of the span share one row.
pub fn switches(_log: &Log, _t0: f64, _t1: f64, _limit: usize) -> Rows {
    Rows {
        rows: Vec::new(),
        more: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::haltech::{Col, RawLog};

    /// What NSP writes for "no reading".
    const X: f64 = 2_147_483_647.0;

    /// A log with the given sample times in milliseconds: RPM and Vehicle Speed, which every log needs, then the given channels.
    fn log_at(t_ms: Vec<f64>, channels: &[(&str, &[f64])]) -> Log {
        let mut names = vec!["RPM".to_string(), "Vehicle Speed".to_string()];
        let mut cols = vec![Col::Const(3000.0), Col::Const(0.0)];
        for (name, v) in channels {
            assert_eq!(v.len(), t_ms.len(), "{name}");
            names.push(name.to_string());
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
            types: vec!["Raw".to_string(); names.len()],
            names,
            t_ms,
            cols,
        })
        .unwrap()
    }

    /// The same, with one sample a second from 0 s: the index of a sample is its time in seconds.
    fn log(channels: &[(&str, &[f64])]) -> Log {
        let n = channels[0].1.len();
        log_at((0..n).map(|i| i as f64 * 1000.0).collect(), channels)
    }

    /// The rows for the whole of a log.
    fn whole(log: &Log) -> Rows {
        switches(log, 0.0, log.duration(), MAX_ROWS)
    }

    fn names(r: &Rows) -> Vec<&str> {
        r.rows.iter().map(|row| row.name.as_str()).collect()
    }

    #[test]
    fn a_channel_that_goes_between_0_and_1_gets_a_row() {
        let l = log(&[("Clutch", &[0.0, 0.0, 1.0, 1.0, 1.0, 0.0, 0.0, 1.0])]);
        assert_eq!(
            whole(&l),
            Rows {
                rows: vec![Row {
                    name: "Clutch".into(),
                    also: vec![],
                    // on from the first sample that reads 1 to the first that reads 0 again, or to the end of the log
                    on: vec![[2.0, 5.0], [7.0, 7.0]],
                    gaps: vec![],
                    changes: vec![2.0, 5.0, 7.0],
                }],
                more: 0,
            }
        );
    }

    #[test]
    fn a_channel_that_never_changes_gets_no_row() {
        let l = log(&[
            ("Always on", &[1.0, 1.0, 1.0, 1.0]),
            ("Always off", &[0.0, 0.0, 0.0, 0.0]),
            // one value only, with a missing sample: stored as a series, still not a switch
            ("On with a hole", &[1.0, X, 1.0, 1.0]),
        ]);
        assert_eq!(whole(&l).rows, vec![]);
    }

    #[test]
    fn a_channel_with_any_other_value_is_not_a_switch() {
        let l = log(&[
            ("Launch state", &[0.0, 1.0, 2.0, 1.0, 0.0]),
            ("Duty", &[0.0, 0.5, 1.0, 0.5, 0.0]),
            ("Trim", &[0.0, -1.0, 0.0, 1.0, 0.0]),
            ("Brake", &[0.0, 1.0, 1.0, 0.0, 0.0]),
        ]);
        assert_eq!(names(&whole(&l)), ["Brake"]);
    }

    #[test]
    fn missing_samples_make_a_gap_and_are_not_a_change() {
        let l = log(&[
            ("Held on", &[0.0, 1.0, X, X, 1.0, 1.0, 0.0, 0.0]),
            ("Off after", &[0.0, 1.0, X, X, 0.0, 0.0, 0.0, 0.0]),
            ("Missing at both ends", &[X, 0.0, 1.0, 1.0, 1.0, 0.0, X, X]),
        ]);
        let r = whole(&l);
        assert_eq!(names(&r), ["Held on", "Off after", "Missing at both ends"]);

        // the switch reads on either side of the missing stretch: one on span, with a gap inside it
        assert_eq!(r.rows[0].on, [[1.0, 6.0]]);
        assert_eq!(r.rows[0].gaps, [[2.0, 4.0]]);
        assert_eq!(r.rows[0].changes, [1.0, 6.0]);

        // it went off somewhere in the missing stretch: the change is the first sample that shows it
        assert_eq!(r.rows[1].on, [[1.0, 4.0]]);
        assert_eq!(r.rows[1].gaps, [[2.0, 4.0]]);
        assert_eq!(r.rows[1].changes, [1.0, 4.0]);

        // a log that starts or ends with nothing: gaps, and no change where the first reading arrives
        assert_eq!(r.rows[2].on, [[2.0, 5.0]]);
        assert_eq!(r.rows[2].gaps, [[0.0, 1.0], [6.0, 7.0]]);
        assert_eq!(r.rows[2].changes, [2.0, 5.0]);

        // inside 1 s to 5 s "Held on" reads 1, nothing, nothing, 1, 1: no change, so no row
        assert_eq!(
            names(&switches(&l, 1.5, 5.0, MAX_ROWS)),
            ["Missing at both ends", "Off after"]
        );
    }

    #[test]
    fn identical_channels_share_a_row_under_the_shortest_name() {
        let clutch = [0.0, 1.0, 1.0, 0.0, 0.0, 1.0];
        let l = log(&[
            ("Clutch Switch Input State", &clutch),
            ("Brake Pedal State", &[0.0, 0.0, 1.0, 1.0, 0.0, 0.0]),
            ("AVI6 Switch State", &clutch),
            ("Clutch State", &clutch),
            // as long as "Clutch State": the tie goes to the name that sorts first
            ("Clutch Input", &clutch),
        ]);
        let r = whole(&l);
        assert_eq!(names(&r), ["Clutch Input", "Brake Pedal State"]);
        assert_eq!(
            r.rows[0].also,
            [
                "Clutch State",
                "AVI6 Switch State",
                "Clutch Switch Input State"
            ]
        );
        assert_eq!(r.rows[1].also, Vec::<String>::new());
    }

    #[test]
    fn channels_that_share_a_missing_stretch_still_share_a_row() {
        let l = log(&[
            ("Fan Output State", &[0.0, X, X, 1.0, 1.0, 0.0]),
            ("Fan", &[0.0, X, X, 1.0, 1.0, 0.0]),
            // the same readings, but present where the others are missing: a different signal
            ("Fan request", &[0.0, 0.0, 0.0, 1.0, 1.0, 0.0]),
        ]);
        let r = whole(&l);
        assert_eq!(names(&r), ["Fan", "Fan request"]);
        assert_eq!(r.rows[0].also, ["Fan Output State"]);
    }

    /// The sample logs hold the clutch under three names that part by one sample here and there.
    /// Inside a span where they read the same they are one row; across a span where they part they are not.
    #[test]
    fn channels_are_compared_across_the_span_not_the_whole_log() {
        let l = log(&[
            ("Clutch State", &[0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0]),
            (
                "AVI6 Switch State",
                &[0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0],
            ),
        ]);
        let r = switches(&l, 3.0, 7.0, MAX_ROWS);
        assert_eq!(names(&r), ["Clutch State"]);
        assert_eq!(r.rows[0].also, ["AVI6 Switch State"]);
        assert_eq!(names(&whole(&l)), ["Clutch State", "AVI6 Switch State"]);
    }

    #[test]
    fn a_change_outside_the_span_gives_no_row() {
        let l = log(&[
            ("Early", &[0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]),
            ("Late", &[0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0]),
            ("Inside", &[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0]),
        ]);
        let r = switches(&l, 2.0, 6.0, MAX_ROWS);
        assert_eq!(names(&r), ["Inside"]);
        assert_eq!(r.more, 0);
        // between two samples nothing changes
        assert_eq!(switches(&l, 3.2, 3.8, MAX_ROWS).rows, vec![]);
    }

    #[test]
    fn a_change_on_the_edge_of_the_span_counts() {
        let l = log(&[
            ("At 2 s", &[0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]),
            ("At 6 s", &[1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0]),
        ]);
        let r = switches(&l, 2.0, 6.0, MAX_ROWS);
        assert_eq!(names(&r), ["At 2 s", "At 6 s"]);
        assert_eq!(r.rows[0].changes, [2.0]);
        assert_eq!(r.rows[1].changes, [6.0]);
        // one side of the edge it is in, the other side it is out
        assert_eq!(
            names(&switches(&l, 2.001, 5.999, MAX_ROWS)),
            Vec::<&str>::new()
        );
    }

    /// The UI keeps a log's times as f32 and sends them back as the ends of the span.
    /// 69.743 s, the length of one of the sample logs, becomes 69.74299621582031: just short of the last sample.
    #[test]
    fn a_change_on_the_last_sample_survives_the_ui_rounding_its_time() {
        let l = log_at(
            vec![0.0, 23_000.0, 46_000.0, 69_743.0],
            &[("Clutch", &[0.0, 0.0, 0.0, 1.0])],
        );
        let t1 = 69.743_f32 as f64;
        assert!(t1 < 69.743, "the rounding this test is about");

        let r = switches(&l, 0.0, t1, MAX_ROWS);
        assert_eq!(names(&r), ["Clutch"]);
        // everything in the reply is inside the span that was asked for
        assert_eq!(r.rows[0].changes, [t1]);
        assert_eq!(r.rows[0].on, [[t1, t1]]);
    }

    #[test]
    fn spans_are_clipped_to_the_span_asked_for() {
        let l = log(&[
            (
                "Clutch",
                &[1.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0],
            ),
            ("Fan", &[1.0, 1.0, 0.0, 0.0, 0.0, X, X, X, X, 1.0]),
            ("Brake", &[0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0]),
        ]);
        let r = switches(&l, 2.0, 7.0, MAX_ROWS);
        assert_eq!(names(&r), ["Fan", "Clutch", "Brake"]);
        // Fan went off as the span starts: no on span. Its gap runs past the end of the span and is cut there.
        assert_eq!(r.rows[0].on, Vec::<[f64; 2]>::new());
        assert_eq!(r.rows[0].gaps, [[5.0, 7.0]]);
        assert_eq!(r.rows[0].changes, [2.0]);
        // Clutch was on before the span and is on after it
        assert_eq!(r.rows[1].on, [[2.0, 3.0], [5.0, 7.0]]);
        assert_eq!(r.rows[1].changes, [3.0, 5.0]);
        // Brake goes off as the span ends: its on span runs to the end
        assert_eq!(r.rows[2].on, [[4.0, 7.0]]);
        assert_eq!(r.rows[2].changes, [4.0, 7.0]);
    }

    #[test]
    fn rows_come_in_order_of_first_change_and_stop_at_the_limit() {
        // ten switches, each on for one second; the higher the number, the earlier it changes
        let series: Vec<(String, Vec<f64>)> = (0..10)
            .map(|k| {
                let mut v = vec![0.0; 14];
                v[11 - k] = 1.0;
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
                "Switch 2"
            ]
        );
        assert_eq!(r.more, 2);

        let r = switches(&l, 0.0, 13.0, 3);
        assert_eq!(names(&r), ["Switch 9", "Switch 8", "Switch 7"]);
        assert_eq!(r.more, 7);
    }

    #[test]
    fn the_order_is_by_the_first_change_inside_the_span() {
        let l = log(&[
            (
                "Early then late",
                &[0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0],
            ),
            (
                "Middle",
                &[0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0],
            ),
        ]);
        assert_eq!(names(&whole(&l)), ["Early then late", "Middle"]);
        assert_eq!(
            names(&switches(&l, 3.0, 9.0, MAX_ROWS)),
            ["Middle", "Early then late"]
        );
    }

    #[test]
    fn switches_that_first_change_together_are_ordered_by_name() {
        let l = log(&[
            ("Decel", &[0.0, 1.0, 1.0, 0.0]),
            ("Brake", &[0.0, 1.0, 0.0, 0.0]),
        ]);
        assert_eq!(names(&whole(&l)), ["Brake", "Decel"]);
    }

    #[test]
    fn a_span_that_is_backwards_or_not_a_number_gives_nothing() {
        let l = log(&[("Clutch", &[0.0, 1.0, 0.0, 1.0])]);
        let none = Rows {
            rows: vec![],
            more: 0,
        };
        assert_eq!(switches(&l, 3.0, 0.0, MAX_ROWS), none);
        assert_eq!(switches(&l, f64::NAN, 3.0, MAX_ROWS), none);
        assert_eq!(switches(&l, 0.0, f64::NAN, MAX_ROWS), none);
    }
}
```

- [ ] **Step 3: Add the module and the place a log keeps its switches**

**`crates/core/src/lib.rs`, line 8.** Name the module in the crate doc.

Find:

```rust
//! - `session`: app state and the single `dispatch` entry point the shells call.
```

Replace with:

```rust
//! - `switches`: on/off channels and when they change, for the replay's switch rows.
//! - `session`: app state and the single `dispatch` entry point the shells call.
```

**`crates/core/src/lib.rs`, line 19.** Declare the module.

Find:

```rust
pub mod stats;
pub mod table;
```

Replace with:

```rust
pub mod stats;
pub mod switches;
pub mod table;
```

**`crates/core/src/log.rs`, line 6.** Import the type the new field holds.

Find:

```rust
use crate::haltech::{name, type_info, Col, RawLog, BAD};
```

Replace with:

```rust
use crate::haltech::{name, type_info, Col, RawLog, BAD};
use crate::switches::Switch;
```

**`crates/core/src/log.rs`, line 52.** The field on `Log`, beside `states`, which is kept the same way.

Find:

```rust
    pub(crate) states: OnceLock<Vec<String>>,
}
```

Replace with:

```rust
    pub(crate) states: OnceLock<Vec<String>>,
    /// the on/off channels, found on first use
    pub(crate) switches: OnceLock<Vec<Switch>>,
}
```

**`crates/core/src/log.rs`, line 135.** Start it empty in `Log::from_raw`.

Find:

```rust
            states: OnceLock::new(),
        })
```

Replace with:

```rust
            states: OnceLock::new(),
            switches: OnceLock::new(),
        })
```

- [ ] **Step 4: Run the tests and see them fail**

```bash
cargo test --release -p logviewer-core --no-fail-fast --lib switches
```

Expected: it compiles, with two warnings that fields are never read (`switches` on `Log`, and `j`, `changes`, `on`, `gaps` on `Switch`), and ends with

```text
test result: FAILED. 2 passed; 13 failed; 0 ignored; 0 measured; 4 filtered out
```

The two that pass expect no rows: `a_channel_that_never_changes_gets_no_row` and `a_span_that_is_backwards_or_not_a_number_gives_nothing`. The other thirteen fail on their assertions, not on a compile error.

- [ ] **Step 5: Write the implementation**

In `crates/core/src/switches.rs`, replace everything above the line `#[cfg(test)]` with this. The test module stays as it is.

```rust
//! Switch rows for the replay: on/off channels as bars on the time axis.
//!
//! NSP exports a switch as a plain number with no type that marks it, so a switch is found from its samples:
//! every sample that is present is exactly 0 or 1, and both occur. Which channels are switches is worked out
//! once per log and kept with it. Which of them change, and which read the same, is answered for a span.

use std::ops::Range;

use serde::Serialize;

use crate::log::Log;

/// The most rows the replay shows.
pub const MAX_ROWS: usize = 8;

/// Seconds. The UI holds times as f32, so an end of the span it asks for can miss a sample time by a rounding error.
/// A time this close to an end of the span is on that end. NSP times are whole milliseconds.
const EDGE: f64 = 0.0005;

/// One on/off channel of a log, over the whole log.
#[derive(Clone, Debug)]
pub struct Switch {
    /// channel index in the log
    j: usize,
    /// sample index of every change: the first sample that shows the new state
    changes: Vec<usize>,
    /// [start, end] in log seconds while the switch is on. A stretch of missing samples does not end one.
    on: Vec<[f64; 2]>,
    /// [start, end] in log seconds of every stretch of missing samples
    gaps: Vec<[f64; 2]>,
}

/// One row of the replay: a switch that changes inside the span.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Row {
    /// the shortest name among the channels that read the same across the span
    pub name: String,
    /// the other channels that read the same across the span, shortest name first
    pub also: Vec<String>,
    /// [start, end] in log seconds while the switch is on, clipped to the span
    pub on: Vec<[f64; 2]>,
    /// [start, end] in log seconds with no samples, clipped to the span
    pub gaps: Vec<[f64; 2]>,
    /// log seconds of every change inside the span
    pub changes: Vec<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Rows {
    pub rows: Vec<Row>,
    /// switches that change inside the span and were left out by the limit
    pub more: usize,
}

/// 0 or 1 at every sample that is present, and both occur.
fn is_switch(a: &[f64]) -> bool {
    let (mut off, mut on) = (false, false);
    for &v in a {
        if v == 0.0 {
            off = true;
        } else if v == 1.0 {
            on = true;
        } else if !v.is_nan() {
            return false;
        }
    }
    off && on
}

/// Changes, on spans and gaps of one switch channel over the whole log.
fn trace(j: usize, t: &[f64], a: &[f64]) -> Switch {
    let mut sw = Switch {
        j,
        changes: Vec::new(),
        on: Vec::new(),
        gaps: Vec::new(),
    };
    let end = t[t.len() - 1];
    // the last reading that was present, where the on span it belongs to started, where the gap after it started
    let (mut last, mut on_from, mut gap_from) = (f64::NAN, None, None);
    for (i, &v) in a.iter().enumerate() {
        if v.is_nan() {
            gap_from.get_or_insert(t[i]);
            continue;
        }
        if let Some(g) = gap_from.take() {
            sw.gaps.push([g, t[i]]);
        }
        if v == last {
            continue;
        }
        // the first reading of a log is not a change
        if !last.is_nan() {
            sw.changes.push(i);
        }
        if v == 1.0 {
            on_from = Some(t[i]);
        } else if let Some(s) = on_from.take() {
            sw.on.push([s, t[i]]);
        }
        last = v;
    }
    if let Some(g) = gap_from {
        sw.gaps.push([g, end]);
    }
    if let Some(s) = on_from {
        sw.on.push([s, end]);
    }
    sw
}

/// Every switch channel of the log, in channel order. Found on first use and kept with the log.
fn all(log: &Log) -> &[Switch] {
    log.switches.get_or_init(|| {
        (0..log.names.len())
            .filter(|&j| !log.is_const(j) && is_switch(log.chan_at(j)))
            .map(|j| trace(j, &log.t, log.chan_at(j)))
            .collect()
    })
}

/// The same reading at every sample. A missing sample matches a missing sample: NaN is not equal to itself.
fn same(a: &[f64], b: &[f64]) -> bool {
    a.iter()
        .zip(b)
        .all(|(x, y)| x == y || (x.is_nan() && y.is_nan()))
}

/// The span asked for, in log seconds, both ends included.
#[derive(Clone, Copy)]
struct Span {
    t0: f64,
    t1: f64,
}

impl Span {
    /// A time within `EDGE` of an end of the span is on that end.
    fn snap(self, x: f64) -> f64 {
        if (x - self.t0).abs() <= EDGE {
            self.t0
        } else if (x - self.t1).abs() <= EDGE {
            self.t1
        } else {
            x
        }
    }

    /// Indexes of the samples inside the span.
    fn samples(self, t: &[f64]) -> Range<usize> {
        t.partition_point(|&x| x < self.t0 - EDGE)..t.partition_point(|&x| x <= self.t1 + EDGE)
    }

    /// The parts of `spans` inside this span. One that ends as this span starts is left out:
    /// the switch is off from there. One that starts as this span ends is kept, with no length.
    fn clip(self, spans: &[[f64; 2]]) -> Vec<[f64; 2]> {
        spans
            .iter()
            .map(|s| [self.snap(s[0]), self.snap(s[1])])
            .filter(|s| s[1] > self.t0 && s[0] <= self.t1)
            .map(|s| [s[0].max(self.t0), s[1].min(self.t1)])
            .collect()
    }
}

/// A switch that changes inside the span, with every channel that reads the same there.
struct Found<'a> {
    /// sample index of its first change inside the span
    first: usize,
    switch: &'a Switch,
    /// the channels that read the same at every sample of the span, shortest name first
    names: Vec<&'a str>,
}

/// The switches that change at the samples `inside`, in order of first change. Channels that read the same
/// at every one of those samples are one entry.
fn changing<'a>(log: &'a Log, inside: &Range<usize>) -> Vec<Found<'a>> {
    let readings = |s: &Switch| &log.chan_at(s.j)[inside.clone()];
    let mut found: Vec<Found> = Vec::new();
    for switch in all(log) {
        let Some(&first) = switch.changes.iter().find(|i| inside.contains(i)) else {
            continue;
        };
        let name = log.names[switch.j].as_str();
        match found
            .iter_mut()
            .find(|f| same(readings(f.switch), readings(switch)))
        {
            Some(f) => f.names.push(name),
            None => found.push(Found {
                first,
                switch,
                names: vec![name],
            }),
        }
    }
    for f in &mut found {
        f.names.sort_by_key(|n| (n.chars().count(), *n));
    }
    // switches that first change at the same sample are in name order, so the order never depends on channel order
    found.sort_by(|a, b| a.first.cmp(&b.first).then(a.names[0].cmp(b.names[0])));
    found
}

/// The switches that change between `t0` and `t1` (log seconds, both ends included), in order of first change,
/// at most `limit` of them. Channels that read the same at every sample of the span share one row.
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
            name: f.names[0].to_string(),
            also: f.names[1..].iter().map(|n| n.to_string()).collect(),
            on: span.clip(&f.switch.on),
            gaps: span.clip(&f.switch.gaps),
            changes: (f.switch.changes.iter())
                .filter(|i| inside.contains(i))
                .map(|&i| span.snap(log.t[i]))
                .collect(),
        })
        .collect();
    Rows { rows, more }
}
```

- [ ] **Step 6: Run the tests and see them pass**

```bash
cargo test --release -p logviewer-core --no-fail-fast --lib switches
```

Expected: no warnings from `switches.rs` or `log.rs`, and

```text
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 4 filtered out
```

- [ ] **Step 7: Run the whole core suite, the formatter and the linter**

```bash
cargo test --release -p logviewer-core --no-fail-fast 2>&1 | rg "Running|test result"
cargo fmt --check
cargo clippy --release -p logviewer-core -- -D warnings
```

Expected: every `test result` line says `ok`: 19 passed in `src/lib.rs`, 1 in `tests/golden.rs`, 3 in `tests/library.rs`, 6 in `tests/smoothing.rs`. `cargo fmt --check` prints nothing. Clippy ends with `Finished` and no warning. `crates/core/tests/golden.json` is unchanged: `git status --short crates/core/tests/golden.json` prints nothing.

- [ ] **Step 8: Commit**

```bash
git add crates/core/src/switches.rs crates/core/src/lib.rs crates/core/src/log.rs
git commit -m "Core: the switches that change in a span" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | tail -1
git status --short
```

Expected: the first command prints `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`, and `git status --short` lists no file this task touched. What it may still list is not part of the task: `?? .claude/`, `?? skills-lock.json`, and `?? docs/superpowers/plans/` if the plan is not committed yet.

### Task 2: The `switches` command and its types

**Files:**
- Create: `crates/core/tests/switches.rs`
- Modify: `crates/core/src/session.rs` (lines 15, 124, 165, 257, 432, 459)
- Modify: `src/api.ts` (lines 7, 43)
- Modify: `src/types.ts` (lines 158)
- Test: `crates/core/tests/switches.rs` for the command; `npx tsc --noEmit` for the TypeScript

**Interfaces:**
- Consumes, from Task 1: `logviewer_core::switches::{switches, MAX_ROWS}` with `pub fn switches(log: &Log, t0: f64, t1: f64, limit: usize) -> Rows` and `pub const MAX_ROWS: usize = 8`; `Rows` and `Row` derive `Serialize` with fields `rows`, `more` and `name`, `also`, `on`, `gaps`, `changes`.
- Consumes, existing: `Session::dispatch(&mut self, cmd: &str, args: Value) -> Result<Reply, String>`; `fn arg_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, String>` in `session.rs`; the test helpers `common::{call, sample_session}` in `crates/core/tests/common/mod.rs`, where `call(s: &mut Session, cmd: &str, args: Value) -> Result<Value, String>` and `sample_session() -> Option<Session>` loads every log in `testdata/logs`.
- Produces, the command: `switches` with arguments `{ "log": <log key>, "t0": <seconds>, "t1": <seconds> }`, answering `{ "rows": [...], "more": <count> }`. Errors: `missing argument: log`, `missing argument: t0`, `missing argument: t1`, `That log is not loaded.`
- Produces, in `src/types.ts`:

```ts
export interface SwitchRow {
  name: string;
  also: string[];
  on: [number, number][];
  gaps: [number, number][];
  changes: number[];
}

export interface Switches {
  rows: SwitchRow[];
  more: number;
}
```

- Produces, in `src/api.ts`: `api.switches(log: string, t0: number, t1: number): Promise<Switches>`.

**Implementer:** implementer

- [ ] **Step 1: Check the branch**

```bash
export PATH="$HOME/.cargo/bin:$PATH"
git branch --show-current
```

Expected: `switch-rows`. If it prints anything else, run `git switch switch-rows` and check again. Never commit on `main`.

- [ ] **Step 2: Write the failing test**

Create `crates/core/tests/switches.rs`. It calls the command the way a shell does, on the sample logs. The values in it were read from those logs: see "What was checked on the sample logs". They live here and not in `golden.json`.

```rust
//! The replay's switch rows, through the `switches` command the UI calls, on the sample logs.

mod common;

use common::{call, sample_session};
use logviewer_core::Session;
use serde_json::{json, Value};

fn log_key(s: &mut Session, file: &str) -> String {
    let logs = call(s, "logs", json!({})).unwrap();
    let log = logs.as_array().unwrap().iter().find(|l| l["name"] == file);
    log.expect("sample log")["key"]
        .as_str()
        .unwrap()
        .to_string()
}

fn rows(s: &mut Session, log: &str, t0: f64, t1: f64) -> Value {
    call(s, "switches", json!({ "log": log, "t0": t0, "t1": t1 })).unwrap()
}

fn names(reply: &Value) -> Vec<&str> {
    let rows = reply["rows"].as_array().unwrap();
    rows.iter().map(|r| r["name"].as_str().unwrap()).collect()
}

/// The pull the app opens on: the one with the largest RPM gain. Returns its log and the span the replay shows,
/// which is the pull with 1.5 s either side.
fn default_pull(s: &mut Session) -> (String, f64, f64) {
    let overview = call(s, "overview", json!({})).unwrap();
    let pulls = overview["pulls"].as_array().unwrap();
    let gain = |p: &&Value| p["gain"].as_f64().unwrap();
    let p = pulls
        .iter()
        .max_by(|a, b| gain(a).total_cmp(&gain(b)))
        .unwrap();
    (
        p["logKey"].as_str().unwrap().to_string(),
        p["t0"].as_f64().unwrap() - 1.5,
        p["t1"].as_f64().unwrap() + 1.5,
    )
}

#[test]
fn the_default_pull_gets_its_rows_in_order_of_first_change() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let (log, t0, t1) = default_pull(&mut s);
    assert_eq!(log, log_key(&mut s, "PCLog_2026-04-17_0145pm.csv"));
    assert_eq!((t0, t1), (31.251 - 1.5, 34.91 + 1.5));

    let reply = rows(&mut s, &log, t0, t1);
    assert_eq!(
        names(&reply),
        [
            "Decel Detected",
            "Drive By Wire 1 Pin 1 Output State",
            "Clutch State",
            "Gear Upshift State",
            "Stepper 1 Pin 2 Output State",
            "Predicted MAP Active",
        ]
    );
    assert_eq!(reply["more"], 0);
}

#[test]
fn clutch_state_carries_its_two_duplicates() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let (log, t0, t1) = default_pull(&mut s);
    let reply = rows(&mut s, &log, t0, t1);
    assert_eq!(
        reply["rows"][2],
        json!({
            "name": "Clutch State",
            "also": ["AVI6 Switch State", "Clutch Switch Input State"],
            // clutch in for the shift into 2nd and again for the shift into 3rd
            "on": [[29.963, 31.206], [34.96, 35.777]],
            "gaps": [],
            "changes": [29.963, 31.206, 34.96, 35.777],
        })
    );
    // the cam solenoid output is logged under two names; it comes on mid-pull and is still on when the span ends
    assert_eq!(
        reply["rows"][4],
        json!({
            "name": "Stepper 1 Pin 2 Output State",
            "also": ["Cam Control Switched Output State Intake"],
            "on": [[32.579, t1]],
            "gaps": [],
            "changes": [32.579],
        })
    );
}

/// Across the whole of the same log the three clutch channels part by one sample (at 8.4 s, 26.6 s and 37.7 s),
/// so they are three rows there, and more switches change than the replay has rows for.
#[test]
fn a_whole_log_is_cut_at_eight_rows_and_says_how_many_are_left_out() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let log = log_key(&mut s, "PCLog_2026-04-17_0145pm.csv");
    let reply = rows(&mut s, &log, 0.0, 45.384);
    assert_eq!(
        names(&reply),
        [
            "Cam Control Switched Output State Intake",
            "Stepper 1 Pin 2 Output State",
            "Predicted MAP Active",
            "Drive By Wire 1 Pin 1 Output State",
            "AVI6 Switch State",
            "Clutch State",
            "Clutch Switch Input State",
            "Decel Detected",
        ]
    );
    assert_eq!(reply["more"], 3);
    for row in reply["rows"].as_array().unwrap() {
        assert_eq!(row["also"], json!([]), "{}", row["name"]);
    }
}

#[test]
fn a_log_with_no_switch_that_changes_has_no_rows() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let log = log_key(&mut s, "PCLog_2026-04-17_0142pm.csv");
    assert_eq!(
        rows(&mut s, &log, 0.0, 18.371),
        json!({ "rows": [], "more": 0 })
    );
}

#[test]
fn the_same_span_gives_the_same_answer_every_time() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let (log, t0, t1) = default_pull(&mut s);
    let first = rows(&mut s, &log, t0, t1);
    // another span in between: the switches found for the log are kept, the rows are not
    rows(&mut s, &log, 0.0, 10.0);
    assert_eq!(rows(&mut s, &log, t0, t1), first);
}

#[test]
fn a_request_that_cannot_be_answered_says_why() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let log = log_key(&mut s, "PCLog_2026-04-17_0145pm.csv");
    let err = |s: &mut Session, args: Value| call(s, "switches", args).unwrap_err();
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

- [ ] **Step 3: Run it and see it fail**

```bash
cargo test --release -p logviewer-core --no-fail-fast --test switches
```

Expected: all six fail because the command does not exist yet.

```text
called `Result::unwrap()` on an `Err` value: "unknown command: switches"
test result: FAILED. 0 passed; 6 failed; 0 ignored; 0 measured; 0 filtered out
```

- [ ] **Step 4: Add the command**

**`crates/core/src/session.rs`, line 15.** Import what the command calls.

Find:

```rust
use crate::stats::median;
```

Replace with:

```rust
use crate::stats::median;
use crate::switches::{switches, MAX_ROWS};
```

**`crates/core/src/session.rs`, line 124.** A number argument, beside `arg_str`. JSON has no NaN, so a NaN from the UI arrives as null and is refused here.

Find:

```rust
        .ok_or_else(|| format!("missing argument: {key}"))
}
```

Replace with:

```rust
        .ok_or_else(|| format!("missing argument: {key}"))
}

fn arg_f64(args: &Value, key: &str) -> Result<f64, String> {
    args.get(key)
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("missing argument: {key}"))
}
```

**`crates/core/src/session.rs`, line 165.** One lookup of a log by key. `remove` and `log_data` each spell this out today; the new command would be a third copy.

Find:

```rust
    pub fn logs(&self) -> &[Log] {
        &self.logs
    }
```

Replace with:

```rust
    pub fn logs(&self) -> &[Log] {
        &self.logs
    }

    fn log(&self, key: &str) -> Result<&Log, String> {
        self.logs
            .iter()
            .find(|l| l.key == key)
            .ok_or_else(|| "That log is not loaded.".to_string())
    }
```

**`crates/core/src/session.rs`, line 257.** `remove` uses the lookup.

Find:

```rust
        let name = self
            .logs
            .iter()
            .find(|l| l.key == key)
            .map(|l| l.name.clone())
            .ok_or("That log is not loaded.")?;
```

Replace with:

```rust
        let name = self.log(key)?.name.clone();
```

**`crates/core/src/session.rs`, line 432.** `log_data` uses the lookup.

Find:

```rust
                let key = arg_str(&args, "key")?;
                let log = self
                    .logs
                    .iter()
                    .find(|l| l.key == key)
                    .ok_or("That log is not loaded.")?;
                Ok(Reply::Bytes(Self::data(log)))
```

Replace with:

```rust
                let log = self.log(arg_str(&args, "key")?)?;
                Ok(Reply::Bytes(Self::data(log)))
```

**`crates/core/src/session.rs`, line 459.** The command, between `dyno` and `get_settings`.

Find:

```rust
            "get_settings" => {
```

Replace with:

```rust
            "switches" => {
                let log = self.log(arg_str(&args, "log")?)?;
                let (t0, t1) = (arg_f64(&args, "t0")?, arg_f64(&args, "t1")?);
                ok(serde_json::to_value(switches(log, t0, t1, MAX_ROWS))
                    .map_err(|e| e.to_string())?)
            }
            "get_settings" => {
```

- [ ] **Step 5: Run the core tests and see them pass**

```bash
cargo test --release -p logviewer-core --no-fail-fast 2>&1 | rg "Running|test result"
```

Expected: every `test result` line says `ok`: 19 passed in `src/lib.rs`, 1 in `tests/golden.rs`, 3 in `tests/library.rs`, 6 in `tests/smoothing.rs`, 6 in `tests/switches.rs`. The library tests cover `remove_log` and `log_data`, which now go through the new lookup.

- [ ] **Step 6: Expose the command to the UI, and see the type check fail**

**`src/api.ts`, line 7.** Import the reply type.

Find:

```ts
import type { DynoOut, LogMeta, Overview, Settings, Vehicle } from './types';
```

Replace with:

```ts
import type { DynoOut, LogMeta, Overview, Settings, Switches, Vehicle } from './types';
```

**`src/api.ts`, line 43.** Expose the command.

Find:

```ts
  getSettings: () => call<Settings | null>('get_settings'),
```

Replace with:

```ts
  /** on/off channels that change between t0 and t1 (seconds in the log), in order of first change */
  switches: (log: string, t0: number, t1: number) => call<Switches>('switches', { log, t0, t1 }),
  getSettings: () => call<Settings | null>('get_settings'),
```

```bash
npx tsc --noEmit
```

Expected: it fails, because the type does not exist yet.

```text
src/api.ts(7,53): error TS2305: Module '"./types"' has no exported member 'Switches'.
```

- [ ] **Step 7: Add the types**

**`src/types.ts`, line 158.** The shapes the core returns, before `Vehicle`.

Find:

```ts
/** Vehicle in SI units, as the core wants it. */
```

Replace with:

```ts
/** One row of the replay's switch rows: an on/off channel that changes inside the span. Times are log seconds, clipped to the span. */
export interface SwitchRow {
  /** the shortest name among the channels that read the same across the span */
  name: string;
  /** the other channels that read the same across the span */
  also: string[];
  /** [start, end] while the switch is on */
  on: [number, number][];
  /** [start, end] with no samples */
  gaps: [number, number][];
  /** when the switch changes */
  changes: number[];
}

export interface Switches {
  rows: SwitchRow[];
  /** switches that change inside the span and were left out by the core's limit of eight rows */
  more: number;
}

/** Vehicle in SI units, as the core wants it. */
```

- [ ] **Step 8: Run the type check, the formatters and the linter**

```bash
npx tsc --noEmit
npx prettier --check "src/**/*.ts" tests
cargo fmt --check
cargo clippy --release -p logviewer-core -- -D warnings
```

Expected: `tsc` and `cargo fmt --check` print nothing, Prettier prints `All matched files use Prettier code style!`, Clippy ends with `Finished` and no warning.

- [ ] **Step 9: Commit**

```bash
git add crates/core/tests/switches.rs crates/core/src/session.rs src/api.ts src/types.ts
git commit -m "Core: the switches command, and its types for the UI" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | tail -1
git status --short
```

Expected: the first command prints `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`, and `git status --short` lists no file this task touched. What it may still list is not part of the task: `?? .claude/`, `?? skills-lock.json`, and `?? docs/superpowers/plans/` if the plan is not committed yet.

### Task 3: Draw the rows under the traces

**Files:**
- Modify: `src/state.ts` (lines 4, 262)
- Modify: `src/charts.ts` (lines 6, 222, 245, 256, 317, 325, 337, 345, 452, 548)
- Test: `tests/ui.mjs` (lines 38, 200)

**Interfaces:**
- Consumes, from Task 2, in `src/types.ts`: `SwitchRow { name: string; also: string[]; on: [number, number][]; gaps: [number, number][]; changes: number[] }` and `Switches { rows: SwitchRow[]; more: number }`. Times are seconds in the focused log, clipped to the span the rows were asked for.
- Consumes, existing in `src/charts.ts`: `TG = { l: 46, r: 92, lab: 17, ph: 53, gap: 6, axis: 22 }` (left gutter, right gutter, label row, panel height, gap, time axis); `interface TraceLayout { pw; rpmMode; spans; x0; x1; X: (v: number) => number; panels }`; `function trLayout(w: number): TraceLayout`; `export function drawTraces(): void`, which draws everything that does not move into a cached canvas `c` and the playhead and readouts onto `ctx` on every frame. Existing in `src/state.ts`: `S` (app state, also reachable in the browser as `window.__logViewer`), `S.xmode: 'time' | 'rpm'`, `S.t` (the playhead, seconds), `S.rev` (bump it when the cached drawing is stale), `theme()` with `ink`, `ink2`, `grid`, `rule`, `body`.
- Produces, in `src/state.ts`: `S.sw: Switches | null` (the rows to draw; nothing sets it yet, Task 4 does) and `S.swNow: string[]` (what each row reads at the playhead, as last drawn).
- Produces, in `src/charts.ts`:

```ts
export const SW = { top: 10, lab: 14, bar: 8, gap: 4 };
export function switchAt(row: SwitchRow, t: number): 'On' | 'Off' | '–';
export interface TraceLayout { /* as before, plus */ rows: SwitchRow[]; swY: number }
```

  `rows` is what is drawn under the last panel (empty in By RPM), `swY` is the y of the bottom of the last panel. Row `k`'s bar is at `y = swY + SW.top + k * (SW.lab + SW.bar + SW.gap) + SW.lab`, `SW.bar` high.
- Produces, in `tests/ui.mjs`, helpers the later tasks use: `TG`, `SW`, `swPitch`, `replay(page)`, `xAt(r, t)`, `barY(r, k)`, `playhead(page, t)`, `pixel(page, x, y)`, `token(page, name)`, `sameColour(a, b)`, and the constants `bare`, `ink2`, `grid` of the checks.

**Implementer:** implementer

**What is drawn.**

- The rows sit between the last trace and the time axis, so they share the axis and the playhead. With no rows the canvas is the height it is today.
- A row is 26 px: a 14 px line for the name, an 8 px bar, 4 px of space. 10 px of space come before the first row.
- The name is bold 11 px text in `--ink-2`, left-aligned with the traces, squeezed to the width of the plot when it is longer.
- The bar is `--grid` across the plot. It is `--ink-2` while the switch is on, in whole pixels and never less than one. Where there are no samples it is empty: the canvas is cleared there.
- At the right, where the traces show their values, each row shows `On` (in `--ink`), `Off` or `–` (in `--ink-2`) for the playhead's time. A gap wins over an on span.
- By RPM draws no rows. The note under the traces then ends with ` By RPM hides the switch rows.`
- When rows were left out the note ends with the count, for example ` 3 more switches change in this span and are not shown.`
- A switch that is also in the view as a trace is still drawn as a trace. Nothing here looks at the view's traces.

This task draws rows that the tests put into `S.sw` by hand. Nothing asks the core for rows until Task 4.

- [ ] **Step 1: Check the branch**

```bash
export PATH="$HOME/.cargo/bin:$PATH"
git branch --show-current
```

Expected: `switch-rows`. If it prints anything else, run `git switch switch-rows` and check again. Never commit on `main`.

- [ ] **Step 2: Write the failing checks**

`tests/ui.mjs` is one script that walks the app in a browser. `check(name, ok, detail)` prints `ok` or `FAIL`. Add the helpers and the checks.

**`tests/ui.mjs`, line 38.** Helpers for reading the replay and the trace canvas, after `settle`.

Find:

```js
  const settle = page => page.waitForTimeout(250);
```

Replace with:

```js
  const settle = page => page.waitForTimeout(250);

  // geometry of the trace canvas, as in src/charts.ts: TG for the traces, SW for the switch rows under them
  const TG = { l: 46, r: 92, lab: 17, ph: 53, gap: 6 };
  const SW = { top: 10, lab: 14, bar: 8, gap: 4 };
  const swPitch = SW.lab + SW.bar + SW.gap;
  /** The replay as it stands: the span, the switch rows and what they read, and where the canvas puts them. */
  const replay = page =>
    page.evaluate(
      ([l, r, pitch, gap]) => {
        const s = window.__logViewer;
        const traces = (s.fview || s.rview).traces.length;
        return {
          log: s.focus.log.name,
          w0: s.focus.w0,
          w1: s.focus.w1,
          rows: s.sw ? s.sw.rows : null,
          more: s.sw ? s.sw.more : null,
          now: (s.swNow || []).join(),
          height: document.getElementById('tr-wrap').offsetHeight,
          note: document.getElementById('tr-note').textContent,
          pw: document.getElementById('tr-cv').clientWidth - l - r,
          bandY: traces * pitch - gap,
        };
      },
      [TG.l, TG.r, TG.lab + TG.ph + TG.gap, TG.gap],
    );
  /** x on the canvas of a time in the span, and y of the middle of row k's bar. */
  const xAt = (r, t) => TG.l + ((t - r.w0) / (r.w1 - r.w0)) * r.pw;
  const barY = (r, k) => r.bandY + SW.top + k * swPitch + SW.lab + SW.bar / 2;
  /** Put the playhead at t and redraw: pressing By time redraws and moves nothing. Returns what the rows read there. */
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
```

**`tests/ui.mjs`, line 200.** The checks, after the `06-replay` screenshot.

Find:

```js
  await shot(page, '06-replay', true);
```

Replace with:

```js
  await shot(page, '06-replay', true);

  // switch rows, drawn from rows put in by hand so that every case is on screen: on, off, no samples, rows left out.
  // The 1:42 pm log has no switch that changes, so nothing else is drawn under its traces.
  await page.locator('.log-head', { hasText: '1:42 pm log' }).locator('button', { hasText: 'Replay' }).click();
  await settle(page);
  const bare = await replay(page);
  const putRows = more =>
    page.evaluate(more => {
      const s = window.__logViewer;
      s.sw = {
        rows: [
          {
            name: 'Clutch',
            also: ['Clutch Input'],
            // the second on span is 10 ms of an 18 s span: less than a pixel wide
            on: [
              [4, 8],
              [14, 14.01],
            ],
            gaps: [[10, 12]],
            changes: [4, 8, 14, 14.01],
          },
          { name: 'Fan', also: [], on: [[0, s.focus.w1]], gaps: [], changes: [] },
        ],
        more,
      };
      s.rev++;
    }, more);
  await putRows(2);
  const read = [await playhead(page, 2), await playhead(page, 6), await playhead(page, 11)].join(' | ');
  check('a switch row reads On, Off, or a dash where there are no samples', read === 'Off,On | On,On | –,On', read);
  await playhead(page, 15); // clear of the pixels read next
  let drawn = await replay(page);
  check(
    'two rows add their height under the traces',
    drawn.height === bare.height + SW.top + 2 * swPitch,
    bare.height + ' -> ' + drawn.height,
  );
  const [ink2, grid] = [await token(page, '--ink-2'), await token(page, '--grid')];
  const bar = [];
  for (const t of [6, 2, 11]) bar.push(await pixel(page, xAt(drawn, t), barY(drawn, 0)));
  check(
    'the bar is filled while the switch is on, plain while it is off and empty where there are no samples',
    sameColour(bar[0], ink2) && sameColour(bar[1], grid) && bar[2][3] === 0,
    JSON.stringify(bar),
  );
  const brief = await pixel(page, Math.floor(xAt(drawn, 14)), barY(drawn, 0));
  check('a switch that is on for one sample still shows', sameColour(brief, ink2), JSON.stringify(brief));
  check(
    'the note says how many switches are left out',
    / 2 more switches change in this span and are not shown\.$/.test(drawn.note),
    drawn.note,
  );
  await putRows(1);
  await playhead(page, 15);
  drawn = await replay(page);
  check('and counts one switch as one', / 1 more switch changes in this span and is not shown\.$/.test(drawn.note), drawn.note);
  await shot(page, '06b-switch-rows', true);
  await page.click('[data-xmode="rpm"]');
  drawn = await replay(page);
  check(
    'By RPM hides the rows and says so',
    drawn.height === bare.height && drawn.now === '' && / By RPM hides the switch rows\.$/.test(drawn.note),
    JSON.stringify([drawn.height, drawn.now, drawn.note]),
  );
  await page.click('[data-xmode="time"]');
  await page.evaluate(() => {
    const s = window.__logViewer;
    s.sw = null;
    s.rev++;
  });
  await page.click('[data-xmode="time"]');
  drawn = await replay(page);
  check('with no rows the traces take the height they had', drawn.height === bare.height && drawn.now === '', String(drawn.height));
```

- [ ] **Step 3: Run the UI test and see the new checks fail**

```bash
npm run build && cargo build --release -p logviewer-dev && npm run test:ui 2>&1 | rg "^FAIL|checks|passed"
```

Expected, each `FAIL` line going on to show what was read:

```text
FAIL a switch row reads On, Off, or a dash where there are no samples
FAIL two rows add their height under the traces
FAIL the bar is filled while the switch is on, plain while it is off and empty where there are no samples
FAIL a switch that is on for one sample still shows
FAIL the note says how many switches are left out
FAIL and counts one switch as one
FAIL By RPM hides the rows and says so
7 check(s) failed
```

"with no rows the traces take the height they had" already passes, and so does every check that was there before.

- [ ] **Step 4: Add the state**

**`src/state.ts`, line 4.** Import the type.

Find:

```ts
import type { Dyno, DynoOut, Finding, Log, Pull, Sev, Table, TraceDef, Vehicle, View } from './types';
```

Replace with:

```ts
import type { Dyno, DynoOut, Finding, Log, Pull, Sev, Switches, Table, TraceDef, Vehicle, View } from './types';
```

**`src/state.ts`, line 262.** Two fields at the end of `S`.

Find:

```ts
  fview: null as FindingView | null,
  watchDir: '',
};
```

Replace with:

```ts
  fview: null as FindingView | null,
  watchDir: '',
  /** switch rows for the span on screen, as the core returned them; null when there are none to draw */
  sw: null as Switches | null,
  /** what each switch row reads at the playhead, as last drawn: On, Off, or – where there are no samples */
  swNow: [] as string[],
};
```

- [ ] **Step 5: Add the layout of the rows**

**`src/charts.ts`, line 6.** Import the row type.

Find:

```ts
import type { Log, Pt, Pull, Table, TraceDef } from './types';
```

Replace with:

```ts
import type { Log, Pt, Pull, SwitchRow, Table, TraceDef } from './types';
```

**`src/charts.ts`, line 222.** The geometry of a row, beside the trace geometry.

Find:

```ts
export const TG = { l: 46, r: 92, lab: 17, ph: 53, gap: 6, axis: 22 };
```

Replace with:

```ts
export const TG = { l: 46, r: 92, lab: 17, ph: 53, gap: 6, axis: 22 };
/** Switch row geometry: space above the first row, then per row a line for the name, the bar, and space under it. */
export const SW = { top: 10, lab: 14, bar: 8, gap: 4 };
const SW_PITCH = SW.lab + SW.bar + SW.gap;
```

**`src/charts.ts`, line 245.** The layout carries the rows and where they start.

Find:

```ts
  X: (v: number) => number;
  panels: Panel[];
}
```

Replace with:

```ts
  X: (v: number) => number;
  panels: Panel[];
  /** switch rows drawn under the last panel */
  rows: SwitchRow[];
  /** y of the bottom of the last panel, where the switch rows start */
  swY: number;
}
```

**`src/charts.ts`, line 256.** The helpers, above `trLayout`.

Find:

```ts
function trLayout(w: number): TraceLayout {
```

Replace with:

```ts
/** The switch rows to draw. By RPM has none: a switch against engine speed is not a timeline. */
const switchRows = (): SwitchRow[] => (S.xmode === 'time' && S.sw ? S.sw.rows : []);
const swHeight = (rows: number) => (rows ? SW.top + rows * SW_PITCH : 0);
/** y of the top of row k's bar. */
const swBarY = (L: TraceLayout, k: number) => L.swY + SW.top + k * SW_PITCH + SW.lab;

/** What a switch row reads at time t, from the spans the core returned. No samples are read here. */
export function switchAt(row: SwitchRow, t: number): 'On' | 'Off' | '–' {
  const inside = (spans: [number, number][]) => spans.some(s => t >= s[0] && t <= s[1]);
  return inside(row.gaps) ? '–' : inside(row.on) ? 'On' : 'Off';
}

/** What the note under the traces says about the switch rows. */
function switchNote(rpmMode: boolean): string {
  const sw = S.sw;
  if (!sw) return '';
  if (rpmMode) return sw.rows.length ? ' By RPM hides the switch rows.' : '';
  if (!sw.more) return '';
  return (
    ' ' +
    sw.more +
    (sw.more === 1 ? ' more switch changes in this span and is not shown.' : ' more switches change in this span and are not shown.')
  );
}

function trLayout(w: number): TraceLayout {
```

**`src/charts.ts`, line 317.** The end of `trLayout`.

Find:

```ts
  return { pw, rpmMode, spans, x0, x1, X, panels };
```

Replace with:

```ts
  const swY = panels.length * (TG.lab + TG.ph + TG.gap) - TG.gap;
  return { pw, rpmMode, spans, x0, x1, X, panels, rows: switchRows(), swY };
```

- [ ] **Step 6: Draw the rows**

All five edits are inside `drawTraces`.

**`src/charts.ts`, line 325.** The canvas grows by the height of the rows, and by nothing when there are none.

Find:

```ts
  const hpx = Math.max(1, n) * (TG.lab + TG.ph + TG.gap) + TG.axis + 4;
```

Replace with:

```ts
  // the rows go under traces: where a message stands in for the traces there are none
  const band = S.focus && n ? swHeight(switchRows().length) : 0;
  const hpx = Math.max(1, n) * (TG.lab + TG.ph + TG.gap) + band + TG.axis + 4;
```

**`src/charts.ts`, line 337.** No rows are drawn when a message is shown.

Find:

```ts
    trGeom = null;
    $('tr-note').textContent = '';
```

Replace with:

```ts
    trGeom = null;
    S.swNow = [];
    $('tr-note').textContent = '';
```

**`src/charts.ts`, line 345.** `bottom` is where the time axis, the hover line and the playhead end. With no rows it is the value it was.

Find:

```ts
  const bottom = L.panels[n - 1].y0 + TG.ph;
```

Replace with:

```ts
  // the time axis sits under the switch rows, so the rows share it with the traces
  const bottom = L.swY + swHeight(L.rows.length);
```

**`src/charts.ts`, line 452.** The names and bars go into the cached drawing, after the panels and before the x axis.

Find:

```ts
    // x axis
    c.font = '11px ' + th.body;
```

Replace with:

```ts
    // switch rows: the name, then a bar that is filled while the switch is on and empty where there are no samples
    // a span in whole pixels, never less than one: a switch that is on for one sample of a long span still shows
    const px = ([a, b]: [number, number]) => {
      const wd = Math.max(1, Math.ceil(L.X(b)) - Math.floor(L.X(a)));
      return [Math.min(Math.floor(L.X(a)), TG.l + L.pw - wd), wd];
    };
    L.rows.forEach((row, k) => {
      const y = swBarY(L, k);
      c.font = '700 11px ' + th.body;
      c.fillStyle = th.ink2;
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      c.fillText(row.name, TG.l, y - 4, L.pw);
      c.fillStyle = th.grid;
      c.fillRect(TG.l, y, L.pw, SW.bar);
      c.fillStyle = th.ink2;
      for (const span of row.on) {
        const [x, wd] = px(span);
        c.fillRect(x, y, wd, SW.bar);
      }
      for (const span of row.gaps) {
        const [x, wd] = px(span);
        c.clearRect(x, y, wd, SW.bar);
      }
    });
    if (L.rows.length) {
      c.strokeStyle = th.rule;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(TG.l, bottom + 0.5);
      c.lineTo(TG.l + L.pw, bottom + 0.5);
      c.stroke();
    }

    // x axis
    c.font = '11px ' + th.body;
```

**`src/charts.ts`, line 548.** The readouts are drawn on every frame, after the trace readouts, and the note gains its sentence.

Find:

```ts
  $('tr-note').textContent = L.rpmMode
    ? 'Each selected run is drawn against its own RPM in its run colour. Click to move the playhead on run A.'
    : 'Click or drag to move the playhead.' + (f.m0 === f.m0 ? ' The shaded span is the selected pull or finding.' : '');
```

Replace with:

```ts
  // what each switch reads at the playhead
  S.swNow = L.rows.map(row => switchAt(row, S.t));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '700 11.5px ' + th.body;
  S.swNow.forEach((txt, k) => {
    ctx.fillStyle = txt === 'On' ? th.ink : th.ink2;
    ctx.fillText(txt, TG.l + L.pw + 10, swBarY(L, k) + SW.bar / 2);
  });
  $('tr-note').textContent =
    (L.rpmMode
      ? 'Each selected run is drawn against its own RPM in its run colour. Click to move the playhead on run A.'
      : 'Click or drag to move the playhead.' + (f.m0 === f.m0 ? ' The shaded span is the selected pull or finding.' : '')) +
    switchNote(L.rpmMode);
```

- [ ] **Step 7: Run the type check and the UI test and see them pass**

```bash
npx tsc --noEmit
npm run build && cargo build --release -p logviewer-dev && npm run test:ui 2>&1 | rg "^FAIL|checks|passed"
npx prettier --check "src/**/*.ts" tests
```

Expected: `tsc` prints nothing, the UI test prints `all checks passed`, Prettier prints `All matched files use Prettier code style!`.

To look at the result, `node tests/ui.mjs /tmp/shots` saves screenshots; `06b-switch-rows.png` shows the two hand-made rows.

- [ ] **Step 8: Commit**

```bash
git add src/state.ts src/charts.ts tests/ui.mjs
git commit -m "Replay: draw switch rows under the traces" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | tail -1
git status --short
```

Expected: the first command prints `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`, and `git status --short` lists no file this task touched. What it may still list is not part of the task: `?? .claude/`, `?? skills-lock.json`, and `?? docs/superpowers/plans/` if the plan is not committed yet.

### Task 4: Ask for the rows, the checkbox, and one span for traces and rows

**Files:**
- Modify: `src/types.ts` (lines 190)
- Modify: `src/state.ts` (lines 208)
- Modify: `src/charts.ts` (lines 4, 279)
- Modify: `index.html` (lines 145)
- Modify: `src/app.ts` (lines 37, 69, 936, 1153, 1429)
- Test: `tests/ui.mjs` (lines 223, 275, and text Task 3 added)
- Not changed: `src/styles.css`. The checkbox uses the `.chk` class the picker's other checkbox has.

**Interfaces:**
- Consumes, from Task 2: `api.switches(log: string, t0: number, t1: number): Promise<Switches>` in `src/api.ts`; `Switches` in `src/types.ts`.
- Consumes, from Task 3: `S.sw: Switches | null` and `S.swNow: string[]` in `src/state.ts`; `drawTraces` draws whatever is in `S.sw` and needs `S.rev++` when `S.sw` changes. In `tests/ui.mjs`: the helpers `TG`, `SW`, `swPitch`, `replay`, `playhead`, `sameColour`, and `bare` (the replay with no rows), all defined above the place these checks go.
- Consumes, existing: `interface Focus { log: Log; w0: number; w1: number; … }` and `S.focus: Focus | null` in `src/state.ts` (`w0` and `w1` are the stretch of the log the replay shows); in `src/app.ts`, `drawAll()` (every redraw goes through it), `saveSettings()`, `collectSettings(): Settings`, `status(text)`, `errText(e)`, `input(id)`, and `boot()`, which reads the saved settings into `S`.
- Produces, in `src/state.ts`: `export const replaySpan = (f: Focus): [number, number]` and `S.swShow: boolean`.
- Produces, in `src/types.ts`: `Settings.switches?: boolean`.
- Produces, in `src/app.ts`: `function syncSwitches(): void`, called first in `drawAll`.
- Produces, in `index.html`: `<input id="pick-sw" type="checkbox" checked>` labelled `Show switches that change`.
- Produces, in `tests/ui.mjs`: `until(page, fn, arg)` and `rowsShown(page, n)`.

**Implementer:** implementer

**What it does.**

- `replaySpan(focus)` is the stretch of the log on screen. The traces' layout and the request for rows both call it. Today it returns the focus's `w0` and `w1`. Nothing else in this task may read `w0`, `w1`, or a pull's `t0` and `t1` to decide what the rows cover.
- `syncSwitches` runs at the start of every `drawAll`. It makes a key from the log and the span. When the key is the one it last saw, it does nothing, so a replay that is playing asks for nothing. When the key is new it drops the rows on screen, because rows for another span must not be drawn against this one, and asks the core. An answer is used only if no newer request was made after it.
- The key does not hold By time or By RPM. The rows are kept through By RPM and are simply not drawn there, so the note can say they are hidden and By time shows them again at once.
- The checkbox is on unless the saved setting is exactly `false`. Settings saved before this feature have no entry and show the rows. With the box off there is no request and no rows.

- [ ] **Step 1: Check the branch**

```bash
export PATH="$HOME/.cargo/bin:$PATH"
git branch --show-current
```

Expected: `switch-rows`. If it prints anything else, run `git switch switch-rows` and check again. Never commit on `main`.

- [ ] **Step 2: Write the failing checks**

**`tests/ui.mjs`, in text an earlier task added.** Two more helpers, after `sameColour`.

Find:

```js
  const sameColour = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2);
```

Replace with:

```js
  const sameColour = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2);
  /** Waits for a condition in the page. Answers false, with no exception, when it does not come true. */
  const until = (page, fn, arg) =>
    page.waitForFunction(fn, arg, { timeout: 5000 }).then(
      () => true,
      () => false,
    );
  const rowsShown = (page, n) => until(page, n => window.__logViewer.swNow?.length === n, n);
```

**`tests/ui.mjs`, in text an earlier task added.** The checks on the first page, after the last check of the hand-made rows.

Find:

```js
  check('with no rows the traces take the height they had', drawn.height === bare.height && drawn.now === '', String(drawn.height));
```

Replace with:

```js
  check('with no rows the traces take the height they had', drawn.height === bare.height && drawn.now === '', String(drawn.height));

  // switch rows from the core. The default pull is run A already, so make another pull run A and come back: that focuses it.
  const asked = [];
  page.on('request', q => /\/api\/switches$/.test(q.url()) && asked.push(JSON.parse(q.postData())));
  await page.locator('.pull', { hasText: '3rd gear · 2,974' }).locator('button.r0').click();
  // the rows put in by hand were taken out above, so rows here are the core's answer for that pull
  await until(page, () => window.__logViewer.sw !== null);
  await page.locator('.pull', { hasText: '2,551–5,959' }).locator('button.r0').click();
  await rowsShown(page, 6);
  let pull = await replay(page);
  const names = (pull.rows || []).map(r => r.name);
  check(
    'the default pull shows the switches that change in it, in order of first change',
    names.join() ===
      'Decel Detected,Drive By Wire 1 Pin 1 Output State,Clutch State,Gear Upshift State,Stepper 1 Pin 2 Output State,Predicted MAP Active' &&
      pull.height === bare.height + SW.top + 6 * swPitch,
    names.join() + ' ' + pull.height,
  );
  // the clutch is the third row; its second change is the pedal coming back up
  const up = pull.rows?.[2]?.changes[1] ?? 0;
  const flip = [await playhead(page, up - 0.1), await playhead(page, up + 0.1)].map(now => now.split(',')[2]);
  check('the readout flips as the playhead crosses a change', flip.join() === 'On,Off', flip.join());
  await shot(page, '06c-switch-rows-pull', true);
  await page.click('#play');
  await page.waitForTimeout(400);
  await page.click('#play');
  check(
    'the rows are asked for once for each span, not on every frame',
    asked.length === 2 && asked[1].t0 === pull.w0 && asked[1].t1 === pull.w1,
    JSON.stringify(asked),
  );
  await page.click('[data-xmode="rpm"]');
  const byRpm = await replay(page);
  await page.click('[data-xmode="time"]');
  pull = await replay(page);
  check(
    'By RPM hides them, and By time shows them again without asking again',
    byRpm.now === '' &&
      byRpm.height === bare.height &&
      / By RPM hides the switch rows\.$/.test(byRpm.note) &&
      pull.now.split(',').length === 6 &&
      asked.length === 2,
    JSON.stringify([byRpm.now, byRpm.height, byRpm.note, pull.now, asked.length]),
  );
  // the rows follow the span on screen, whatever set it: narrow the span by hand and they are asked for again
  await page.evaluate(() => {
    const s = window.__logViewer;
    s.focus.w0 += 2;
    s.focus.w1 -= 2;
    s.rev++;
  });
  await page.click('[data-xmode="time"]');
  await rowsShown(page, 2);
  const narrow = await replay(page);
  check(
    'the rows follow the span on screen when it changes',
    asked.length === 3 &&
      asked[2].t0 === narrow.w0 &&
      asked[2].t1 === narrow.w1 &&
      (narrow.rows || []).map(r => r.name).join() === 'Stepper 1 Pin 2 Output State,Predicted MAP Active',
    JSON.stringify([asked.length, asked[2], (narrow.rows || []).map(r => r.name)]),
  );
  await page.locator('.log-head', { hasText: 'Back road' }).locator('button', { hasText: 'Replay' }).click();
  await rowsShown(page, 8);
  const whole = await replay(page);
  check(
    'a whole log shows eight rows and counts the rest',
    whole.more === 3 && / 3 more switches change in this span and are not shown\.$/.test(whole.note),
    whole.more + ' ' + whole.note,
  );

  // an answer that arrives after the user has moved to another span must not be drawn against that span
  let held = 0;
  await page.route('**/api/switches', async route => {
    if (!held++) await new Promise(r => setTimeout(r, 800));
    await route.continue();
  });
  await page.locator('.log-head', { hasText: '1:44 pm log' }).locator('button', { hasText: 'Replay' }).click();
  await page.locator('.log-head', { hasText: '1:42 pm log' }).locator('button', { hasText: 'Replay' }).click();
  await page.waitForTimeout(1200);
  await page.unroute('**/api/switches');
  const late = await replay(page);
  check(
    'rows that arrive late for another span are dropped',
    late.log === 'PCLog_2026-04-17_0142pm.csv' && late.rows?.length === 0 && late.height === bare.height,
    JSON.stringify([late.log, late.rows?.length, late.height]),
  );

  // the checkbox in Channels turns the rows off without asking the core
  await page.locator('.log-head', { hasText: 'Back road' }).locator('button', { hasText: 'Replay' }).click();
  await rowsShown(page, 8);
  const askedBefore = asked.length;
  const box = page.locator('#pick-sw');
  if (await box.count()) await box.uncheck();
  const off = await replay(page);
  check(
    'the checkbox in Channels turns the rows off',
    (await box.count()) === 1 && off.rows === null && off.now === '' && off.height === bare.height && asked.length === askedBefore,
    JSON.stringify([off.rows, off.now, off.height, asked.length - askedBefore]),
  );
```

**`tests/ui.mjs`, line 223.** The checks after the reload, before the saved-smoothing check.

Find:

```js
  // a saved smoothing level the app does not know falls back to Medium, also when it names something every object has
```

Replace with:

```js
  // the switch rows were turned off before the window closed: they stay off, and ticking the box brings them back
  const kept = await page.evaluate(() => ({
    box: document.getElementById('pick-sw')?.checked,
    rows: window.__logViewer.sw,
    now: window.__logViewer.swNow?.length,
  }));
  check('switch rows stay off after a reload', kept.box === false && kept.rows === null && kept.now === 0, JSON.stringify(kept));
  await page.click('#chan-btn');
  if (await page.locator('#pick-sw').count()) await page.check('#pick-sw');
  check('and come back when the box is ticked', await rowsShown(page, 6));
  // a switch added as a trace is drawn as a trace and keeps its row
  await page.fill('#pick-q', 'clutch state');
  const clutchTrace = page
    .locator('#pick-list .pk:not([hidden])', { has: page.locator('.nm[title="Clutch State"]') })
    .locator('button', { hasText: 'Trace' });
  await clutchTrace.click();
  const both = await replay(page);
  check(
    'a switch added as a trace keeps its row',
    both.height === bare.height + (TG.lab + TG.ph + TG.gap) + SW.top + 6 * swPitch && both.rows?.[2]?.name === 'Clutch State',
    both.height + ' ' + both.rows?.[2]?.name,
  );
  await clutchTrace.click();
  await page.fill('#pick-q', '');

  // a saved smoothing level the app does not know falls back to Medium, also when it names something every object has
```

**`tests/ui.mjs`, line 275.** The phone and tablet check now has the rows on screen.

Find:

```js
    await settle(page);
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      rail: getComputedStyle(document.querySelector('.rail')).position,
    }));
    check(name + ' layout fits', m.sw <= m.cw && m.rail === (width < 860 ? 'static' : 'sticky'), JSON.stringify(m));
```

Replace with:

```js
    await settle(page);
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

- [ ] **Step 3: Run the UI test and see the new checks fail**

```bash
npm run build && cargo build --release -p logviewer-dev && npm run test:ui 2>&1 | rg "^FAIL|checks|passed"
```

Expected, after about a minute (each wait for rows gives up after five seconds), each `FAIL` line going on to show what was read:

```text
FAIL the default pull shows the switches that change in it, in order of first change
FAIL the readout flips as the playhead crosses a change
FAIL the rows are asked for once for each span, not on every frame
FAIL By RPM hides them, and By time shows them again without asking again
FAIL the rows follow the span on screen when it changes
FAIL a whole log shows eight rows and counts the rest
FAIL rows that arrive late for another span are dropped
FAIL the checkbox in Channels turns the rows off
FAIL switch rows stay off after a reload
FAIL and come back when the box is ticked
FAIL a switch added as a trace keeps its row
FAIL phone layout fits, switch rows included
FAIL tablet layout fits, switch rows included
13 check(s) failed
```

- [ ] **Step 4: Give the traces and the rows one span**

**`src/state.ts`, line 208.** The one place that says which stretch of the log is on screen, after the `Focus` interface.

Find:

```ts
/** The channels behind a finding, shown in place of the user's view until they leave it. */
```

Replace with:

```ts
/** The stretch of the focused log the replay shows, in log seconds. The traces and the switch rows both read it here, so they always show the same stretch. */
export const replaySpan = (f: Focus): [number, number] => [f.w0, f.w1];

/** The channels behind a finding, shown in place of the user's view until they leave it. */
```

**`src/charts.ts`, line 4.** Import `replaySpan`.

Find:

```ts
import { $, RUN, S, chInfo, css, curTable, curView, fmt, hideTip, mix, niceStep, prep, series, showTip, theme } from './state';
```

Replace with:

```ts
import { $, RUN, S, chInfo, css, curTable, curView, fmt, hideTip, mix, niceStep, prep, replaySpan, series, showTip, theme } from './state';
```

**`src/charts.ts`, line 279.** The traces take their stretch of the log from `replaySpan`, in the By time branch of `trLayout`.

Find:

```ts
    spans.push({ log: f.log, i0: idxAt(f.log, f.w0), i1: Math.min(f.log.n - 1, idxAt(f.log, f.w1) + 1), first: true });
    x0 = f.w0;
    x1 = f.w1;
```

Replace with:

```ts
    [x0, x1] = replaySpan(f);
    spans.push({ log: f.log, i0: idxAt(f.log, x0), i1: Math.min(f.log.n - 1, idxAt(f.log, x1) + 1), first: true });
```

- [ ] **Step 5: Add the setting and the checkbox**

**`src/types.ts`, line 190.** The saved setting, at the end of `Settings`.

Find:

```ts
  watchDir?: string;
}
```

Replace with:

```ts
  watchDir?: string;
  /** "Show switches that change" in the Channels picker; on unless this is false */
  switches?: boolean;
}
```

**`src/state.ts`, in text an earlier task added.** The checkbox state, at the end of `S`.

Find:

```ts
  swNow: [] as string[],
};
```

Replace with:

```ts
  swNow: [] as string[],
  /** "Show switches that change" in the Channels picker */
  swShow: true,
};
```

**`index.html`, line 145.** The checkbox, in the first row of `#picker`, with the class the other one has.

Find:

```html
            <label class="chk"><input id="pick-chg" type="checkbox" checked> Hide channels that never change</label>
```

Replace with:

```html
            <label class="chk"><input id="pick-chg" type="checkbox" checked> Hide channels that never change</label>
            <label class="chk"><input id="pick-sw" type="checkbox" checked> Show switches that change</label>
```

- [ ] **Step 6: Ask for the rows, and wire the checkbox**

**`src/app.ts`, line 37.** Import `replaySpan`, in the list from './state'.

Find:

```ts
  pullName,
  resetTheme,
```

Replace with:

```ts
  pullName,
  replaySpan,
  resetTheme,
```

**`src/app.ts`, line 69.** Save the setting, in `collectSettings`.

Find:

```ts
    names: S.names,
    watchDir: S.watchDir,
  };
```

Replace with:

```ts
    names: S.names,
    watchDir: S.watchDir,
    switches: S.swShow,
  };
```

**`src/app.ts`, line 936.** Ask for the rows, from the one function every redraw goes through.

Find:

```ts
// ---------- frame loop ----------

function drawAll(): void {
  syncTransport();
```

Replace with:

```ts
// ---------- switch rows ----------

let swKey = '';
let swSeq = 0;

/** Ask the core for the switch rows of the span on screen. Runs on every draw and asks once per span. */
function syncSwitches(): void {
  const f = S.focus;
  const span = f && S.swShow ? replaySpan(f) : null;
  const key = f && span ? [f.log.key, ...span].join('|') : '';
  if (key === swKey) return;
  swKey = key;
  const seq = ++swSeq;
  // rows for another span must not be drawn against this one while the new rows are on their way
  S.sw = null;
  S.rev++;
  if (!f || !span) return;
  api.switches(f.log.key, span[0], span[1]).then(
    rows => {
      if (seq !== swSeq) return;
      S.sw = rows;
      S.rev++;
      drawAll();
    },
    e => {
      if (seq === swSeq) status('Switch rows failed: ' + errText(e));
    },
  );
}

// ---------- frame loop ----------

function drawAll(): void {
  syncSwitches();
  syncTransport();
```

**`src/app.ts`, line 1153.** The checkbox, in `wire`.

Find:

```ts
  input('pick-chg').addEventListener('change', filterPicker);
```

Replace with:

```ts
  input('pick-chg').addEventListener('change', filterPicker);
  input('pick-sw').addEventListener('change', () => {
    S.swShow = input('pick-sw').checked;
    saveSettings();
    drawAll();
  });
```

**`src/app.ts`, line 1429.** Read the setting, in `boot`.

Find:

```ts
  S.watchDir = typeof st.watchDir === 'string' ? st.watchDir : '';
```

Replace with:

```ts
  S.watchDir = typeof st.watchDir === 'string' ? st.watchDir : '';
  // on unless it was turned off: settings saved before the switch rows existed have no entry
  S.swShow = st.switches !== false;
  input('pick-sw').checked = S.swShow;
```

- [ ] **Step 7: Run the type check and the UI test and see them pass**

```bash
npx tsc --noEmit
npm run build && cargo build --release -p logviewer-dev && npm run test:ui 2>&1 | rg "^FAIL|checks|passed"
npx prettier --check "src/**/*.ts" tests
```

Expected: `tsc` prints nothing, the UI test prints `all checks passed`, Prettier prints `All matched files use Prettier code style!`.

`node tests/ui.mjs /tmp/shots` saves `06c-switch-rows-pull.png`, the default pull with its six rows.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/state.ts src/charts.ts src/app.ts index.html tests/ui.mjs
git commit -m "Replay: ask the core for switch rows; Show switches that change" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | tail -1
git status --short
```

Expected: the first command prints `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`, and `git status --short` lists no file this task touched. What it may still list is not part of the task: `?? .claude/`, `?? skills-lock.json`, and `?? docs/superpowers/plans/` if the plan is not committed yet.

### Task 5: Pointing at a row, and the notes

**Files:**
- Modify: `src/state.ts`
- Modify: `src/charts.ts` (lines 510)
- Modify: `src/app.ts` (lines 4, 1219, 1232, 1257)
- Modify: `README.md` (lines 63, 78, 85, 87, 122)
- Modify: `CLAUDE.md` (lines 11, 46, 49, 61)
- Modify: `docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md` (lines 3, 12, 18, 20, 46, 51)
- Test: `tests/ui.mjs` (in text Task 4 added)

**Interfaces:**
- Consumes, from Task 3, in `src/charts.ts`: `SW = { top: 10, lab: 14, bar: 8, gap: 4 }`, `const SW_PITCH = SW.lab + SW.bar + SW.gap`, `swBarY(L: TraceLayout, k: number): number` (y of the top of row `k`'s bar), `switchAt(row: SwitchRow, t: number): 'On' | 'Off' | '–'`, `TraceLayout.rows: SwitchRow[]` and `TraceLayout.swY: number`, the module's `trGeom: TraceLayout | null` (the layout last drawn), and in `drawTraces` the locals `L` (the layout), `top` (y of the top of the first trace), `ctx` and `th`.
- Consumes, from Task 4, in `src/app.ts`: `syncSwitches()`, which sets `S.sw = null` when the span changes. In `tests/ui.mjs`: `replay`, `xAt`, `barY`, `pixel`, `sameColour`, `TG`, and `ink2` (the `--ink-2` colour, read in Task 3's checks).
- Consumes, existing: in `src/app.ts`, the trace canvas's `pointerdown`, `pointermove` and `pointerleave` handlers in `wire()`, `traceLayout()` and `trX(e)` (the pointer's time) from `src/charts.ts`, `showTip(x, y, head, rows)` and `hideTip()` from `src/state.ts`, `S.hoverX`.
- Produces, in `src/state.ts`: `S.swHover: number | null`, the index of the row the pointer is on.
- Produces, in `src/charts.ts`: `export function switchRowAt(e: PointerEvent): number | null`.

**Implementer:** implementer

**What it does.**

- A row is its name and its bar, 26 px. While the pointer is on one, the tooltip shows the row's name, the time under the pointer with what the row reads there, and one `Also logged as` line for each other channel that reads the same.
- While the pointer is on a row, a 1 px line in `--ink-2` runs from the top of the first trace down to that row's bar at each of the row's changes. No other row draws lines, so the traces stay clean. The lines are drawn on every frame, not into the cached drawing.
- On a row there is no hover line and no tooltip of trace values. Pressing to scrub, leaving the canvas, or a new span clears the pointed-at row.
- Touch has no pointing: the existing handler returns early for touch, and that stays.

- [ ] **Step 1: Check the branch**

```bash
export PATH="$HOME/.cargo/bin:$PATH"
git branch --show-current
```

Expected: `switch-rows`. If it prints anything else, run `git switch switch-rows` and check again. Never commit on `main`.

- [ ] **Step 2: Write the failing checks**

**`tests/ui.mjs`, in text an earlier task added.** The checks, after the trace-and-row check.

Find:

```js
  await clutchTrace.click();
  await page.fill('#pick-q', '');
```

Replace with:

```js
  await clutchTrace.click();
  await page.fill('#pick-q', '');

  // pointing at a row: the other names of the switch in the tooltip, and a line through the traces at each of its changes
  const shown = await replay(page);
  const clutch = shown.rows?.[2];
  // one pixel under the top edge of the first trace: nothing else is drawn there
  const lineAt = t => pixel(page, xAt(shown, t), TG.lab + 1);
  const pointAt = y => page.locator('#tr-cv').hover({ position: { x: xAt(shown, shown.w0 + 3), y } });
  await pointAt(barY(shown, 2));
  const tip = await page.evaluate(() => (document.getElementById('tip').hidden ? '' : document.getElementById('tip').innerText));
  check(
    'pointing at a row lists the other names of the switch',
    /^Clutch State\s[\s\S]*Also logged as\s*AVI6 Switch State\s*Also logged as\s*Clutch Switch Input State/.test(tip),
    tip.replace(/\n/g, ' | '),
  );
  const lines = [];
  for (const t of clutch?.changes ?? []) lines.push(await lineAt(t));
  check(
    'and draws a line through the traces at each of its changes',
    lines.length === 4 && lines.every(p => sameColour(p, ink2)),
    JSON.stringify(lines),
  );
  // the upshift row changes 45 ms after the clutch does, six pixels along
  const other = await lineAt(shown.rows?.[3]?.changes[0] ?? 0);
  check('no other row draws its changes', !sameColour(other, ink2), JSON.stringify(other));
  await shot(page, '06d-switch-row-pointed');
  await pointAt(TG.lab + 20);
  const away = [await page.evaluate(() => window.__logViewer.swHover), await lineAt(clutch?.changes[0] ?? 0)];
  check('the lines go when the pointer moves up to the traces', away[0] === null && !sameColour(away[1], ink2), JSON.stringify(away));
```

- [ ] **Step 3: Run the UI test and see the new checks fail**

```bash
npm run build && cargo build --release -p logviewer-dev && npm run test:ui 2>&1 | rg "^FAIL|checks|passed"
```

Expected, each `FAIL` line going on to show what was read:

```text
FAIL pointing at a row lists the other names of the switch
FAIL and draws a line through the traces at each of its changes
FAIL the lines go when the pointer moves up to the traces
3 check(s) failed
```

"no other row draws its changes" already passes: no row draws lines yet.

- [ ] **Step 4: Find the row under the pointer, and draw its lines**

**`src/state.ts`, in text an earlier task added.** The row the pointer is on, at the end of `S`.

Find:

```ts
  swShow: true,
};
```

Replace with:

```ts
  swShow: true,
  /** index of the switch row the pointer is on */
  swHover: null as number | null,
};
```

**`src/charts.ts`, in text an earlier task added.** Which row is under the pointer, above `switchNote`.

Find:

```ts
/** What the note under the traces says about the switch rows. */
```

Replace with:

```ts
/** Index of the switch row under the pointer, or null. A row is its name and its bar. */
export function switchRowAt(e: PointerEvent): number | null {
  const L = trGeom;
  if (!L || !L.rows.length) return null;
  const y = e.clientY - $('tr-cv').getBoundingClientRect().top - L.swY - SW.top;
  const k = Math.floor(y / SW_PITCH);
  return y >= 0 && k < L.rows.length ? k : null;
}

/** What the note under the traces says about the switch rows. */
```

**`src/charts.ts`, line 510.** The lines, drawn on every frame, after the hover line and before the playhead.

Find:

```ts
  // playhead: run A's log in RPM mode, the focused log in time mode
```

Replace with:

```ts
  // the row the pointer is on marks each of its changes through the traces; no other row does, so the traces stay clean
  const pointed = S.swHover;
  if (pointed !== null && L.rows[pointed]) {
    ctx.strokeStyle = th.ink2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const t of L.rows[pointed].changes) {
      const x = Math.round(L.X(t)) + 0.5;
      ctx.moveTo(x, top);
      ctx.lineTo(x, swBarY(L, pointed) + SW.bar);
    }
    ctx.stroke();
  }
  // playhead: run A's log in RPM mode, the focused log in time mode
```

- [ ] **Step 5: Wire the pointer**

**`src/app.ts`, line 4.** Import `switchAt` and `switchRowAt`. The line is now over Prettier's 140 columns, so it is one name a line.

Find:

```ts
import { atRunRpm, draw3d, drawDyno, drawTraces, dropTraceCache, dynoHover, t3Hover, tableScale, trX, traceLayout } from './charts';
```

Replace with:

```ts
import {
  atRunRpm,
  draw3d,
  drawDyno,
  drawTraces,
  dropTraceCache,
  dynoHover,
  switchAt,
  switchRowAt,
  t3Hover,
  tableScale,
  trX,
  traceLayout,
} from './charts';
```

**`src/app.ts`, in text an earlier task added.** When the rows go, so does the pointed-at row: its index would point into other rows.

Find:

```ts
  S.sw = null;
  S.rev++;
  if (!f || !span) return;
```

Replace with:

```ts
  S.sw = null;
  S.swHover = null;
  S.rev++;
  if (!f || !span) return;
```

**`src/app.ts`, line 1219.** Pressing to scrub clears it, in the `pointerdown` handler of the trace canvas.

Find:

```ts
    S.hoverX = null;
    hideTip();
    scrub(e);
    drawAll();
  });
```

Replace with:

```ts
    S.hoverX = null;
    S.swHover = null;
    hideTip();
    scrub(e);
    drawAll();
  });
```

**`src/app.ts`, line 1232.** The `pointermove` handler of the trace canvas: on a row, the row's tooltip replaces the trace values.

Find:

```ts
    if (e.pointerType === 'touch') return;
    const x = trX(e);
    const th = theme();
```

Replace with:

```ts
    if (e.pointerType === 'touch') return;
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

**`src/app.ts`, line 1257.** Leaving the canvas clears it.

Find:

```ts
  tc.addEventListener('pointerleave', () => {
    S.hoverX = null;
    hideTip();
    drawTraces();
  });
```

Replace with:

```ts
  tc.addEventListener('pointerleave', () => {
    S.hoverX = null;
    S.swHover = null;
    hideTip();
    drawTraces();
  });
```

- [ ] **Step 6: Run the type check and the UI test and see them pass**

```bash
npx tsc --noEmit
npm run build && cargo build --release -p logviewer-dev && npm run test:ui 2>&1 | rg "^FAIL|checks|passed"
```

Expected: `tsc` prints nothing and the UI test prints `all checks passed`.

`node tests/ui.mjs /tmp/shots` saves `06d-switch-row-pointed.png`: the Clutch State row pointed at, its tooltip, and four lines through the traces.

- [ ] **Step 7: Write the notes**

`README.md`:

**`README.md`, line 63.** The layout.

Find:

```text
  src/findings.rs    detectors: what is wrong, why it matters, what to change
```

Replace with:

```text
  src/findings.rs    detectors: what is wrong, why it matters, what to change
  src/switches.rs    on/off channels and when they change, for the replay's switch rows
```

**`README.md`, line 78.** The commands.

Find:

```text
The UI asks for `logs`, `log_data`, `overview`, `dyno` and so on,
```

Replace with:

```text
The UI asks for `logs`, `log_data`, `overview`, `dyno`, `switches` and so on,
```

**`README.md`, line 85.** What the core tests cover.

Find:

```text
npm run test:core    # core against a snapshot from the real logs; library import, duplicates, watch folder
```

Replace with:

```text
npm run test:core    # core against a snapshot from the real logs; library import, duplicates, watch folder; switch rows
```

**`README.md`, line 87.** What the UI test covers.

Find:

```text
npm run test:ui      # drives the UI in a browser: import, dyno, findings, views, replay, phone and tablet widths
```

Replace with:

```text
npm run test:ui      # drives the UI in a browser: import, dyno, findings, views, replay, switch rows, phone and tablet widths
```

**`README.md`, line 122.** What to know about the numbers: a new bullet above the road-load one.

Find:

```text
- The virtual dyno is road-load math:
```

Replace with:

```text
- Under the replay traces, on/off channels are drawn as switch rows: a bar that is filled while the switch is on. NSP does not mark its switches, so the core reads them from the data: a channel is a switch when every sample it has in the log is exactly 0 or 1 and both occur. A switch gets a row when it changes inside the span on screen. Channels that read the same at every sample of that span share one row under the shortest name; pointing at the row lists the others and marks its changes on the traces. At most eight rows are shown, in order of first change, and the note under the traces counts the rest. A stretch with no samples is left empty. By RPM hides the rows. **Show switches that change** in Channels turns them off.
- The virtual dyno is road-load math:
```

`CLAUDE.md`:

**`CLAUDE.md`, line 11.** Commands.

Find:

```text
- `npm run test:core` — core against `crates/core/tests/golden.json` (snapshot from `testdata/logs`) plus library tests.
```

Replace with:

```text
- `npm run test:core` — core against `crates/core/tests/golden.json` (snapshot from `testdata/logs`) plus library and switch-row tests.
```

**`CLAUDE.md`, line 46.** Planned: the replay bullet says what is built and what is left.

Find:

```text
- Replay: show on/off and state channels as rows on the timeline instead of line graphs, appearing on their own for any switch that changes during the pull. Being designed, not built.
```

Replace with:

```text
- Replay: on/off channels are rows under the traces, appearing on their own for any switch that changes in the span on screen. Built from `docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md` by `docs/superpowers/plans/2026-10-04-replay-switch-rows.md`; seen in the browser test, not yet in the native window.
  The traces and the rows take the stretch of the log they show from `replaySpan` in `src/state.ts`, so a zoom changes one place.
  The website's replay screenshot predates the rows. `npm run site:shots` retakes it; the image gets taller, so its `height` in `site/index.html` must follow.
  Still to design: channels with a small set of states (gear, launch control state, active table). They need value labels the log does not carry, so they stay as traces.
```

**`CLAUDE.md`, line 49.** Planned: this line under the App UI pass bullet is out of date; delete it.

Delete this line:

```text
  Switch rows: design in `docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md`, waiting for review. Not built.
```

**`CLAUDE.md`, line 61.** Rules for this project: a new last rule.

Find:

```text
- Other ECUs (Link next) go in a module beside `haltech.rs`; the dyno and tables use only the channel roles in `log.rs`.
```

Replace with:

```text
- Other ECUs (Link next) go in a module beside `haltech.rs`; the dyno and tables use only the channel roles in `log.rs`.
- Switch rows: what is a switch, which channels share a row, the spans, the order and the limit of eight are decided in `crates/core/src/switches.rs`. `src/charts.ts` draws the spans the core returns and reads no samples for them. Their values are tested in `crates/core/tests/switches.rs`, not in the golden snapshot.
```

The spec, `docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md`. These record what was built where it differs from the design; nothing else in the spec changes.

**`docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md`, line 3.** The status line.

Find:

```text
Status: design, waiting for review. Nothing here is built.
```

Replace with:

```text
Status: built, by `docs/superpowers/plans/2026-10-04-replay-switch-rows.md`. Four things were settled while building and are marked "As built" below.
```

**`docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md`, line 12.** Why: what the sample logs show.

Find:

```text
(Clutch State, AVI6 Switch State and Clutch Switch Input State are identical sample for sample).
```

Replace with:

```text
(Clutch State, AVI6 Switch State and Clutch Switch Input State are identical sample for sample).

As built: those three channels read the same through the default pull, but across a whole log they part by one sample at a few changes
(8.4 s, 26.6 s and 37.7 s of the 1:45 pm log). Channels are therefore compared across the span on screen, not the whole log.
```

**`docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md`, line 18.** What the user sees: the label.

Find:

```text
- A row is a label on the left, a bar across the time axis that is filled while the switch is on, and `On` or `Off` at the playhead on the right.
```

Replace with:

```text
- A row is a label on the left, a bar across the time axis that is filled while the switch is on, and `On` or `Off` at the playhead on the right.
  (As built: the gutter left of the traces is 46 px, too narrow for a channel name, so the label sits on its own line above the bar, left-aligned, as the trace labels do.)
```

**`docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md`, line 20.** What the user sees: sharing a row.

Find:

```text
- Signals that are identical across the whole log share one row. The row carries the shortest name; the tooltip lists the others.
```

Replace with:

```text
- Signals that read the same at every sample of the span on screen share one row. The row carries the shortest name; the tooltip lists the others.
  (As built. The design said "identical across the whole log"; see Why.)
```

**`docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md`, line 46.** How it is built: the reply.

Find:

```text
  Finding the switch channels and grouping identical ones is done once per log and kept with it.
```

Replace with:

```text
  Finding the switch channels and grouping identical ones is done once per log and kept with it.
  (As built: the reply is `{ rows: [{ name, also, on, gaps, changes }], more }`. `more` counts rows, so it sits beside them. `changes` lists the times of the changes,
  which the UI needs for the lines it draws and cannot work out from spans that were clipped. Finding the switch channels is done once per log; grouping is done per span.)
```

**`docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md`, line 51.** How it is built: the styles.

Find:

```text
- `index.html`, `src/styles.css`: the checkbox, and the row label and readout styles.
```

Replace with:

```text
- `index.html`, `src/styles.css`: the checkbox, and the row label and readout styles.
  (As built: the label and the readout are drawn on the canvas with the theme's colours, as the trace labels and values are, so `src/styles.css` did not change.)
```

- [ ] **Step 8: Run everything**

```bash
cargo test --release -p logviewer-core --no-fail-fast 2>&1 | rg "Running|test result"
npm run build && cargo build --release -p logviewer-dev && npm run test:ui 2>&1 | rg "^FAIL|checks|passed"
npx tsc --noEmit
npx prettier --check "src/**/*.ts" tests
cargo fmt --check
cargo clippy --release -p logviewer-core -- -D warnings
git status --short crates/core/tests/golden.json src/styles.css src-tauri crates/devserver
```

Expected: every `test result` line says `ok` (19, 1, 3, 6 and 6 passed), the UI test prints `all checks passed`, `tsc` and `cargo fmt --check` print nothing, Prettier prints `All matched files use Prettier code style!`, Clippy ends with `Finished` and no warning, and the last command prints nothing: the golden snapshot, the stylesheet and the two shells are untouched.

- [ ] **Step 9: Commit**

```bash
git add src/state.ts src/charts.ts src/app.ts tests/ui.mjs README.md CLAUDE.md docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md
git commit -m "Replay: point at a switch row for its other names and its changes; notes" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | tail -1
git status --short
```

Expected: the first command prints `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`, and `git status --short` lists no file this task touched. What it may still list is not part of the task: `?? .claude/`, `?? skills-lock.json`, and `?? docs/superpowers/plans/` if the plan is not committed yet.
