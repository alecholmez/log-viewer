# Switch Rows Fixes Implementation Plan

> **For agentic workers:** Execute this plan with the owner's `convergence-loop` skill, task by task. Never use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the switch rows' open issues: group channels that are one signal once per log (issues 1 and 6), keep state channels out by the range the log's header declares (issue 3), clear a failed request's message (issue 5), pin more sample pulls (issue 8, core part), and bring the notes up to date (issue 7).

**Architecture:** The NSP parser keeps each channel's `DisplayMaxMin` as a range, and `Log` holds it in engineering units next to `types`. `crates/core/src/switches.rs` takes a channel as a switch only when its samples are 0 and 1 and its declared range, if any, lies within 0 to 2. It then groups the log's switches once, by their changes across the whole log, and keeps the groups on the log. A group's row is built from its shortest-named channel alone and appears for a span when that channel changes in it. In the UI, only `syncSwitches` in `src/app.ts` changes: rows that arrive clear the "Switch rows failed: …" message.

**Tech Stack:** Rust 2021 (`logviewer-core`: serde, serde_json), TypeScript 5.9 on canvas 2D with no framework, Vite 7, Playwright (Chromium) for the UI test, Prettier and rustfmt. The Tauri shell and `logviewer-dev` forward `dispatch` and need no change.

**Spec:** docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md, together with GitHub issues 1, 3, 5, 6, 7 and 8 (`gh issue view N`) and the owner's decisions recorded below under "Decisions this plan carries out".

## Global Constraints

- Numbers: all numbers are computed in `crates/core`; the UI only formats and draws. For switch rows that means what is a switch, which channels are one signal, spans, gaps, change times, ordering and the row limit are core work, and the UI reads no samples.
- Commands: every platform goes through `Session::dispatch` (`crates/core/src/session.rs`). This plan adds no command and changes no reply shape: the reply stays `{ rows: [{ name, also, on, gaps, changes }], more }`.
- NaN: `!(x > y)` style comparisons in the core are deliberate. They are also true for NaN, which is a missing sample. Keep them (`if !(t0 <= t1)` in `switches`).
- Copy: UI copy is minimal and direct, with no metaphors or analogies. The status text `Switch rows failed: ` stays word for word.
- Golden snapshot: do not refresh `crates/core/tests/golden.json` and never run with `UPDATE_GOLDEN=1`. The golden test must pass unchanged after every task. If it fails, stop and report it: nothing in this plan should change what it sees.
- TDD: every task writes a failing test first, runs it and sees the failure this plan states, writes the minimal code, and runs it again to see it pass.
- Shell: run `export PATH="$HOME/.cargo/bin:$PATH"` first in every shell.
- Core tests: `cargo test --release -p logviewer-core --no-fail-fast`
- UI test: `npm run build && cargo build --release -p logviewer-dev && npm run test:ui`. It starts its own server on port 1439 and stops with "Port 1439 is in use" if an earlier run left one behind. It needs Playwright's Chromium (`npx playwright install chromium`).
- Type check: `npx tsc --noEmit`
- Formatting and lint: `npx prettier --check "src/**/*.ts" tests`, `cargo fmt --check`, `cargo clippy --release -p logviewer-core --all-targets -- -D warnings`
- Not touched: the drawing and pointer code for the rows in `src/charts.ts`, the pointer handlers in `src/app.ts`, `crates/core/tests/golden.json`, `src-tauri`, `crates/devserver`, `src/styles.css`, `site/`. The display is being redesigned separately. In the UI only `syncSwitches` changes, and `tests/ui.mjs` gains the check for it and the one expectation the new core rules change.
- Branch: every commit goes on the feature branch `switch-fixes`, never on `main`. Do not push and do not merge.
- Commits: each task ends with one commit whose message ends with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stage the files the task names, by name, never `git add -A` or `git add .`: the working tree holds untracked `.claude/`, `skills-lock.json`, other untracked notes, and this plan until the owner commits it. None of them is part of a task's commit.
- Search: `rg` and `fd`, never `grep` or `find`.

## Review Focus

- A state channel that declares `2,0` and reads only 0 and 1 in one log is taken for a switch there (Drive By Wire Throttle Motor Direction in the 1:36 pm log). The owner accepted this limit. It is pinned so that a later change sees it: Task 1, `a_state_that_declares_0_to_2_and_reads_0_and_1_is_still_a_switch`.
- Grouping is a transitive closure: two channels two samples apart are one signal if a third sits between them. Expected: one row whatever the channel order, built from the shortest name. Pinned in Task 2, `grouping_is_transitive_and_does_not_depend_on_channel_order`. On the sample logs, four channels that each change once at the same moment group in the 1:55 pm log (Thermofan 2 Output State with Thermofan 1 Idle Up Active, Thermofan 2 Idle Up Active and Digital Pulse Output 2 Output State). The rule says they are one signal. The reviewer should know this.
- Missing samples: two channels missing at different samples must never group, so a row never depends on channel order (issue 6). Pinned in Task 2, `channels_missing_at_different_samples_are_two_rows_in_either_order`. No sample log has a missing switch sample.
- A header with no `DisplayMaxMin` for a channel, or one that is not two numbers: the samples alone decide. Pinned in Task 1, `the_declared_range_is_kept_with_its_channel` (parsed as `None`) and `a_channel_that_declares_a_range_wider_than_0_to_2_is_not_a_switch` (the `No range` channel).
- Rows that arrive must clear only their own failure message. An import message or any other status must stay. Pinned in Task 3, "rows that arrive leave any other message alone".

---

## Decisions this plan carries out

The owner made these calls. They bind every task.

1. **Issue 1, which channels are one signal.** Channels are grouped once per log, not per span. Two switch channels are one signal when they start in the same state, change the same number of times, and each pair of corresponding changes goes the same way and is at most one sample apart. A group is the transitive closure of that relation, so it never depends on channel order. Channels with missing samples group only when they are missing at the same samples. The groups are computed once and kept with the log.
   - A group's row is built from one channel alone: the member with the shortest name, ties broken by name order. Its `on`, `gaps` and `changes` come from that channel only. `also` lists the other members, shortest name first.
   - A row appears for a span when its named channel changes inside the span. Rows are ordered by that channel's first change in the span, then by name. The limit stays `MAX_ROWS` (8), with `more` counting the rest.
2. **Issue 6** goes away once a row is built from one channel. The issue's two cases become library tests, and the doc comment claiming that every member agrees on `on` and `gaps` goes.
3. **Issue 3, what is a switch.** The NSP header gives a channel a line `DisplayMaxMin : max,min`. The parser keeps that range with the channel. A channel is a switch only when every sample it has in the log is 0 or 1, both occur, and its declared range lies within 0 to 2 (min at least 0, max at most 2). A channel with no declared range is decided by its samples alone.
4. **Issue 5.** `syncSwitches` clears the "Switch rows failed: …" status when rows arrive. Its comment says that a failed request is not retried until the span, the log or the checkbox changes. A UI check aborts one `/api/switches` request and then sees the message go when rows arrive.
5. **Issue 8, core part only.** Command tests on two more sample pulls, the 1:46 pm 3rd gear pull and the 1:44 pm 2nd gear pull. The 1.5 s padding in `default_pull` becomes a named constant. The UI items of issue 8 are not in this plan.
6. **Issue 7 and the notes.** These are brought up to date with the new rules: the doc comments in `switches.rs`, on `SwitchRow` in `src/types.ts` and on `api.switches`, the switch rows lines in `README.md` and `CLAUDE.md`, the spec, and the top of the earlier plan. The `switchRowAt` doc comment in `src/charts.ts`, also named in issue 7, is not touched: `src/charts.ts` is out of bounds for this plan, so that point of the issue stays open.

Decided by this plan:

- The declared range is scaled with the channel's `Type`, like its samples, so both are in engineering units. Every switch in the sample logs is of type `Raw` (scale 1), so the sample logs show no difference.
- `default_pull` and the new pull helper keep the span inside the log (`max(0)`, `min(duration)`), as `focusPull` in `src/state.ts` does. The default pull needs no clamp. The 1:46 pm pull starts 0.672 s into its log and is clamped to 0.
- The UI check that counted the rows left out of the whole Back road log (the 1:45 pm log, renamed in the test) loses that point: across the whole log the clutch is now one row, eight signals change, and none is left out. The note for rows left out is still checked with the hand-made rows, and on real data by the core test on the whole 1:44 pm log.
- The UI expectation that changes moves in Task 2, together with the core change that changes it. That way the UI test passes after every commit.

