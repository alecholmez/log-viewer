//! Findings: what the logs show is wrong, why it matters, and what to change.
//!
//! Every detector works from the logged channels only. Evidence quotes the numbers it used, and each step
//! names the setting to change with a value taken from the data.

use std::sync::OnceLock;

use regex::Regex;
use serde::Serialize;

use crate::dyno::{Dyno, Pull};
use crate::fmt::{fx, js_round, n0, num, sgn};
use crate::haltech::name;
use crate::log::Log;
use crate::stats::{max_of, median, min_of, mode, quant, segments, Seg};
use crate::table::Table;

/// A trace the replay should show for a finding: channel `a`, optionally `b` dashed behind it.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Trace {
    pub a: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub b: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lo: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hi: Option<f64>,
    /// the channel the finding is about, as opposed to context
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub key: bool,
}

fn tr(a: &str) -> Trace {
    Trace {
        a: a.into(),
        b: None,
        lo: None,
        hi: None,
        key: false,
    }
}
fn tr2(a: &str, b: &str) -> Trace {
    Trace {
        a: a.into(),
        b: Some(b.into()),
        lo: None,
        hi: None,
        key: false,
    }
}
fn k(mut t: Trace) -> Trace {
    t.key = true;
    t
}
fn t_rpm() -> Trace {
    tr(name::RPM)
}
fn t_idle() -> Trace {
    tr2(name::RPM, name::IDLE_TARGET)
}
fn t_ped() -> Trace {
    Trace {
        lo: Some(0.0),
        hi: Some(100.0),
        ..tr2(name::PEDAL, name::TPS)
    }
}
fn t_map() -> Trace {
    tr2(name::MAP, name::BARO)
}
fn t_lam() -> Trace {
    tr2(name::LAMBDA, name::LAMBDA_TARGET)
}
fn t_ign() -> Trace {
    tr(name::IGN)
}
fn t_knk() -> Trace {
    tr2(name::KNOCK, name::KNOCK_THRESHOLD)
}
fn t_stft() -> Trace {
    tr(name::STFT)
}
fn t_duty() -> Trace {
    tr(name::DUTY)
}
fn t_cam() -> Trace {
    tr2(name::CAM, name::CAM_TARGET)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Occurrence {
    pub log_key: String,
    pub t0: f64,
    pub t1: f64,
    pub at: f64,
    pub label: String,
}

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    /// crit, warn, info or good
    pub sev: String,
    pub area: String,
    pub title: String,
    /// what the logs show
    pub evidence: Vec<String>,
    /// one plain sentence on why it matters
    #[serde(skip_serializing_if = "Option::is_none")]
    pub why: Option<String>,
    /// what to change, in order
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub steps: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub channels: Vec<Trace>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub log_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub t0: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub t1: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at: Option<f64>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub occurrences: Vec<Occurrence>,
    /// set when the finding points at a table rather than a moment in a log
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table: Option<String>,
}

impl Finding {
    fn at_log(mut self, log: &Log, t0: f64, t1: f64, at: f64) -> Self {
        self.log_key = Some(log.key.clone());
        self.t0 = Some(t0);
        self.t1 = Some(t1);
        self.at = Some(at);
        self
    }
}

fn rank(sev: &str) -> u8 {
    match sev {
        "crit" => 0,
        "warn" => 1,
        "info" => 2,
        _ => 3,
    }
}

fn round_to(v: f64, step: f64) -> f64 {
    js_round(v / step) * step
}

// ---------- ECU state channels ----------

fn state_skip() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)Injector \d|Ignition \d|Output State|Input State|Pin \d|Stepper|Pulse|Calibration|Diagnostic|Count|Cycle|Memory|Data Log|Derivative|Filter|Spectrogram|Reset|Bootmode|Fuel Pump|WIDEBAND|WB\d|Rate|Gain|Steering|Thermo|Slip|Gear|Detection|Upshift|Combined|Failed|Stages|Direction|Status|Check|Outcome|Switch|Cruise|Brake|Clutch|AVI\d").unwrap()
    })
}
fn state_key() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)Launch|Ignition|Limit|Fuel|Idle|Cam|Protection|Traction|Rolling|Anti|Flat")
            .unwrap()
    })
}
fn mode_switch() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)Launch|Rolling|Anti|Flat|Traction|Protection").unwrap())
}

/// Channels that describe an ECU mode or state: few distinct integer values, not per-cylinder or hardware detail.
fn state_names(log: &Log) -> &Vec<String> {
    log.states.get_or_init(|| {
        let mut out = Vec::new();
        for (j, nm) in log.names.iter().enumerate() {
            if log.types[j] != "Raw" || state_skip().is_match(nm) || log.is_const(j) {
                continue;
            }
            let a = log.chan_at(j);
            let mut seen: Vec<f64> = Vec::new();
            let mut ok = true;
            for &v in a {
                if v != js_round(v) {
                    ok = false;
                    break;
                }
                if !seen.contains(&v) {
                    seen.push(v);
                    if seen.len() > 12 {
                        ok = false;
                        break;
                    }
                }
            }
            if ok {
                out.push(nm.clone());
            }
        }
        out
    })
}

/// What normal idle looks like across all logs: accelerator released, car stopped, RPM near target.
struct Baseline {
    ign: f64,
    map: f64,
    states: Vec<(String, f64)>,
}

fn idle_baseline(logs: &[Log]) -> Baseline {
    let (mut ign, mut map) = (Vec::new(), Vec::new());
    let mut states: Vec<(String, Vec<f64>)> = Vec::new();
    for log in logs {
        let c = &log.ch;
        let idx: Vec<usize> = (0..log.n)
            .filter(|&i| {
                c.pedal[i] < 1.0
                    && c.vss[i] < 1.0
                    && c.rpm[i] > 300.0
                    && (c.rpm[i] - c.idle_t[i]).abs() < 0.12 * c.idle_t[i]
            })
            .collect();
        for &i in &idx {
            ign.push(c.ign[i]);
            map.push(c.map[i]);
        }
        if idx.is_empty() {
            continue;
        }
        for (j, nm) in log.names.iter().enumerate() {
            if log.types[j] != "Raw" || state_skip().is_match(nm) {
                continue;
            }
            let a = log.chan_at(j);
            let pos = match states.iter().position(|(n, _)| n == nm) {
                Some(p) => p,
                None => {
                    states.push((nm.clone(), Vec::new()));
                    states.len() - 1
                }
            };
            states[pos].1.extend(idx.iter().map(|&i| a[i]));
        }
    }
    Baseline {
        ign: quant(&ign, 0.75),
        map: median(&map),
        states: states
            .into_iter()
            .filter(|(_, v)| !v.is_empty())
            .map(|(n, v)| (n, mode(&v)))
            .collect(),
    }
}

struct StateDiff {
    name: String,
    now: f64,
    normal: f64,
}

/// State channels whose value during [i0, i1] differs from the idle baseline.
fn state_diff(log: &Log, i0: usize, i1: usize, base: &Baseline) -> Vec<StateDiff> {
    let mut out = Vec::new();
    for nm in state_names(log) {
        let Some(&(_, b)) = base.states.iter().find(|(n, _)| n == nm) else {
            continue;
        };
        if b.is_nan() {
            continue;
        }
        let v = mode(&log.x(nm)[i0..=i1]);
        if !v.is_nan() && v != b {
            out.push(StateDiff {
                name: nm.clone(),
                now: v,
                normal: b,
            });
        }
    }
    let any_key = out.iter().any(|d| state_key().is_match(&d.name));
    if any_key {
        out.retain(|d| state_key().is_match(&d.name));
    }
    out.truncate(4);
    out
}

/// Idle with the engine otherwise behaving: accelerator released, stopped, near target, normal timing.
fn steady_idle<'a>(log: &'a Log, base_ign: f64) -> impl Fn(usize) -> bool + 'a {
    let c = &log.ch;
    move |i| {
        c.pedal[i] < 1.0
            && c.vss[i] < 1.0
            && c.rpm[i] > 300.0
            && (c.idle_t[i] - c.rpm[i]).abs() < 250.0
            && !(c.ign[i] < base_ign - 4.0)
    }
}

// ---------- detectors ----------

struct Dip<'a> {
    cause: String,
    sw: Option<StateDiff>,
    tbl: Option<StateDiff>,
    ign: f64,
    ign_low: bool,
    rpm: f64,
    sev: &'static str,
    evidence: Vec<String>,
    log: &'a Log,
    t0: f64,
    t1: f64,
    at: f64,
    channels: Vec<Trace>,
}

