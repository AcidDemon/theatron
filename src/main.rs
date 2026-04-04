use axum::Router;
use axum::extract::{Path, State};
use axum::response::Json;
use axum::routing::get;
use serde::Serialize;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

struct AppState {
    recordings_dir: PathBuf,
    static_dir: PathBuf,
}

#[derive(Serialize)]
struct Recording {
    user: String,
    filename: String,
    size: u64,
    modified: u64,
}

#[derive(Serialize)]
struct RecordingList {
    recordings: Vec<Recording>,
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut recordings_dir = "/var/log/ssh-sessions".to_string();
    let mut static_dir = "./frontend".to_string();
    let mut bind = "127.0.0.1:3000".to_string();

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "-d" | "--dir" if i + 1 < args.len() => {
                i += 1;
                recordings_dir = args[i].clone();
            }
            "--static" if i + 1 < args.len() => {
                i += 1;
                static_dir = args[i].clone();
            }
            "-b" | "--bind" if i + 1 < args.len() => {
                i += 1;
                bind = args[i].clone();
            }
            "-h" | "--help" => {
                eprintln!("Usage: theatron [OPTIONS]");
                eprintln!();
                eprintln!(
                    "  -d, --dir <PATH>      Recordings directory (default: /var/log/ssh-sessions)"
                );
                eprintln!("  --static <PATH>        Static frontend files (default: ./frontend)");
                eprintln!("  -b, --bind <ADDR>      Listen address (default: 127.0.0.1:3000)");
                std::process::exit(0);
            }
            _ => {}
        }
        i += 1;
    }

    let state = Arc::new(AppState {
        recordings_dir: PathBuf::from(&recordings_dir),
        static_dir: PathBuf::from(&static_dir),
    });

    let app = Router::new()
        .route("/api/recordings", get(list_recordings))
        .route("/api/recordings/{user}/{filename}", get(serve_recording))
        .fallback_service(ServeDir::new(&state.static_dir))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr: SocketAddr = bind.parse().expect("invalid bind address");
    eprintln!("theatron: listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn list_recordings(State(state): State<Arc<AppState>>) -> Json<RecordingList> {
    let mut recordings = Vec::new();

    if let Ok(users) = std::fs::read_dir(&state.recordings_dir) {
        for user_entry in users.flatten() {
            let user_dir = user_entry.path();
            if !user_dir.is_dir() {
                continue;
            }
            let user = user_dir
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            if let Ok(files) = std::fs::read_dir(&user_dir) {
                for file_entry in files.flatten() {
                    let path = file_entry.path();
                    let name = path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();
                    if !name.ends_with(".cast") && !name.ends_with(".cast.age") {
                        continue;
                    }
                    let meta = std::fs::metadata(&path).ok();
                    recordings.push(Recording {
                        user: user.clone(),
                        filename: name,
                        size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                        modified: meta
                            .and_then(|m| m.modified().ok())
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs())
                            .unwrap_or(0),
                    });
                }
            }
        }
    }

    recordings.sort_by(|a, b| b.modified.cmp(&a.modified));
    Json(RecordingList { recordings })
}

async fn serve_recording(
    State(state): State<Arc<AppState>>,
    Path((user, filename)): Path<(String, String)>,
) -> Result<Vec<u8>, axum::http::StatusCode> {
    // Validate: no path traversal
    if user.contains('/')
        || user.contains("..")
        || filename.contains('/')
        || filename.contains("..")
    {
        return Err(axum::http::StatusCode::BAD_REQUEST);
    }

    let path = state.recordings_dir.join(&user).join(&filename);
    std::fs::read(&path).map_err(|_| axum::http::StatusCode::NOT_FOUND)
}
