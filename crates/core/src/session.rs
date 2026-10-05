//! The app's state and its command surface. The Tauri shell and the browser dev server both call `dispatch`,
//! so every platform runs exactly the same code.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::dyno::{detect_pulls, dyno, Dyno, Pt, Pull, Vehicle};
use crate::findings::{analyze_logs, check_pull, Finding};
use crate::haltech::{parse_nsp_csv, to_eng, type_info, Col};
use crate::log::Log;
use crate::stats::median;
use crate::switches::{switches, MAX_SWITCHES};
use crate::table::{axes, bin_table, Table};

pub enum Reply {
    Json(Value),
    Bytes(Vec<u8>),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChannelMeta {
    name: String,
    unit: &'static str,
    d: u8,
    /// set for channels that never change; they are not in the data blob
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<f64>,
    constant: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LogMeta {
    key: String,
    name: String,
    start: String,
    n: usize,
    hz: f64,
    duration: f64,
    channels: Vec<ChannelMeta>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub pulls: Vec<Pull>,
    pub coarse: Table,
    pub fine: Table,
    pub findings: Vec<Finding>,
    pub samples: usize,
    pub hz: f64,
    pub ethanol: f64,
}

#[derive(Serialize)]
pub struct Band {
    pub lo: Vec<Pt>,
    pub hi: Vec<Pt>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DynoOut {
    pub runs: Vec<Option<Dyno>>,
    /// run A's power if the car's weight is off by the stated uncertainty
    pub band: Option<Band>,
    /// checks on run A
    pub checks: Vec<Finding>,
}

#[derive(Deserialize)]
struct DynoArgs {
    vehicle: Vehicle,
    runs: Vec<Option<String>>,
}

pub struct Session {
    logs: Vec<Log>,
    pulls: Vec<Pull>,
    dir: Option<PathBuf>,
    /// content digest per log key, to recognise the same log under another file name
    digests: Vec<(String, u64)>,
    /// file names removed from the library: a watch-folder scan must not bring them back
    ignored: BTreeSet<String>,
}

/// Why a file was not imported.
enum Skip {
    /// the same log is already in the library
    Duplicate(String),
    /// not an NSP log
    NotALog(String),
    Other(String),
}

impl Skip {
    fn text(self) -> String {
        match self {
            Skip::Duplicate(s) | Skip::NotALog(s) | Skip::Other(s) => s,
        }
    }
}

/// FNV-1a over the file's bytes.
fn digest(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325u64, |h, b| {
        (h ^ b as u64).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

fn is_csv(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("csv"))
}

fn arg_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("missing argument: {key}"))
}

fn arg_f64(args: &Value, key: &str) -> Result<f64, String> {
    args.get(key)
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("missing argument: {key}"))
}

impl Session {
    /// A session that keeps nothing on disk.
    pub fn memory() -> Session {
        Session {
            logs: Vec::new(),
            pulls: Vec::new(),
            dir: None,
            digests: Vec::new(),
            ignored: BTreeSet::new(),
        }
    }

    /// Open the library in `dir`: logs imported earlier are loaded again, settings are read from settings.json.
    pub fn open(dir: PathBuf) -> Session {
        let mut s = Session {
            dir: Some(dir.clone()),
            ..Session::memory()
        };
        let logs_dir = dir.join("logs");
        let _ = fs::create_dir_all(&logs_dir);
        s.ignored = fs::read_to_string(dir.join("ignored.json"))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        let mut files: Vec<PathBuf> = fs::read_dir(&logs_dir)
            .map(|rd| rd.filter_map(|e| e.ok().map(|e| e.path())).collect())
            .unwrap_or_default();
        files.sort();
        for f in files.into_iter().filter(|f| is_csv(f)) {
            if let (Some(name), Ok(bytes)) = (f.file_name().and_then(|n| n.to_str()), fs::read(&f))
            {
                let _ = s.add(name, &String::from_utf8_lossy(&bytes));
            }
        }
        s.refresh();
        s
    }

    pub fn logs(&self) -> &[Log] {
        &self.logs
    }

    fn log(&self, key: &str) -> Result<&Log, String> {
        self.logs
            .iter()
            .find(|l| l.key == key)
            .ok_or_else(|| "That log is not loaded.".to_string())
    }

    fn refresh(&mut self) {
        self.logs.sort_by(|a, b| a.name.cmp(&b.name));
        self.pulls = self.logs.iter().flat_map(detect_pulls).collect();
    }

    /// The same bytes are already in the library, whatever the file is called.
    fn check_new(&self, name: &str, d: u64) -> Result<(), Skip> {
        let Some((key, _)) = self.digests.iter().find(|(_, x)| *x == d) else {
            return Ok(());
        };
        let have = self
            .logs
            .iter()
            .find(|l| &l.key == key)
            .map_or(name, |l| l.name.as_str());
        Err(Skip::Duplicate(if have == name {
            format!("{name} is already in the library.")
        } else {
            format!("{name} is already in the library as {have}.")
        }))
    }

