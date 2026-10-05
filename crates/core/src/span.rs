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
    changes
        .iter()
        .copied()
        .filter(|i| inside.contains(i))
        .collect()
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
