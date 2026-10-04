//! The native shell. It owns one `Session` from the core and forwards the UI's commands to it,
//! so the analysis that runs here is the same code the tests and the browser dev server run.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use logviewer_core::{Reply, Session};
use serde_json::Value;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, State};

struct AppState(Mutex<Session>);

fn dispatch(state: &AppState, cmd: &str, args: Value) -> Result<Reply, String> {
    // a panic in one command must not lock the app out of its library
    state
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .dispatch(cmd, args)
}

/// Commands that answer with JSON.
#[tauri::command(async)]
fn call(state: State<'_, AppState>, cmd: String, args: Value) -> Result<Value, String> {
    match dispatch(&state, &cmd, args)? {
        Reply::Json(v) => Ok(v),
        Reply::Bytes(_) => Err(format!("{cmd} returns bytes: use call_bytes")),
    }
}

/// Commands that answer with raw bytes (log samples). They reach the UI as an ArrayBuffer without a JSON round trip.
#[tauri::command(async)]
fn call_bytes(state: State<'_, AppState>, cmd: String, args: Value) -> Result<Response, String> {
    match dispatch(&state, &cmd, args)? {
        Reply::Bytes(b) => Ok(Response::new(b)),
        Reply::Json(_) => Err(format!("{cmd} returns JSON: use call")),
    }
}

fn is_csv(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("csv"))
}

/// Import logs the system handed to the app: "Open with", a file dropped on the icon, AirDrop or the share sheet.
/// The UI is told afterwards so it reloads the library.
fn import_paths(app: &AppHandle, paths: Vec<PathBuf>) {
    let state = app.state::<AppState>();
    let (mut added, mut notes) = (0, Vec::new());
    for path in paths.into_iter().filter(|p| is_csv(p)) {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("log.csv")
            .to_string();
        let result = std::fs::read(&path)
            .map_err(|e| e.to_string())
            .and_then(|bytes| {
                state
                    .0
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .load_text(&name, &String::from_utf8_lossy(&bytes))
            });
        match result {
            Ok(_) => added += 1,
            Err(e) => notes.push(format!("{name}: {e}")),
        }
    }
    if added == 0 && notes.is_empty() {
        return;
    }
    let mut msg = match added {
        0 => String::new(),
        1 => "Added 1 log. ".to_string(),
        n => format!("Added {n} logs. "),
    };
    msg.push_str(&notes.join(" "));
    let _ = app.emit("logs-changed", msg);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|_app| {
            // Windows and Linux pass files opened with the app as arguments
            #[cfg(desktop)]
            import_paths(
                _app.handle(),
                std::env::args_os().skip(1).map(PathBuf::from).collect(),
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![call, call_bytes])
        .build(tauri::generate_context!())
        .expect("error while building the application");

    // The library (imported logs and settings.json) lives in the app's own data directory on every platform.
    // It is opened here and not in the setup hook: setup runs once the event loop is ready, and macOS and iOS
    // deliver a file the app was launched with before that. That import has to land in the library on disk.
    let dir = app
        .path()
        .app_data_dir()
        .expect("no app data directory on this system");
    std::fs::create_dir_all(&dir).expect("could not create the app data directory");
    app.manage(AppState(Mutex::new(Session::open(dir))));

    app.run(|_handle, _event| {
        // macOS and iOS deliver opened files as an event, also while the app is already running
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = _event {
            import_paths(
                _handle,
                urls.iter().filter_map(|u| u.to_file_path().ok()).collect(),
            );
        }
    });
}
