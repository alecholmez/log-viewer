//! What the log list shows, as the core gives it: each log's start, the library's order, the sentence that says what a
//! pull is, and why a log has no pull.

mod common;

use std::fs;

use common::{call, root, sample_session};
use logviewer_core::Session;
use serde_json::{json, Value};

/// A small NSP log: the `Log :` header line (None for a log without one), then the channels as (name, NSP type, raw
/// samples as NSP writes them: Speed and Percentage in tenths), one row every `ms` milliseconds from `clock`, which is
/// the hour and minute (`13:00`) the log starts at, on the minute. Every log needs RPM and Vehicle Speed.
fn nsp(
    header: Option<&str>,
    clock: &str,
    ms: usize,
    channels: &[(&str, &str, Vec<f64>)],
) -> String {
    let mut text = String::from("%DataLog%\n");
    for (name, ty, _) in channels {
        text += &format!("Channel : {name}\nType : {ty}\n");
    }
    if let Some(h) = header {
        text += &format!("Log : {h}\n");
    }
    for i in 0..channels[0].2.len() {
        let t = i * ms;
        text += &format!("{clock}:{:02}.{:03}", t / 1000, t % 1000);
        for (_, _, v) in channels {
            text += &format!(",{}", v[i]);
        }
        text += "\n";
    }
    text
}

/// RPM as given and the car standing still, 50 ms apart. The RPM samples make each log's bytes its own.
fn idle(header: Option<&str>, clock: &str, rpm: &[f64]) -> String {
    let still = vec![0.0; rpm.len()];
    nsp(
        header,
        clock,
        50,
        &[
            ("RPM", "EngineSpeed", rpm.to_vec()),
            ("Vehicle Speed", "Speed", still),
        ],
    )
}

fn sample(name: &str) -> String {
    fs::read_to_string(root().join("testdata/logs").join(name)).expect("sample log")
}

/// Each log in the library as (file name, start), in the library's order.
fn starts(s: &mut Session) -> Vec<(String, Option<String>)> {
    let logs = call(s, "logs", json!({})).unwrap();
    let logs = logs.as_array().unwrap();
    logs.iter()
        .map(|l| {
            let at = l["startedAt"].as_str().map(str::to_string);
            (l["name"].as_str().unwrap().to_string(), at)
        })
        .collect()
}

#[test]
fn each_sample_log_starts_at_its_header_date_and_the_clock_of_its_first_row() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let at = |name: &str, t: &str| (name.to_string(), Some(t.to_string()));
    assert_eq!(
        starts(&mut s),
        [
            at("PCLog_2026-04-17_0136pm.csv", "2026-04-17T13:36:54"),
            at("PCLog_2026-04-17_0140pm.csv", "2026-04-17T13:40:22"),
            at("PCLog_2026-04-17_0142pm.csv", "2026-04-17T13:42:04"),
            at("PCLog_2026-04-17_0144pm.csv", "2026-04-17T13:44:01"),
            at("PCLog_2026-04-17_0145pm.csv", "2026-04-17T13:45:37"),
            at("PCLog_2026-04-17_0146pm.csv", "2026-04-17T13:46:49"),
            at("PCLog_2026-04-17_0148pm.csv", "2026-04-17T13:48:57"),
            at("PCLog_2026-04-17_0155pm.csv", "2026-04-17T13:55:10"),
        ]
    );
}

#[test]
fn a_header_with_no_date_gives_no_start() {
    let mut s = Session::memory();
    s.load_text("no-header.csv", &idle(None, "13:00", &[3000.0, 3001.0]))
        .unwrap();
    s.load_text(
        "short-date.csv",
        &idle(Some("2026417 01:00:00"), "13:00", &[3000.0, 3002.0]),
    )
    .unwrap();
    // beside them, a log whose header does carry a date
    s.load_text(
        "zz-dated.csv",
        &idle(Some("20260417 01:00:00"), "13:00", &[3000.0, 3003.0]),
    )
    .unwrap();
    assert_eq!(
        starts(&mut s),
        [
            (
                "zz-dated.csv".to_string(),
                Some("2026-04-17T13:00:00".to_string())
            ),
            ("no-header.csv".to_string(), None),
            ("short-date.csv".to_string(), None)
        ]
    );
}

