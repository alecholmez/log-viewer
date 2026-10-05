//! Switch rows for the replay: on/off channels as bars on the time axis.
//!
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
pub(crate) struct Switch {
    /// channel index in the log
    j: usize,
    /// sample index of every change: the first sample that shows the new state
    changes: Vec<usize>,
    /// [start, end] in log seconds while the switch is on. A stretch of missing samples does not end one.
    on: Vec<[f64; 2]>,
    /// [start, end] in log seconds of every stretch of missing samples
    gaps: Vec<[f64; 2]>,
}

/// The switch channels of a log that are one signal, and the channel their row is built from.
#[derive(Clone, Debug)]
pub(crate) struct Group {
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

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Rows {
    pub rows: Vec<Row>,
    /// signals whose named channel changes inside the span and that were left out by the limit
    pub more: usize,
}

/// A switch: the range the log declares for it, if any, lies within 0 to 2, and its samples read 0 and 1.
fn is_switch(a: &[f64], range: Option<[f64; 2]>) -> bool {
    no_range_or_on_off(range) && reads_on_off(a)
}

/// True when the log declares no range for the channel, or one within 0 to 2. NSP declares `1,0` or `2,0` for a switch,
/// and a wider range for a state or a count that can read only 0 and 1 in one log. A log that declares no range leaves it
/// to the samples. A NaN bound fails both comparisons, so such a channel is not a switch.
fn no_range_or_on_off(range: Option<[f64; 2]>) -> bool {
    range.is_none_or(|[min, max]| min >= 0.0 && max <= 2.0)
}

/// 0 or 1 at every sample that is present, and both occur.
fn reads_on_off(a: &[f64]) -> bool {
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
            ranges: vec![None; names.len()],
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
                "Switch 2"
            ]
        );
        assert_eq!(r.more, 2);

        let r = switches(&l, 0.0, 23.0, 3);
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
        // their second changes are two samples apart, so they are two signals
        let l = log(&[
            ("Decel", &[0.0, 1.0, 1.0, 1.0, 0.0]),
            ("Brake", &[0.0, 1.0, 0.0, 0.0, 0.0]),
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

    /// Two channels that read the same inside the span can part just before it: then the span's first sample is a
    /// change for one and not for the other. They are two rows, whichever order the channels come in.
    #[test]
    fn channels_that_part_just_before_the_span_are_two_rows_in_either_order() {
        let a_long: &[f64] = &[1.0, 0.0, 0.0, 0.0, 1.0, 1.0];
        let b: &[f64] = &[0.0, 0.0, 0.0, 0.0, 1.0, 1.0];
        let ab = switches(&log(&[("A long", a_long), ("B", b)]), 1.0, 5.0, MAX_ROWS);
        let ba = switches(&log(&[("B", b), ("A long", a_long)]), 1.0, 5.0, MAX_ROWS);
        assert_eq!(ab, ba);
        assert_eq!(names(&ab), ["A long", "B"]);
        assert_eq!(ab.rows[0].also, Vec::<String>::new());
        assert_eq!(ab.rows[0].changes, [1.0, 4.0]);
        assert_eq!(ab.rows[1].also, Vec::<String>::new());
        assert_eq!(ab.rows[1].changes, [4.0]);
    }

    #[test]
    fn channels_that_read_and_change_the_same_share_a_row_in_either_order() {
        let x: &[f64] = &[0.0, 1.0, 1.0, 0.0, 0.0, 1.0];
        let ab = switches(&log(&[("Clutch", x), ("Clutch State", x)]), 0.0, 5.0, 8);
        let ba = switches(&log(&[("Clutch State", x), ("Clutch", x)]), 0.0, 5.0, 8);
        assert_eq!(ab, ba);
        assert_eq!(names(&ab), ["Clutch"]);
        assert_eq!(ab.rows[0].also, ["Clutch State"]);
    }
}
