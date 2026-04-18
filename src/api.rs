//! API handlers for theatron.

use axum::{
    extract::{Path as AxumPath, Query, State},
    http::{header, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::sync::{Arc, Mutex};

use crate::index::{Index, QueryParams};
use crate::stream;

pub struct AppState {
    pub index: Mutex<Index>,
    pub storage_dir: std::path::PathBuf,
    pub storage_mode: String,
}

pub async fn info(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let idx = state.index.lock().unwrap();
    let total = idx.stats().map(|s| s.total_sessions).unwrap_or(0);
    Json(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "storage_dir": state.storage_dir.to_string_lossy(),
        "storage_mode": state.storage_mode,
        "total_sessions": total,
    }))
    .into_response()
}

pub async fn stats(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let idx = state.index.lock().unwrap();
    match idx.stats() {
        Ok(s) => Json(s).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

pub async fn activity(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let idx = state.index.lock().unwrap();
    match idx.activity_24h() {
        Ok(buckets) => {
            let data: Vec<serde_json::Value> = buckets
                .into_iter()
                .map(|(ts, count)| {
                    serde_json::json!({ "hour": ts, "count": count })
                })
                .collect();
            Json(serde_json::json!({ "buckets": data })).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

#[derive(Deserialize, Default)]
pub struct SessionsQuery {
    pub q: Option<String>,
    pub user: Option<String>,
    pub host: Option<String>,
    pub from: Option<f64>,
    pub to: Option<f64>,
    pub page: Option<usize>,
    pub per_page: Option<usize>,
    pub sort: Option<String>,
    pub order: Option<String>,
}

pub async fn sessions(
    State(state): State<Arc<AppState>>,
    Query(q): Query<SessionsQuery>,
) -> impl IntoResponse {
    let params = QueryParams {
        q: q.q,
        user: q.user,
        host: q.host,
        from: q.from,
        to: q.to,
        page: q.page.unwrap_or(1),
        per_page: q.per_page.unwrap_or(25),
        sort: q.sort.unwrap_or_else(|| "started".into()),
        order: q.order.unwrap_or_else(|| "desc".into()),
    };
    let idx = state.index.lock().unwrap();
    match idx.query(&params) {
        Ok(result) => Json(serde_json::json!({
            "sessions": result.sessions,
            "total": result.total,
            "page": params.page,
            "per_page": params.per_page,
        }))
        .into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

pub async fn session_detail(
    State(state): State<Arc<AppState>>,
    AxumPath(session_id): AxumPath<String>,
) -> impl IntoResponse {
    let idx = state.index.lock().unwrap();
    match idx.get_session(&session_id) {
        Ok(Some(s)) => Json(s).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

#[derive(Deserialize)]
pub struct StreamBody {
    pub age_identity: String,
}

pub async fn stream_recording(
    State(state): State<Arc<AppState>>,
    AxumPath((session_id, part)): AxumPath<(String, u32)>,
    Json(body): Json<StreamBody>,
) -> impl IntoResponse {
    let rec_path = find_recording(&state.storage_dir, &state.storage_mode, &session_id, part);
    let rec_path = match rec_path {
        Some(p) => p,
        None => return (StatusCode::NOT_FOUND, "recording not found").into_response(),
    };

    let identity = body.age_identity;
    let result =
        tokio::task::spawn_blocking(move || stream::decrypt_to_lines(&rec_path, &identity)).await;

    match result {
        Ok(Ok(lines)) => {
            let body_str = lines.join("\n") + "\n";
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "application/x-ndjson")],
                body_str,
            )
                .into_response()
        }
        Ok(Err(e)) => {
            if e.contains("decrypt") {
                (StatusCode::FORBIDDEN, format!("decryption failed: {e}")).into_response()
            } else {
                (StatusCode::INTERNAL_SERVER_ERROR, e).into_response()
            }
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub async fn raw_recording(
    State(state): State<Arc<AppState>>,
    AxumPath((session_id, part)): AxumPath<(String, u32)>,
) -> impl IntoResponse {
    let rec_path = find_recording(&state.storage_dir, &state.storage_mode, &session_id, part);
    let filename = format!("{session_id}.part{part}.kgv1.age");
    match rec_path {
        Some(p) => match std::fs::read(&p) {
            Ok(bytes) => {
                let mut headers = axum::http::HeaderMap::new();
                headers.insert(
                    header::CONTENT_TYPE,
                    "application/octet-stream".parse().unwrap(),
                );
                headers.insert(
                    header::CONTENT_DISPOSITION,
                    format!("attachment; filename=\"{filename}\"").parse().unwrap(),
                );
                (StatusCode::OK, headers, bytes).into_response()
            }
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        },
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

fn find_recording(
    storage_dir: &std::path::Path,
    mode: &str,
    session_id: &str,
    part: u32,
) -> Option<std::path::PathBuf> {
    if session_id.contains('/') || session_id.contains("..") {
        return None;
    }
    let pattern = format!("{session_id}.part{part}.kgv1.age");
    match mode {
        "collector" => {
            let senders = storage_dir.join("senders");
            for sender in std::fs::read_dir(&senders).ok()?.flatten() {
                let recs = sender.path().join("recordings");
                if let Some(path) = find_file_recursive(&recs, &pattern) {
                    return Some(path);
                }
            }
            None
        }
        _ => find_file_recursive(storage_dir, &pattern),
    }
}

fn find_file_recursive(dir: &std::path::Path, name: &str) -> Option<std::path::PathBuf> {
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_file_recursive(&path, name) {
                return Some(found);
            }
        } else if path.file_name()?.to_str()? == name {
            return Some(path);
        }
    }
    None
}
