//! Small statistics helpers. NaN marks a missing sample throughout the core.

fn sorted_finite(a: &[f64]) -> Vec<f64> {
    let mut b: Vec<f64> = a.iter().copied().filter(|x| !x.is_nan()).collect();
    b.sort_by(|x, y| x.partial_cmp(y).unwrap());
    b
}

/// Upper median of the non-missing values.
pub fn median(a: &[f64]) -> f64 {
    let b = sorted_finite(a);
    if b.is_empty() {
        f64::NAN
    } else {
        b[b.len() >> 1]
    }
}

/// Quantile by rank (no interpolation).
pub fn quant(a: &[f64], q: f64) -> f64 {
    let b = sorted_finite(a);
    if b.is_empty() {
        f64::NAN
    } else {
        b[((q * b.len() as f64).floor() as usize).min(b.len() - 1)]
    }
}

/// Most common value. Ties go to the value that reached the winning count first.
pub fn mode(a: &[f64]) -> f64 {
    let mut seen: Vec<(f64, usize)> = Vec::new();
    let (mut best, mut best_count) = (f64::NAN, 0usize);
    for &v in a {
        if v.is_nan() {
            continue;
        }
        let count = match seen.iter_mut().find(|(x, _)| *x == v) {
            Some(e) => {
                e.1 += 1;
                e.1
            }
            None => {
                seen.push((v, 1));
                1
            }
        };
        if count > best_count {
            best_count = count;
            best = v;
        }
    }
    best
}

/// Maximum, or NaN if any sample is missing.
pub fn max_of(a: &[f64]) -> f64 {
    let mut m = f64::NEG_INFINITY;
    for &v in a {
        if v.is_nan() {
            return f64::NAN;
        }
        if v > m {
            m = v;
        }
    }
    m
}

/// Minimum, or NaN if any sample is missing.
pub fn min_of(a: &[f64]) -> f64 {
    let mut m = f64::INFINITY;
    for &v in a {
        if v.is_nan() {
            return f64::NAN;
        }
        if v < m {
            m = v;
        }
    }
    m
}

/// A run of consecutive samples, inclusive at both ends.
#[derive(Clone, Copy, Debug)]
pub struct Seg {
    pub i0: usize,
    pub i1: usize,
}

/// Runs where `pred` holds for at least `min_dur` seconds. Runs closer than `merge_gap` seconds are joined first.
pub fn segments(t: &[f64], pred: impl Fn(usize) -> bool, min_dur: f64, merge_gap: f64) -> Vec<Seg> {
    let n = t.len();
    let mut raw: Vec<Seg> = Vec::new();
    let mut start: Option<usize> = None;
    for i in 0..=n {
        let ok = i < n && pred(i);
        match (ok, start) {
            (true, None) => start = Some(i),
            (false, Some(s)) => {
                raw.push(Seg { i0: s, i1: i - 1 });
                start = None;
            }
            _ => {}
        }
    }
    let mut merged: Vec<Seg> = Vec::new();
    for g in raw {
        match merged.last_mut() {
            Some(last) if merge_gap > 0.0 && t[g.i0] - t[last.i1] <= merge_gap => last.i1 = g.i1,
            _ => merged.push(g),
        }
    }
    merged
        .into_iter()
        .filter(|g| t[g.i1] - t[g.i0] >= min_dur)
        .collect()
}
