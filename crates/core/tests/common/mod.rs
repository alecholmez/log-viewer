//! Shared by the integration tests.
#![allow(dead_code)]

use std::fs;
use std::path::PathBuf;

use logviewer_core::{Reply, Session};
use serde_json::{json, Value};

pub fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A session holding every log in `testdata/logs`, or None when the sample logs are not there.
pub fn sample_session() -> Option<Session> {
    let dir = root().join("testdata/logs");
    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .map(|rd| rd.filter_map(|e| e.ok().map(|e| e.path())).collect())
        .unwrap_or_default();
    files.retain(|p| p.extension().is_some_and(|e| e == "csv"));
    files.sort();
    if files.is_empty() {
        eprintln!("no sample logs in {}; skipping", dir.display());
        return None;
    }
    let mut s = Session::memory();
    for f in &files {
        let text = String::from_utf8_lossy(&fs::read(f).unwrap()).into_owned();
        s.load_text(f.file_name().unwrap().to_str().unwrap(), &text)
            .unwrap();
    }
    Some(s)
}

/// A command that answers with JSON, as a shell calls it.
pub fn call(s: &mut Session, cmd: &str, args: Value) -> Result<Value, String> {
    match s.dispatch(cmd, args)? {
        Reply::Json(v) => Ok(v),
        Reply::Bytes(_) => Err("expected JSON".into()),
    }
}

/// Seconds shown either side of a pull. Copies the UI's rule for the span of a pull (`focusPull` in `src/state.ts`).
pub const PULL_PAD: f64 = 1.5;

/// The key of a sample log, by its file name.
pub fn log_key(s: &mut Session, file: &str) -> String {
    let logs = call(s, "logs", json!({})).unwrap();
    let log = logs.as_array().unwrap().iter().find(|l| l["name"] == file);
    log.expect("sample log")["key"]
        .as_str()
        .unwrap()
        .to_string()
}

/// A pull's log and the span the replay shows for it: the pull with `PULL_PAD` either side, kept inside the log,
/// as the UI does.
pub fn replay_span(s: &mut Session, pull: &Value) -> (String, f64, f64) {
    let log = pull["logKey"].as_str().unwrap().to_string();
    let logs = call(s, "logs", json!({})).unwrap();
    let meta = logs.as_array().unwrap().iter().find(|l| l["key"] == log);
    let duration = meta.unwrap()["duration"].as_f64().unwrap();
    let (t0, t1) = (pull["t0"].as_f64().unwrap(), pull["t1"].as_f64().unwrap());
    (log, (t0 - PULL_PAD).max(0.0), (t1 + PULL_PAD).min(duration))
}

/// The pull the app opens on: the one with the largest RPM gain.
pub fn default_pull(s: &mut Session) -> (String, f64, f64) {
    let overview = call(s, "overview", json!({})).unwrap();
    let pulls = overview["pulls"].as_array().unwrap();
    let gain = |p: &&Value| p["gain"].as_f64().unwrap();
    let p = pulls
        .iter()
        .max_by(|a, b| gain(a).total_cmp(&gain(b)))
        .unwrap()
        .clone();
    replay_span(s, &p)
}

/// The pull with the given key.
pub fn pull(s: &mut Session, key: &str) -> (String, f64, f64) {
    let overview = call(s, "overview", json!({})).unwrap();
    let pulls = overview["pulls"].as_array().unwrap();
    let p = pulls
        .iter()
        .find(|p| p["key"] == key)
        .expect("sample pull")
        .clone();
    replay_span(s, &p)
}