## What was checked on the sample logs

The code in this plan was run on a scratch copy of the repository at commit 8ff8ada, task by task: core tests, golden test, rustfmt, clippy with `--all-targets`, the type check, Prettier and the full UI test. The red and green results quoted in the tasks come from that run.

- `DisplayMaxMin` is present for 491 of the 509 channels in every sample log, written as `max,min` in raw units.
- Switches under the old rule: 22 names across the eight logs. Under the new rule: 20. O2 Control State (`524288,0`) and Diagnostic ratiometric voltage reference error (`4096,-4096`) are out. Both were switches only in the 1:46 pm log. Every remaining switch declares `1,0` or `2,0` and is of type `Raw`.
- The 20 names are 12 signals: Clutch State, AVI6 Switch State and Clutch Switch Input State group in every log that has them (1:44, 1:45, 1:48, 1:55 pm). Brake Pedal State groups with Brake Pedal Switch 1 Input State. Stepper 1 Pin 2 Output State groups with Cam Control Switched Output State Intake. Thermofan 2 Output State groups with Thermofan 1 Idle Up Active, Thermofan 2 Idle Up Active and Digital Pulse Output 2 Output State. Thermofan 1 Output State groups with Stepper 1 Pin 3 Output State. The other seven are on their own.
- Drive By Wire Throttle Motor Direction declares `2,0`. It is still the only row of the 1:36 pm log, where it reads only 0 and 1.
- Default pull (1:45 pm, 2nd gear, 29.751 s to 36.41 s): the same six rows as before, in the same order. The clutch row is unchanged: built from Clutch State alone, it is on from 29.963 s to 31.206 s and from 34.96 s to 35.777 s.
- Narrowed default pull (31.751 s to 34.41 s): unchanged, two rows.
- 1:46 pm 3rd gear pull (0 s to 4.271 s): before, five rows, with "O2 Control State" under Decel Detected and the cam output as two rows. After, four rows: Decel Detected (no `also`), Drive By Wire 1 Pin 1 Output State, Predicted MAP Active, Stepper 1 Pin 2 Output State (also Cam Control Switched Output State Intake).
- 1:44 pm 2nd gear pull at 12.1 s (10.593 s to 17.782 s): before, five rows with the clutch twice (Clutch State also AVI6 Switch State, and Clutch Switch Input State on its own). After, four rows with the clutch once, carrying both names.
- Whole 1:45 pm log (0 s to 45.384 s): before, eight rows, three left out, every row with an empty `also`. After, eight rows and none left out.
- Whole 1:44 pm log (0 s to 75.441 s): nine signals change, so eight rows and one left out.
- The 1:42 pm log still has no switch that changes.
- Under the old per-span rule the clutch showed twice in three of the ten sample pulls (1:44 pm 2nd gear at 12.1 s, 1:45 pm 1st gear, 1:45 pm 3rd gear). With the new rule it shows once in all of them.

## Files

| File | Task | What changes |
| --- | --- | --- |
| `crates/core/src/haltech.rs` | 1 | `RawLog.ranges`, `display_range`, the parser reads `DisplayMaxMin`; a unit test |
| `crates/core/src/log.rs` | 1, 2 | `Log.ranges` in engineering units; a unit test; the per-log store holds groups |
| `crates/core/src/switches.rs` | 1, 2 | the range in what is a switch; grouping once per log; rows from one channel; doc comments; unit tests |
| `crates/core/tests/switches.rs` | 1, 2 | `PULL_PAD`, `replay_span`, `pull`; tests on the 1:46 pm, 1:44 pm and 1:36 pm logs; expectations on the whole logs |
| `tests/ui.mjs` | 2, 3 | the whole-log expectation; the failed-request checks |
| `src/app.ts` | 3 | `syncSwitches` clears its failure message, and its comment |
| `src/types.ts`, `src/api.ts` | 4 | doc comments |
| `README.md`, `CLAUDE.md`, the spec, the earlier plan | 4 | the notes |

---

### Task 1: The declared range decides what is a switch

**Implementer:** implementer

**Files:**
- Modify: `crates/core/src/haltech.rs` (`RawLog`, `parse_nsp_csv`, new `display_range`, new test module at the end)
- Modify: `crates/core/src/log.rs` (`Log` gains `ranges`; `Log::from_raw`; new test module at the end)
- Modify: `crates/core/src/switches.rs` (`is_switch` split in two, `all`, test helpers, one unit test)
- Test: `crates/core/tests/switches.rs`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `pub ranges: Vec<Option<[f64; 2]>>` on `haltech::RawLog` (raw units, `[min, max]`, one per channel) and on `log::Log` (engineering units, `[min, max]`, one per channel). `fn is_switch(a: &[f64], range: Option<[f64; 2]>) -> bool` in `switches.rs`. In `crates/core/tests/switches.rs`: `const PULL_PAD: f64 = 1.5`, `fn replay_span(s: &mut Session, pull: &Value) -> (String, f64, f64)`, `fn pull(s: &mut Session, key: &str) -> (String, f64, f64)`. In the `switches.rs` unit tests: `type Declared<'a> = (&'a str, Option<[f64; 2]>, &'a [f64])` and `fn declared(channels: &[Declared]) -> Log`. Task 2 uses all of these.

- [ ] **Step 0: Branch**

```bash
git checkout main
git checkout -b switch-fixes
```

- [ ] **Step 1: Write the failing tests**

Append to the end of `crates/core/src/haltech.rs`:

```rust

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_declared_range_is_kept_with_its_channel() {
        let text = "%DataLog%\n\
            Channel : RPM\nID : 1\nType : EngineSpeed\nDisplayMaxMin : 20000,0\n\
            Channel : No range\nID : 2\nType : Raw\n\
            Channel : Error\nID : 3\nType : Raw\nDisplayMaxMin : 4096,-4096\n\
            Channel : Not numbers\nID : 4\nType : Raw\nDisplayMaxMin : high,low\n\
            12:00:00.000,3000,0,1,0\n";
        let raw = parse_nsp_csv(text, "t.csv").unwrap();
        // NSP writes the maximum first; the range is kept as [min, max]
        assert_eq!(
            raw.ranges,
            [Some([0.0, 20000.0]), None, Some([-4096.0, 4096.0]), None]
        );
    }
}
```

Append to the end of `crates/core/src/log.rs`:

```rust

#[cfg(test)]
mod tests {
    use super::Log;
    use crate::haltech::parse_nsp_csv;

    #[test]
    fn a_declared_range_is_scaled_like_the_samples() {
        let text = "%DataLog%\n\
            Channel : RPM\nType : EngineSpeed\nDisplayMaxMin : 20000,0\n\
            Channel : Vehicle Speed\nType : Speed\nDisplayMaxMin : 4000,0\n\
            Channel : Brake Pedal State\nType : Raw\nDisplayMaxMin : 2,0\n\
            Channel : Fuel Composition\nType : Percentage\nDisplayMaxMin : 1000,0\n\
            Channel : Memory Writes Pending\nType : Raw\n\
            12:00:00.000,3000,0,0,500,0\n";
        let log = Log::from_raw(parse_nsp_csv(text, "t.csv").unwrap()).unwrap();
        assert_eq!(
            log.ranges,
            [
                Some([0.0, 20000.0]),
                Some([0.0, 400.0]),
                Some([0.0, 2.0]),
                Some([0.0, 100.0]),
                None
            ]
        );
    }
}
```

In `crates/core/src/switches.rs`, in the test module, replace:

```rust
    /// The rows for the whole of a log.
    fn whole(log: &Log) -> Rows {
```

with:

```rust
    /// A channel's name, the range the log's header declares for it in engineering units, and its samples.
    type Declared<'a> = (&'a str, Option<[f64; 2]>, &'a [f64]);

    /// The same as `log`, with a declared range for each channel.
    fn declared(channels: &[Declared]) -> Log {
        let plain: Vec<(&str, &[f64])> = channels.iter().map(|(n, _, v)| (*n, *v)).collect();
        let mut l = log(&plain);
        // RPM and Vehicle Speed come first
        for (k, (_, range, _)) in channels.iter().enumerate() {
            l.ranges[2 + k] = *range;
        }
        l
    }

    /// The rows for the whole of a log.
    fn whole(log: &Log) -> Rows {
```

