//! What the log list shows, as the core gives it: each log's start and the library's order.

mod common;

use std::fs;

use common::{call, root, sample_session};
use logviewer_core::Session;
use serde_json::json;

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
