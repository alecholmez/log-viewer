//! Runs the whole core over the sample logs and compares every number and every sentence with a stored snapshot.
//! The snapshot was first produced by the JavaScript prototype this core was ported from.
//!
//! After an intended change in behaviour, refresh it with:  UPDATE_GOLDEN=1 cargo test -p logviewer-core --test golden

mod common;

use std::fs;

use common::{root, sample_session};
use logviewer_core::dyno::Vehicle;
use serde_json::{json, Value};

/// Walk two JSON values and collect where they differ. Numbers match within a relative 1e-6.
fn diff(path: &str, a: &Value, b: &Value, out: &mut Vec<String>) {
    if out.len() >= 25 {
        return;
    }
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            let (x, y) = (x.as_f64().unwrap(), y.as_f64().unwrap());
            if (x - y).abs() > 1e-6 * x.abs().max(y.abs()).max(1.0) {
                out.push(format!("{path}: {x} vs {y}"));
            }
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                out.push(format!("{path}: {} items vs {}", x.len(), y.len()));
            }
            for (i, (p, q)) in x.iter().zip(y).enumerate() {
                diff(&format!("{path}[{i}]"), p, q, out);
            }
        }
        (Value::Object(x), Value::Object(y)) => {
            let mut keys: Vec<&String> = x.keys().chain(y.keys()).collect();
            keys.sort();
            keys.dedup();
            for k in keys {
                match (x.get(k), y.get(k)) {
                    (Some(p), Some(q)) => diff(&format!("{path}.{k}"), p, q, out),
                    (p, q) => out.push(format!(
                        "{path}.{k}: {} vs {}",
                        p.map_or("missing".into(), |v| v.to_string()),
                        q.map_or("missing".into(), |v| v.to_string())
                    )),
                }
            }
        }
        _ if a == b => {}
        _ => out.push(format!("{path}:\n      got  {a}\n      want {b}")),
    }
}

#[test]
fn matches_the_snapshot() {
    let Some(s) = sample_session() else { return };
    let golden_path = root().join("crates/core/tests/golden.json");
    let golden: Value = serde_json::from_str(&fs::read_to_string(&golden_path).unwrap()).unwrap();
    let veh: Vehicle = serde_json::from_value(golden["vehicle"].clone()).unwrap();
    let overview = s.overview();
    let dyno: Vec<Value> = overview
        .pulls
        .iter()
        .map(|p| json!({ "key": p.key, "out": s.dyno(&veh, &[Some(p.key.clone())]) }))
        .collect();
    let got = json!({
        "vehicle": golden["vehicle"],
        "logs": s.logs().iter().map(|l| json!({ "key": l.key, "name": l.name, "n": l.n, "hz": l.hz, "channels": l.names.len() })).collect::<Vec<_>>(),
        "overview": overview,
        "dyno": dyno,
    });
    if std::env::var("UPDATE_GOLDEN").is_ok() {
        fs::write(&golden_path, serde_json::to_string(&got).unwrap()).unwrap();
        return;
    }
    let mut out = Vec::new();
    diff("", &got, &golden, &mut out);
    assert!(
        out.is_empty(),
        "{} difference(s) from the snapshot:\n  {}",
        out.len(),
        out.join("\n  ")
    );
}