In the same test module, insert this test just before `fn missing_samples_make_a_gap_and_are_not_a_change` (keep that test's `#[test]` line under the new test):

```rust
    /// A state or a count can read only 0 and 1 in one log and still declare a wider range in the header.
    /// The switches in the sample logs declare `1,0` or `2,0`.
    #[test]
    fn a_channel_that_declares_a_range_wider_than_0_to_2_is_not_a_switch() {
        // on for one sample, two samples after the channel before it
        let on_at =
            |i: usize| -> Vec<f64> { (0..13).map(|k| if k == i { 1.0 } else { 0.0 }).collect() };
        let l = declared(&[
            // as O2 Control State and Diagnostic ratiometric voltage reference error declare in the sample logs
            ("O2 Control State", Some([0.0, 524_288.0]), &on_at(1)),
            ("Reference error", Some([-4096.0, 4096.0]), &on_at(3)),
            // as Clutch State and Brake Pedal State declare
            ("Clutch State", Some([0.0, 1.0]), &on_at(5)),
            ("Brake Pedal State", Some([0.0, 2.0]), &on_at(7)),
            // declares 0 to 2 and reads 0 and 1 here: a switch in this log, as Drive By Wire Throttle Motor Direction is
            ("Motor Direction", Some([0.0, 2.0]), &on_at(9)),
            // no range declared: the samples alone decide
            ("No range", None, &on_at(11)),
        ]);
        assert_eq!(
            names(&whole(&l)),
            [
                "Clutch State",
                "Brake Pedal State",
                "Motor Direction",
                "No range"
            ]
        );
    }
```

In `crates/core/tests/switches.rs`, replace the whole of `default_pull` and the comment above it:

```rust
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
```

with:

```rust
/// Seconds shown either side of a pull. Copies the UI's rule for the span of a pull (`focusPull` in `src/state.ts`).
const PULL_PAD: f64 = 1.5;

/// A pull's log and the span the replay shows for it: the pull with `PULL_PAD` either side, kept inside the log,
/// as the UI does.
fn replay_span(s: &mut Session, pull: &Value) -> (String, f64, f64) {
    let log = pull["logKey"].as_str().unwrap().to_string();
    let logs = call(s, "logs", json!({})).unwrap();
    let meta = logs.as_array().unwrap().iter().find(|l| l["key"] == log);
    let duration = meta.unwrap()["duration"].as_f64().unwrap();
    let (t0, t1) = (pull["t0"].as_f64().unwrap(), pull["t1"].as_f64().unwrap());
    (log, (t0 - PULL_PAD).max(0.0), (t1 + PULL_PAD).min(duration))
}

/// The pull the app opens on: the one with the largest RPM gain.
fn default_pull(s: &mut Session) -> (String, f64, f64) {
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
fn pull(s: &mut Session, key: &str) -> (String, f64, f64) {
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

In `the_default_pull_gets_its_rows_in_order_of_first_change`, replace:

```rust
    assert_eq!((t0, t1), (31.251 - 1.5, 34.91 + 1.5));
```

with:

```rust
    assert_eq!((t0, t1), (31.251 - PULL_PAD, 34.91 + PULL_PAD));
```

Insert these two tests just before `fn a_log_with_no_switch_that_changes_has_no_rows` (above its `#[test]` line):

```rust
/// O2 Control State reads only 0 and 1 in the 1:46 pm log, as Decel Detected does, but declares `524288,0`.
/// Diagnostic ratiometric voltage reference error reads 0 and 1 there too and declares `4096,-4096`. Neither is a switch.
#[test]
fn the_1_46_pm_3rd_gear_pull_has_no_state_channel_in_its_rows() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let (log, t0, t1) = pull(&mut s, "PCLog_2026-04-17_0146pm.csv|20260417 01:46:49@0.7");
    assert_eq!((t0, t1), (0.0, 2.771 + PULL_PAD));
    let reply = rows(&mut s, &log, t0, t1);
    assert_eq!(reply["rows"][0]["name"], "Decel Detected");
    assert_eq!(reply["rows"][0]["also"], json!([]));
    let text = reply.to_string();
    assert!(
        !text.contains("O2 Control State") && !text.contains("Diagnostic"),
        "{text}"
    );
}

/// Drive By Wire Throttle Motor Direction declares `2,0` and reads 0, 1 and 2 in most sample logs. In the 1:36 pm log
/// it reads only 0 and 1, so it is a switch there. A known limit of the rule: the header cannot tell it from a switch.
#[test]
fn a_state_that_declares_0_to_2_and_reads_0_and_1_is_still_a_switch() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let log = log_key(&mut s, "PCLog_2026-04-17_0136pm.csv");
    let reply = rows(&mut s, &log, 0.0, 69.743);
    assert_eq!(names(&reply), ["Drive By Wire Throttle Motor Direction"]);
}
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cargo test --release -p logviewer-core --lib`
Expected: does not compile, with `error[E0609]: no field `ranges` on type `RawLog`` (haltech test) and twice `error[E0609]: no field `ranges` on type `log::Log`` (log test and the `declared` helper).

Run: `cargo test --release -p logviewer-core --test switches`
Expected: `the_1_46_pm_3rd_gear_pull_has_no_state_channel_in_its_rows ... FAILED` with `left: Array [String("O2 Control State")]`, `right: Array []`. The other seven pass, including `a_state_that_declares_0_to_2_and_reads_0_and_1_is_still_a_switch`, which pins behaviour that does not change.

- [ ] **Step 3: Keep the declared range when parsing**

In `crates/core/src/haltech.rs`, in `pub struct RawLog`, replace:

```rust
    pub types: Vec<String>,
    /// milliseconds from the first row
```

with:

```rust
    pub types: Vec<String>,
    /// per channel, the header's `DisplayMaxMin` as [min, max] in raw units; None when the header gives none
    pub ranges: Vec<Option<[f64; 2]>>,
    /// milliseconds from the first row
```

Replace:

```rust
/// Parse a Haltech NSP "PCLog" CSV export, keeping every channel.
```

with:

```rust
/// `DisplayMaxMin : max,min` as [min, max]. None when it is not two numbers.
fn display_range(val: &str) -> Option<[f64; 2]> {
    let (max, min) = val.split_once(',')?;
    Some([min.trim().parse().ok()?, max.trim().parse().ok()?])
}

/// Parse a Haltech NSP "PCLog" CSV export, keeping every channel.
```

In `parse_nsp_csv`, replace:

```rust
    let mut types: Vec<String> = Vec::new();
    let mut start = String::new();
```

with:

```rust
    let mut types: Vec<String> = Vec::new();
    let mut ranges: Vec<Option<[f64; 2]>> = Vec::new();
    let mut start = String::new();
```

Replace:

```rust
                types.push("Raw".to_string());
            }
```

with:

```rust
                types.push("Raw".to_string());
                ranges.push(None);
            }
```

Replace:

```rust
            "Log" => start = val.to_string(),
```

with:

```rust
            "DisplayMaxMin" => {
                if let Some(last) = ranges.last_mut() {
                    *last = display_range(val);
                }
            }
            "Log" => start = val.to_string(),
```

At the end of `parse_nsp_csv`, replace:

```rust
        names,
        types,
        t_ms,
```

with:

```rust
        names,
        types,
        ranges,
        t_ms,
```

- [ ] **Step 4: Hold the range on the log in engineering units**

In `crates/core/src/log.rs`, in `pub struct Log`, replace:

```rust
    pub types: Vec<String>,
    pub cols: Vec<Col>,
```

with:

```rust
    pub types: Vec<String>,
    /// per channel, the range the log's header declares, as [min, max] in engineering units; None when it declares none
    pub ranges: Vec<Option<[f64; 2]>>,
    pub cols: Vec<Col>,
```

In `Log::from_raw`, replace:

```rust
        Ok(Log {
            key: format!("{}|{}", raw.name, raw.start),
```

with:

```rust
        let ranges = (raw.ranges.iter().zip(&raw.types))
            .map(|(range, ty)| {
                let (s, o, _, _) = type_info(ty);
                range.map(|[min, max]| [min * s + o, max * s + o])
            })
            .collect();
        Ok(Log {
            key: format!("{}|{}", raw.name, raw.start),
```

and replace:

```rust
            types: raw.types,
            cols: raw.cols,
```

with:

```rust
            types: raw.types,
            ranges,
            cols: raw.cols,
```

- [ ] **Step 5: Add the range to what is a switch**

In `crates/core/src/switches.rs`, replace:

```rust
/// 0 or 1 at every sample that is present, and both occur.
fn is_switch(a: &[f64]) -> bool {
```

with:

```rust
/// A switch: the range the log declares for it, if any, lies within 0 to 2, and its samples read 0 and 1.
fn is_switch(a: &[f64], range: Option<[f64; 2]>) -> bool {
    declares_on_off(range) && reads_on_off(a)
}

/// NSP declares `1,0` or `2,0` for a switch, and a wider range for a state or a count that can read only 0 and 1 in one log.
/// A log that declares no range leaves it to the samples.
fn declares_on_off(range: Option<[f64; 2]>) -> bool {
    range.is_none_or(|[min, max]| min >= 0.0 && max <= 2.0)
}

/// 0 or 1 at every sample that is present, and both occur.
fn reads_on_off(a: &[f64]) -> bool {
```

In `all`, replace:

```rust
            .filter(|&j| !log.is_const(j) && is_switch(log.chan_at(j)))
```

with:

```rust
            .filter(|&j| !log.is_const(j) && is_switch(log.chan_at(j), log.ranges[j]))
```

In the test module's `log_at`, replace:

```rust
            types: vec!["Raw".to_string(); names.len()],
            names,
```

with:

```rust
            types: vec!["Raw".to_string(); names.len()],
            ranges: vec![None; names.len()],
            names,
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `cargo test --release -p logviewer-core --no-fail-fast`
Expected: every test passes: 24 library tests, the golden test (1), and 8 in `switches`. The golden test passes unchanged.

Run: `cargo fmt --check && cargo clippy --release -p logviewer-core --all-targets -- -D warnings`
Expected: no output from rustfmt, and clippy finishes with no warning.

- [ ] **Step 7: Commit**

```bash
git add crates/core/src/haltech.rs crates/core/src/log.rs crates/core/src/switches.rs crates/core/tests/switches.rs
git commit -m "Switch rows: a channel that declares a range wider than 0 to 2 is not a switch

The NSP parser keeps each channel's DisplayMaxMin, and the log holds it in
engineering units. O2 Control State and Diagnostic ratiometric voltage
reference error read only 0 and 1 in the 1:46 pm log but declare wider
ranges, so they no longer show as switch rows. Fixes #3.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Group channels once per log; a row comes from one channel

**Implementer:** implementer

**Files:**
- Modify: `crates/core/src/switches.rs` (module doc, new `Group`, `Row` docs, new `first_reading`, `same_signal`, `group`; `all`, `Found`, `changing`, `switches`; `same` removed; unit tests)
- Modify: `crates/core/src/log.rs` (the per-log store holds `Group`s)
- Test: `crates/core/tests/switches.rs`, `tests/ui.mjs`

**Interfaces:**
- Consumes: `Log.ranges`, `is_switch(a, range)`, `PULL_PAD`, `pull(s, key)` from Task 1.
- Produces: `pub struct Group` in `switches.rs` (private fields `switch: Switch`, `name: String`, `also: Vec<String>`), stored as `pub(crate) switches: OnceLock<Vec<Group>>` on `Log`. `pub fn switches(log, t0, t1, limit) -> Rows` keeps its signature and reply shape.

- [ ] **Step 1: Write the failing tests**

In `crates/core/src/switches.rs`, in the test module, replace the whole test `channels_are_compared_across_the_span_not_the_whole_log` and its doc comment:

```rust
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
```

with:

```rust
    /// Channels are grouped once, across the whole log. Two that read the same inside a span but change a different
    /// number of times over the log are two signals in every span.
    #[test]
    fn channels_that_part_anywhere_in_the_log_are_two_rows_in_every_span() {
        let l = log(&[
            ("Clutch State", &[0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0]),
            (
                "AVI6 Switch State",
                &[0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0],
            ),
        ]);
        let r = switches(&l, 3.0, 7.0, MAX_ROWS);
        assert_eq!(names(&r), ["AVI6 Switch State", "Clutch State"]);
        assert_eq!(r.rows[0].also, Vec::<String>::new());
        assert_eq!(r.rows[1].also, Vec::<String>::new());
        assert_eq!(names(&whole(&l)), ["Clutch State", "AVI6 Switch State"]);
    }

    /// The sample logs hold the clutch under three names whose changes part by one sample here and there.
    #[test]
    fn channels_whose_changes_are_at_most_one_sample_apart_are_one_signal() {
        let l = log(&[
            (
                "AVI6 Switch State",
                &[0.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0, 0.0],
            ),
            ("Clutch State", &[0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0]),
        ]);
        let r = whole(&l);
        // the row is the shorter name's, and its spans and changes are that channel's alone
        assert_eq!(
            r.rows,
            [Row {
                name: "Clutch State".into(),
                also: vec!["AVI6 Switch State".into()],
                on: vec![[1.0, 3.0], [5.0, 7.0]],
                gaps: vec![],
                changes: vec![1.0, 3.0, 5.0, 7.0],
            }]
        );
        let r = switches(&l, 2.0, 4.0, MAX_ROWS);
        assert_eq!(names(&r), ["Clutch State"]);
        assert_eq!(r.rows[0].on, [[2.0, 3.0]]);
        assert_eq!(r.rows[0].changes, [3.0]);
    }

    /// A row appears for a span when the channel it is built from changes there, whatever the others in its group do.
    #[test]
    fn a_row_appears_only_when_its_named_channel_changes() {
        let l = log(&[
            (
                "AVI6 Switch State",
                &[0.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0, 0.0],
            ),
            ("Clutch State", &[0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0]),
        ]);
        // only AVI6 Switch State changes at 4 s
        assert_eq!(switches(&l, 3.5, 4.5, MAX_ROWS).rows, vec![]);
    }

    #[test]
    fn channels_that_start_apart_change_apart_or_change_more_are_two_signals() {
        #[rustfmt::skip]
        let l = log(&[
            // changes two samples after "Two apart"
            ("Two apart",    &[0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]),
            ("Two later",    &[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]),
            // changes when "Fan" does, but starts on
            ("Fan",          &[0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0]),
            ("Fan inverted", &[1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0]),
            // changes once more than "Pump"
            ("Pump",         &[1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0]),
            ("Pump twice",   &[1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0]),
        ]);
        let r = whole(&l);
        assert_eq!(
            names(&r),
            [
                "Two apart",
                "Two later",
                "Fan",
                "Fan inverted",
                "Pump",
                "Pump twice"
            ]
        );
        assert!(r.rows.iter().all(|row| row.also.is_empty()));
    }

    /// A is one sample from B and B one from C, so all three are one signal, though A and C are two samples apart.
    #[test]
    fn grouping_is_transitive_and_does_not_depend_on_channel_order() {
        let a: (&str, &[f64]) = (
            "Fan Output State",
            &[0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0],
        );
        let b: (&str, &[f64]) = (
            "Fan State",
            &[0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0],
        );
        let c: (&str, &[f64]) = ("Fan", &[0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0]);
        let want = Rows {
            rows: vec![Row {
                name: "Fan".into(),
                also: vec!["Fan State".into(), "Fan Output State".into()],
                on: vec![[4.0, 8.0]],
                gaps: vec![],
                changes: vec![4.0, 8.0],
            }],
            more: 0,
        };
        for order in [
            [a, b, c],
            [a, c, b],
            [b, a, c],
            [b, c, a],
            [c, a, b],
            [c, b, a],
        ] {
            assert_eq!(whole(&log(&order)), want, "{:?}", order.map(|ch| ch.0));
        }
    }

    /// Two channels missing at different samples are two signals, so neither row depends on which channel comes first.
    #[test]
    fn channels_missing_at_different_samples_are_two_rows_in_either_order() {
        let a: (&str, &[f64]) = ("A", &[1.0, X, X, 1.0, 0.0]);
        let b: (&str, &[f64]) = ("B", &[X, X, X, 1.0, 0.0]);
        let ab = switches(&log(&[a, b]), 0.5, 4.0, MAX_ROWS);
        assert_eq!(ab, switches(&log(&[b, a]), 0.5, 4.0, MAX_ROWS));
        assert_eq!(names(&ab), ["A", "B"]);
        assert_eq!(
            (ab.rows[0].on.clone(), ab.rows[0].gaps.clone()),
            (vec![[0.5, 4.0]], vec![[1.0, 3.0]])
        );
        assert_eq!(
            (ab.rows[1].on.clone(), ab.rows[1].gaps.clone()),
            (vec![[3.0, 4.0]], vec![[0.5, 3.0]])
        );

        let c: (&str, &[f64]) = ("C", &[0.0, 1.0, X, 1.0, 1.0, 0.0]);
        let d: (&str, &[f64]) = ("D", &[0.0, 1.0, 1.0, 1.0, 1.0, 0.0]);
        let cd = switches(&log(&[c, d]), 2.5, 5.0, MAX_ROWS);
        assert_eq!(cd, switches(&log(&[d, c]), 2.5, 5.0, MAX_ROWS));
        assert_eq!(names(&cd), ["C", "D"]);
        assert_eq!(cd.rows[0].gaps, [[2.5, 3.0]]);
        assert_eq!(cd.rows[1].gaps, Vec::<[f64; 2]>::new());
    }
```

Two existing tests used channels that the new rule would join into one signal. Change their data so that they keep testing what their names say. Both pass before and after the change.

In `rows_come_in_order_of_first_change_and_stop_at_the_limit`, replace:

```rust
        // ten switches, each on for one second; the higher the number, the earlier it changes
        let series: Vec<(String, Vec<f64>)> = (0..10)
            .map(|k| {
                let mut v = vec![0.0; 14];
                v[11 - k] = 1.0;
```

with:

```rust
        // ten switches, each on for one second, two seconds apart so that no two are one signal;
        // the higher the number, the earlier it changes
        let series: Vec<(String, Vec<f64>)> = (0..10)
            .map(|k| {
                let mut v = vec![0.0; 24];
                v[22 - 2 * k] = 1.0;
```

and, further down in the same test, replace:

```rust
        let r = switches(&l, 0.0, 13.0, 3);
```

with:

```rust
        let r = switches(&l, 0.0, 23.0, 3);
```

In `switches_that_first_change_together_are_ordered_by_name`, replace:

```rust
        let l = log(&[
            ("Decel", &[0.0, 1.0, 1.0, 0.0]),
            ("Brake", &[0.0, 1.0, 0.0, 0.0]),
        ]);
```

with:

```rust
        // their second changes are two samples apart, so they are two signals
        let l = log(&[
            ("Decel", &[0.0, 1.0, 1.0, 1.0, 0.0]),
            ("Brake", &[0.0, 1.0, 0.0, 0.0, 0.0]),
        ]);
```

In `crates/core/tests/switches.rs`, replace the whole test `a_whole_log_is_cut_at_eight_rows_and_says_how_many_are_left_out` and its doc comment:

```rust
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
```

with:

```rust
/// Across the whole of the same log the three clutch channels part by one sample at a few changes
/// (8.4 s, 26.6 s and 37.7 s). Their changes are never more than a sample apart, so they are one row there too.
#[test]
fn across_the_whole_1_45_pm_log_the_clutch_is_one_row() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let log = log_key(&mut s, "PCLog_2026-04-17_0145pm.csv");
    let reply = rows(&mut s, &log, 0.0, 45.384);
    assert_eq!(
        names(&reply),
        [
            "Stepper 1 Pin 2 Output State",
            "Predicted MAP Active",
            "Drive By Wire 1 Pin 1 Output State",
            "Clutch State",
            "Decel Detected",
            "Gear Upshift State",
            "AVI1 Switch State",
            "Brake Pedal State",
        ]
    );
    assert_eq!(reply["more"], 0);
    assert_eq!(
        reply["rows"][3]["also"],
        json!(["AVI6 Switch State", "Clutch Switch Input State"])
    );
    assert_eq!(
        reply["rows"][7]["also"],
        json!(["Brake Pedal Switch 1 Input State"])
    );
}

/// Nine switches change across the whole 1:44 pm log: eight rows, and one left out.
#[test]
fn a_whole_log_is_cut_at_eight_rows_and_says_how_many_are_left_out() {
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
        ]
    );
    assert_eq!(reply["more"], 1);
}

/// The clutch channels part by one sample in this pull: grouped per span they were two rows.
#[test]
fn the_1_44_pm_2nd_gear_pull_shows_the_clutch_once() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let (log, t0, t1) = pull(&mut s, "PCLog_2026-04-17_0144pm.csv|20260417 01:44:01@12.1");
    assert_eq!((t0, t1), (12.093 - PULL_PAD, 16.282 + PULL_PAD));
    let reply = rows(&mut s, &log, t0, t1);
    assert_eq!(
        names(&reply),
        [
            "Clutch State",
            "Drive By Wire 1 Pin 1 Output State",
            "Decel Detected",
            "Gear Upshift State",
        ]
    );
    assert_eq!(
        reply["rows"][0],
        json!({
            "name": "Clutch State",
            "also": ["AVI6 Switch State", "Clutch Switch Input State"],
            "on": [[10.61, 12.093], [16.323, 17.333]],
            "gaps": [],
            "changes": [10.61, 12.093, 16.323, 17.333],
        })
    );
}

/// The cam solenoid output is logged under two names. Grouped per span they were two rows in this pull.
#[test]
fn the_1_46_pm_3rd_gear_pull_shows_the_cam_output_once() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let (log, t0, t1) = pull(&mut s, "PCLog_2026-04-17_0146pm.csv|20260417 01:46:49@0.7");
    let reply = rows(&mut s, &log, t0, t1);
    assert_eq!(
        names(&reply),
        [
            "Decel Detected",
            "Drive By Wire 1 Pin 1 Output State",
            "Predicted MAP Active",
            "Stepper 1 Pin 2 Output State",
        ]
    );
    assert_eq!(
        reply["rows"][3]["also"],
        json!(["Cam Control Switched Output State Intake"])
    );
}
```

In `the_same_span_gives_the_same_answer_every_time`, replace:

```rust
    // another span in between: the switches found for the log are kept, the rows are not
```

with:

```rust
    // another span in between: the groups found for the log are kept, the rows are not
```

`clutch_state_carries_its_two_duplicates` and `the_default_pull_gets_its_rows_in_order_of_first_change` keep their values: the default pull gives the same six rows, and the clutch row built from Clutch State alone has the spans it had.

In `tests/ui.mjs`, replace:

```js
  await page.locator('.log-head', { hasText: 'Back road' }).locator('button', { hasText: 'Replay' }).click();
  await rowsShown(page, 8);
  const whole = await replay(page);
  check(
    'a whole log shows eight rows and counts the rest',
    whole.more === 3 && / 3 more switches change in this span and are not shown\.$/.test(whole.note),
    whole.more + ' ' + whole.note,
  );
```

with:

```js
  // across the whole log the clutch channels part by a sample at a few changes; they are still one row
  await page.locator('.log-head', { hasText: 'Back road' }).locator('button', { hasText: 'Replay' }).click();
  await rowsShown(page, 8);
  const whole = await replay(page);
  const wholeNames = (whole.rows || []).map(r => r.name).join();
  check(
    'a whole log shows the clutch once among its eight rows, and no note when none is left out',
    wholeNames ===
      'Stepper 1 Pin 2 Output State,Predicted MAP Active,Drive By Wire 1 Pin 1 Output State,Clutch State,Decel Detected,Gear Upshift State,AVI1 Switch State,Brake Pedal State' &&
      whole.more === 0 &&
      !/ more switch/.test(whole.note),
    wholeNames + ' ' + whole.more + ' ' + whole.note,
  );
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cargo test --release -p logviewer-core --no-fail-fast`
Expected: five library tests fail: `a_row_appears_only_when_its_named_channel_changes`, `channels_missing_at_different_samples_are_two_rows_in_either_order`, `channels_that_part_anywhere_in_the_log_are_two_rows_in_every_span`, `channels_whose_changes_are_at_most_one_sample_apart_are_one_signal`, `grouping_is_transitive_and_does_not_depend_on_channel_order`. Four command tests in `switches` fail: `a_whole_log_is_cut_at_eight_rows_and_says_how_many_are_left_out`, `across_the_whole_1_45_pm_log_the_clutch_is_one_row`, `the_1_44_pm_2nd_gear_pull_shows_the_clutch_once`, `the_1_46_pm_3rd_gear_pull_shows_the_cam_output_once`. The golden test passes.

Run: `npm run build && cargo build --release -p logviewer-dev && npm run test:ui`
Expected: `FAIL a whole log shows the clutch once among its eight rows, and no note when none is left out`. Its detail shows the old names, starting `Cam Control Switched Output State Intake`, then `3` and the note ` 3 more switches change in this span and are not shown.`

- [ ] **Step 3: Store groups on the log**

In `crates/core/src/log.rs`, replace:

```rust
use crate::switches::Switch;
```

with:

```rust
use crate::switches::Group;
```

and replace:

```rust
    /// the on/off channels, found on first use
    pub(crate) switches: OnceLock<Vec<Switch>>,
```

with:

```rust
    /// the on/off channels, grouped into signals, found on first use
    pub(crate) switches: OnceLock<Vec<Group>>,
```

- [ ] **Step 4: Group once per log and build each row from one channel**

In `crates/core/src/switches.rs`, replace the module doc's second paragraph:

```rust
//! NSP exports a switch as a plain number with no type that marks it, so a switch is found from its samples:
//! every sample that is present is exactly 0 or 1, and both occur. Which channels are switches is worked out
//! once per log and kept with it. Which of them change, and which read the same and change together, is answered for a span.
```

with:

```rust
//! NSP exports a switch as a plain number with no type that marks it, so a switch is found from its samples and the
//! log's header: every sample that is present is exactly 0 or 1, both occur, and the range the header declares for the
//! channel, if it declares one, lies within 0 to 2.
//!
//! The same signal is often logged under several names. Two switch channels are one signal when they start in the same
//! state, change as often, each pair of corresponding changes goes the same way at most one sample apart, and they are
//! missing at the same samples. A group is every channel linked to another by that rule, so it never depends on channel
//! order. Which channels are switches, and their groups, are worked out once per log and kept with it.
//!
//! A group's row is built from one channel alone, the member with the shortest name. It appears for a span when that
//! channel changes inside the span.
```

Replace `Row` and its doc comment:

```rust
/// One row of the replay: a switch that changes inside the span.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Row {
    /// the shortest name among the channels that read the same and change together across the span
    pub name: String,
    /// the other channels that read the same and change together across the span, shortest name first
    pub also: Vec<String>,
    /// [start, end] in log seconds while the switch is on, clipped to the span
    pub on: Vec<[f64; 2]>,
    /// [start, end] in log seconds with no samples, clipped to the span
    pub gaps: Vec<[f64; 2]>,
    /// log seconds of every change inside the span
    pub changes: Vec<f64>,
}
```

with:

```rust
/// The switch channels of a log that are one signal, and the channel their row is built from.
#[derive(Clone, Debug)]
pub struct Group {
    /// the member with the shortest name, ties broken by name order
    switch: Switch,
    name: String,
    /// the other members, shortest name first
    also: Vec<String>,
}

/// One row of the replay: a group whose named channel changes inside the span. Built from that channel alone.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Row {
    /// the channel the row is built from: the shortest name in its group, ties broken by name order
    pub name: String,
    /// the other channels in its group, shortest name first. Their changes can be a sample off the named channel's.
    pub also: Vec<String>,
    /// [start, end] in log seconds while the named channel is on, clipped to the span.
    /// One that starts on the last sample of the span has no length.
    pub on: Vec<[f64; 2]>,
    /// [start, end] in log seconds where the named channel has no samples, clipped to the span
    pub gaps: Vec<[f64; 2]>,
    /// log seconds of every change of the named channel inside the span
    pub changes: Vec<f64>,
}
```

Replace `all` and `same`:

```rust
/// Every switch channel of the log, in channel order. Found on first use and kept with the log.
fn all(log: &Log) -> &[Switch] {
    log.switches.get_or_init(|| {
        (0..log.names.len())
            .filter(|&j| !log.is_const(j) && is_switch(log.chan_at(j), log.ranges[j]))
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
```

with:

```rust
/// The first reading that is present.
fn first_reading(a: &[f64]) -> f64 {
    a.iter().copied().find(|v| !v.is_nan()).unwrap_or(f64::NAN)
}

/// Two switch channels are one signal: they are missing at the same samples, start in the same state, change as often,
/// and each pair of corresponding changes goes the same way at most one sample apart.
fn same_signal(a: &Switch, ra: &[f64], b: &Switch, rb: &[f64]) -> bool {
    ra.iter().zip(rb).all(|(x, y)| x.is_nan() == y.is_nan())
        && first_reading(ra) == first_reading(rb)
        && a.changes.len() == b.changes.len()
        && (a.changes.iter().zip(&b.changes)).all(|(&i, &k)| i.abs_diff(k) <= 1 && ra[i] == rb[k])
}

/// The switches that are one signal, as indexes into `switches`: every switch linked to another by `same_signal`,
/// directly or through others. Groups come in order of their first member.
fn group(log: &Log, switches: &[Switch]) -> Vec<Vec<usize>> {
    let readings = |i: usize| log.chan_at(switches[i].j);
    // the group of each switch, named by its first member
    let mut label: Vec<usize> = (0..switches.len()).collect();
    for i in 0..switches.len() {
        for k in i + 1..switches.len() {
            if label[i] != label[k]
                && same_signal(&switches[i], readings(i), &switches[k], readings(k))
            {
                let (keep, gone) = (label[i].min(label[k]), label[i].max(label[k]));
                label
                    .iter_mut()
                    .filter(|l| **l == gone)
                    .for_each(|l| *l = keep);
            }
        }
    }
    (0..switches.len())
        .filter(|&g| label[g] == g)
        .map(|g| (0..switches.len()).filter(|&i| label[i] == g).collect())
        .collect()
}

/// Every group of switch channels in the log. Found on first use and kept with the log.
fn all(log: &Log) -> &[Group] {
    log.switches.get_or_init(|| {
        let switches: Vec<Switch> = (0..log.names.len())
            .filter(|&j| !log.is_const(j) && is_switch(log.chan_at(j), log.ranges[j]))
            .map(|j| trace(j, &log.t, log.chan_at(j)))
            .collect();
        group(log, &switches)
            .into_iter()
            .map(|members| {
                let mut named: Vec<(&str, usize)> = (members.iter())
                    .map(|&i| (log.names[switches[i].j].as_str(), i))
                    .collect();
                named.sort_by_key(|&(name, _)| (name.chars().count(), name));
                Group {
                    switch: switches[named[0].1].clone(),
                    name: named[0].0.to_string(),
                    also: named[1..].iter().map(|(n, _)| n.to_string()).collect(),
                }
            })
            .collect()
    })
}
```

Replace `Found`, `changing` and the doc comment of `switches`:

```rust
/// A switch that changes inside the span, with every channel that reads the same and changes at the same
/// samples there. All of them agree on `changes`, `on` and `gaps`, so it does not matter which one is kept.
struct Found<'a> {
    /// sample indexes of its changes inside the span, never empty
    changes: Vec<usize>,
    switch: &'a Switch,
    /// the channels that share this row, shortest name first
    names: Vec<&'a str>,
}

/// The switches that change at the samples `inside`, in order of first change. Channels that read the same and
/// change at the same samples there are one entry. A change on the first sample of the span counts.
fn changing<'a>(log: &'a Log, inside: &Range<usize>) -> Vec<Found<'a>> {
    let readings = |s: &Switch| &log.chan_at(s.j)[inside.clone()];
    let mut found: Vec<Found> = Vec::new();
    for switch in all(log) {
        let changes: Vec<usize> = (switch.changes.iter())
            .copied()
            .filter(|i| inside.contains(i))
            .collect();
        if changes.is_empty() {
            continue;
        }
        let name = log.names[switch.j].as_str();
        match found
            .iter_mut()
            .find(|f| f.changes == changes && same(readings(f.switch), readings(switch)))
        {
            Some(f) => f.names.push(name),
            None => found.push(Found {
                changes,
                switch,
                names: vec![name],
            }),
        }
    }
    for f in &mut found {
        f.names.sort_by_key(|n| (n.chars().count(), *n));
    }
    // switches that first change at the same sample are in name order, so the order never depends on channel order
    found.sort_by(|a, b| (a.changes[0].cmp(&b.changes[0])).then(a.names[0].cmp(b.names[0])));
    found
}

/// The switches that change between `t0` and `t1` (log seconds, both ends included), in order of first change,
/// at most `limit` of them. Channels that read the same and change at the same samples of the span share one row.
```

with:

```rust
/// A group whose named channel changes inside the span.
struct Found<'a> {
    group: &'a Group,
    /// sample indexes of the named channel's changes inside the span, never empty
    changes: Vec<usize>,
}

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
```

In `switches`, replace:

```rust
        .map(|f| Row {
            name: f.names[0].to_string(),
            also: f.names[1..].iter().map(|n| n.to_string()).collect(),
            on: span.clip(&f.switch.on),
            gaps: span.clip(&f.switch.gaps),
            changes: f.changes.iter().map(|&i| span.snap(log.t[i])).collect(),
        })
```

with:

```rust
        .map(|f| Row {
            name: f.group.name.clone(),
            also: f.group.also.clone(),
            on: span.clip(&f.group.switch.on),
            gaps: span.clip(&f.group.switch.gaps),
            changes: f.changes.iter().map(|&i| span.snap(log.t[i])).collect(),
        })
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cargo test --release -p logviewer-core --no-fail-fast`
Expected: every test passes: 29 library tests, the golden test (1) unchanged, and 11 in `switches`.

Run: `cargo fmt --check && cargo clippy --release -p logviewer-core --all-targets -- -D warnings && npx prettier --check "src/**/*.ts" tests`
Expected: no output from rustfmt, no clippy warning, and `All matched files use Prettier code style!`

Run: `npm run build && cargo build --release -p logviewer-dev && npm run test:ui`
Expected: `ok   a whole log shows the clutch once among its eight rows, and no note when none is left out`, and `all checks passed`. The other switch-row checks pass with their values unchanged: six rows for the default pull, two for the narrowed span, eight for Back road in the checkbox check, the late answer on the 1:44 and 1:42 pm logs, the clutch tooltip with its two other names.

- [ ] **Step 6: Commit**

```bash
git add crates/core/src/switches.rs crates/core/src/log.rs crates/core/tests/switches.rs tests/ui.mjs
git commit -m "Switch rows: group channels that are one signal once per log

Two switch channels are one signal when they start in the same state,
change as often, each change goes the same way at most one sample apart,
and they are missing at the same samples; a group is the transitive
closure. Groups are kept with the log. A row is built from the group's
shortest name alone and appears when that channel changes in the span.
The clutch is one row in every sample pull and across whole logs.
Fixes #1, fixes #6.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: A failed request's message goes when rows arrive

**Implementer:** implementer

**Files:**
- Modify: `src/app.ts` (`syncSwitches` and the lines above it, nothing else)
- Test: `tests/ui.mjs`

**Interfaces:**
- Consumes: nothing from Tasks 1 and 2. The UI check uses the whole Back road log, which shows eight rows after Task 2.
- Produces: `const SW_FAILED = 'Switch rows failed: '` in `src/app.ts`, used only by `syncSwitches`.

- [ ] **Step 1: Write the failing check**

In `tests/ui.mjs`, right after the check `'the checkbox in Channels turns the rows off'` (it ends with `JSON.stringify([off.rows, off.now, off.height, asked.length - askedBefore]),` and `);`), and before `await page.click('[data-smooth="high"]');`, insert:

```js

  // a failed request says so in the status line; when rows come back for the span, the message goes
  const errorsBefore = errors.length;
  await page.route('**/api/switches', route => route.abort(), { times: 1 });
  await box.check();
  const failShown = await until(page, () => /^Switch rows failed: /.test(document.getElementById('status').textContent));
  // not asked again for the same span: unticking and ticking the box asks again
  await box.uncheck();
  await box.check();
  const rowsBack = await rowsShown(page, 8);
  const afterFail = await text(page, 'status');
  check(
    'a failed request says so, and the message goes when rows arrive',
    failShown && rowsBack && !/Switch rows failed/.test(afterFail),
    JSON.stringify([failShown, rowsBack, afterFail]),
  );
  // the browser reports the aborted request on the console; that one is expected
  errors.splice(errorsBefore, errors.length - errorsBefore, ...errors.slice(errorsBefore).filter(m => !/ERR_FAILED/.test(m)));
  // rows that arrive clear only their own failure: another message stays
  await page.evaluate(() => (document.getElementById('status').textContent = 'Added 1 log.'));
  await box.uncheck();
  await box.check();
  await rowsShown(page, 8);
  check('rows that arrive leave any other message alone', (await text(page, 'status')) === 'Added 1 log.', await text(page, 'status'));
  await box.uncheck();
