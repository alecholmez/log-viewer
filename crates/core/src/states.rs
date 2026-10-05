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
            (
                "Gear",
                "Gear",
                Some([-8.0, 10.0]),
                &[1.0, 1.0, 2.0, 2.0, 3.0],
            ),
            (
                "Engine State",
                "Raw",
                Some([0.0, 4.0]),
                &[2.0, 3.0, 3.0, 2.0, 3.0],
            ),
            (
                "Idle Control State",
                "Raw",
                Some([-9.0, 3.0]),
                &[-7.0, -9.0, -3.0, -7.0, -7.0],
            ),
        ]);
        // in order of first change, ties by name
        assert_eq!(
            names(&whole(&l)),
            ["Engine State", "Idle Control State", "Gear"]
        );
    }

    /// Each condition of the rule keeps a channel out; two channels beside them pass.
    #[test]
    fn a_state_is_a_whole_number_channel_with_no_unit_a_few_values_and_a_narrow_range() {
        let l = typed(&[
            // a switch is not a state
            (
                "Clutch State",
                "Raw",
                Some([0.0, 1.0]),
                &[0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0],
            ),
            // a unit: whole numbers once scaled (1 and 2 %), still not a state
            (
                "Boost Duty",
                "Percentage",
                Some([0.0, 1000.0]),
                &[10.0, 20.0, 10.0, 20.0, 10.0, 20.0, 10.0, 20.0, 10.0, 20.0],
            ),
            // a sample that is not a whole number
            (
                "Half Steps",
                "Raw",
                None,
                &[0.0, 0.5, 1.0, 0.5, 0.0, 0.5, 1.0, 0.5, 0.0, 1.0],
            ),
            // nine values, as a counter has
            (
                "Tooth Count",
                "Raw",
                None,
                &[0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 0.0],
            ),
            // eight values and a declared range exactly 128 wide: a state
            (
                "Eight",
                "Raw",
                Some([0.0, 128.0]),
                &[0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 0.0, 1.0],
            ),
            // a diagnostic's range
            (
                "Error",
                "Raw",
                Some([-4096.0, 4096.0]),
                &[0.0, 1.0, 2.0, 1.0, 0.0, 1.0, 2.0, 1.0, 0.0, 1.0],
            ),
            // one wider than 128
            (
                "Wide",
                "Raw",
                Some([0.0, 129.0]),
                &[0.0, 1.0, 2.0, 1.0, 0.0, 1.0, 2.0, 1.0, 0.0, 1.0],
            ),
            // no declared range: the samples decide. 0 and 2 is not a switch
            (
                "No range",
                "Raw",
                None,
                &[0.0, 2.0, 0.0, 2.0, 0.0, 2.0, 0.0, 2.0, 0.0, 2.0],
            ),
            // one value only, with a missing sample: stored as a series, still not a state
            (
                "One value",
                "Raw",
                None,
                &[3.0, X, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0],
            ),
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
                (
                    "Busy",
                    "Raw",
                    None,
                    &[2.0, 3.0, 2.0, 3.0, 2.0, 3.0, 2.0, 3.0, 2.0],
                ),
                // five changes: two and a half a second
                (
                    "Five",
                    "Raw",
                    None,
                    &[2.0, 3.0, 2.0, 2.0, 3.0, 3.0, 2.0, 2.0, 3.0],
                ),
                // four changes: exactly twice a second
                (
                    "Four",
                    "Raw",
                    None,
                    &[2.0, 2.0, 3.0, 3.0, 2.0, 2.0, 3.0, 3.0, 2.0],
                ),
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
            (
                "Data Log Status",
                "Raw",
                Some([0.0, 6.0]),
                &[0.0, 1.0, 2.0, 1.0, 0.0],
            ),
            (
                "Log Status",
                "Raw",
                Some([0.0, 6.0]),
                &[0.0, 1.0, 2.0, 1.0, 0.0],
            ),
        ]);
        assert_eq!(names(&whole(&l)), ["Log Status"]);
    }

    /// Time Since Engine Limiter declares `2147483647,-1` in every sample log: [-0.001, NaN] once scaled. A NaN bound
    /// means wider than anything. The same range on a channel of type Raw pins that rule on its own.
    #[test]
    fn a_declared_range_with_a_missing_bound_is_not_narrow() {
        let l = typed(&[
            (
                "Time Since Engine Limiter",
                "Time_ms_as_s",
                Some([-1.0, X]),
                &[-1.0, -1.0, 0.0, 50.0, 100.0],
            ),
            ("Limit", "Raw", Some([-1.0, X]), &[0.0, 1.0, 2.0, 1.0, 0.0]),
            (
                "Same values, no range",
                "Raw",
                None,
                &[0.0, 1.0, 2.0, 1.0, 0.0],
            ),
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
        let l = typed(&[(
            "Gear",
            "Gear",
            None,
            &[1.0, 1.0, 2.0, 2.0, 2.0, 3.0, 3.0, 3.0],
        )]);
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
            (
                "Busy",
                "Raw",
                None,
                &[2.0, 3.0, 2.0, 3.0, 2.0, 2.0, 2.0, 2.0],
            ),
            (
                "Calm",
                "Raw",
                None,
                &[7.0, 7.0, 7.0, 7.0, 7.0, 8.0, 8.0, 8.0],
            ),
            (
                "Quiet",
                "Raw",
                None,
                &[5.0, 5.0, 5.0, 6.0, 6.0, 6.0, 6.0, 6.0],
            ),
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
            (
                "Engine State",
                "Raw",
                Some([0.0, 4.0]),
                &[2.0, 3.0, 3.0, 2.0],
            ),
            (
                "Ignition Active Table",
                "Raw",
                Some([-1.0, 6.0]),
                &[0.0, 2.0, 2.0, 0.0],
            ),
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
