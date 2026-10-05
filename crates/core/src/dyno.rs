//! Pull detection and the virtual dyno: wheel power from how fast the engine accelerates the car.

use std::sync::OnceLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::fmt::{fx, n0, num};
use crate::log::Log;
use crate::stats::median;

/// One gear, accelerator applied, RPM climbing.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pull {
    pub key: String,
    pub log_key: String,
    pub i0: usize,
    pub i1: usize,
    pub gear: f64,
    pub t0: f64,
    pub t1: f64,
    pub rpm0: f64,
    pub rpm1: f64,
    pub dur: f64,
    pub gain: f64,
    pub peak_pedal: f64,
    pub peak_tps: f64,
    pub peak_map: f64,
}

const MIN_PEDAL: f64 = 15.0;
const MIN_SPEED: f64 = 12.0;
const MIN_DUR: f64 = 1.2;
const MIN_GAIN: f64 = 700.0;

/// The stretches where the rule for a pull holds at every sample: the accelerator pedal at `MIN_PEDAL` or more, the car
/// at `MIN_SPEED` or more, in one gear, RPM rising. Each is the first and last sample of a stretch; the last is the latest
/// sample that is not lower than the one before it, so a stretch can end below its highest RPM.
fn stretches(log: &Log) -> Vec<(usize, usize)> {
    let (ch, n) = (&log.ch, log.n);
    let mut out = Vec::new();
    if n == 0 {
        return out;
    }
    let ok = |i: usize| {
        ch.pedal[i] >= MIN_PEDAL
            && ch.vss[i] >= MIN_SPEED
            && ch.gear[i] >= 1.0
            && ch.rpm[(i + 3).min(n - 1)] > ch.rpm[i.saturating_sub(3)]
    };
    let mut s: Option<usize> = None;
    for i in 0..=n {
        let good = i < n && ok(i) && s.is_none_or(|s0| ch.gear[i] == ch.gear[s0]);
        if good && s.is_none() {
            s = Some(i);
        }
        if !good {
            if let Some(a) = s {
                let mut b = i - 1;
                while b > a && ch.rpm[b] < ch.rpm[b - 1] {
                    b -= 1;
                }
                out.push((a, b));
                s = if i < n && ok(i) { Some(i) } else { None };
            }
        }
    }
    out
}

/// A pull is a stretch that lasts `MIN_DUR` and gains `MIN_GAIN`.
pub fn detect_pulls(log: &Log) -> Vec<Pull> {
    let (t, ch) = (&log.t, &log.ch);
    let mut pulls = Vec::new();
    for (a, b) in stretches(log) {
        let (dur, gain) = (t[b] - t[a], ch.rpm[b] - ch.rpm[a]);
        if dur >= MIN_DUR && gain >= MIN_GAIN {
            let (mut pk, mut mp, mut tp) = (0.0f64, 0.0f64, 0.0f64);
            for j in a..=b {
                pk = pk.max(ch.pedal[j]);
                mp = mp.max(ch.map[j]);
                tp = tp.max(ch.tps[j]);
            }
            pulls.push(Pull {
                key: format!("{}@{}", log.key, fx(t[a], 1)),
                log_key: log.key.clone(),
                i0: a,
                i1: b,
                gear: ch.gear[a],
                t0: t[a],
                t1: t[b],
                rpm0: ch.rpm[a],
                rpm1: ch.rpm[b],
                dur,
                gain,
                peak_pedal: pk,
                peak_tps: tp,
                peak_map: mp,
            });
        }
    }
    pulls
}

/// What a pull is, in one sentence written from the constants `detect_pulls` uses.
pub fn pull_rule() -> String {
    format!(
        "A pull is RPM rising in one gear, with the car moving and the accelerator pedal at {}% or more, for at least {} s and {} rpm.",
        num(MIN_PEDAL),
        num(MIN_DUR),
        n0(MIN_GAIN)
    )
}