```

The last `box.uncheck()` leaves the box as the check before it left it: the reload check further down expects the rows to be off. The `errors.splice` is needed: without it, `no page errors` fails with `Failed to load resource: net::ERR_FAILED` (checked).

- [ ] **Step 2: Run the UI test to see it fail**

Run: `npm run build && cargo build --release -p logviewer-dev && npm run test:ui`
Expected: `FAIL a failed request says so, and the message goes when rows arrive  [true,true,"Switch rows failed: Failed to fetch"]` and `1 check(s) failed`. The message appears and the rows come back, but the message stays. "rows that arrive leave any other message alone" passes already. It guards the fix in Step 3.

- [ ] **Step 3: Clear the message when rows arrive**

In `src/app.ts`, replace:

```ts
let swKey = '';
let swSeq = 0;

/** Ask the core for the switch rows of the span on screen. Runs on every draw and asks once per span. */
function syncSwitches(): void {
```

with:

```ts
let swKey = '';
let swSeq = 0;
/** How the status line starts while a request for switch rows has failed. */
const SW_FAILED = 'Switch rows failed: ';

/**
 * Ask the core for the switch rows of the span on screen. Runs on every draw and asks once per span.
 * A failed request is not retried until the span, the log or "Show switches that change" changes:
 * retrying here would send a request on every frame while the replay plays.
 */
function syncSwitches(): void {
```

and, in the same function, replace:

```ts
      S.sw = rows;
      S.swFor = key;
      S.rev++;
      drawAll();
    },
    e => {
      if (seq === swSeq) status('Switch rows failed: ' + errText(e));
    },
```

with:

```ts
      S.sw = rows;
      S.swFor = key;
      S.rev++;
      // an earlier failure no longer holds once rows arrive; any other message stays
      if ($('status').textContent?.startsWith(SW_FAILED)) status('');
      drawAll();
    },
    e => {
      if (seq === swSeq) status(SW_FAILED + errText(e));
    },
