//! Smoothing of the power curve, through the `dyno` command the UI calls, on the sample logs.

mod common;

use std::fs;

use common::{call, root, sample_session};
use logviewer_core::Session;
use serde_json::{json, Value};

/// The vehicle the snapshot was made with, as the UI sends it.
fn vehicle() -> Value {
    let golden = fs::read_to_string(root().join("crates/core/tests/golden.json")).unwrap();
    serde_json::from_str::<Value>(&golden).unwrap()["vehicle"].clone()
}

fn dyno(s: &mut Session, vehicle: &Value, pull: &str) -> Value {
    call(s, "dyno", json!({ "vehicle": vehicle, "runs": [pull] })).unwrap()
}

fn with_smooth(vehicle: &Value, rpm: f64) -> Value {
    let mut v = vehicle.clone();
    v["smooth"] = json!(rpm);
    v
}

fn column(curve: &Value, key: &str) -> Vec<f64> {
    let pts = curve.as_array().unwrap();
    pts.iter().map(|p| p[key].as_f64().unwrap()).collect()
}

/// Sample-to-sample wiggle: the mean absolute second difference.
fn roughness(y: &[f64]) -> f64 {
    let d2 = y.windows(3).map(|w| (w[2] - 2.0 * w[1] + w[0]).abs());
    d2.sum::<f64>() / (y.len() - 2) as f64
}

fn pull_keys(s: &mut Session) -> Vec<String> {
    let overview = call(s, "overview", json!({})).unwrap();
    let pulls = overview["pulls"].as_array().unwrap();
    pulls
        .iter()
        .map(|p| p["key"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn a_request_without_smoothing_is_the_curve_as_computed() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let veh = vehicle();
    for key in pull_keys(&mut s) {
        assert_eq!(
            dyno(&mut s, &veh, &key),
            dyno(&mut s, &with_smooth(&veh, 0.0), &key),
            "{key}"
        );
    }
}

#[test]
fn smoothing_keeps_the_rpm_range_of_every_pull_and_removes_wiggle() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let veh = vehicle();
    for key in pull_keys(&mut s) {
        let raw = dyno(&mut s, &veh, &key);
        let smooth = dyno(&mut s, &with_smooth(&veh, 250.0), &key);
        let (raw, smooth) = (&raw["runs"][0]["core"], &smooth["runs"][0]["core"]);

        assert_eq!(
            column(smooth, "rpm"),
            column(raw, "rpm"),
            "{key}: the curve covers different engine speeds"
        );
        let (before, after) = (
            roughness(&column(raw, "hp")),
            roughness(&column(smooth, "hp")),
        );
        assert!(
            after < before * 0.8,
            "{key}: roughness {before:.2} -> {after:.2}"
        );
    }
}

#[test]
fn peaks_torque_and_the_weight_band_come_from_the_smoothed_curve() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let veh = vehicle();
    for key in pull_keys(&mut s) {
        let raw = dyno(&mut s, &veh, &key);
        let smooth = dyno(&mut s, &with_smooth(&veh, 250.0), &key);
        let run = &smooth["runs"][0];
        let (hp, tq, rpm) = (
            column(&run["core"], "hp"),
            column(&run["core"], "tq"),
            column(&run["core"], "rpm"),
        );

        let top = hp.iter().cloned().fold(f64::MIN, f64::max);
        assert_eq!(
            run["peakHp"]["hp"].as_f64().unwrap(),
            top,
            "{key}: peak power is not on the curve"
        );
        let top = tq.iter().cloned().fold(f64::MIN, f64::max);
        assert_eq!(
            run["peakTq"]["tq"].as_f64().unwrap(),
            top,
            "{key}: peak torque is not on the curve"
        );
        for i in 0..hp.len() {
            assert!(
                (tq[i] - hp[i] * 5252.0 / rpm[i]).abs() < 1e-9,
                "{key}: torque does not follow power"
            );
        }
        for edge in ["lo", "hi"] {
            let (before, after) = (
                roughness(&column(&raw["band"][edge], "hp")),
                roughness(&column(&smooth["band"][edge], "hp")),
            );
            assert!(
                after < before * 0.8,
                "{key}: band {edge} roughness {before:.2} -> {after:.2}"
            );
        }
    }
}