#[test]
fn logs_are_listed_by_start_then_file_name_and_logs_with_no_start_come_last() {
    let mut s = Session::memory();
    // added out of order on purpose: the library sorts them
    let day = Some("20260417 01:00:00");
    s.load_text("zz-undated.csv", &idle(None, "13:00", &[3000.0, 3001.0]))
        .unwrap();
    s.load_text(
        "PCLog_2026-04-17_0146pm.csv",
        &sample("PCLog_2026-04-17_0146pm.csv"),
    )
    .unwrap();
    s.load_text("b-same-minute.csv", &idle(day, "13:43", &[3000.0, 3002.0]))
        .unwrap();
    // a file the person named, holding the 1:36 pm log: it goes where its start puts it
    s.load_text("Warm-up.csv", &sample("PCLog_2026-04-17_0136pm.csv"))
        .unwrap();
    s.load_text("a-same-minute.csv", &idle(day, "13:43", &[3000.0, 3003.0]))
        .unwrap();
    s.load_text(
        "PCLog_2026-04-17_0142pm.csv",
        &sample("PCLog_2026-04-17_0142pm.csv"),
    )
    .unwrap();
    s.load_text("aa-undated.csv", &idle(None, "13:00", &[3000.0, 3004.0]))
        .unwrap();
    let names: Vec<String> = starts(&mut s).into_iter().map(|(n, _)| n).collect();
    assert_eq!(
        names,
        [
            "Warm-up.csv",
            "PCLog_2026-04-17_0142pm.csv",
            "a-same-minute.csv",
            "b-same-minute.csv",
            "PCLog_2026-04-17_0146pm.csv",
            "aa-undated.csv",
            "zz-undated.csv",
        ]
    );
}

const RULE: &str = "A pull is RPM rising in one gear, with the car moving and the accelerator pedal at 15% or more, for at least 1.2 s and 700 rpm.";