```

- [ ] **Step 4: Run the checks to see them pass**

Run: `npx tsc --noEmit && npx prettier --check "src/**/*.ts" tests`
Expected: no type errors, and `All matched files use Prettier code style!`

Run: `npm run build && cargo build --release -p logviewer-dev && npm run test:ui`
Expected: `ok   a failed request says so, and the message goes when rows arrive  [true,true,""]`, `ok   rows that arrive leave any other message alone  Added 1 log.`, `ok   no page errors`, and `all checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts tests/ui.mjs
git commit -m "Switch rows: rows that arrive clear the failed-request message

The message goes only when it is the switch rows' own. The comment says a
failed request is not retried until the span, the log or the checkbox
changes. The UI test aborts one request to reach the error branch.
Fixes #5.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Notes and doc comments

**Implementer:** implementer

**Files:**
- Modify: `src/types.ts` (`SwitchRow` doc comments only)
- Modify: `src/api.ts` (the doc comment on `switches` only)
- Modify: `README.md` (the switch rows paragraph under "What to know about the numbers")
- Modify: `CLAUDE.md` (the Replay line under "Planned" and the switch rows rule under "Rules for this project")
- Modify: `docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md`
- Modify: `docs/superpowers/plans/2026-10-04-replay-switch-rows.md` (two lines at the top)