/// What a log says is wrong must not depend on how smooth the user likes the chart.
#[test]
fn findings_on_a_pull_do_not_change_with_the_smoothing_level() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let veh = vehicle();
    let mut dips = 0;
    for key in pull_keys(&mut s) {
        let raw = dyno(&mut s, &veh, &key);
        for level in [150.0, 250.0, 400.0] {
            let smooth = dyno(&mut s, &with_smooth(&veh, level), &key);
            assert_eq!(smooth["checks"], raw["checks"], "{key} at ±{level} rpm");
        }
        let checks = raw["checks"].as_array().unwrap();
        dips += checks
            .iter()
            .filter(|c| c["title"].as_str().unwrap().starts_with("Torque dip"))
            .count();
    }
    // the sample logs hold a torque dip that smoothing flattens on the drawn curve; without one this test proves little
    assert!(dips > 0, "no torque dip finding in the sample logs");
}

#[test]
fn the_fuel_check_does_not_change_with_the_smoothing_level() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let veh = vehicle();
    let mut checked = 0;
    for key in pull_keys(&mut s) {
        let raw = dyno(&mut s, &veh, &key);
        let smooth = dyno(&mut s, &with_smooth(&veh, 250.0), &key);
        assert_eq!(
            smooth["runs"][0]["fuelCheck"], raw["runs"][0]["fuelCheck"],
            "{key}"
        );
        checked += usize::from(!raw["runs"][0]["fuelCheck"].is_null());
    }
    assert!(checked > 0, "no pull in the sample logs has a fuel check");
}

/// A finding about the shape of the curve carries that stretch of the curve as computed,
/// so the chart can show what the finding describes at any smoothing level.
#[test]
fn a_torque_dip_finding_carries_the_stretch_of_curve_it_describes() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let veh = vehicle();
    let mut dips = 0;
    for key in pull_keys(&mut s) {
        let as_computed = dyno(&mut s, &veh, &key)["runs"][0]["core"].clone();
        let smoothed = dyno(&mut s, &with_smooth(&veh, 250.0), &key);
        for f in smoothed["checks"].as_array().unwrap() {
            if !f["title"].as_str().unwrap().starts_with("Torque dip") {
                continue;
            }
            dips += 1;
            let (at, pts) = (&f["dyno"]["at"], &f["dyno"]["pts"]);
            assert!(
                pts.is_array(),
                "{key}: the dip finding has no curve for the chart"
            );
            let pts = pts.as_array().unwrap();

            // the stretch is the curve as computed, not the smoothed one
            for p in pts {
                let same = as_computed
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|q| q["i"] == p["i"]);
                assert_eq!(
                    Some(p),
                    same,
                    "{key}: a point of the stretch is not on the curve as computed"
                );
            }
            // it runs from before the dip to the recovery, and names the lowest point
            let tq = column(&f["dyno"]["pts"], "tq");
            let (first, last) = (tq[0], tq[tq.len() - 1]);
            let low = tq.iter().cloned().fold(f64::MAX, f64::min);
            assert!(
                low < first * 0.92 && first - low >= 12.0,
                "{key}: no dip in the stretch: {tq:?}"
            );
            assert!(
                last >= first * 0.97,
                "{key}: the stretch ends before torque recovers: {tq:?}"
            );
            assert_eq!(
                at["tq"].as_f64().unwrap(),
                low,
                "{key}: the named point is not the lowest"
            );
            assert!(
                pts.contains(at),
                "{key}: the named point is not on the stretch"
            );
        }
    }
    assert!(dips > 0, "no torque dip finding in the sample logs");
}
