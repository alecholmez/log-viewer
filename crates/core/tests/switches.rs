//! The replay's switch rows, through the `switches` command the UI calls, on the sample logs.

mod common;

use common::{call, default_pull, log_key, pull, sample_session, PULL_PAD};
use logviewer_core::Session;
use serde_json::{json, Value};

fn rows(s: &mut Session, log: &str, t0: f64, t1: f64) -> Value {
    call(s, "switches", json!({ "log": log, "t0": t0, "t1": t1 })).unwrap()
}

fn names(reply: &Value) -> Vec<&str> {
    let rows = reply["rows"].as_array().unwrap();
    rows.iter().map(|r| r["name"].as_str().unwrap()).collect()
}

#[test]
fn the_default_pull_gets_its_rows_in_order_of_first_change() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let (log, t0, t1) = default_pull(&mut s);
    assert_eq!(log, log_key(&mut s, "PCLog_2026-04-17_0145pm.csv"));
    assert_eq!((t0, t1), (31.251 - PULL_PAD, 34.91 + PULL_PAD));

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

/// Nine switches change across the whole 1:44 pm log, fewer than the limit: all nine, in order of first change.
#[test]
fn a_whole_log_shows_all_nine_of_its_switches() {
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
            "Stepper 1 Pin 2 Output State",
        ]
    );
    assert_eq!(reply["more"], 0);
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

/// Known limit of the grouping rule: in the 1:55 pm log four channels each change once, at the same sample, so the rule
/// takes them for one signal. Thermofan 2 Output State, the shortest name, carries the other three.
#[test]
fn four_channels_that_change_once_at_the_same_sample_are_one_switch() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let log = log_key(&mut s, "PCLog_2026-04-17_0155pm.csv");
    let reply = rows(&mut s, &log, 0.0, 69.663);
    let rows = reply["rows"].as_array().unwrap();
    let fan = rows
        .iter()
        .find(|r| r["name"] == "Thermofan 2 Output State");
    assert_eq!(
        fan,
        Some(&json!({
            "name": "Thermofan 2 Output State",
            "also": [
                "Thermofan 1 Idle Up Active",
                "Thermofan 2 Idle Up Active",
                "Digital Pulse Output 2 Output State"
            ],
            "on": [[60.909, 69.663]],
            "gaps": [],
            "changes": [60.909],
        }))
    );
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
    // another span in between: the groups found for the log are kept, the rows are not
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