**Interfaces:**
- Consumes: the rules built in Tasks 1 and 2, and the counts under "What was checked on the sample logs".
- Produces: nothing code depends on. No behaviour changes.

- [ ] **Step 1: Confirm the counts the notes will state**

This task changes no behaviour, so it has no failing test. Its check is that the notes state what the core does. Run: `cargo test --release -p logviewer-core --test switches`
Expected: 11 passed. The notes below quote these tests' values (the rule, the clutch grouped in every log, the declared-range examples) and the counts measured for this plan: 20 channel names that are switches in at least one sample log, forming 12 signals.

- [ ] **Step 2: The TypeScript doc comments**

In `src/types.ts`, replace:

```ts
/** One row of the replay's switch rows: an on/off channel that changes inside the span. Times are log seconds, clipped to the span. */
export interface SwitchRow {
  /** the shortest name among the channels that read the same and change together across the span */
  name: string;
  /** the other channels that read the same and change together across the span, shortest name first */
  also: string[];
  /** [start, end] while the switch is on */
  on: [number, number][];
  /** [start, end] with no samples */
  gaps: [number, number][];
  /** when the switch changes */
  changes: number[];
}
```

with:

```ts
/**
 * One row of the replay's switch rows: a group of on/off channels that are one signal over the whole log, shown because
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
```