fn find_idle_dips(logs: &[Log], base: &Baseline, out: &mut Vec<Finding>) {
    let mut found: Vec<Dip> = Vec::new();
    for log in logs {
        let (c, t) = (&log.ch, &log.t);
        let segs = segments(
            t,
            |i| {
                c.pedal[i] < 1.0
                    && c.rpm[i] > 250.0
                    && c.rpm[i]
                        < 0.8
                            * (if c.idle_t[i].is_nan() || c.idle_t[i] == 0.0 {
                                1000.0
                            } else {
                                c.idle_t[i]
                            })
            },
            0.3,
            2.0,
        );
        for s in segs.iter().take(3) {
            let mut kk = s.i0;
            for i in s.i0..=s.i1 {
                if c.rpm[i] < c.rpm[kk] {
                    kk = i;
                }
            }
            let ign = median(&c.ign[s.i0..=s.i1]);
            let (map_max, lam_max, st_min) = (
                max_of(&c.map[s.i0..=s.i1]),
                max_of(&c.lam[s.i0..=s.i1]),
                min_of(&c.stft[s.i0..=s.i1]),
            );
            let mut ev = vec![format!(
                "RPM fell to {} against a {} target and stayed under 80% of target for {} s.",
                n0(c.rpm[kk]),
                n0(c.idle_t[kk]),
                fx(t[s.i1] - t[s.i0], 1)
            )];
            let ign_low = !base.ign.is_nan() && base.ign - ign >= 5.0;
            if ign_low {
                ev.push(format!(
                    "Ignition was {}° during the dip. Steady idle in these logs runs {}°.",
                    fx(ign, 1),
                    fx(base.ign, 1)
                ));
            }
            if !base.map.is_nan() && map_max - base.map >= 12.0 {
                ev.push(format!(
                    "MAP rose to {} kPa. Steady idle sits at {} kPa.",
                    n0(map_max),
                    n0(base.map)
                ));
            }
            if lam_max >= 1.08 || st_min <= -8.0 {
                ev.push(format!(
                    "Lambda reached {} with short-term fuel trim at {}%.",
                    fx(lam_max, 2),
                    sgn(st_min, 1)
                ));
            }
            if (c.cam_t[kk] - c.cam[kk]).abs() >= 4.0 {
                ev.push(format!(
                    "Intake cam was at {}° against a {}° target.",
                    fx(c.cam[kk], 1),
                    fx(c.cam_t[kk], 1)
                ));
            }
            let mut diff = state_diff(log, s.i0, s.i1, base);
            if !diff.is_empty() {
                let list: Vec<String> = diff
                    .iter()
                    .map(|d| format!("{} {} (normally {})", d.name, num(d.now), num(d.normal)))
                    .collect();
                ev.push(format!(
                    "States that differ from steady idle: {}.",
                    list.join(", ")
                ));
            }
            let mut channels = vec![k(t_idle())];
            channels.push(if ign_low { k(t_ign()) } else { t_ign() });
            channels.extend(diff.iter().map(|d| k(tr(&d.name))));
            channels.extend([t_map(), t_lam(), t_stft(), t_cam()]);
            let sw_pos = diff.iter().position(|d| mode_switch().is_match(&d.name));
            let sw = sw_pos.map(|p| diff.remove(p));
            let tbl_pos = diff
                .iter()
                .position(|d| d.name.to_lowercase().contains("ignition active table"));
            let tbl = tbl_pos.map(|p| diff.remove(p));
            let cause = if ign_low && (sw.is_some() || tbl.is_some()) {
                format!(
                    "mode:{}{}",
                    sw.as_ref()
                        .map(|s| format!("{}{}", s.name, num(s.now)))
                        .unwrap_or_default(),
                    tbl.as_ref()
                        .map(|t| format!("tbl{}", num(t.now)))
                        .unwrap_or_default()
                )
            } else if ign_low {
                "ign".to_string()
            } else if st_min <= -8.0 && lam_max >= 1.08 {
                "trim".to_string()
            } else {
                "other".to_string()
            };
            found.push(Dip {
                cause,
                sw,
                tbl,
                ign,
                ign_low,
                rpm: c.rpm[kk],
                sev: if c.rpm[kk] < 0.65 * c.idle_t[kk] {
                    "crit"
                } else {
                    "warn"
                },
                evidence: ev,
                log,
                t0: t[s.i0],
                t1: t[s.i1],
                at: t[kk],
                channels,
            });
        }
    }
    // one finding per cause, worst occurrence first
    let mut groups: Vec<(String, Vec<Dip>)> = Vec::new();
    for f in found {
        match groups.iter_mut().find(|(c, _)| *c == f.cause) {
            Some((_, list)) => list.push(f),
            None => groups.push((f.cause.clone(), vec![f])),
        }
    }
    for (_, mut list) in groups {
        list.sort_by(|a, b| a.rpm.partial_cmp(&b.rpm).unwrap());
        let mut log_keys: Vec<&str> = list.iter().map(|f| f.log.key.as_str()).collect();
        log_keys.sort();
        log_keys.dedup();
        let (count, n_logs) = (list.len(), log_keys.len());
        let occurrences: Vec<Occurrence> = list
            .iter()
            .map(|f| Occurrence {
                log_key: f.log.key.clone(),
                t0: f.t0,
                t1: f.t1,
                at: f.at,
                label: format!("{} rpm", n0(f.rpm)),
            })
            .collect();
        let w = list.swap_remove(0);
        let mut ev = w.evidence.clone();
        if count > 1 {
            ev.insert(
                0,
                format!(
                    "Seen {} times in {} log{}. The numbers below are from the lowest one.",
                    count,
                    n_logs,
                    if n_logs > 1 { "s" } else { "" }
                ),
            );
        }
        let mut title = if count > 1 {
            format!("Idle dips below target, lowest {} rpm", n0(w.rpm))
        } else {
            format!("Idle dipped to {} rpm", n0(w.rpm))
        };
        let mut why = "An idle that falls this far under target is a near-stall. It is worst as the car comes to a stop, when the engine has no momentum to carry it.".to_string();
        let steps: Vec<String>;
        if let Some(sw) = &w.sw {
            // when does that mode switch on?
            let (mut n, mut v_max, mut ped_max) = (0, 0.0f64, 0.0f64);
            for log in logs {
                let (a, c) = (log.x(&sw.name), &log.ch);
                for i in 1..log.n {
                    if a[i] == sw.now && a[i - 1] != sw.now {
                        n += 1;
                        v_max = v_max.max(c.vss[i - 1]);
                        ped_max = ped_max.max(c.pedal[i]);
                    }
                }
            }
            let what = if sw.name.to_lowercase().contains("launch") {
                "Launch control".to_string()
            } else {
                sw.name
                    .strip_suffix(" State")
                    .unwrap_or(&sw.name)
                    .to_string()
            };
            if n > 0 {
                ev.push(format!("{} changed to {} on {} occasions, each as road speed fell below {} km/h with the accelerator at {}%.", sw.name, num(sw.now), n, fx(v_max, 0), n0(ped_max)));
            }
            title = format!(
                "{} switches on at every stop and idle falls to {} rpm",
                what,
                n0(w.rpm)
            );
            why = format!("At {}° of timing the engine makes far less torque from the same air. The idle controller has to open the throttle to hold speed, manifold vacuum is lost, and the engine can stall as the car stops.", fx(w.ign, 0));
            steps = vec![
                format!("In the {} setup, add an arming condition a stopped, idling car cannot meet: a minimum accelerator position (80% is a common choice) or a dedicated switch. Road speed alone arms it at every stop.", what.to_lowercase()),
                match &w.tbl {
                    Some(tb) => format!("If it has to arm on speed alone, edit the ignition table it switches to (Ignition Active Table {}): put idle timing, {}°, in the cells below 2,000 rpm instead of {}°.", num(tb.now), fx(base.ign, 0), fx(w.ign, 0)),
                    None => format!("If it has to arm on speed alone, raise the ignition it commands below 2,000 rpm from {}° to idle timing, {}°.", fx(w.ign, 0), fx(base.ign, 0)),
                },
                format!("Re-log a stop from a roll. Ignition should hold near {}° and MAP near {} kPa as the car comes to rest.", fx(base.ign, 0), n0(base.map)),
            ];
        } else if let Some(tb) = &w.tbl {
            steps = vec![format!("Find what selects Ignition Active Table {} at idle and stop it, or put {}° in that table’s idle cells.", num(tb.now), fx(base.ign, 0)), format!("Re-log a hot idle. Ignition should hold near {}°.", fx(base.ign, 0))];
        } else if w.ign_low {
            steps = vec![format!("Find which correction takes ignition from {}° to {}° at idle. Check Ignition Correction Total, then the idle, launch and anti-lag setups.", fx(base.ign, 0), fx(w.ign, 0)), format!("Re-log a hot idle. Ignition should hold near {}°.", fx(base.ign, 0))];
        } else if w.cause == "trim" {
            steps = vec!["Closed-loop trim was removing fuel going into the dip and lambda went lean. Fix the closed-loop fuel findings first, then re-log.".to_string()];
        } else {
            steps = vec!["Open this in the replay and compare the flagged channels against a steady idle to see which one moves first.".to_string()];
        }
        out.push(
            Finding {
                sev: w.sev.into(),
                area: "Idle".into(),
                title,
                evidence: ev,
                why: Some(why),
                steps,
                channels: w.channels.clone(),
                occurrences,
                ..Default::default()
            }
            .at_log(w.log, w.t0, w.t1, w.at),
        );
    }
}

