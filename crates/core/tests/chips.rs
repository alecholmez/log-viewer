//! The replay's chips through the `chips` command the UI calls, on the sample logs: the states, and the answer's shape.
//! The switches in the answer are tested in switches.rs.

mod common;

use common::{call, default_pull, log_key, pull, sample_session};
use logviewer_core::Session;
use serde_json::{json, Value};

fn chips(s: &mut Session, log: &str, t0: f64, t1: f64) -> Value {
    call(s, "chips", json!({ "log": log, "t0": t0, "t1": t1 })).unwrap()
}

fn state_names(reply: &Value) -> Vec<&str> {
    let rows = reply["states"]["rows"].as_array().unwrap();
    rows.iter().map(|r| r["name"].as_str().unwrap()).collect()
}

#[test]
fn the_default_pull_gets_its_states_in_order_of_first_change() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let (log, t0, t1) = default_pull(&mut s);
    let reply = chips(&mut s, &log, t0, t1);
    assert_eq!(
        state_names(&reply),
        [
            "Drive By Wire Throttle Motor Direction",
            "Engine State",
            "Idle Control State",
            "Ignition Active Table",
            "Gear",
            "Traction Control State",
            "Manifold Pressure Filter Scale",
        ]
    );
    assert_eq!(reply["states"]["more"], 0);
}

#[test]
fn gear_reads_1_2_3_across_the_default_pull() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let (log, t0, t1) = default_pull(&mut s);
    let reply = chips(&mut s, &log, t0, t1);
    assert_eq!(
        reply["states"]["rows"][4],
        json!({
            "name": "Gear",
            "sections": [[t0, 31.251, 1.0], [31.251, 35.817, 2.0], [35.817, t1, 3.0]],
            "gaps": [],
            "changes": [31.251, 35.817],
        })
    );
}

#[test]
fn idle_control_state_reads_its_negative_values() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let (log, t0, t1) = default_pull(&mut s);
    let reply = chips(&mut s, &log, t0, t1);
    assert_eq!(
        reply["states"]["rows"][2],
        json!({
            "name": "Idle Control State",
            "sections": [
                [t0, 29.918, -7.0],
                [29.918, 29.963, -9.0],
                [29.963, 30.679, -3.0],
                [30.679, 35.058, -7.0],
                [35.058, 35.534, -3.0],
                [35.534, t1, -7.0]
            ],
            "gaps": [],
            "changes": [29.918, 29.963, 30.679, 35.058, 35.534],
        })
    );
}

#[test]
fn the_1_44_pm_2nd_gear_pull_gets_five_states() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let (log, t0, t1) = pull(&mut s, "PCLog_2026-04-17_0144pm.csv|20260417 01:44:01@12.1");
    let reply = chips(&mut s, &log, t0, t1);
    assert_eq!(
        state_names(&reply),
        [
            "Idle Control State",
            "Drive By Wire Throttle Motor Direction",
            "Engine State",
            "Ignition Active Table",
            "Gear",
        ]
    );
    assert_eq!(reply["states"]["more"], 0);
    assert_eq!(
        reply["states"]["rows"][4]["sections"],
        json!([[t0, 12.093, 1.0], [12.093, 17.376, 2.0], [17.376, t1, 3.0]])
    );
}

/// Eleven states change across the whole 1:44 pm log. The eight that change least are kept, in order of first change.
#[test]
fn a_whole_log_keeps_the_states_that_change_least() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let log = log_key(&mut s, "PCLog_2026-04-17_0144pm.csv");
    let reply = chips(&mut s, &log, 0.0, 75.441);
    assert_eq!(
        state_names(&reply),
        [
            "Launch Control State",
            "Engine State",
            "Drive By Wire 1 Pin 2 Output State",
            "Start Button Next Expected Action Channel",
            "Traction Control State",
            "Gear",
            "Manifold Pressure Filter Scale",
            "Last Engine Limiting Function",
        ]
    );
    // Ignition Active Table (29 changes), Idle Control State (39), Drive By Wire Throttle Motor Direction (55)
    assert_eq!(reply["states"]["more"], 3);
}