/// Why a log has no pull, in the log's own numbers: the first reason that applies, written from the constants
/// `detect_pulls` uses. For a log with no pull only. A log with no gear or no speed reading reads as never in gear or
/// never moving.
pub fn why_no_pull(log: &Log) -> String {
    let (t, ch) = (&log.t, &log.ch);
    let in_gear = ch.gear.iter().any(|&g| g >= 1.0);
    let moved = ch.vss.iter().any(|&v| v >= MIN_SPEED);
    // NaN when the log has no reading of the pedal at all
    let pedal = ch.pedal.iter().copied().fold(f64::NAN, f64::max);
    // "but I did press it"
    let pressed = if pedal >= MIN_PEDAL {
        format!(" The accelerator pedal reached {}%.", n0(pedal))
    } else {
        String::new()
    };
    if !in_gear && !moved {
        return format!("No pulls: the car stayed out of gear and did not move.{pressed}");
    }
    if !in_gear {
        return format!("No pulls: the car stayed out of gear.{pressed}");
    }
    if !moved {
        return format!(
            "No pulls: the car stayed under {} km/h.{pressed}",
            num(MIN_SPEED)
        );
    }
    // false for NaN: a log with no pedal reading does not take this branch
    if pedal < MIN_PEDAL {
        return format!(
            "No pulls: the accelerator pedal peaked at {}%, under the {}% a pull needs.",
            fx(pedal, 1),
            num(MIN_PEDAL)
        );
    }
    // the longest stretch of two samples or more; the first of two as long
    let mut longest: Option<(usize, usize)> = None;
    for (a, b) in stretches(log) {
        if b > a && longest.is_none_or(|(x, y)| t[b] - t[a] > t[y] - t[x]) {
            longest = Some((a, b));
        }
    }
    let Some((a, b)) = longest else {
        return format!(
            "No pulls: RPM never rose in gear with the accelerator pedal at {}% or more.",
            num(MIN_PEDAL)
        );
    };
    let dur = t[b] - t[a];
    // a stretch just short of the time a pull needs is never written as that time: 1.17 s, not 1.2 s
    let lasted = (1..=3)
        .map(|d| fx(dur, d))
        .find(|s| dur >= MIN_DUR || s.parse::<f64>().is_ok_and(|v| v < MIN_DUR))
        .unwrap_or_else(|| fx(dur, 3));
    format!(
        "No pulls: the longest stretch of rising RPM in one gear lasted {lasted} s and gained {} rpm. A pull needs {} s and {} rpm.",
        n0(ch.rpm[b] - ch.rpm[a]),
        num(MIN_DUR),
        n0(MIN_GAIN)
    )
}

/// Vehicle as the UI sends it, in SI units.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vehicle {
    /// kg, car plus driver
    pub mass: f64,
    /// kg, weight uncertainty for the band
    #[serde(default)]
    pub unc: f64,
    /// m², drag coefficient times frontal area
    pub cda: f64,
    pub crr: f64,
    /// kg·m², engine and flywheel
    pub ie: f64,
    /// kg, wheels and driveline as equivalent mass
    pub mrot: f64,
    /// s, half-window of the fit of engine speed that gives acceleration
    pub window: f64,
    /// rpm, half-width of the smoothing along the power curve; 0 leaves the curve as computed
    #[serde(default)]
    pub smooth: f64,
    #[serde(default)]
    pub tire: String,
    #[serde(default)]
    pub fd: Option<f64>,
    #[serde(default)]
    pub gears: Vec<f64>,
    #[serde(default)]
    pub speed_src: String,
}

/// "215/45R17" -> rolling circumference in metres. A loaded tire rolls about 1.5% short of its unloaded size.
pub fn tire_circ(size: &str) -> f64 {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"(?i)(\d{3})\s*/\s*(\d{2})\s*Z?R?\s*(\d{2})").unwrap());
    let Some(m) = re.captures(size) else {
        return f64::NAN;
    };
    let p = |i: usize| m[i].parse::<f64>().unwrap_or(f64::NAN);
    std::f64::consts::PI * (p(3) * 25.4 + 2.0 * p(1) * p(2) / 100.0) / 1000.0 * 0.985
}