/// The closed-loop target itself moving away from Target Lambda.
fn find_o2_swing(logs: &[Log], base: &Baseline, out: &mut Vec<Finding>) -> bool {
    let (mut idle_n, mut idle_off, mut ovr_n, mut ovr_off, mut lo, mut hi, mut map_max) =
        (0usize, 0usize, 0usize, 0usize, 0usize, 0usize, 0.0f64);
    let (mut gaps, mut lam, mut rich, mut lean, mut t_lo, mut t_hi) = (
        Vec::new(),
        Vec::new(),
        Vec::new(),
        Vec::new(),
        Vec::new(),
        Vec::new(),
    );
    let mut best: Option<(&Log, Seg, f64)> = None;
    for log in logs {
        let (c, t, o) = (&log.ch, &log.t, log.x(name::O2_TARGET));
        let steady = steady_idle(log, base.ign);
        let mut last: Option<f64> = None;
        for i in 0..log.n {
            let d = o[i] - c.lam_t[i];
            if !(c.rpm[i] > 400.0) || d.is_nan() {
                continue;
            }
            let (off, idle) = (d.abs() >= 0.05, c.pedal[i] < 1.0 && c.vss[i] < 1.0);
            if idle {
                idle_n += 1;
                if off {
                    idle_off += 1;
                }
            } else if c.pedal[i] < 1.0 {
                ovr_n += 1;
                if off {
                    ovr_off += 1;
                }
            }
            if off {
                if d > 0.0 {
                    hi += 1;
                    t_hi.push(o[i]);
                } else {
                    lo += 1;
                    t_lo.push(o[i]);
                }
                if c.map[i] > map_max {
                    map_max = c.map[i];
                }
            }
            if idle && off && steady(i) {
                lam.push(c.lam[i]);
                if c.lam[i] > 1.05 {
                    lean.push(c.rpm[i]);
                } else if c.lam[i] < 0.95 {
                    rich.push(c.rpm[i]);
                }
            }
            if i > 0 && idle && (o[i] - o[i - 1]).abs() > 0.15 {
                if let Some(l) = last {
                    if t[i] - l < 40.0 {
                        gaps.push(t[i] - l);
                    }
                }
                last = Some(t[i]);
            }
        }
        for s in segments(
            t,
            |i| steady(i) && (o[i] - c.lam_t[i]).abs() >= 0.05,
            8.0,
            0.5,
        ) {
            let dur = t[s.i1] - t[s.i0];
            if best.is_none_or(|b| dur > b.2) {
                best = Some((log, s, dur));
            }
        }
    }
    if idle_n < 100 || (idle_off as f64) / (idle_n as f64) < 0.5 || lo == 0 || hi == 0 {
        return false;
    }
    let (a, b) = (median(&t_lo), median(&t_hi));
    let amp = (b - a) / 2.0;
    let mut ev = vec![
        format!(
            "O2 Control Bank 1 Target is {} λ away from Target Lambda in {} of {} idle samples{}, alternating between {} and {}. It only happens below about {} kPa.",
            fx(amp, 2),
            n0(idle_off as f64),
            n0(idle_n as f64),
            if ovr_n > 0 { format!(" and {} of {} overrun samples", n0(ovr_off as f64), n0(ovr_n as f64)) } else { String::new() },
            fx(a, 2),
            fx(b, 2),
            n0(map_max)
        ),
        format!(
            "Each time lambda reaches the current target the target flips to the other side{}. Lambda sweeps {} to {} as a result.",
            if gaps.is_empty() { String::new() } else { format!(", every {} to {} s at idle", fx(quant(&gaps, 0.1), 0), fx(quant(&gaps, 0.9), 0)) },
            fx(quant(&lam, 0.03), 2),
            fx(quant(&lam, 0.97), 2)
        ),
    ];
    if rich.len() > 10 && lean.len() > 10 {
        ev.push(format!(
            "Idle RPM follows it: about {} rpm at the lean end and {} rpm at the rich end.",
            n0(median(&lean)),
            n0(median(&rich))
        ));
    }
    let mut f = Finding {
        sev: "warn".into(),
        area: "Fuel".into(),
        title: format!("Closed-loop fuel target swings ±{} λ at idle", fx(amp, 2)),
        evidence: ev,
        why: Some(format!("The ECU is steering the mixture from {}% rich to {}% lean and back. Torque changes with mixture, so idle speed rises and falls with it and the fuel trims never settle.", n0(amp * 100.0), n0(amp * 100.0))),
        steps: vec![
            format!("In the O2 control setup, find the setting that offsets or oscillates the closed-loop target (it may be called target oscillation, dither or switching amplitude). It is acting as ±{} λ. Set it to 0 so O2 Control Bank 1 Target equals Target Lambda.", fx(amp, 2)),
            format!("If the oscillation is there for a catalyst, keep it small: a few hundredths of lambda, not {}.", fx(amp, 2)),
            "Re-log a hot idle. O2 Control Bank 1 Target should read the same as Target Lambda and lambda should hold within about ±0.03.".into(),
            "Do this before changing idle speed or fuel trim gains. Those loops cannot be judged while this swing is driving them.".into(),
        ],
        channels: vec![k(tr2(name::LAMBDA, name::O2_TARGET)), k(tr2(name::O2_TARGET, name::LAMBDA_TARGET)), t_stft(), t_idle(), t_map()],
        ..Default::default()
    };
    if let Some((log, s, _)) = best {
        f = f.at_log(
            log,
            log.t[s.i0],
            log.t[s.i1].min(log.t[s.i0] + 25.0),
            log.t[s.i0],
        );
    }
    out.push(f);
    true
}