#[test]
fn the_1_42_pm_log_has_one_state_and_no_switch() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let log = log_key(&mut s, "PCLog_2026-04-17_0142pm.csv");
    let reply = chips(&mut s, &log, 0.0, 18.371);
    assert_eq!(reply["switches"], json!({ "rows": [], "more": 0 }));
    assert_eq!(state_names(&reply), ["Idle Control State"]);
    assert_eq!(
        reply["states"]["rows"][0],
        json!({
            "name": "Idle Control State",
            "sections": [[0.0, 0.081, -1.0], [0.081, 18.371, 1.0]],
            "gaps": [],
            "changes": [0.081],
        })
    );
}

/// Trigger Synchronisation State changes 2.4 to 3.7 times a second in every sample log, and Data Log Status and Data Log
/// Memory State are the logger's own: none of them is ever a state. At most eight states change in any 2 s of the sample
/// logs, so none is left out of a 2 s window and its answer lists every state that changes in it.
#[test]
fn signals_and_the_loggers_own_channels_are_never_states() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let logs = call(&mut s, "logs", json!({})).unwrap();
    let logs: Vec<(String, f64)> = (logs.as_array().unwrap().iter())
        .map(|l| {
            (
                l["key"].as_str().unwrap().to_string(),
                l["duration"].as_f64().unwrap(),
            )
        })
        .collect();
    let mut seen = 0;
    for (log, duration) in logs {
        let mut t0 = 0.0;
        while t0 < duration {
            let reply = chips(&mut s, &log, t0, (t0 + 2.0).min(duration));
            assert_eq!(reply["states"]["more"], 0, "{log} at {t0} s");
            for name in state_names(&reply) {
                assert!(
                    ![
                        "Trigger Synchronisation State",
                        "Data Log Status",
                        "Data Log Memory State"
                    ]
                    .contains(&name),
                    "{name} in {log} at {t0} s"
                );
                seen += 1;
            }
            t0 += 2.0;
        }
    }
    // the windows did hold states
    assert!(seen > 0);
}

#[test]
fn traction_control_state_is_one_of_the_default_pulls_states() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let (log, t0, t1) = default_pull(&mut s);
    let reply = chips(&mut s, &log, t0, t1);
    let tcs = &reply["states"]["rows"][5];
    assert_eq!(tcs["name"], "Traction Control State");
    assert_eq!(
        tcs["changes"],
        json!([
            32.631, 32.676, 32.916, 32.961, 33.34, 33.393, 33.453, 33.53, 33.627, 35.008, 35.957,
            36.005
        ])
    );
    assert_eq!(tcs["sections"][0], json!([t0, 32.631, 0.0]));
}

/// The answer holds the switches and the states, each as `{ rows, more }`.
#[test]
fn the_answer_holds_the_switches_and_the_states_of_the_span() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let (log, t0, t1) = default_pull(&mut s);
    let reply = chips(&mut s, &log, t0, t1);
    let mut keys: Vec<&str> = reply
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(keys, ["states", "switches"]);
    assert_eq!(reply["switches"]["rows"].as_array().unwrap().len(), 6);
    assert_eq!(reply["switches"]["more"], 0);
}

#[test]
fn the_same_span_gives_the_same_answer_every_time() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let (log, t0, t1) = default_pull(&mut s);
    let first = chips(&mut s, &log, t0, t1);
    // another span in between: what is found for the log is kept, the answer for a span is not
    chips(&mut s, &log, 0.0, 10.0);
    assert_eq!(chips(&mut s, &log, t0, t1), first);
}

#[test]
fn a_request_that_cannot_be_answered_says_why() {
    let Some(mut s) = sample_session() else {
        return;
    };
    let log = log_key(&mut s, "PCLog_2026-04-17_0145pm.csv");
    let err = |s: &mut Session, args: Value| call(s, "chips", args).unwrap_err();
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