    fn add(&mut self, name: &str, text: &str) -> Result<String, Skip> {
        let d = digest(text);
        self.check_new(name, d)?;
        let raw = parse_nsp_csv(text, name).map_err(Skip::NotALog)?;
        let log = Log::from_raw(raw).map_err(Skip::Other)?;
        if self.logs.iter().any(|l| l.key == log.key) {
            return Err(Skip::Duplicate(format!(
                "{name} is already in the library."
            )));
        }
        let key = log.key.clone();
        self.digests.push((key.clone(), d));
        self.logs.push(log);
        Ok(key)
    }

    fn forget(&mut self, key: &str) {
        self.logs.retain(|l| l.key != key);
        self.digests.retain(|(k, _)| k != key);
    }

    fn save_ignored(&self) {
        if let Some(dir) = &self.dir {
            let _ = fs::write(
                dir.join("ignored.json"),
                serde_json::to_string(&self.ignored).unwrap_or_default(),
            );
        }
    }

    fn import(&mut self, name: &str, text: &str) -> Result<String, Skip> {
        let Some(dir) = self.dir.clone() else {
            let key = self.add(name, text)?;
            self.refresh();
            return Ok(key);
        };
        self.check_new(name, digest(text))?;
        // same file name, different log: keep both
        let (mut stored, mut k) = (name.to_string(), 2);
        while self.logs.iter().any(|l| l.name == stored) {
            let (stem, ext) = name.rsplit_once('.').unwrap_or((name, "csv"));
            stored = format!("{stem} ({k}).{ext}");
            k += 1;
        }
        let key = self.add(&stored, text)?;
        if let Err(e) = fs::write(dir.join("logs").join(&stored), text) {
            self.forget(&key);
            return Err(Skip::Other(format!(
                "Could not save {stored} to the library: {e}"
            )));
        }
        self.refresh();
        Ok(key)
    }

    /// Import a log from its text. With a library directory, the file is copied into it.
    pub fn load_text(&mut self, name: &str, text: &str) -> Result<String, String> {
        let key = self.import(name, text).map_err(Skip::text)?;
        // adding a log by hand overrides an earlier removal
        if self.ignored.remove(name) {
            self.save_ignored();
        }
        Ok(key)
    }

    fn remove(&mut self, key: &str) -> Result<(), String> {
        let name = self.log(key)?.name.clone();
        self.forget(key);
        if let Some(dir) = &self.dir {
            let _ = fs::remove_file(dir.join("logs").join(&name));
        }
        self.ignored.insert(name);
        self.save_ignored();
        self.refresh();
        Ok(())
    }

    /// Import every NSP .csv in a folder that is not in the library yet. Desktop only: needs a real path.
    /// Files that are not NSP logs, logs already in the library and logs the user removed are passed over without comment.
    fn scan_dir(&mut self, path: &Path) -> Result<Value, String> {
        let mut files: Vec<PathBuf> = fs::read_dir(path)
            .map_err(|e| format!("Cannot read {}: {e}", path.display()))?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .collect();
        files.sort();
        let (mut added, mut errors): (Vec<String>, Vec<String>) = (Vec::new(), Vec::new());
        for f in files.into_iter().filter(|f| is_csv(f)) {
            let Some(name) = f.file_name().and_then(|n| n.to_str()).map(str::to_string) else {
                continue;
            };
            if self.ignored.contains(&name) || self.logs.iter().any(|l| l.name == name) {
                continue;
            }
            match fs::read(&f) {
                Ok(bytes) => match self.import(&name, &String::from_utf8_lossy(&bytes)) {
                    Ok(_) => added.push(name),
                    Err(Skip::Duplicate(_)) | Err(Skip::NotALog(_)) => {}
                    Err(Skip::Other(e)) => errors.push(format!("{name}: {e}")),
                },
                Err(e) => errors.push(format!("{name}: {e}")),
            }
        }
        Ok(json!({ "added": added, "errors": errors }))
    }

    fn meta(log: &Log) -> LogMeta {
        let channels = log
            .names
            .iter()
            .enumerate()
            .map(|(j, nm)| {
                let (_, _, unit, d) = type_info(&log.types[j]);
                let value = match log.cols[j] {
                    Col::Const(c) => Some(to_eng(&log.types[j])(c)),
                    Col::Series(_) => None,
                };
                ChannelMeta {
                    name: nm.clone(),
                    unit,
                    d,
                    constant: value.is_some(),
                    value,
                }
            })
            .collect();
        LogMeta {
            key: log.key.clone(),
            name: log.name.clone(),
            start: log.start.clone(),
            n: log.n,
            hz: log.hz,
            duration: log.duration(),
            channels,
        }
    }

    /// Time base then every changing channel, in channel order, as little-endian f32.
    fn data(log: &Log) -> Vec<u8> {
        let series = (0..log.names.len()).filter(|&j| !log.is_const(j));
        let mut out = Vec::with_capacity((1 + series.clone().count()) * log.n * 4);
        for &v in &log.t {
            out.extend_from_slice(&(v as f32).to_le_bytes());
        }
        for j in series {
            for &v in log.chan_at(j) {
                out.extend_from_slice(&(v as f32).to_le_bytes());
            }
        }
        out
    }