/// How hard the idle speed loop works for the error it sees.
fn find_idle_loop(logs: &[Log], base: &Baseline, swing: bool, out: &mut Vec<Finding>) {
    let (mut p_abs, mut i_rate, mut kp, mut ki, mut needs, mut swings, mut ratio) = (
        Vec::new(),
        Vec::new(),
        Vec::new(),
        Vec::new(),
        Vec::new(),
        Vec::new(),
        Vec::new(),
    );
    let (mut n, mut ign_max, mut kd_max) = (0usize, 0.0f64, 0.0f64);
    let mut worst: Option<(&Log, Seg, f64)> = None;
    for log in logs {
        let (c, t) = (&log.ch, &log.t);
        let (st, p, int, o, d) = (
            log.x(name::IDLE_STATE),
            log.x(name::IDLE_P),
            log.x(name::IDLE_I),
            log.x(name::IDLE_OUT),
            log.x(name::DBW_OFFSET),
        );
        let (kpc, kic, kdc, ig) = (
            log.x(name::IDLE_KP),
            log.x(name::IDLE_KI),
            log.x(name::IDLE_KD),
            log.x(name::IDLE_IGN),
        );
        let steady = steady_idle(log, base.ign);
        let on = |i: usize| steady(i) && st[i] == 1.0;
        let (mut i_all, mut e_all) = (Vec::new(), Vec::new());
        for i in 0..log.n {
            if !on(i) {
                continue;
            }
            let e = c.idle_t[i] - c.rpm[i];
            let ae = e.abs();
            n += 1;
            e_all.push(e);
            i_all.push(int[i]);
            if o[i] > 0.0 {
                ratio.push(d[i] / o[i]);
            }
            if ig[i].abs() > ign_max {
                ign_max = ig[i].abs();
            }
            if kdc[i] > kd_max {
                kd_max = kdc[i];
            }
            if ae <= 120.0 && kpc[i] > 0.0 {
                kp.push(kpc[i]);
                ki.push(kic[i]);
            }
            if (80.0..=120.0).contains(&ae) {
                p_abs.push(p[i].abs());
                let (a, b) = (i.saturating_sub(3), (i + 3).min(log.n - 1));
                if on(a) && on(b) && t[b] > t[a] {
                    i_rate.push((int[b] - int[a]).abs() / (t[b] - t[a]));
                }
            }
        }
        // within one log: how far the integral had to move for the RPM swing it was following
        if e_all.len() >= 150 {
            let (i_s, e_s) = (
                quant(&i_all, 0.97) - quant(&i_all, 0.03),
                quant(&e_all, 0.97) - quant(&e_all, 0.03),
            );
            if e_s > 0.0 {
                needs.push(i_s / e_s * 100.0);
                swings.push((i_s, e_s));
            }
        }
        for s in segments(
            t,
            |i| on(i) && (c.idle_t[i] - c.rpm[i]).abs() >= 80.0,
            1.0,
            0.2,
        ) {
            let dur = t[s.i1] - t[s.i0];
            if worst.is_none_or(|w| dur > w.2) {
                worst = Some((log, s, dur));
            }
        }
    }
    let Some((wlog, ws, wdur)) = worst else {
        return;
    };
    if n < 200 || p_abs.len() < 20 || i_rate.len() < 10 || needs.is_empty() {
        return;
    }
    let (p_at, rate, need, r) = (
        median(&p_abs),
        median(&i_rate),
        median(&needs),
        median(&ratio),
    );
    let (i_swing, e_swing) = swings[needs.iter().position(|&x| x == need).unwrap_or(0)];
    if !(need > 0.0) || !(p_at < 0.4 * need) {
        return;
    }
    let p_goal = 0.4 * need;
    let p_mult = js_round(p_goal / p_at).clamp(2.0, 4.0);
    let i_mult = (js_round(need / 2.0 / rate * 2.0) / 2.0).clamp(1.5, 3.0);
    let mut ev = vec![
        format!("At a normal, warm-timing idle, RPM sat more than 80 rpm off target for up to {} s at a time.", fx(wdur, 1)),
        format!(
            "At about 100 rpm of error the proportional term adds {}% output and the integral moves {}% per second.{}",
            fx(p_at, 1),
            fx(rate, 2),
            if r.is_nan() { String::new() } else { format!(" Each 1% of output is {}% of throttle, so that is {}% of throttle.", fx(r, 2), fx(p_at * r, 2)) }
        ),
        format!("Over one idle log the integral swings {}% to follow a {} rpm swing, so the engine needs roughly {}% of output per 100 rpm.", fx(i_swing, 1), n0(e_swing), fx(need, 1)),
    ];
    if kd_max == 0.0 || ign_max == 0.0 {
        ev.push(format!(
            "{}{}{}.",
            if kd_max == 0.0 { "Idle Control Derivative Gain is 0" } else { "" },
            if kd_max == 0.0 && ign_max == 0.0 { " and " } else { "" },
            if ign_max == 0.0 { "Idle Control Ignition Correction never leaves 0°: idle is held by the throttle alone" } else { "" }
        ));
    }
    let mut steps = Vec::new();
    if swing {
        steps.push("Fix the closed-loop fuel target swing first. It is the disturbance this loop is chasing, and gains set against it will be wrong once it is gone.".to_string());
    }
    steps.push(format!(
        "Raise Idle Control Proportional Gain where RPM error is under 120 rpm (logged {} to {} there). Aim for about {}% of output at 100 rpm of error; it gives {}% now, so roughly {}× the gain. Double it, re-log, and repeat rather than jumping straight there.",
        n0(quant(&kp, 0.1)),
        n0(quant(&kp, 0.9)),
        fx(p_goal, 1),
        fx(p_at, 1),
        num(p_mult)
    ));
    steps.push(format!(
        "Raise Idle Control Integral Gain about {}× (logged {} to {}). At {}%/s it takes {} s to wind in the {}% that 100 rpm needs; about 2 s is a good target.",
        num(i_mult),
        n0(quant(&ki, 0.1)),
        n0(quant(&ki, 0.9)),
        fx(rate, 2),
        fx(need / rate, 0),
        fx(need, 1)
    ));
    if ign_max == 0.0 {
        steps.push(format!("Turn on idle ignition control with about ±5° of authority around the {}° base. Ignition corrects RPM within one engine cycle; the throttle takes several.", fx(base.ign, 0)));
    }
    steps.push("Change one thing at a time and re-log a hot idle. Stop raising a gain when a 100 rpm error clears in about a second without RPM overshooting the target.".to_string());
    out.push(
        Finding {
            sev: "warn".into(),
            area: "Idle".into(),
            title: "Idle speed control barely reacts to RPM error".into(),
            evidence: ev,
            why: Some("A loop this soft lets idle drift 100 rpm or more for seconds at a time. That is what makes an idle feel lazy and lets it sag when a fan or the steering loads the engine.".into()),
            steps,
            channels: vec![k(t_idle()), k(tr2(name::IDLE_P, name::IDLE_I)), tr2(name::IDLE_OUT, name::IDLE_BASE), tr(name::DBW_OFFSET), tr(name::TPS), t_lam(), t_ign()],
            ..Default::default()
        }
        .at_log(wlog, wlog.t[ws.i0], wlog.t[ws.i1], wlog.t[ws.i0]),
    );
}

/// A standing integral offset means the base idle table is off at that coolant temperature.
fn find_idle_base(logs: &[Log], base: &Baseline, out: &mut Vec<Finding>) {
    struct Band<'a> {
        k: f64,
        int: Vec<f64>,
        base: Vec<f64>,
        log: &'a Log,
        i: usize,
    }
    let mut bands: Vec<Band> = Vec::new();
    for log in logs {
        let c = &log.ch;
        let (st, int, b) = (
            log.x(name::IDLE_STATE),
            log.x(name::IDLE_I),
            log.x(name::IDLE_BASE),
        );
        let steady = steady_idle(log, base.ign);
        for i in 0..log.n {
            if !steady(i) || st[i] != 1.0 || c.ect[i].is_nan() {
                continue;
            }
            let kk = (c.ect[i] / 10.0).floor() * 10.0;
            let pos = match bands.iter().position(|x| x.k == kk) {
                Some(p) => p,
                None => {
                    bands.push(Band {
                        k: kk,
                        int: Vec::new(),
                        base: Vec::new(),
                        log,
                        i,
                    });
                    bands.len() - 1
                }
            };
            bands[pos].int.push(int[i]);
            bands[pos].base.push(b[i]);
        }
    }
    bands.sort_by(|a, b| a.k.partial_cmp(&b.k).unwrap());
    let rows: Vec<(f64, f64, f64, usize, &Log, usize)> = bands
        .iter()
        .filter_map(|b| {
            let (mi, mb) = (median(&b.int), median(&b.base));
            (b.int.len() >= 100 && mi.abs() >= 4.0).then_some((
                b.k,
                mi,
                mb,
                b.int.len(),
                b.log,
                b.i,
            ))
        })
        .collect();
    let Some(&(wk, wmi, _, _, wlog, wi)) = rows.first() else {
        return;
    };
    let mut steps: Vec<String> = rows
        .iter()
        .map(|r| {
            format!(
                "Change Idle Control Base Output at {} to {} °C from about {}% to about {}%.",
                num(r.0),
                num(r.0 + 10.0),
                fx(r.2, 0),
                fx(r.2 + r.1, 0)
            )
        })
        .collect();
    steps.push("Re-log a warm-up. The integral term should rest within about ±2%.".into());
    out.push(
        Finding {
            sev: "info".into(),
            area: "Idle".into(),
            title: format!("Idle base output is {}% too {} at {} to {} °C", n0(wmi.abs()), if wmi < 0.0 { "high" } else { "low" }, num(wk), num(wk + 10.0)),
            evidence: rows.iter().map(|r| format!("Between {} and {} °C the base output is {}% and the integral term rests at {}% to hold target ({} samples).", num(r.0), num(r.0 + 10.0), fx(r.2, 0), sgn(r.1, 1), n0(r.3 as f64))).collect(),
            why: Some("The base table should put the engine at target on its own. When the integral has to carry a standing offset, idle flares or sags each time the controller takes over, until the integral winds back to that offset.".into()),
            steps,
            channels: vec![k(tr(name::IDLE_I)), k(tr2(name::IDLE_OUT, name::IDLE_BASE)), t_idle(), tr(name::ECT)],
            ..Default::default()
        }
        .at_log(wlog, wlog.t[wi], wlog.t[wlog.n - 1].min(wlog.t[wi] + 25.0), wlog.t[wi]),
    );
}

fn fuel_row(table: &Table, m: usize, pred: impl Fn(f64) -> bool) -> Vec<String> {
    (0..table.rpm_ax.len())
        .filter_map(|r| {
            let v = table.fuel[m][r];
            (!v.is_nan() && pred(v)).then(|| format!("{} rpm {}%", n0(table.rpm_ax[r]), sgn(v, 0)))
        })
        .collect()
}