/// Each log with no pull as (file name, reason), in the library's order.
fn no_pulls(s: &mut Session) -> Vec<(String, String)> {
    let logs = call(s, "logs", json!({})).unwrap();
    let name = |key: &Value| {
        let log = logs.as_array().unwrap().iter().find(|l| l["key"] == *key);
        log.unwrap()["name"].as_str().unwrap().to_string()
    };
    let overview = call(s, "overview", json!({})).unwrap();
    let rows = overview["noPulls"].as_array().unwrap();
    rows.iter()
        .map(|r| {
            (
                name(&r["logKey"]),
                r["reason"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

#[test]
fn the_overview_says_what_a_pull_is() {
    let mut s = Session::memory();
    assert_eq!(
        call(&mut s, "overview", json!({})).unwrap()["pullRule"],
        RULE
    );
}

#[test]
fn each_sample_log_with_no_pull_says_why_in_its_own_numbers() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let out_of_gear = "No pulls: the car stayed out of gear and did not move.";
    let row = |name: &str, reason: &str| (name.to_string(), reason.to_string());
    assert_eq!(
        no_pulls(&mut s),
        [
            row("PCLog_2026-04-17_0136pm.csv", out_of_gear),
            row(
                "PCLog_2026-04-17_0140pm.csv",
                &format!("{out_of_gear} The accelerator pedal reached 54%.")
            ),
            row("PCLog_2026-04-17_0142pm.csv", out_of_gear),
            row(
                "PCLog_2026-04-17_0148pm.csv",
                "No pulls: the accelerator pedal peaked at 14.7%, under the 15% a pull needs."
            ),
        ]
    );
}

/// One log of 2 s at 50 ms a row, or of `rpm.len()` rows at `ms`: RPM as given, and Gear, Vehicle Speed and the accelerator
/// pedal each held at one raw value (Speed and Percentage in tenths). None leaves that channel out of the log.
fn drive(ms: usize, rpm: Vec<f64>, gear: Option<f64>, speed: f64, pedal: Option<f64>) -> String {
    let n = rpm.len();
    let mut channels = vec![
        ("RPM", "EngineSpeed", rpm),
        ("Vehicle Speed", "Speed", vec![speed; n]),
    ];
    if let Some(g) = gear {
        channels.push(("Gear", "Gear", vec![g; n]));
    }
    if let Some(p) = pedal {
        channels.push((
            "Drive By Wire Accelerator Pedal Position",
            "Percentage",
            vec![p; n],
        ));
    }
    nsp(Some("20260417 01:00:00"), "13:00", ms, &channels)
}

/// Why this one log has no pull.
fn why(text: &str) -> String {
    let mut s = Session::memory();
    s.load_text("t.csv", text).unwrap();
    let rows = no_pulls(&mut s);
    assert_eq!(rows.len(), 1, "{rows:?}");
    rows[0].1.clone()
}

/// What NSP writes for "no reading".
const NONE: f64 = 2_147_483_647.0;

#[test]
fn a_log_out_of_gear_or_standing_still_says_so_and_says_when_the_pedal_was_pressed() {
    let flat = || vec![3000.0; 40];
    // no gear channel at all reads as never in gear
    assert_eq!(
        why(&drive(50, flat(), None, 0.0, Some(400.0))),
        "No pulls: the car stayed out of gear and did not move. The accelerator pedal reached 40%."
    );
    assert_eq!(
        why(&drive(50, flat(), Some(0.0), 300.0, Some(100.0))),
        "No pulls: the car stayed out of gear."
    );
    assert_eq!(
        why(&drive(50, flat(), Some(2.0), 100.0, Some(600.0))),
        "No pulls: the car stayed under 12 km/h. The accelerator pedal reached 60%."
    );
    // a speed channel with no reading reads as never moving
    assert_eq!(
        why(&drive(50, flat(), Some(2.0), NONE, Some(200.0))),
        "No pulls: the car stayed under 12 km/h. The accelerator pedal reached 20%."
    );
}

#[test]
fn a_log_in_gear_and_moving_says_what_the_pedal_or_the_rpm_did() {
    let flat = || vec![3000.0; 40];
    assert_eq!(
        why(&drive(50, flat(), Some(2.0), 300.0, Some(149.0))),
        "No pulls: the accelerator pedal peaked at 14.9%, under the 15% a pull needs."
    );
    assert_eq!(
        why(&drive(50, flat(), Some(2.0), 300.0, Some(500.0))),
        "No pulls: RPM never rose in gear with the accelerator pedal at 15% or more."
    );
    // RPM rises 20 a row from the 10th row to the 25th, then falls. The rule compares RPM three rows either side, so the
    // stretch runs from the 7th row to the 23rd: 0.8 s, 3,000 to 3,280 rpm
    let rise: Vec<f64> = (0..40)
        .map(|i| match i {
            0..=9 => 3000.0,
            10..=25 => 3000.0 + 20.0 * (i - 9) as f64,
            _ => 3320.0 - 40.0 * (i - 25) as f64,
        })
        .collect();
    assert_eq!(
        why(&drive(50, rise, Some(2.0), 300.0, Some(500.0))),
        "No pulls: the longest stretch of rising RPM in one gear lasted 0.8 s and gained 280 rpm. A pull needs 1.2 s and 700 rpm."
    );
}

#[test]
fn a_stretch_just_short_of_the_time_a_pull_needs_is_not_written_as_that_time() {
    // 20 ms a row: RPM rises 5 a row from the 20th row to the 77th, then falls. The stretch runs from the 17th row to the
    // 76th: 1.18 s, which one decimal would write as 1.2 s, and 3,000 to 3,285 rpm
    let rpm: Vec<f64> = (0..100)
        .map(|i| match i {
            0..=19 => 3000.0,
            20..=77 => 3000.0 + 5.0 * (i - 19) as f64,
            _ => 3290.0 - 5.0 * (i - 77) as f64,
        })
        .collect();
    assert_eq!(
        why(&drive(20, rpm, Some(2.0), 300.0, Some(500.0))),
        "No pulls: the longest stretch of rising RPM in one gear lasted 1.18 s and gained 285 rpm. A pull needs 1.2 s and 700 rpm."
    );
}

#[test]
fn a_log_with_a_pull_has_no_reason() {
    // RPM rises 25 a row for 2 s: 1,000 rpm in one gear
    let rpm: Vec<f64> = (0..40).map(|i| 3000.0 + 25.0 * i as f64).collect();
    let mut s = Session::memory();
    s.load_text("t.csv", &drive(50, rpm, Some(2.0), 300.0, Some(500.0)))
        .unwrap();
    let overview = call(&mut s, "overview", json!({})).unwrap();
    assert_eq!(overview["pulls"].as_array().unwrap().len(), 1);
    assert_eq!(overview["noPulls"], json!([]));
}