    pub fn overview(&self) -> Overview {
        let (rc, mc) = axes(false);
        let (rf, mf) = axes(true);
        let coarse = bin_table(&self.logs, &rc, &mc);
        let fine = bin_table(&self.logs, &rf, &mf);
        let findings = analyze_logs(&self.logs, Some(&coarse));
        let hz: Vec<f64> = self.logs.iter().map(|l| l.hz).collect();
        let eth: Vec<f64> = self.logs.iter().map(|l| median(&l.ch.eth)).collect();
        Overview {
            pulls: self.pulls.clone(),
            coarse,
            fine,
            findings,
            samples: self.logs.iter().map(|l| l.n).sum(),
            hz: median(&hz),
            ethanol: median(&eth),
        }
    }

    pub fn dyno(&self, veh: &Vehicle, runs: &[Option<String>]) -> DynoOut {
        let find = |key: &Option<String>| -> Option<(&Log, &Pull)> {
            let p = self.pulls.iter().find(|p| Some(&p.key) == key.as_ref())?;
            let l = self.logs.iter().find(|l| l.key == p.log_key)?;
            Some((l, p))
        };
        let out: Vec<Option<Dyno>> = runs
            .iter()
            .map(|k| find(k).map(|(l, p)| dyno(l, p, veh)))
            .collect();
        let (mut band, mut checks) = (None, Vec::new());
        if let Some((l, p)) = runs.first().and_then(find) {
            if veh.unc > 0.0 {
                let with = |mass: f64| {
                    dyno(
                        l,
                        p,
                        &Vehicle {
                            mass,
                            ..veh.clone()
                        },
                    )
                    .core
                };
                band = Some(Band {
                    lo: with(veh.mass - veh.unc),
                    hi: with(veh.mass + veh.unc),
                });
            }
            // findings describe the log, so they read the curve as computed: the smoothing level must not change them
            let raw;
            let for_checks = if veh.smooth > 0.0 {
                raw = dyno(
                    l,
                    p,
                    &Vehicle {
                        smooth: 0.0,
                        ..veh.clone()
                    },
                );
                Some(&raw)
            } else {
                out[0].as_ref()
            };
            checks = check_pull(l, p, for_checks);
        }
        DynoOut {
            runs: out,
            band,
            checks,
        }
    }

    fn settings_path(&self) -> Option<PathBuf> {
        self.dir.as_ref().map(|d| d.join("settings.json"))
    }

    /// One entry point for every front end.
    pub fn dispatch(&mut self, cmd: &str, args: Value) -> Result<Reply, String> {
        let ok = |v: Value| Ok(Reply::Json(v));
        match cmd {
            "logs" => ok(serde_json::to_value(
                self.logs.iter().map(Self::meta).collect::<Vec<_>>(),
            )
            .map_err(|e| e.to_string())?),
            "log_data" => {
                let log = self.log(arg_str(&args, "key")?)?;
                Ok(Reply::Bytes(Self::data(log)))
            }
            "load_text" => {
                let key = self.load_text(arg_str(&args, "name")?, arg_str(&args, "text")?)?;
                ok(json!({ "key": key }))
            }
            "remove_log" => {
                self.remove(arg_str(&args, "key")?)?;
                ok(Value::Null)
            }
            "scan_dir" => {
                let path = arg_str(&args, "path")?.to_string();
                ok(self.scan_dir(Path::new(&path))?)
            }
            "overview" => ok(serde_json::to_value(self.overview()).map_err(|e| e.to_string())?),
            "dyno" => {
                let a: DynoArgs =
                    serde_json::from_value(args).map_err(|e| format!("bad dyno arguments: {e}"))?;
                ok(serde_json::to_value(self.dyno(&a.vehicle, &a.runs))
                    .map_err(|e| e.to_string())?)
            }
            "switches" => {
                let log = self.log(arg_str(&args, "log")?)?;
                let (t0, t1) = (arg_f64(&args, "t0")?, arg_f64(&args, "t1")?);
                ok(serde_json::to_value(switches(log, t0, t1, MAX_SWITCHES))
                    .map_err(|e| e.to_string())?)
            }
            "get_settings" => {
                let v = self
                    .settings_path()
                    .and_then(|p| fs::read_to_string(p).ok())
                    .and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or(Value::Null);
                ok(v)
            }
            "set_settings" => {
                if let Some(p) = self.settings_path() {
                    let text =
                        serde_json::to_string_pretty(args.get("value").unwrap_or(&Value::Null))
                            .map_err(|e| e.to_string())?;
                    fs::write(p, text).map_err(|e| format!("Could not save settings: {e}"))?;
                }
                ok(Value::Null)
            }
            other => Err(format!("unknown command: {other}")),
        }
    }
}