fn find_overrun(logs: &[Log], table: Option<&Table>, out: &mut Vec<Finding>) {
    let (mut n, mut cut, mut dec, mut fnn) = (0usize, 0usize, 0usize, 0usize);
    let (mut ls, mut ts, mut ms, mut duty_min) = (0.0, 0.0, 0.0, f64::INFINITY);
    let (mut dmin, mut tps) = (Vec::new(), Vec::new());
    let mut best: Option<(&Log, Seg, f64)> = None;
    for log in logs {
        let c = &log.ch;
        let (dd, mm) = (log.x(name::DECEL), log.x(name::DECEL_MIN));
        let pred = |i: usize| c.pedal[i] < 1.0 && c.rpm[i] > 1800.0 && c.vss[i] > 10.0;
        for i in 0..log.n {
            if !pred(i) {
                continue;
            }
            n += 1;
            if dd[i] == 1.0 {
                dec += 1;
            }
            if !mm[i].is_nan() {
                dmin.push(mm[i]);
            }
            tps.push(c.tps[i]);
            if c.duty[i] < duty_min {
                duty_min = c.duty[i];
            }
            if !(c.duty[i] > 0.2) {
                cut += 1;
            } else if c.lam[i] > 0.6 && c.lam[i] < 1.4 {
                ls += c.lam[i];
                ts += c.lam_t[i];
                ms += c.map[i];
                fnn += 1;
            }
        }
        for s in segments(&log.t, pred, 1.5, 0.3) {
            let dur = log.t[s.i1] - log.t[s.i0];
            if best.is_none_or(|b| dur > b.2) {
                best = Some((log, s, dur));
            }
        }
    }
    if n < 40 || fnn == 0 {
        return;
    }
    let (lam, tgt) = (ls / fnn as f64, ts / fnn as f64);
    let rich = (1.0 - lam / tgt) * 100.0;
    let seen = dec as f64 / n as f64 > 0.8;
    if !((cut as f64 / n as f64) < 0.05 && rich >= 6.0) {
        return;
    }
    let mut ev = vec![
        format!("{} samples with the accelerator released above 1,800 rpm. Injectors stayed on in {}; duty never went below {}%.", n0(n as f64), if cut > 0 { format!("all but {cut}") } else { "every one".to_string() }, fx(duty_min, 1)),
        format!("Lambda averaged {} against a {} target at about {} kPa.", fx(lam, 2), fx(tgt, 2), n0(ms / fnn as f64)),
    ];
    if seen {
        ev.push(format!("Decel Detected reads 1 in {} of them, so the ECU recognises the overrun but is not cutting fuel.", n0(dec as f64)));
    }
    let mut steps = vec![if seen {
        format!("Turn on decel fuel cut, or raise its cut amount to 100%. The ECU already flags the decel and reports a Decel Min RPM of {} to {}; fuel should be off above that with the accelerator released.", n0(quant(&dmin, 0.05)), n0(quant(&dmin, 0.95)))
    } else {
        format!("Enable decel fuel cut so it triggers with the accelerator released above about 1,500 rpm. The throttle plate rests at {}% here, so any throttle threshold has to be above that.", fx(median(&tps), 1))
    }];
    if let Some(table) = table {
        for m in 0..table.map_ax.len() {
            if table.map_ax[m] <= 30.0 {
                let cells = fuel_row(table, m, |v| v <= -6.0);
                if !cells.is_empty() {
                    steps.push(format!("If you keep fuel on during overrun, lean the {} kPa row of the fuel table instead: {}.", num(table.map_ax[m]), cells.join(", ")));
                }
            }
        }
    }
    steps.push("Re-log a lift from about 4,000 rpm. Injector duty should read 0% until RPM falls to the minimum, then come back in without a stumble.".into());
    let mut f = Finding {
        sev: "warn".into(),
        area: "Fuel".into(),
        title: format!("No fuel cut on overrun, running {}% rich", n0(rich)),
        evidence: ev,
        why: Some(format!("Fuel injected on overrun does no work. At {}% rich it wastes fuel, can foul plugs, and leaves the wideband reading rich when you get back on the throttle.", n0(rich))),
        steps,
        channels: vec![k(t_duty()), k(t_lam()), tr(name::DECEL), t_ped(), t_rpm(), t_map()],
        ..Default::default()
    };
    if let Some((log, s, _)) = best {
        f = f.at_log(log, log.t[s.i0], log.t[s.i1], log.t[s.i0]);
    }
    out.push(f);
}

fn find_lean_boost(logs: &[Log], out: &mut Vec<Finding>) {
    let mut worst: Option<(&Log, usize, f64)> = None;
    for log in logs {
        let c = &log.ch;
        let hold = (js_round(0.3 * log.hz) as usize).max(3);
        let mut i = 0;
        while i + hold <= log.n {
            if c.map[i] > c.baro[i] + 15.0 && c.duty[i] > 1.0 {
                let mut lo = f64::INFINITY;
                for j in i..i + hold {
                    lo = js_min(lo, c.lam[j] - c.lam_t[j]);
                }
                if lo >= 0.04 && worst.is_none_or(|w| c.map[i] > w.2) {
                    worst = Some((log, i + (hold >> 1), c.map[i]));
                }
            }
            i += 1;
        }
    }
    let Some((log, i, _)) = worst else { return };
    let c = &log.ch;
    let st = if c.stft[i].is_nan() { 0.0 } else { c.stft[i] };
    let lt = if c.ltft[i].is_nan() { 0.0 } else { c.ltft[i] };
    let pct = (c.lam[i] / c.lam_t[i] * (1.0 + st / 100.0) * (1.0 + lt / 100.0) - 1.0) * 100.0;
    let (rpm_cell, map_cell) = (round_to(c.rpm[i], 500.0), round_to(c.map[i], 20.0));
    out.push(
        Finding {
            sev: if c.map[i] > c.baro[i] + 40.0 { "crit" } else { "warn" }.into(),
            area: "Fuel".into(),
            title: "Lean of target under boost".into(),
            evidence: vec![
                format!("Lambda held {} against a {} target at {} rpm, {} kPa.", fx(c.lam[i], 2), fx(c.lam_t[i], 2), n0(c.rpm[i]), n0(c.map[i])),
                format!("Short-term trim was {}%, long-term {}%, injector duty {}%.", sgn(st, 1), sgn(lt, 1), n0(c.duty[i])),
                "This is the highest load in the logs. Nothing above it has been tested.".into(),
            ],
            why: Some("Running leaner than target under boost raises combustion temperature. It is the usual route to knock and piston damage, and it gets worse as boost goes up.".into()),
            steps: vec![
                format!("Add {}% to the fuel table around {} rpm / {} kPa ({} ÷ {} with the trims included).", n0(pct), n0(rpm_cell), n0(map_cell), fx(c.lam[i], 2), fx(c.lam_t[i], 2)),
                format!("Carry the same {}% into the cells above {} kPa and past {} rpm before you go there. They are untested, and an untested cell should start rich.", n0(pct), n0(map_cell), n0(rpm_cell)),
                "Leave boost and timing where they are until a repeat pull holds lambda on target.".into(),
            ],
            channels: vec![k(t_lam()), t_map(), t_duty(), t_stft(), t_rpm(), t_ign()],
            ..Default::default()
        }
        .at_log(log, log.t[i] - 0.3, log.t[i] + 0.3, log.t[i]),
    );
}

/// `Math.min` semantics: NaN if either side is NaN.
fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.min(b)
    }
}

fn find_fuel_cells(table: &Table, out: &mut Vec<Finding>) {
    let mut n = 0;
    let (mut rows, mut big): (Vec<String>, Vec<(usize, usize, f64)>) = (Vec::new(), Vec::new());
    for m in (0..table.map_ax.len()).rev() {
        let cells = fuel_row(table, m, |v| v.abs() >= 8.0);
        if !cells.is_empty() {
            n += cells.len();
            rows.push(format!(
                "{} kPa row: {}.",
                num(table.map_ax[m]),
                cells.join(", ")
            ));
        }
        for r in 0..table.rpm_ax.len() {
            let v = table.fuel[m][r];
            if !v.is_nan() && v.abs() >= 8.0 {
                big.push((m, r, v));
            }
        }
    }
    if n == 0 {
        return;
    }
    big.sort_by(|a, b| b.2.abs().partial_cmp(&a.2.abs()).unwrap());
    let largest: Vec<String> = big
        .iter()
        .take(4)
        .map(|c| {
            format!(
                "{} rpm / {} kPa {}%",
                n0(table.rpm_ax[c.1]),
                num(table.map_ax[c.0]),
                sgn(c.2, 0)
            )
        })
        .collect();
    let mut steps = vec!["Scale each listed cell of the base fuel table by its correction: a −17% cell becomes 0.83 × its current value, a +18% cell 1.18 ×.".to_string()];
    steps.extend(rows);
    steps.push("Drive the same cells again and re-log. Repeat until they are within about ±3%, then let the trims handle the rest.".into());
    out.push(Finding {
        sev: "warn".into(),
        area: "Fuel".into(),
        title: format!("{} fuel table cell{} off by 8% or more", n, if n > 1 { "s are" } else { " is" }),
        evidence: vec![format!("Largest: {}.", largest.join(", ")), "From steady-state samples only, with the O2 trims included. Positive means the cell needs more fuel.".into()],
        why: Some("When the base table is this far out, the closed-loop trims are doing the fuelling. They react late, so the mixture is wrong every time load changes, and they are not there at all under boost.".into()),
        steps,
        table: Some("fuel".into()),
        ..Default::default()
    });
}