In `src/api.ts`, replace:

```ts
  /** on/off channels that change between t0 and t1 (seconds in the log), in order of first change */
```

with:

```ts
  /**
   * on/off channels that change between t0 and t1 (seconds in the log), one row per signal, in order of first change.
   * A span with t0 after t1 answers no rows. An `on` span that starts on the last sample of the span has zero length.
   */
```

- [ ] **Step 3: README and CLAUDE.md**

In `README.md`, in the switch rows paragraph, replace:

```markdown
NSP does not mark its switches, so the core reads them from the data: a channel is a switch when every sample it has in the log is exactly 0 or 1 and both occur. A switch gets a row when it changes inside the span on screen. Channels that read the same at every sample of the span on screen and change at the same samples share one row under the shortest name; pointing at the row lists the others and marks its changes on the traces.
```

with:

```markdown
NSP does not mark its switches, so the core reads them from the log: a channel is a switch when every sample it has in the log is exactly 0 or 1, both occur, and the range the log's header declares for it (`DisplayMaxMin`) lies within 0 to 2. A state that declares 0 to 2 and reads only 0 and 1 in one log is taken for a switch in that log. The same signal is often logged under several names: channels that start in the same state and make the same changes, each at most one sample apart, across the whole log are one signal and share one row. The row is drawn from the channel with the shortest name and appears when that channel changes inside the span on screen; pointing at the row lists the other names and marks its changes on the traces.
```