/// Metres per second of road speed per engine rpm from gearing, or NaN if the gearing is not known.
pub fn kv_from_gearing(veh: &Vehicle, gear: f64) -> f64 {
    if !(gear >= 1.0) {
        return f64::NAN;
    }
    let g = veh
        .gears
        .get(gear as usize - 1)
        .copied()
        .unwrap_or(f64::NAN);
    let (c, fd) = (tire_circ(&veh.tire), veh.fd.unwrap_or(f64::NAN));
    if g > 0.0 && fd > 0.0 && !c.is_nan() {
        c / (60.0 * g * fd)
    } else {
        f64::NAN
    }
}

/// Stoichiometric AFR and lower heating value (MJ/kg) of a gasoline-ethanol blend from ethanol volume fraction.
pub fn fuel_props(e: f64) -> (f64, f64) {
    let me = e * 0.789 / (e * 0.789 + (1.0 - e) * 0.745);
    (me * 9.0 + (1.0 - me) * 14.7, me * 26.8 + (1.0 - me) * 43.5)
}

pub const DRIVELINE_LOSS: f64 = 0.13;

/// Local quadratic least-squares fit of y(t) around sample i within ±h of t[i]. Works on unevenly spaced t.
/// t is time for the acceleration fit and engine speed for the smoothing of the power curve.
/// Returns (smoothed value, slope).
fn local_quad(t: &[f64], y: &[f64], i: usize, h: f64, lo: usize, hi: usize) -> (f64, f64) {
    let (mut a, mut b) = (i, i);
    while a > lo && t[i] - t[a - 1] <= h {
        a -= 1;
    }
    while b < hi && t[b + 1] - t[i] <= h {
        b += 1;
    }
    let (mut s0, mut s1, mut s2, mut s3, mut s4, mut y0, mut y1, mut y2) =
        (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    for j in a..=b {
        let x = t[j] - t[i];
        let x2 = x * x;
        let v = y[j];
        s0 += 1.0;
        s1 += x;
        s2 += x2;
        s3 += x2 * x;
        s4 += x2 * x2;
        y0 += v;
        y1 += v * x;
        y2 += v * x2;
    }
    if s0 < 4.0 {
        let d = s0 * s2 - s1 * s1;
        if s0 < 2.0 || d.abs() < 1e-12 {
            return (y[i], 0.0);
        }
        let m = (s0 * y1 - s1 * y0) / d;
        return ((y0 - m * s1) / s0, m);
    }
    let det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
    if det.abs() < 1e-18 {
        return (y[i], 0.0);
    }
    let c0 = (y0 * (s2 * s4 - s3 * s3) - s1 * (y1 * s4 - s3 * y2) + s2 * (y1 * s3 - s2 * y2)) / det;
    let c1 = (s0 * (y1 * s4 - s3 * y2) - y0 * (s1 * s4 - s3 * s2) + s2 * (s1 * y2 - y1 * s2)) / det;
    (c0, c1)
}

/// Smooth power along the curve: a local quadratic fit of power against engine speed within ±h rpm of each point.
/// The fit is one-sided at the ends, so the curve keeps its whole rpm range. Torque follows from the smoothed power.
fn smooth_power(core: &mut [Pt], h: f64) {
    if !(h > 0.0) || core.is_empty() {
        return;
    }
    // engine speed in units of h keeps the sums of the fit near 1 whatever the width
    let x: Vec<f64> = core.iter().map(|p| p.rpm / h).collect();
    let hp: Vec<f64> = core.iter().map(|p| p.hp).collect();
    let last = core.len() - 1;
    for (i, p) in core.iter_mut().enumerate() {
        p.hp = local_quad(&x, &hp, i, 1.0, 0, last).0;
        p.tq = p.hp * 5252.0 / p.rpm;
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct Pt {
    pub i: usize,
    pub t: f64,
    pub rpm: f64,
    pub hp: f64,
    pub tq: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct FuelCheck {
    pub bsfc: f64,
    pub n: usize,
    pub eth: f64,
    pub lo: f64,
    pub hi: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct SpeedCheck {
    pub ecu: f64,
    pub gear: f64,
    pub diff: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dyno {
    /// the pull with its window edges trimmed, where the fit is two-sided
    pub core: Vec<Pt>,
    pub kmh_per_krpm: f64,
    pub peak_hp: Option<Pt>,
    pub peak_tq: Option<Pt>,
    pub fuel_check: Option<FuelCheck>,
    pub speed_check: Option<SpeedCheck>,
}

/// Wheel power through one pull: (effective mass × acceleration + aero drag + rolling resistance) × speed.
pub fn dyno(log: &Log, pull: &Pull, veh: &Vehicle) -> Dyno {
    let (i0, i1, t, ch) = (pull.i0, pull.i1, &log.t, &log.ch);
    let ratios: Vec<f64> = (i0..=i1)
        .filter(|&i| ch.rpm[i] > 500.0 && ch.vss[i] > 5.0)
        .map(|i| ch.vss[i] / 3.6 / ch.rpm[i])
        .collect();
    let (kv_ecu, kv_gear) = (median(&ratios), kv_from_gearing(veh, pull.gear));
    let kv = if veh.speed_src == "gear" && !kv_gear.is_nan() {
        kv_gear
    } else {
        kv_ecu
    };
    let mut baro = median(&ch.baro[i0..=i1]);
    if baro.is_nan() || baro == 0.0 {
        baro = 101.3;
    }
    // ambient assumed 20 °C: IAT is post-intercooler, so it says nothing about the air the car pushes through
    let rho = baro * 1000.0 / (287.05 * 293.15);
    let w_per_v = (2.0 * std::f64::consts::PI / 60.0) / kv;
    let m_eff = veh.mass + veh.mrot + veh.ie * w_per_v * w_per_v;
    let pts: Vec<Pt> = (i0..=i1)
        .map(|i| {
            let (rpm, slope) = local_quad(t, &ch.rpm, i, veh.window, i0, i1);
            let (v, a) = (rpm * kv, slope * kv);
            let hp = (m_eff * a + 0.5 * rho * veh.cda * v * v + veh.crr * veh.mass * 9.80665) * v
                / 745.6999;
            Pt {
                i,
                t: t[i],
                rpm,
                hp,
                tq: hp * 5252.0 / rpm,
            }
        })
        .collect();
    let edge = veh.window * 0.5;
    let mut core: Vec<Pt> = pts
        .into_iter()
        .filter(|p| p.t - t[i0] >= edge && t[i1] - p.t >= edge)
        .collect();
    // does the fuel the ECU commanded support this much power? Read from the curve as computed.
    let eth = median(&ch.eth[i0..=i1]);
    let mut fuel_check = None;
    if !eth.is_nan() {
        let bs: Vec<f64> = core
            .iter()
            .filter(|p| ch.map[p.i] > baro + 5.0 && p.hp > 40.0 && ch.fuel[p.i] > 0.0)
            .map(|p| ch.fuel[p.i] * 7.93664 / (p.hp / (1.0 - DRIVELINE_LOSS)))
            .collect();
        if bs.len() >= 8 {
            let k = 43.5 / fuel_props(eth / 100.0).1;
            fuel_check = Some(FuelCheck {
                bsfc: median(&bs),
                n: bs.len(),
                eth,
                lo: 0.53 * k,
                hi: 0.70 * k,
            });
        }
    }
    // smoothed after the fuel check and before the peaks: a check on the estimate must not move with a display setting,
    // and the peaks have to be on the curve that is drawn
    smooth_power(&mut core, veh.smooth);
    let (mut peak_hp, mut peak_tq): (Option<Pt>, Option<Pt>) = (None, None);
    for p in &core {
        if peak_hp.is_none_or(|q| p.hp > q.hp) {
            peak_hp = Some(*p);
        }
        if peak_tq.is_none_or(|q| p.tq > q.tq) {
            peak_tq = Some(*p);
        }
    }
    let speed_check = if kv_gear.is_nan() {
        None
    } else {
        Some(SpeedCheck {
            ecu: kv_ecu * 3600.0,
            gear: kv_gear * 3600.0,
            diff: (kv_ecu / kv_gear - 1.0) * 100.0,
        })
    };
    Dyno {
        core,
        kmh_per_krpm: kv * 3600.0,
        peak_hp,
        peak_tq,
        fuel_check,
        speed_check,
    }
}

/// Interpolate a dyno curve at an RPM. The curve is monotonic in RPM within a pull.
pub fn at_rpm(c: &[Pt], rpm: f64, key: impl Fn(&Pt) -> f64) -> f64 {
    if c.is_empty() || rpm < c[0].rpm || rpm > c[c.len() - 1].rpm {
        return f64::NAN;
    }
    for i in 1..c.len() {
        if c[i].rpm >= rpm {
            let (a, b) = (&c[i - 1], &c[i]);
            let f = if b.rpm == a.rpm {
                0.0
            } else {
                (rpm - a.rpm) / (b.rpm - a.rpm)
            };
            return key(a) + (key(b) - key(a)) * f;
        }
    }
    f64::NAN
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A curve sampled every 40 rpm from 3,000 rpm.
    fn curve(n: usize, hp: impl Fn(usize, f64) -> f64) -> Vec<Pt> {
        (0..n)
            .map(|i| {
                let rpm = 3000.0 + 40.0 * i as f64;
                let hp = hp(i, rpm);
                Pt {
                    i,
                    t: i as f64 * 0.05,
                    rpm,
                    hp,
                    tq: hp * 5252.0 / rpm,
                }
            })
            .collect()
    }

    /// Power that rises and rolls over, with no noise.
    fn clean(rpm: f64) -> f64 {
        let x = (rpm - 3000.0) / 1000.0;
        120.0 + 60.0 * x - 12.0 * x * x
    }

    /// Repeatable noise within ±4 hp.
    fn noise(i: usize) -> f64 {
        ((i * 7919 + 13) % 17) as f64 / 2.0 - 4.0
    }

    /// Sample-to-sample wiggle: the mean absolute second difference of power.
    fn roughness(c: &[Pt]) -> f64 {
        let d2 = c
            .windows(3)
            .map(|w| (w[2].hp - 2.0 * w[1].hp + w[0].hp).abs());
        d2.sum::<f64>() / (c.len() - 2) as f64
    }

    /// Mean distance from the noise-free curve.
    fn error(c: &[Pt]) -> f64 {
        c.iter().map(|p| (p.hp - clean(p.rpm)).abs()).sum::<f64>() / c.len() as f64
    }

    #[test]
    fn smoothing_off_leaves_the_curve_as_computed() {
        let before = curve(60, |i, rpm| clean(rpm) + noise(i));
        let mut after = before.clone();
        smooth_power(&mut after, 0.0);
        for (a, b) in after.iter().zip(&before) {
            assert_eq!((a.hp, a.tq), (b.hp, b.tq));
        }
    }

    #[test]
    fn a_curve_without_noise_is_not_changed() {
        let before = curve(60, |_, rpm| clean(rpm));
        let mut after = before.clone();
        smooth_power(&mut after, 250.0);
        for (a, b) in after.iter().zip(&before) {
            assert!(
                (a.hp - b.hp).abs() < 1e-6,
                "{} hp became {} at {} rpm",
                b.hp,
                a.hp,
                a.rpm
            );
        }
    }

    #[test]
    fn a_noisy_curve_gets_smoother_over_the_same_rpm_range() {
        let before = curve(60, |i, rpm| clean(rpm) + noise(i));
        let mut after = before.clone();
        smooth_power(&mut after, 250.0);

        assert_eq!(after.len(), before.len());
        for (a, b) in after.iter().zip(&before) {
            assert_eq!(a.rpm, b.rpm);
        }
        assert!(
            roughness(&after) < roughness(&before) / 3.0,
            "roughness {} -> {}",
            roughness(&before),
            roughness(&after)
        );
        assert!(
            error(&after) < error(&before) / 2.0,
            "distance from the noise-free curve {} -> {}",
            error(&before),
            error(&after)
        );
        for p in &after {
            assert!(
                (p.tq - p.hp * 5252.0 / p.rpm).abs() < 1e-9,
                "torque does not follow power at {} rpm",
                p.rpm
            );
        }
    }
}