fn find_knock(logs: &[Log], out: &mut Vec<Finding>) {
    struct Band {
        k: f64,
        sig: Vec<f64>,
        thr: f64,
        margin: f64,
        map: f64,
    }
    let mut close: Option<(&Log, usize, f64)> = None;
    let mut counted = 0.0;
    let mut first: Option<(&Log, usize)> = None;
    let mut bands: Vec<Band> = Vec::new();
    for log in logs {
        let c = &log.ch;
        for i in 1..log.n {
            if c.knk_n[i] > c.knk_n[i - 1] {
                counted += c.knk_n[i] - c.knk_n[i - 1];
                if first.is_none() {
                    first = Some((log, i));
                }
            }
            let m = c.knk_t[i] - c.knk[i];
            if !(c.rpm[i] > 1500.0) || m.is_nan() {
                continue;
            }
            if close.is_none_or(|cl| m < cl.2) {
                close = Some((log, i, m));
            }
            let kk = (c.rpm[i] / 500.0).floor() * 500.0;
            let pos = match bands.iter().position(|b| b.k == kk) {
                Some(p) => p,
                None => {
                    bands.push(Band {
                        k: kk,
                        sig: Vec::new(),
                        thr: f64::INFINITY,
                        margin: f64::INFINITY,
                        map: f64::NAN,
                    });
                    bands.len() - 1
                }
            };
            let b = &mut bands[pos];
            b.sig.push(c.knk[i]);
            if m < b.margin {
                b.margin = m;
                b.thr = c.knk_t[i];
                b.map = c.map[i];
            }
        }
    }
    if counted > 0.0 {
        let (log, i) = first.unwrap();
        let c = &log.ch;
        out.push(
            Finding {
                sev: "crit".into(),
                area: "Knock".into(),
                title: format!("{} knock event{} counted", num(counted), if counted > 1.0 { "s" } else { "" }),
                evidence: vec![format!("First at {} rpm, {} kPa, with {}° of advance and lambda {}.", n0(c.rpm[i]), n0(c.map[i]), fx(c.ign[i], 1), fx(c.lam[i], 2))],
                why: Some("Knock is uncontrolled combustion. Sustained under load it breaks ring lands and pistons.".into()),
                steps: vec![
                    format!("Take 2° out of the ignition table at {} rpm / {} kPa and the cells around it.", n0(round_to(c.rpm[i], 500.0)), n0(round_to(c.map[i], 20.0))),
                    "Check lambda in the same cells is on target or richer.".into(),
                    "Re-log the same pull. If knock is still counted, take out another 2° before trying anything else.".into(),
                ],
                channels: vec![k(t_knk()), k(tr(name::KNOCK_COUNT)), t_ign(), t_rpm(), t_map(), t_lam()],
                ..Default::default()
            }
            .at_log(log, log.t[i] - 0.5, log.t[i] + 0.5, log.t[i]),
        );
        return;
    }
    let Some((log, i, m)) = close else { return };
    if !(m < 4.0) {
        return;
    }
    bands.sort_by(|a, b| a.k.partial_cmp(&b.k).unwrap());
    let tight: Vec<(f64, f64, f64, f64)> = bands
        .iter()
        .filter(|b| b.sig.len() >= 20 && b.margin < 6.0)
        .map(|b| (b.k, quant(&b.sig, 0.99), b.thr, b.map))
        .collect();
    let c = &log.ch;
    let mut ev = vec![format!("Closest: signal {} dB against a {} dB threshold at {} rpm, {} kPa. No knock was counted in any log.", fx(c.knk[i], 0), fx(c.knk_t[i], 0), n0(c.rpm[i]), n0(c.map[i]))];
    ev.extend(tight.iter().map(|b| {
        format!(
            "{} to {} rpm: background reaches {} dB, threshold {} dB near {} kPa.",
            n0(b.0),
            n0(b.0 + 500.0),
            fx(b.1, 0),
            fx(b.2, 0),
            n0(b.3)
        )
    }));
    let mut steps = Vec::new();
    if !tight.is_empty() {
        let list: Vec<String> = tight
            .iter()
            .take(8)
            .map(|b| {
                format!(
                    "{} to {} rpm near {} kPa, from {} to {} dB",
                    n0(b.0),
                    n0(b.0 + 500.0),
                    n0(b.3),
                    fx(b.2, 0),
                    fx((b.1 + 6.0).ceil(), 0)
                )
            })
            .collect();
        steps.push(format!(
            "Raise the Knock Threshold table to about 6 dB over background in these cells: {}.",
            list.join("; ")
        ));
    }
    steps.push("Only raise a cell if you are sure the engine was not knocking there. No knock was counted, but under boost check with audio knock detection before trusting the background figure.".into());
    steps.push("Re-log. Knock Sensor 1 Knock Count should stay at 0 in normal driving.".into());
    out.push(
        Finding {
            sev: "info".into(),
            area: "Knock".into(),
            title: format!("Knock threshold sits within {} dB of normal engine noise", fx(m.max(0.0), 0)),
            evidence: ev,
            why: Some("A threshold inside normal engine noise makes the ECU pull timing for knock that is not there. Set too far above it, real knock goes unseen. About 6 dB over the background is the usual margin.".into()),
            steps,
            channels: vec![k(t_knk()), t_ign(), tr("Knock Control Bank 1 Ignition Correction"), t_rpm(), t_map(), t_lam()],
            ..Default::default()
        }
        .at_log(log, log.t[i] - 0.5, log.t[i] + 0.5, log.t[i]),
    );
}

