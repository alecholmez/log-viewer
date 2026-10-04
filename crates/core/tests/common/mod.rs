//! Shared by the integration tests.
#![allow(dead_code)]

use std::fs;
use std::path::PathBuf;

use logviewer_core::{Reply, Session};
use serde_json::Value;

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