(The paragraph's first sentence and its sentences from "At most eight rows are shown" on stay as they are.)

In `CLAUDE.md`, replace:

```markdown
Built from `docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md` by `docs/superpowers/plans/2026-10-04-replay-switch-rows.md`; seen in the browser test, not yet in the native window.
```

with:

```markdown
Built from `docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md` by `docs/superpowers/plans/2026-10-04-replay-switch-rows.md`, then fixed by `docs/superpowers/plans/2026-10-04-switch-rows-fixes.md` (issues 1, 3, 5, 6, 7 and 8, core part); seen in the browser test, not yet in the native window.
```

and replace:

```markdown
- Switch rows: what is a switch, which channels share a row (they read the same at every sample of the span on screen and change at the same samples), the spans, the order and the limit of eight are decided in `crates/core/src/switches.rs`.
```

with:

```markdown
- Switch rows: what is a switch (samples of 0 and 1, and a declared `DisplayMaxMin` within 0 to 2), which channels are one signal (grouped once per log: same start, same changes each at most one sample apart, missing at the same samples), the spans, the order and the limit of eight are decided in `crates/core/src/switches.rs`. A row is built from the group's shortest name alone.
```

(The rest of that line, from "`src/charts.ts` draws the spans", stays.)

- [ ] **Step 4: The spec**

In `docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md`, replace:

```markdown
Status: built, by `docs/superpowers/plans/2026-10-04-replay-switch-rows.md`. Four things were settled while building and are marked "As built" below.
```

with:

```markdown
Status: built, by `docs/superpowers/plans/2026-10-04-replay-switch-rows.md`, then fixed by `docs/superpowers/plans/2026-10-04-switch-rows-fixes.md`. What was settled while building and fixing is marked "As built" below.
```

Replace:

```markdown
In the eight sample logs, 19 on/off channels change at least once and 131 never change. Some are the same signal under several names
(Clutch State, AVI6 Switch State and Clutch Switch Input State are identical sample for sample).

As built: those three channels read the same through the default pull, but across a whole log they part by one sample at a few changes
(8.4 s, 26.6 s and 37.7 s of the 1:45 pm log). Channels are therefore compared across the span on screen, not the whole log.
```

with:

```markdown
In the eight sample logs, 20 channels are switches in at least one log. They are 12 signals: some are the same signal under several names
(Clutch State, AVI6 Switch State and Clutch Switch Input State).

As built: those three channels are not identical sample for sample. Across a whole log they part by one sample at a few changes
(8.4 s, 26.6 s and 37.7 s of the 1:45 pm log). Channels are therefore grouped once per log by their changes, allowing one sample between them.
```

Replace:

```markdown
- Signals that read the same at every sample of the span on screen and change at the same samples share one row. The row carries the shortest name; the tooltip lists the others.
  (As built. The design said "identical across the whole log"; see Why.)
```

with:

```markdown
- Channels that are one signal share one row. The row carries the shortest name; the tooltip lists the others.
  (As built: two switch channels are one signal when they start in the same state, change as often, each pair of corresponding changes
  goes the same way at most one sample apart, and they are missing at the same samples. A group is every channel linked to another by that
  rule, worked out once per log. The row's bar, gaps and changes come from the channel with the shortest name alone, and the row appears
  when that channel changes inside the span. The design said "identical across the whole log"; see Why.)
```

Replace:

```markdown
- Every sample in the whole log that is present is exactly 0 or 1, and both values occur.
- A channel with any other value, or with one value only, is not a switch.
```

with:

```markdown
- Every sample in the whole log that is present is exactly 0 or 1, and both values occur.
- A channel with any other value, or with one value only, is not a switch.
- (As built: and the range the log's header declares for the channel, `DisplayMaxMin : max,min`, lies within 0 to 2. NSP declares `1,0` or `2,0`
  for its switches. O2 Control State declares `524288,0` and Diagnostic ratiometric voltage reference error `4096,-4096`; both read only 0 and 1
  in the 1:46 pm log and are not switches. A channel with no declared range is decided by its samples. Known limit: Drive By Wire Throttle Motor
  Direction declares `2,0` and reads 0, 1 and 2 in most logs, so in a log where it reads only 0 and 1 it is a switch.)
```

Replace:

```markdown
Finding the switch channels is done once per log; grouping is done per span.)
```

with:

```markdown
Finding the switch channels and grouping them are done once per log, and kept with it.)
```

- [ ] **Step 5: The earlier plan**

In `docs/superpowers/plans/2026-10-04-replay-switch-rows.md`, replace the first line:

```markdown
# Replay Switch Rows Implementation Plan
```

with:

```markdown
# Replay Switch Rows Implementation Plan

> **Amended.** The code this plan gives for `changing` (Task 1) and for `syncSwitches` and the row reads (Task 4) is not what was built: it was changed in review,
> and again by `docs/superpowers/plans/2026-10-04-switch-rows-fixes.md`, which groups channels once per log and adds the declared range to what is a switch.
```

- [ ] **Step 6: Check that nothing else moved**

Run: `npx tsc --noEmit && npx prettier --check "src/**/*.ts" tests && git diff --stat`
Expected: no type errors, `All matched files use Prettier code style!`, and a diff of these six files only: `CLAUDE.md`, `README.md`, `docs/superpowers/plans/2026-10-04-replay-switch-rows.md`, `docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md`, `src/api.ts`, `src/types.ts`.

Run: `rg -n "read the same at every sample|grouping is done per span|19 on/off|131 never" README.md CLAUDE.md docs/superpowers/specs src`
Expected: no match.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/api.ts README.md CLAUDE.md docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md docs/superpowers/plans/2026-10-04-replay-switch-rows.md
git commit -m "Switch rows: notes and doc comments follow the new rules

README, CLAUDE.md, the spec's As built notes and count, the doc comments
on SwitchRow and api.switches, and a note at the top of the first plan
that its changing and syncSwitches code was amended. Part of #7; the
switchRowAt comment in src/charts.ts is left for the display redesign.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
