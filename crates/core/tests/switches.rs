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
