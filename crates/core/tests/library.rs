//! The library on disk: importing, duplicates, removal, the watch folder and reopening.

use std::fs;
use std::path::{Path, PathBuf};

mod common;

use common::call;
use logviewer_core::{Reply, Session};
use serde_json::json;

fn sample(name: &str) -> (String, String) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../testdata/logs")
        .join(name);
    (
        name.to_string(),
        fs::read_to_string(path).expect("test log"),
    )
}

fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("logviewer-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn names(s: &mut Session) -> Vec<String> {
    call(s, "logs", json!({}))
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["name"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn import_remove_and_reopen() {
    let dir = scratch("library");
    let (a_name, a) = sample("PCLog_2026-04-17_0142pm.csv");
    let (b_name, b) = sample("PCLog_2026-04-17_0146pm.csv");

    let mut s = Session::open(dir.clone());
    assert!(names(&mut s).is_empty());
    s.load_text(&a_name, &a).unwrap();
    assert!(
        dir.join("logs").join(&a_name).is_file(),
        "the log is copied into the library"
    );

    // the same log again, under its own name or another, is refused
    assert_eq!(
        s.load_text(&a_name, &a).unwrap_err(),
        format!("{a_name} is already in the library.")
    );
    assert!(s
        .load_text("copy.csv", &a)
        .unwrap_err()
        .contains(&format!("already in the library as {a_name}")));
    // a different log with a name already taken is kept beside the first
    s.load_text(&a_name, &b).unwrap();
    assert_eq!(
        names(&mut s),
        vec![a_name.replace(".csv", " (2).csv"), a_name.clone()]
    );
    // anything else is refused with the reason
    assert!(s
        .load_text("notes.csv", "a,b\n1,2\n")
        .unwrap_err()
        .starts_with("Not an NSP datalog export"));

    // settings round-trip
    call(
        &mut s,
        "set_settings",
        json!({ "value": { "model": "custom" } }),
    )
    .unwrap();
    assert_eq!(
        call(&mut s, "get_settings", json!({})).unwrap()["model"],
        "custom"
    );

    // a new session finds the same library
    let mut s = Session::open(dir.clone());
    assert_eq!(names(&mut s).len(), 2);
    assert_eq!(
        call(&mut s, "get_settings", json!({})).unwrap()["model"],
        "custom"
    );
    assert!(
        s.load_text("copy.csv", &a).is_err(),
        "duplicates are still recognised after reopening"
    );

    // removing deletes the library copy
    let key = call(&mut s, "logs", json!({})).unwrap()[1]["key"]
        .as_str()
        .unwrap()
        .to_string();
    call(&mut s, "remove_log", json!({ "key": key })).unwrap();
    assert!(!dir.join("logs").join(&a_name).exists());
    assert_eq!(names(&mut s).len(), 1);

    let _ = fs::remove_dir_all(&dir);
    let _ = b_name;
}

#[test]
fn watch_folder_scan() {
    let dir = scratch("watch");
    let inbox = dir.join("inbox");
    fs::create_dir_all(&inbox).unwrap();
    let (a_name, a) = sample("PCLog_2026-04-17_0142pm.csv");
    let (b_name, b) = sample("PCLog_2026-04-17_0146pm.csv");
    fs::write(inbox.join(&a_name), &a).unwrap();
    fs::write(inbox.join("shopping.csv"), "item,qty\nplugs,4\n").unwrap();
    fs::write(inbox.join("readme.txt"), "not a csv").unwrap();

    let mut s = Session::open(dir.join("library"));
    let scan =
        |s: &mut Session| call(s, "scan_dir", json!({ "path": inbox.to_str().unwrap() })).unwrap();
    assert_eq!(
        scan(&mut s),
        json!({ "added": [a_name], "errors": [] }),
        "the NSP log is imported, other files are passed over"
    );
    assert_eq!(
        scan(&mut s),
        json!({ "added": [], "errors": [] }),
        "a second scan finds nothing new"
    );

    // the same log under another name is not imported twice
    fs::write(inbox.join("again.csv"), &a).unwrap();
    assert_eq!(scan(&mut s)["added"], json!([]));

    // a log the user removed does not come back on the next scan, or after reopening
    let key = call(&mut s, "logs", json!({})).unwrap()[0]["key"]
        .as_str()
        .unwrap()
        .to_string();
    call(&mut s, "remove_log", json!({ "key": key })).unwrap();
    fs::remove_file(inbox.join("again.csv")).unwrap();
    assert_eq!(scan(&mut s)["added"], json!([]));
    let mut s = Session::open(dir.join("library"));
    assert_eq!(scan(&mut s)["added"], json!([]));
    // adding it by hand brings it back
    s.load_text(&a_name, &a).unwrap();
    assert_eq!(names(&mut s), vec![a_name.clone()]);

    // new logs keep arriving
    fs::write(inbox.join(&b_name), &b).unwrap();
    assert_eq!(scan(&mut s)["added"], json!([b_name]));

    assert!(call(
        &mut s,
        "scan_dir",
        json!({ "path": dir.join("missing").to_str().unwrap() })
    )
    .unwrap_err()
    .starts_with("Cannot read"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn log_data_layout() {
    let (name, text) = sample("PCLog_2026-04-17_0142pm.csv");
    let mut s = Session::memory();
    let key = s.load_text(&name, &text).unwrap();
    let meta = call(&mut s, "logs", json!({})).unwrap();
    let (n, channels) = (
        meta[0]["n"].as_u64().unwrap() as usize,
        meta[0]["channels"].as_array().unwrap().clone(),
    );
    let series = channels
        .iter()
        .filter(|c| !c["constant"].as_bool().unwrap())
        .count();
    let Reply::Bytes(blob) = s.dispatch("log_data", json!({ "key": key })).unwrap() else {
        panic!("expected bytes")
    };
    assert_eq!(
        blob.len(),
        (1 + series) * n * 4,
        "time base plus every changing channel as f32"
    );
    let f = |i: usize| f32::from_le_bytes(blob[i * 4..i * 4 + 4].try_into().unwrap());
    assert_eq!(f(0), 0.0, "time starts at zero");
    assert!(f(n - 1) > 10.0 && f(n - 1) < 30.0, "the log is 18 s long");
    // RPM is a changing channel; find its block and check the values look like engine speed
    let k = channels
        .iter()
        .filter(|c| !c["constant"].as_bool().unwrap())
        .position(|c| c["name"] == "RPM")
        .unwrap();
    let rpm: Vec<f32> = (0..n).map(|i| f((k + 1) * n + i)).collect();
    assert!(rpm.iter().all(|v| *v >= 0.0 && *v < 9000.0));
    assert!(rpm.iter().cloned().fold(0.0, f32::max) > 800.0);
}