fn find_cam(logs: &[Log], out: &mut Vec<Finding>) {
    let mut worst: Option<(&Log, Seg, usize, f64)> = None;
    let (mut steady_err, mut slew) = (Vec::new(), Vec::new());
    let (mut kp, mut ki, mut kd) = (f64::NAN, f64::NAN, f64::NAN);
    for log in logs {
        let (c, t) = (&log.ch, &log.t);
        if kp.is_nan() {
            kp = mode(log.x(name::CAM_KP));
            ki = mode(log.x(name::CAM_KI));
            kd = mode(log.x(name::CAM_KD));
        }
        if log.n > 6 {
            for i in 3..log.n - 3 {
                if !(c.rpm[i] > 1500.0) {
                    continue;
                }
                let dt = t[i + 2] - t[i - 2];
                let (d_t, d_a) = (
                    (c.cam_t[i + 2] - c.cam_t[i - 2]) / dt,
                    (c.cam[i + 2] - c.cam[i - 2]) / dt,
                );
                if d_t.is_nan() || d_a.is_nan() {
                    continue;
                }
                slew.push(d_a.abs());
                if d_t.abs() < 3.0 {
                    steady_err.push(c.cam_t[i] - c.cam[i]);
                }
            }
        }
        for s in segments(
            t,
            |i| c.rpm[i] > 1500.0 && (c.cam_t[i] - c.cam[i]).abs() > 5.0,
            0.5,
            0.0,
        ) {
            let mut kk = s.i0;
            for i in s.i0..=s.i1 {
                if (c.cam_t[i] - c.cam[i]).abs() > (c.cam_t[kk] - c.cam[kk]).abs() {
                    kk = i;
                }
            }
            let e = (c.cam_t[kk] - c.cam[kk]).abs();
            if worst.is_none_or(|w| e > w.3) {
                worst = Some((log, s, kk, e));
            }
        }
    }
    let Some((log, s, kk, e)) = worst else { return };
    if steady_err.len() < 50 {
        return;
    }
    let (c, t) = (&log.ch, &log.t);
    let mean = steady_err.iter().sum::<f64>() / steady_err.len() as f64;
    let sd = (steady_err
        .iter()
        .map(|x| (x - mean) * (x - mean))
        .sum::<f64>()
        / steady_err.len() as f64)
        .sqrt();
    let top = quant(&slew, 0.99);
    let (a, b) = (s.i0.saturating_sub(10), (s.i1 + 2).min(log.n - 1));
    let (mut t_min, mut t_max) = (f64::INFINITY, f64::NEG_INFINITY);
    for i in a..=b {
        if c.cam_t[i] < t_min {
            t_min = c.cam_t[i];
        }
        if c.cam_t[i] > t_max {
            t_max = c.cam_t[i];
        }
    }
    let gains = if kp.is_nan() {
        String::new()
    } else {
        format!(" (logged P {}, I {}, D {})", n0(kp), n0(ki), n0(kd))
    };
    let moving = t_max - t_min >= 5.0;
    let steps = if mean.abs() < 2.0 && sd < 3.0 && moving {
        vec![
            format!("Leave the cam control gains alone{gains}. With the target steady the cam already holds it."),
            format!("Smooth the cam target table around {} rpm: neighbouring cells differ by enough that the target jumps {}° as load changes. Keep steps between adjacent cells to about 5°.", n0(round_to(c.rpm[kk], 500.0)), fx(t_max - t_min, 0)),
        ]
    } else if mean.abs() >= 2.0 {
        vec![
            format!("The cam rests {}° {} target when the target is steady. Raise Cam Control Intake Integral Gain about 1.5×{gains} and re-log.", fx(mean.abs(), 1), if mean > 0.0 { "short of" } else { "past" }),
            "If the offset stays, check oil pressure and temperature at the same RPM: the actuator needs pressure to hold position.".into(),
        ]
    } else {
        vec![format!("The cam wanders ±{}° around a steady target. Lower Cam Control Intake Proportional Gain by about 25%{gains} and re-log.", fx(sd, 1))]
    };
    out.push(
        Finding {
            sev: "info".into(),
            area: "Cam".into(),
            title: format!("Intake cam off target by {}°", fx(e, 0)),
            evidence: vec![
                format!("Cam at {}° against a {}° target at {} rpm, off by more than 5° for {} s.", fx(c.cam[kk], 1), fx(c.cam_t[kk], 1), n0(c.rpm[kk]), fx(t[s.i1] - t[s.i0], 1)),
                format!("Around that moment the target moved {}°. The cam itself moves at up to {}°/s in these logs.", fx(t_max - t_min, 0), n0(top)),
                format!("With the target steady, error averages {}° and varies by ±{}°.", sgn(mean, 1), fx(sd, 1)),
            ],
            why: Some("Cam timing sets how much air the engine traps. When the cam is not where the table says, fuel and ignition for that cell are slightly wrong too.".into()),
            steps,
            channels: vec![k(t_cam()), tr("Cam Control Intake Bank 1 Error"), tr("Cam Control Intake Bank 1 Output"), t_rpm(), t_map(), tr("Oil Pressure")],
            ..Default::default()
        }
        .at_log(log, t[s.i0], t[s.i1], t[kk]),
    );
}

/// A torque dip inside a pull that recovers, with what moved at the same time.
fn find_pull_dips(log: &Log, pull: &Pull, dy: &Dyno, out: &mut Vec<Finding>) {
    let (c, ch) = (&dy.core, &log.ch);
    if c.len() < 20 || !dy.peak_tq.is_some_and(|p| p.tq >= 90.0) {
        return;
    }
    let mut peak = c[0];
    let mut dip: Option<(crate::dyno::Pt, crate::dyno::Pt)> = None;
    let mut rec: Option<crate::dyno::Pt> = None;
    for p in c.iter().skip(1) {
        if let Some((from, _)) = dip {
            if p.tq >= from.tq * 0.97 {
                rec = Some(*p);
                break;
            }
        }
        if dip.is_none() && p.tq > peak.tq {
            peak = *p;
            continue;
        }
        if p.tq < peak.tq * 0.92
            && peak.tq - p.tq >= 12.0
            && dip.is_none_or(|(_, low)| p.tq < low.tq)
        {
            dip = Some((peak, *p));
        }
    }
    let (Some((from, low)), Some(rec)) = (dip, rec) else {
        return;
    };
    let (a, b) = (from.i, low.i);
    let mut ev = vec![format!(
        "Torque fell {}% between {} and {} rpm, then recovered by {} rpm.",
        n0((1.0 - low.tq / from.tq) * 100.0),
        n0(from.rpm),
        n0(low.rpm),
        n0(rec.rpm)
    )];
    let (mut why, mut steps): (Vec<String>, Vec<String>) = (Vec::new(), Vec::new());
    if ch.ign[a] - ch.ign[b] >= 1.5 {
        why.push(format!(
            "ignition dropped {}°",
            fx(ch.ign[a] - ch.ign[b], 1)
        ));
        steps.push(format!("Look at the ignition table between {} and {} rpm at {} kPa. If the {}° drop is in the table, smooth it; if it is a correction, find which one in the replay.", n0(from.rpm), n0(low.rpm), n0(ch.map[b]), fx(ch.ign[a] - ch.ign[b], 1)));
    }
    if ch.tps[a] - ch.tps[b] >= 5.0 && (ch.pedal[a] - ch.pedal[b]).abs() < 3.0 {
        why.push(format!(
            "the throttle plate closed {}% with the accelerator held",
            n0(ch.tps[a] - ch.tps[b])
        ));
        steps.push("The drive-by-wire table or a torque limiter is closing the throttle. Check the pedal-to-throttle map and any boost or traction limit at that point.".into());
    }
    if ch.pedal[a] - ch.pedal[b] >= 5.0 {
        why.push(format!(
            "the accelerator was eased {}%",
            n0(ch.pedal[a] - ch.pedal[b])
        ));
        steps
            .push("This one is the driver. Repeat the pull holding the accelerator steady.".into());
    }
    if ch.map[a] - ch.map[b] >= 5.0 {
        why.push(format!("MAP fell {} kPa", n0(ch.map[a] - ch.map[b])));
        steps.push("Boost dropped. Check boost control duty and the wastegate at that RPM.".into());
    }
    if (ch.lam[b] - ch.lam_t[b]).abs() >= 0.06 {
        why.push(format!(
            "lambda was {} against {}",
            fx(ch.lam[b], 2),
            fx(ch.lam_t[b], 2)
        ));
        steps.push(format!(
            "Correct the fuel table at {} rpm / {} kPa by {}%.",
            n0(round_to(ch.rpm[b], 500.0)),
            n0(round_to(ch.map[b], 20.0)),
            sgn((ch.lam[b] / ch.lam_t[b] - 1.0) * 100.0, 0)
        ));
    }
    ev.push(if why.is_empty() { "Ignition, throttle, MAP and lambda were steady through it, so it may be road surface or gradient.".to_string() } else { format!("At the same time {}.", why.join(", ")) });
    if steps.is_empty() {
        steps.push("Repeat the pull on the same road. A dip that moves or disappears is the road; one that stays at the same RPM is the engine.".into());
    }
    out.push(
        Finding {
            sev: if why.is_empty() { "info" } else { "warn" }.into(),
            area: "Run".into(),
            title: format!("Torque dip at {} rpm", n0(low.rpm)),
            evidence: ev,
            why: Some("A dip that the engine recovers from is power left on the table, and it usually has one cause you can see in the log.".into()),
            steps,
            channels: vec![k(tr("calc:tq")), t_ign(), t_ped(), t_map(), t_lam(), t_rpm()],
            ..Default::default()
        }
        .at_log(log, pull.t0, pull.t1, low.t),
    );
}

/// Everything the logs show as a whole, most serious first.
pub fn analyze_logs(logs: &[Log], table: Option<&Table>) -> Vec<Finding> {
    let mut out = Vec::new();
    if logs.is_empty() {
        return out;
    }
    let base = idle_baseline(logs);
    find_idle_dips(logs, &base, &mut out);
    let swing = find_o2_swing(logs, &base, &mut out);
    find_idle_loop(logs, &base, swing, &mut out);
    find_idle_base(logs, &base, &mut out);
    find_overrun(logs, table, &mut out);
    find_lean_boost(logs, &mut out);
    if let Some(t) = table {
        find_fuel_cells(t, &mut out);
    }
    find_knock(logs, &mut out);
    find_cam(logs, &mut out);
    out.sort_by_key(|f| rank(&f.sev));
    out
}

