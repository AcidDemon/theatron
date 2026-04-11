mod api;
mod index;
mod manifest;
mod stream;

use axum::routing::{get, post};
use axum::Router;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut storage_dir = "/var/lib/epitropos-collector".to_string();
    let mut storage_mode = "collector".to_string();
    let mut static_dir = "./frontend".to_string();
    let mut bind = "127.0.0.1:3000".to_string();

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "-d" | "--dir" if i + 1 < args.len() => {
                i += 1;
                storage_dir = args[i].clone();
            }
            "--mode" if i + 1 < args.len() => {
                i += 1;
                storage_mode = args[i].clone();
            }
            "--static" if i + 1 < args.len() => {
                i += 1;
                static_dir = args[i].clone();
            }
            "-b" | "--bind" if i + 1 < args.len() => {
                i += 1;
                bind = args[i].clone();
            }
            "--version" | "-V" => {
                println!("theatron {}", env!("CARGO_PKG_VERSION"));
                std::process::exit(0);
            }
            "-h" | "--help" => {
                eprintln!("Usage: theatron [OPTIONS]");
                eprintln!("  -d, --dir <PATH>     Storage directory");
                eprintln!("  --mode <MODE>        collector|local (default: collector)");
                eprintln!("  --static <PATH>      Frontend files (default: ./frontend)");
                eprintln!("  -b, --bind <ADDR>    Listen address (default: 127.0.0.1:3000)");
                std::process::exit(0);
            }
            _ => {}
        }
        i += 1;
    }

    // Build index.
    let idx = index::Index::new().expect("failed to create index");
    let storage_path = PathBuf::from(&storage_dir);
    eprintln!("theatron: scanning {}...", storage_dir);
    let count = index::scan_dir(&idx, &storage_path, &storage_mode).unwrap_or(0);
    eprintln!("theatron: indexed {count} manifests");

    let state = Arc::new(api::AppState {
        index: Mutex::new(idx),
        storage_dir: storage_path.clone(),
        storage_mode: storage_mode.clone(),
    });

    // Inotify watcher (background task).
    let state_watch = state.clone();
    let path_watch = storage_path.clone();
    let mode_watch = storage_mode.clone();
    tokio::spawn(async move {
        if let Err(e) = run_inotify(state_watch, &path_watch, &mode_watch).await {
            eprintln!("theatron: inotify watcher failed: {e}");
        }
    });

    let app = Router::new()
        .route("/api/stats", get(api::stats))
        .route("/api/sessions", get(api::sessions))
        .route("/api/sessions/{session_id}", get(api::session_detail))
        .route(
            "/api/stream/{session_id}/parts/{part}",
            post(api::stream_recording),
        )
        .route(
            "/api/raw/{session_id}/parts/{part}",
            get(api::raw_recording),
        )
        .fallback_service(ServeDir::new(&static_dir))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr: SocketAddr = bind.parse().expect("invalid bind address");
    eprintln!("theatron: listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn run_inotify(
    state: Arc<api::AppState>,
    storage_dir: &std::path::Path,
    mode: &str,
) -> Result<(), String> {
    use inotify::{Inotify, WatchMask};

    let mut inotify = Inotify::init().map_err(|e| format!("inotify init: {e}"))?;

    // Collect directories to watch.
    let dirs: Vec<PathBuf> = match mode {
        "collector" => {
            let senders = storage_dir.join("senders");
            if !senders.exists() {
                return Ok(());
            }
            let mut dirs = vec![];
            for sender in std::fs::read_dir(&senders)
                .map_err(|e| format!("{e}"))?
                .flatten()
            {
                let recs = sender.path().join("recordings");
                if recs.exists() {
                    // Watch user subdirs too.
                    if let Ok(entries) = std::fs::read_dir(&recs) {
                        for entry in entries.flatten() {
                            if entry.path().is_dir() {
                                dirs.push(entry.path());
                            }
                        }
                    }
                    dirs.push(recs);
                }
            }
            dirs
        }
        _ => {
            let mut dirs = vec![storage_dir.to_path_buf()];
            if let Ok(entries) = std::fs::read_dir(storage_dir) {
                for entry in entries.flatten() {
                    if entry.path().is_dir() {
                        dirs.push(entry.path());
                    }
                }
            }
            dirs
        }
    };

    for dir in &dirs {
        let _ = inotify
            .watches()
            .add(dir, WatchMask::CLOSE_WRITE | WatchMask::CREATE);
    }

    let mut buffer = [0; 4096];
    loop {
        let events = inotify
            .read_events_blocking(&mut buffer)
            .map_err(|e| format!("inotify read: {e}"))?;

        for event in events {
            if let Some(name) = event.name {
                let name_str = name.to_string_lossy();
                if name_str.ends_with(".manifest.json") {
                    // Find the file in watched dirs.
                    for dir in &dirs {
                        let candidate = dir.join(name_str.as_ref());
                        if candidate.exists() {
                            if let Ok(m) = manifest::load_manifest(&candidate) {
                                let sender =
                                    extract_sender(storage_dir, &candidate);
                                let idx = state.index.lock().unwrap();
                                let _ = idx.upsert(
                                    &sender,
                                    &m,
                                    &candidate.to_string_lossy(),
                                );
                                eprintln!("theatron: indexed {}", name_str);
                            }
                        }
                    }
                }
            }
        }
    }
}

fn extract_sender(storage_dir: &std::path::Path, path: &std::path::Path) -> String {
    if let Ok(relative) = path.strip_prefix(storage_dir) {
        let lossy = relative.to_string_lossy().to_string();
        let parts: Vec<&str> = lossy.split('/').collect();
        if parts.len() >= 2 && parts[0] == "senders" {
            return parts[1].to_string();
        }
    }
    String::new()
}
