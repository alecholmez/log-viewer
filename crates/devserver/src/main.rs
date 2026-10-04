//! Browser mode. Serves the built UI from `dist/` and exposes the core's commands at POST /api/<command>,
//! the same commands the Tauri shell forwards. Useful for UI work without a native build, and for tests.
//!
//!   cargo run -p logviewer-dev -- [--port 1430] [--dir .logviewer] [--dist dist] [logs.csv ...]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;

use logviewer_core::{Reply, Session};
use tiny_http::{Header, Method, Request, Response, Server};

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        _ => "application/octet-stream",
    }
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("static header")
}

fn main() {
    let mut args = std::env::args().skip(1);
    let (mut port, mut dir, mut dist, mut files) = (
        1430u16,
        PathBuf::from(".logviewer"),
        PathBuf::from("dist"),
        Vec::new(),
    );
    while let Some(a) = args.next() {
        match a.as_str() {
            "--port" => port = args.next().and_then(|v| v.parse().ok()).unwrap_or(port),
            "--dir" => dir = args.next().map(PathBuf::from).unwrap_or(dir),
            "--dist" => dist = args.next().map(PathBuf::from).unwrap_or(dist),
            _ => files.push(PathBuf::from(a)),
        }
    }
    fs::create_dir_all(&dir).expect("create data directory");
    let mut session = Session::open(dir.clone());
    for f in &files {
        let name = f
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("log.csv")
            .to_string();
        match fs::read(f)
            .map_err(|e| e.to_string())
            .and_then(|b| session.load_text(&name, &String::from_utf8_lossy(&b)))
        {
            Ok(_) => println!("imported {name}"),
            Err(e) => println!("skipped {name}: {e}"),
        }
    }
    let server = Arc::new(Server::http(("127.0.0.1", port)).expect("bind port"));
    println!(
        "Log Viewer dev server on http://127.0.0.1:{port}  (library: {}, {} logs)",
        dir.display(),
        session.logs().len()
    );
    let session = Arc::new(Mutex::new(session));
    // a few workers so one slow request (a large upload) does not hold up the rest
    let workers: Vec<_> = (0..4)
        .map(|_| {
            let (server, session, dist) = (server.clone(), session.clone(), dist.clone());
            thread::spawn(move || {
                while let Ok(req) = server.recv() {
                    handle(req, &session, &dist);
                }
            })
        })
        .collect();
    for w in workers {
        let _ = w.join();
    }
}

fn handle(mut req: Request, session: &Mutex<Session>, dist: &Path) {
    let url = req.url().split('?').next().unwrap_or("/").to_string();
    if let Some(cmd) = url.strip_prefix("/api/") {
        if *req.method() != Method::Post {
            let _ = req.respond(Response::from_string("POST only").with_status_code(405));
            return;
        }
        let mut body = String::new();
        let _ = req.as_reader().read_to_string(&mut body);
        let args = serde_json::from_str(&body).unwrap_or(serde_json::Value::Null);
        let reply = session
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .dispatch(cmd, args);
        let resp = match reply {
            Ok(Reply::Json(v)) => Response::from_data(v.to_string().into_bytes())
                .with_header(header("Content-Type", "application/json")),
            Ok(Reply::Bytes(b)) => Response::from_data(b)
                .with_header(header("Content-Type", "application/octet-stream")),
            Err(e) => Response::from_data(e.into_bytes())
                .with_status_code(400)
                .with_header(header("Content-Type", "text/plain; charset=utf-8")),
        };
        let _ = req.respond(resp);
        return;
    }
    let rel = url.trim_start_matches('/');
    let mut path = dist.join(if rel.is_empty() { "index.html" } else { rel });
    if rel.contains("..") || !path.is_file() {
        path = dist.join("index.html");
    }
    let resp = match fs::read(&path) {
        Ok(bytes) => {
            Response::from_data(bytes).with_header(header("Content-Type", content_type(&path)))
        }
        Err(_) => Response::from_string("UI not built yet: run `npm run build` first.")
            .with_status_code(404),
    };
    let _ = req.respond(resp);
}