/// Checks on one pull.
pub fn check_pull(log: &Log, pull: &Pull, dy: Option<&Dyno>) -> Vec<Finding> {
    let (i0, i1, t, ch) = (pull.i0, pull.i1, &log.t, &log.ch);
    let mut out: Vec<Finding> = Vec::new();
    let span = |f: Finding, at: f64| f.at_log(log, t[i0], t[i1], at);
    let run = |sev: &str,
               title: String,
               evidence: Vec<String>,
               steps: Vec<String>,
               channels: Vec<Trace>| Finding {
        sev: sev.into(),
        area: "Run".into(),
        title,
        evidence,
        steps,
        channels,
        ..Default::default()
    };
    let mut pk = i0;
    for i in i0..=i1 {
        if ch.pedal[i] > ch.pedal[pk] {
            pk = i;
        }
    }
    let lift = (pk..=i1).find(|&i| ch.pedal[pk] - ch.pedal[i] > 12.0);
    if pull.peak_pedal < 90.0 {
        out.push(span(
            run(
                "warn",
                "Part throttle".into(),
                vec![format!("Accelerator peaked at {}% and the throttle plate at {}%. The curve is power at that opening, not full power.", n0(pull.peak_pedal), n0(pull.peak_tps))],
                vec!["For a power figure, repeat the pull with the accelerator fully down from the start RPM to the end.".into()],
                vec![k(t_ped()), t_map(), t_rpm(), tr("calc:whp")],
            ),
            t[pk],
        ));
    }
    if let Some(l) = lift {
        out.push(span(
            run(
                "warn",
                "Accelerator eased mid-pull".into(),
                vec![format!("Accelerator went from {}% to {}% before the pull ended. Power after that point is not comparable.", n0(ch.pedal[pk]), n0(ch.pedal[l]))],
                vec![format!("Compare runs only up to {} rpm, or repeat the pull holding the accelerator steady.", n0(ch.rpm[l]))],
                vec![k(t_ped()), t_map(), t_rpm(), tr("calc:whp")],
            ),
            t[l],
        ));
    }
    if let Some(dy) = dy {
        find_pull_dips(log, pull, dy, &mut out);
        if let Some(s) = &dy.speed_check {
            let txt = format!(
                "ECU speed gives {} km/h per 1,000 rpm. Gearing and tire size give {}.",
                fx(s.ecu, 2),
                fx(s.gear, 2)
            );
            if s.diff.abs() > 3.0 {
                out.push(run(
                    "warn",
                    format!("ECU speed reads {}% {}", fx(s.diff.abs(), 1), if s.diff < 0.0 { "low" } else { "high" }),
                    vec![format!("{txt} Power moves by about twice that error.")],
                    vec!["Check the final drive, gear ratios and tire size in Vehicle settings first.".into(), "If those are right, correct the speed calibration in the ECU, or switch the speed source to gearing and tire.".into()],
                    vec![],
                ));
            } else {
                out.push(run(
                    "good",
                    "ECU speed matches the gearing".into(),
                    vec![txt],
                    vec![],
                    vec![],
                ));
            }
        }
        if let Some(f) = &dy.fuel_check {
            let tail = format!(" lb/hp·h at the crank with 13% driveline loss. E{} under boost normally runs {} to {}.", n0(f.eth), fx(f.lo, 2), fx(f.hi, 2));
            let ev = vec![format!(
                "Commanded fuel works out to {}{}",
                fx(f.bsfc, 2),
                tail
            )];
            if f.bsfc < f.lo {
                out.push(run("warn", "Estimate is high for the fuel used".into(), ev, vec!["The car is probably lighter than entered, or the ECU speed reads high. Check weight and speed calibration in Vehicle settings.".into()], vec![]));
            } else if f.bsfc > f.hi {
                out.push(run("warn", "Estimate is low for the fuel used".into(), ev, vec!["The car is probably heavier than entered, the ECU speed reads low, or the pull was uphill. Check weight and speed calibration in Vehicle settings.".into()], vec![]));
            } else {
                out.push(run(
                    "good",
                    "Fuel flow agrees with the estimate".into(),
                    ev,
                    vec![],
                    vec![],
                ));
            }
        }
    }
    let hold = (js_round(0.3 * log.hz) as usize).max(3);
    let (mut lean, mut lean_max): (Option<usize>, f64) = (None, 0.0);
    let mut i = i0;
    while i + hold - 1 <= i1 {
        if ch.map[i] > 100.0 {
            let mut lo = f64::INFINITY;
            for j in i..i + hold {
                lo = js_min(lo, ch.lam[j] - ch.lam_t[j]);
            }
            if lo > lean_max {
                lean_max = lo;
                lean = Some(i + (hold >> 1));
            }
        }
        i += 1;
    }
    if let Some(l) = lean {
        if lean_max >= 0.03 {
            out.push(span(
                run(
                    if lean_max >= 0.06 { "crit" } else { "warn" },
                    "Lean of target under boost".into(),
                    vec![format!(
                        "Lambda held {} against a {} target at {} rpm, {} kPa.",
                        fx(ch.lam[l], 2),
                        fx(ch.lam_t[l], 2),
                        n0(ch.rpm[l]),
                        n0(ch.map[l])
                    )],
                    vec![format!(
                        "Add {}% to the fuel table around {} rpm / {} kPa, then repeat the pull.",
                        n0((ch.lam[l] / ch.lam_t[l] - 1.0) * 100.0),
                        n0(round_to(ch.rpm[l], 500.0)),
                        n0(round_to(ch.map[l], 20.0))
                    )],
                    vec![k(t_lam()), t_map(), t_duty(), t_stft(), t_rpm(), t_ign()],
                ),
                t[l],
            ));
        }
    }
    let (mut slip, mut slip_max): (Option<usize>, f64) = (None, 0.0);
    for i in i0..=i1 {
        if ch.und[i] > 10.0 {
            let s = (ch.drv[i] - ch.und[i]) / ch.und[i] * 100.0;
            if s > slip_max {
                slip_max = s;
                slip = Some(i);
            }
        }
    }
    if let Some(s) = slip {
        if slip_max >= 4.0 {
            out.push(span(
                run(
                    "warn",
                    "Wheel slip".into(),
                    vec![format!("Driven wheels ran {}% faster than undriven. Speed from RPM overstates acceleration there.", fx(slip_max, 1))],
                    vec![format!("Use a higher gear for power pulls, or ignore the curve around {} rpm.", n0(ch.rpm[s]))],
                    vec![k(tr2(name::DRIVEN, name::UNDRIVEN)), t_rpm(), t_ped(), tr("calc:tq")],
                ),
                t[s],
            ));
        }
    }
    let mut ki = i0;
    for i in i0..=i1 {
        if ch.knk[i] > ch.knk[ki] {
            ki = i;
        }
    }
    let kn = ch.knk_n[i1] - ch.knk_n[i0];
    if kn > 0.0 {
        out.push(span(
            run(
                "crit",
                "Knock counted".into(),
                vec![format!("{} knock event(s) during the pull.", num(kn))],
                vec![format!(
                    "Take 2° out of the ignition table at {} rpm / {} kPa and repeat the pull.",
                    n0(round_to(ch.rpm[ki], 500.0)),
                    n0(round_to(ch.map[ki], 20.0))
                )],
                vec![
                    k(t_knk()),
                    tr(name::KNOCK_COUNT),
                    t_ign(),
                    t_rpm(),
                    t_map(),
                    t_lam(),
                ],
            ),
            t[ki],
        ));
    } else if !ch.knk_t[ki].is_nan() {
        out.push(span(
            run(
                "good",
                "No knock counted".into(),
                vec![format!(
                    "Knock signal peaked at {} dB against a {} dB threshold.",
                    n0(ch.knk[ki]),
                    n0(ch.knk_t[ki])
                )],
                vec![],
                vec![k(t_knk()), t_ign(), t_rpm(), t_map()],
            ),
            t[ki],
        ));
    }
    let mut di = i0;
    for i in i0..=i1 {
        if ch.duty[i] > ch.duty[di] {
            di = i;
        }
    }
    if ch.duty[di] >= 85.0 {
        out.push(span(
            run(
                "crit",
                format!("Injector duty at {}%", n0(ch.duty[di])),
                vec!["Above 85% the injectors are out of headroom and fuel pressure starts to decide the mixture.".into()],
                vec!["Do not add boost. Fit larger injectors or raise base fuel pressure, then re-enter the injector data.".into()],
                vec![k(t_duty()), tr(name::FUEL_FLOW), t_map(), t_rpm(), t_lam()],
            ),
            t[di],
        ));
    }
    if pull.gain < 1500.0 {
        out.push(run(
            "info",
            "Short RPM sweep".into(),
            vec![format!(
                "Only {} rpm of sweep. Peaks from a short pull are unreliable.",
                n0(pull.gain)
            )],
            vec![],
            vec![],
        ));
    }
    out.push(run("info", format!("{} samples at {} Hz", i1 - i0 + 1, n0(log.hz)), vec!["Acceleration is a derivative, so sample rate limits detail. A faster log rate tightens the curve.".into()], vec![], vec![]));
    out.sort_by_key(|f| rank(&f.sev));
    out
}
