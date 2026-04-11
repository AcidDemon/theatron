# Track D(a) — Theatron Web UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `theatron/docs/specs/2026-04-07-track-d-theatron-web-ui.md`

**Goal:** Build a four-screen web UI (Dashboard, Session Browser, Session Viewer, Exports) for browsing and replaying katagrapho session recordings, with in-memory SQLite FTS search, server-side age decryption streaming, and the terminal-architect dark theme from the stitch mockups.

**Architecture:** Axum backend serves a static vanilla-JS frontend. SQLite FTS index is built at startup from manifest sidecars on disk and kept live via inotify. Playback streams decrypted kgv1 NDJSON to the browser, where xterm.js renders the terminal output with seek/speed controls. The operator's age identity is sent per-request in the POST body, used in-memory, and discarded.

**Tech Stack:** Rust (axum, rusqlite, inotify, age), vanilla JS + Tailwind CSS + xterm.js, no build step for the frontend.

**Repo:** `/home/acid/Workspace/repos/theatron/`

**Phase order:**
1. Phase 1 — Backend: deps, manifest types, SQLite index, inotify
2. Phase 2 — Backend: API endpoints (stats, sessions, stream, export)
3. Phase 3 — Frontend: SPA shell, router, theme
4. Phase 4 — Frontend: Dashboard + Browser screens
5. Phase 5 — Frontend: Viewer screen (xterm.js playback)
6. Phase 6 — Frontend: Exports screen
7. Phase 7 — NixOS module, lint, acceptance

**Commit hygiene:** `git -c commit.gpgsign=false commit`, no Co-Authored-By, one task = one commit.

---

## File structure

```
theatron/
├── Cargo.toml                  # MODIFY: add rusqlite, inotify, age, hex
├── src/
│   ├── main.rs                 # MODIFY: add routes, startup scan, inotify
│   ├── manifest.rs             # CREATE: serde types for manifest JSON
│   ├── index.rs                # CREATE: SQLite schema + scan + upsert + query
│   ├── stream.rs               # CREATE: age decrypt + kgv1 streaming
│   └── api.rs                  # CREATE: /api/stats, sessions, session detail, export
├── frontend/
│   ├── index.html              # REWRITE: SPA shell with nav + 4 screen containers
│   ├── app.js                  # CREATE: hash router + fetch helpers + state
│   ├── dashboard.js            # CREATE: dashboard screen
│   ├── browser.js              # CREATE: session browser table + search
│   ├── terminal.js             # CREATE: xterm.js playback engine
│   ├── exports.js              # CREATE: exports screen
│   ├── theme.css               # CREATE: terminal-architect custom styles
│   └── age-decrypt.js          # KEEP: fallback client-side decryption
└── nixos-module.nix            # CREATE: systemd service
```

---

# Phase 1 — Backend: Deps + Manifest + Index

## Task 1: Add dependencies

**Files:**
- Modify: `theatron/Cargo.toml`

- [ ] **Step 1: Add new deps**

Add to `[dependencies]`:

```toml
rusqlite = { version = "0.32", features = ["bundled"] }
inotify = "0.11"
age = { version = "0.11", default-features = false }
hex = "0.4"
sha2 = "0.10"
```

- [ ] **Step 2: Build**

```bash
cd /home/acid/Workspace/repos/theatron && cargo build --jobs 1 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add Cargo.toml Cargo.lock
git -c commit.gpgsign=false commit -m "build: add rusqlite, inotify, age deps"
```

## Task 2: manifest.rs — serde types

**Files:**
- Create: `theatron/src/manifest.rs`

- [ ] **Step 1: Write manifest.rs**

```rust
//! Serde types for katagrapho-manifest-v1 sidecars.

use serde::Deserialize;

#[derive(Debug, Deserialize, Clone)]
pub struct Manifest {
    pub v: String,
    pub session_id: String,
    pub part: u32,
    pub user: String,
    pub host: String,
    pub boot_id: String,
    pub audit_session_id: Option<u32>,
    pub started: f64,
    pub ended: f64,
    pub katagrapho_version: String,
    pub katagrapho_commit: String,
    pub epitropos_version: String,
    pub epitropos_commit: String,
    pub recording_file: String,
    pub recording_size: u64,
    pub recording_sha256: String,
    pub chunks: Vec<Chunk>,
    pub end_reason: String,
    pub exit_code: i32,
    pub prev_manifest_hash: String,
    #[serde(default)]
    pub this_manifest_hash: String,
    #[serde(default)]
    pub key_id: String,
    #[serde(default)]
    pub signature: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Chunk {
    pub seq: u64,
    pub bytes: u64,
    pub messages: u64,
    pub elapsed: f64,
    pub sha256: String,
}

impl Manifest {
    pub fn duration(&self) -> f64 {
        if self.ended > self.started {
            self.ended - self.started
        } else {
            0.0
        }
    }
}

pub fn load_manifest(path: &std::path::Path) -> Result<Manifest, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("parse {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_sample_manifest() {
        let json = r#"{
            "v": "katagrapho-manifest-v1",
            "session_id": "abc-123",
            "part": 0,
            "user": "alice",
            "host": "nyx",
            "boot_id": "00000000",
            "audit_session_id": 42,
            "started": 1712534400.0,
            "ended": 1712534500.0,
            "katagrapho_version": "0.3.0",
            "katagrapho_commit": "abc",
            "epitropos_version": "0.1.0",
            "epitropos_commit": "def",
            "recording_file": "abc-123.part0.kgv1.age",
            "recording_size": 1024,
            "recording_sha256": "0000",
            "chunks": [],
            "end_reason": "eof",
            "exit_code": 0,
            "prev_manifest_hash": "0000",
            "this_manifest_hash": "1111",
            "key_id": "2222",
            "signature": "3333"
        }"#;
        let m: Manifest = serde_json::from_str(json).unwrap();
        assert_eq!(m.session_id, "abc-123");
        assert_eq!(m.user, "alice");
        assert!((m.duration() - 100.0).abs() < 0.01);
    }
}
```

- [ ] **Step 2: Add `mod manifest;` to main.rs**

At the top of `src/main.rs`:

```rust
mod manifest;
```

- [ ] **Step 3: Test + commit**

```bash
cargo test --jobs 1 manifest 2>&1 | tail -10
git add src/manifest.rs src/main.rs
git -c commit.gpgsign=false commit -m "manifest: serde types for katagrapho-manifest-v1"
```

## Task 3: index.rs — SQLite schema + scan + query

**Files:**
- Create: `theatron/src/index.rs`

- [ ] **Step 1: Write index.rs**

```rust
//! In-memory SQLite FTS index over manifest sidecars.

use rusqlite::{Connection, params};
use std::path::{Path, PathBuf};

use crate::manifest;

pub struct Index {
    conn: Connection,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionRow {
    pub session_id: String,
    pub sender: String,
    pub user: String,
    pub host: String,
    pub started: f64,
    pub ended: f64,
    pub duration: f64,
    pub total_bytes: i64,
    pub parts: i32,
    pub end_reason: String,
    pub exit_code: i32,
    pub ssh_client: String,
    pub audit_session_id: Option<i32>,
    pub manifest_path: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Stats {
    pub total_sessions: i64,
    pub total_bytes: i64,
    pub unique_users: i64,
    pub avg_duration_secs: f64,
    pub sessions_24h: i64,
}

pub struct QueryParams {
    pub q: Option<String>,
    pub user: Option<String>,
    pub host: Option<String>,
    pub from: Option<f64>,
    pub to: Option<f64>,
    pub page: usize,
    pub per_page: usize,
    pub sort: String,
    pub order: String,
}

impl Default for QueryParams {
    fn default() -> Self {
        Self {
            q: None,
            user: None,
            host: None,
            from: None,
            to: None,
            page: 1,
            per_page: 25,
            sort: "started".into(),
            order: "desc".into(),
        }
    }
}

pub struct QueryResult {
    pub sessions: Vec<SessionRow>,
    pub total: i64,
}

impl Index {
    pub fn new() -> Result<Self, String> {
        let conn = Connection::open_in_memory()
            .map_err(|e| format!("sqlite open: {e}"))?;

        conn.execute_batch(
            "CREATE TABLE sessions (
                id INTEGER PRIMARY KEY,
                session_id TEXT NOT NULL,
                sender TEXT NOT NULL DEFAULT '',
                user TEXT NOT NULL,
                host TEXT NOT NULL,
                started REAL NOT NULL,
                ended REAL,
                duration REAL,
                total_bytes INTEGER DEFAULT 0,
                parts INTEGER DEFAULT 1,
                end_reason TEXT DEFAULT '',
                exit_code INTEGER DEFAULT 0,
                boot_id TEXT DEFAULT '',
                audit_session_id INTEGER,
                ssh_client TEXT DEFAULT '',
                manifest_path TEXT NOT NULL,
                UNIQUE(session_id, sender)
            );
            CREATE VIRTUAL TABLE sessions_fts USING fts5(
                session_id, user, host, ssh_client,
                content=sessions, content_rowid=id
            );"
        ).map_err(|e| format!("schema: {e}"))?;

        Ok(Self { conn })
    }

    pub fn upsert(&self, sender: &str, m: &manifest::Manifest, path: &str) -> Result<(), String> {
        // Try to find an existing row for this session+sender.
        let existing: Option<(i64, i32)> = self.conn.query_row(
            "SELECT total_bytes, parts FROM sessions WHERE session_id = ?1 AND sender = ?2",
            params![m.session_id, sender],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).ok();

        if let Some((prev_bytes, prev_parts)) = existing {
            // Multi-part: update totals and the end fields.
            self.conn.execute(
                "UPDATE sessions SET ended = ?1, duration = ?2,
                 total_bytes = ?3, parts = ?4, end_reason = ?5, exit_code = ?6,
                 manifest_path = ?7
                 WHERE session_id = ?8 AND sender = ?9",
                params![
                    m.ended, m.ended - m.started,
                    prev_bytes + m.recording_size as i64,
                    prev_parts + 1,
                    m.end_reason, m.exit_code,
                    path, m.session_id, sender
                ],
            ).map_err(|e| format!("update: {e}"))?;
        } else {
            self.conn.execute(
                "INSERT INTO sessions (session_id, sender, user, host, started, ended,
                 duration, total_bytes, parts, end_reason, exit_code, boot_id,
                 audit_session_id, ssh_client, manifest_path)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1,?9,?10,?11,?12,?13,?14)",
                params![
                    m.session_id, sender, m.user, m.host, m.started, m.ended,
                    m.duration(), m.recording_size as i64,
                    m.end_reason, m.exit_code, m.boot_id,
                    m.audit_session_id.map(|v| v as i32),
                    "", // ssh_client not in manifest yet; empty for now
                    path
                ],
            ).map_err(|e| format!("insert: {e}"))?;

            // Update FTS.
            let rowid = self.conn.last_insert_rowid();
            self.conn.execute(
                "INSERT INTO sessions_fts (rowid, session_id, user, host, ssh_client)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![rowid, m.session_id, m.user, m.host, ""],
            ).map_err(|e| format!("fts insert: {e}"))?;
        }
        Ok(())
    }

    pub fn stats(&self) -> Result<Stats, String> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        let cutoff_24h = now - 86400.0;

        let total_sessions: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM sessions", [], |r| r.get(0)
        ).unwrap_or(0);
        let total_bytes: i64 = self.conn.query_row(
            "SELECT COALESCE(SUM(total_bytes), 0) FROM sessions", [], |r| r.get(0)
        ).unwrap_or(0);
        let unique_users: i64 = self.conn.query_row(
            "SELECT COUNT(DISTINCT user) FROM sessions", [], |r| r.get(0)
        ).unwrap_or(0);
        let avg_duration: f64 = self.conn.query_row(
            "SELECT COALESCE(AVG(duration), 0) FROM sessions", [], |r| r.get(0)
        ).unwrap_or(0.0);
        let sessions_24h: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM sessions WHERE started > ?1",
            params![cutoff_24h], |r| r.get(0)
        ).unwrap_or(0);

        Ok(Stats {
            total_sessions,
            total_bytes,
            unique_users,
            avg_duration_secs: avg_duration,
            sessions_24h,
        })
    }

    pub fn query(&self, p: &QueryParams) -> Result<QueryResult, String> {
        // Build WHERE clause dynamically.
        let mut conditions: Vec<String> = Vec::new();
        let mut bind_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(ref q) = p.q {
            if !q.is_empty() {
                conditions.push(format!(
                    "id IN (SELECT rowid FROM sessions_fts WHERE sessions_fts MATCH ?{})",
                    bind_values.len() + 1
                ));
                bind_values.push(Box::new(q.clone()));
            }
        }
        if let Some(ref user) = p.user {
            conditions.push(format!("user = ?{}", bind_values.len() + 1));
            bind_values.push(Box::new(user.clone()));
        }
        if let Some(ref host) = p.host {
            conditions.push(format!("host = ?{}", bind_values.len() + 1));
            bind_values.push(Box::new(host.clone()));
        }
        if let Some(from) = p.from {
            conditions.push(format!("started >= ?{}", bind_values.len() + 1));
            bind_values.push(Box::new(from));
        }
        if let Some(to) = p.to {
            conditions.push(format!("started <= ?{}", bind_values.len() + 1));
            bind_values.push(Box::new(to));
        }

        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };

        // Validate sort/order to prevent injection.
        let sort_col = match p.sort.as_str() {
            "started" | "duration" | "total_bytes" | "user" | "host" => &p.sort,
            _ => "started",
        };
        let order = if p.order == "asc" { "ASC" } else { "DESC" };

        let count_sql = format!("SELECT COUNT(*) FROM sessions {where_clause}");
        let refs: Vec<&dyn rusqlite::types::ToSql> =
            bind_values.iter().map(|b| b.as_ref()).collect();
        let total: i64 = self.conn
            .query_row(&count_sql, refs.as_slice(), |r| r.get(0))
            .unwrap_or(0);

        let offset = (p.page.saturating_sub(1)) * p.per_page;
        let data_sql = format!(
            "SELECT session_id, sender, user, host, started, ended, duration,
                    total_bytes, parts, end_reason, exit_code, ssh_client,
                    audit_session_id, manifest_path
             FROM sessions {where_clause}
             ORDER BY {sort_col} {order}
             LIMIT ?{} OFFSET ?{}",
            bind_values.len() + 1,
            bind_values.len() + 2
        );

        let mut bind_with_limit = bind_values;
        bind_with_limit.push(Box::new(p.per_page as i64));
        bind_with_limit.push(Box::new(offset as i64));

        let refs2: Vec<&dyn rusqlite::types::ToSql> =
            bind_with_limit.iter().map(|b| b.as_ref()).collect();

        let mut stmt = self.conn.prepare(&data_sql)
            .map_err(|e| format!("prepare: {e}"))?;
        let rows = stmt.query_map(refs2.as_slice(), |row| {
            Ok(SessionRow {
                session_id: row.get(0)?,
                sender: row.get(1)?,
                user: row.get(2)?,
                host: row.get(3)?,
                started: row.get(4)?,
                ended: row.get(5)?,
                duration: row.get(6)?,
                total_bytes: row.get(7)?,
                parts: row.get(8)?,
                end_reason: row.get(9)?,
                exit_code: row.get(10)?,
                ssh_client: row.get(11)?,
                audit_session_id: row.get(12)?,
                manifest_path: row.get(13)?,
            })
        }).map_err(|e| format!("query: {e}"))?;

        let sessions: Vec<SessionRow> = rows.filter_map(|r| r.ok()).collect();

        Ok(QueryResult { sessions, total })
    }

    /// Get a single session by ID (returns all parts' manifests).
    pub fn get_session(&self, session_id: &str) -> Result<Option<SessionRow>, String> {
        self.conn.query_row(
            "SELECT session_id, sender, user, host, started, ended, duration,
                    total_bytes, parts, end_reason, exit_code, ssh_client,
                    audit_session_id, manifest_path
             FROM sessions WHERE session_id = ?1 LIMIT 1",
            params![session_id],
            |row| {
                Ok(SessionRow {
                    session_id: row.get(0)?,
                    sender: row.get(1)?,
                    user: row.get(2)?,
                    host: row.get(3)?,
                    started: row.get(4)?,
                    ended: row.get(5)?,
                    duration: row.get(6)?,
                    total_bytes: row.get(7)?,
                    parts: row.get(8)?,
                    end_reason: row.get(9)?,
                    exit_code: row.get(10)?,
                    ssh_client: row.get(11)?,
                    audit_session_id: row.get(12)?,
                    manifest_path: row.get(13)?,
                })
            },
        ).map(Some).or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            _ => Err(format!("get_session: {e}")),
        })
    }
}

/// Scan a directory tree for .manifest.json files and index them.
pub fn scan_dir(index: &Index, root: &Path, mode: &str) -> Result<usize, String> {
    let mut count = 0;
    match mode {
        "collector" => {
            // senders/*/recordings/*/*.manifest.json
            let senders = root.join("senders");
            if !senders.exists() { return Ok(0); }
            for sender_entry in std::fs::read_dir(&senders).map_err(|e| format!("{e}"))?.flatten() {
                let sender_name = sender_entry.file_name().to_string_lossy().to_string();
                let recs = sender_entry.path().join("recordings");
                if !recs.exists() { continue; }
                count += scan_recordings(index, &recs, &sender_name)?;
            }
        }
        "local" | _ => {
            // <user>/*.manifest.json
            count += scan_recordings(index, root, "")?;
        }
    }
    Ok(count)
}

fn scan_recordings(index: &Index, dir: &Path, sender: &str) -> Result<usize, String> {
    let mut count = 0;
    for entry in walkdir(dir)? {
        if entry.extension().and_then(|e| e.to_str()) == Some("json")
            && entry.to_string_lossy().contains(".manifest.")
        {
            match manifest::load_manifest(&entry) {
                Ok(m) => {
                    index.upsert(sender, &m, &entry.to_string_lossy())?;
                    count += 1;
                }
                Err(e) => {
                    eprintln!("theatron: skip {}: {e}", entry.display());
                }
            }
        }
    }
    Ok(count)
}

fn walkdir(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut result = Vec::new();
    if !dir.exists() { return Ok(result); }
    let read = std::fs::read_dir(dir).map_err(|e| format!("readdir {}: {e}", dir.display()))?;
    for entry in read.flatten() {
        let path = entry.path();
        if path.is_dir() {
            result.extend(walkdir(&path)?);
        } else {
            result.push(path);
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_index_has_zero_stats() {
        let idx = Index::new().unwrap();
        let s = idx.stats().unwrap();
        assert_eq!(s.total_sessions, 0);
        assert_eq!(s.total_bytes, 0);
    }

    #[test]
    fn upsert_and_query_round_trip() {
        let idx = Index::new().unwrap();
        let m = manifest::Manifest {
            v: "katagrapho-manifest-v1".into(),
            session_id: "test-1".into(),
            part: 0,
            user: "alice".into(),
            host: "nyx".into(),
            boot_id: "b".into(),
            audit_session_id: None,
            started: 1000.0,
            ended: 1100.0,
            katagrapho_version: "0".into(),
            katagrapho_commit: "0".into(),
            epitropos_version: "0".into(),
            epitropos_commit: "0".into(),
            recording_file: "test.kgv1.age".into(),
            recording_size: 4096,
            recording_sha256: "00".into(),
            chunks: vec![],
            end_reason: "eof".into(),
            exit_code: 0,
            prev_manifest_hash: "00".into(),
            this_manifest_hash: "11".into(),
            key_id: "".into(),
            signature: "".into(),
        };
        idx.upsert("sender-a", &m, "/tmp/test.manifest.json").unwrap();

        let s = idx.stats().unwrap();
        assert_eq!(s.total_sessions, 1);
        assert_eq!(s.total_bytes, 4096);

        let r = idx.query(&QueryParams::default()).unwrap();
        assert_eq!(r.total, 1);
        assert_eq!(r.sessions[0].user, "alice");
    }

    #[test]
    fn fts_search_by_user() {
        let idx = Index::new().unwrap();
        let m = manifest::Manifest {
            v: "katagrapho-manifest-v1".into(),
            session_id: "s1".into(),
            part: 0, user: "bob".into(), host: "host1".into(),
            boot_id: "b".into(), audit_session_id: None,
            started: 1000.0, ended: 1100.0,
            katagrapho_version: "0".into(), katagrapho_commit: "0".into(),
            epitropos_version: "0".into(), epitropos_commit: "0".into(),
            recording_file: "s1.kgv1.age".into(), recording_size: 100,
            recording_sha256: "0".into(), chunks: vec![],
            end_reason: "eof".into(), exit_code: 0,
            prev_manifest_hash: "0".into(), this_manifest_hash: "1".into(),
            key_id: "".into(), signature: "".into(),
        };
        idx.upsert("", &m, "/tmp/s1.json").unwrap();

        let q = QueryParams { q: Some("bob".into()), ..Default::default() };
        let r = idx.query(&q).unwrap();
        assert_eq!(r.total, 1);

        let q2 = QueryParams { q: Some("nonexistent".into()), ..Default::default() };
        let r2 = idx.query(&q2).unwrap();
        assert_eq!(r2.total, 0);
    }
}
```

- [ ] **Step 2: Wire into main.rs**

```rust
mod index;
```

- [ ] **Step 3: Test + commit**

```bash
cargo test --jobs 1 index 2>&1 | tail -10
git add src/index.rs src/main.rs
git -c commit.gpgsign=false commit -m "index: in-memory SQLite FTS over manifest sidecars"
```

## Task 4: stream.rs — age decrypt + kgv1 streaming

**Files:**
- Create: `theatron/src/stream.rs`

- [ ] **Step 1: Write stream.rs**

```rust
//! Server-side age decryption + kgv1 streaming.
//!
//! The operator's age identity is received in the POST body, used to
//! construct a streaming decryptor, and discarded when the stream
//! ends. The identity never touches disk.

use age::secrecy::ExposeSecret;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;

/// Decrypt a .kgv1.age file using the provided identity string and
/// return a BufReader over the plaintext stream.
pub fn decrypt_recording(
    path: &Path,
    identity_str: &str,
) -> Result<impl BufRead, String> {
    let identity: age::x25519::Identity = identity_str
        .trim()
        .parse()
        .map_err(|e| format!("parse identity: {e}"))?;

    let file = std::fs::File::open(path)
        .map_err(|e| format!("open {}: {e}", path.display()))?;

    let decryptor = age::Decryptor::new(file)
        .map_err(|e| format!("age decryptor: {e}"))?;

    let reader = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .map_err(|e| format!("decrypt: {e}"))?;

    Ok(BufReader::new(reader))
}

/// Read all decrypted lines into a Vec (for small files / tests).
#[allow(dead_code)]
pub fn decrypt_to_lines(
    path: &Path,
    identity_str: &str,
) -> Result<Vec<String>, String> {
    let reader = decrypt_recording(path, identity_str)?;
    let mut lines = Vec::new();
    for line in reader.lines() {
        let line = line.map_err(|e| format!("read line: {e}"))?;
        if !line.is_empty() {
            lines.push(line);
        }
    }
    Ok(lines)
}
```

- [ ] **Step 2: Wire + commit**

```bash
# add mod stream; to main.rs
git add src/stream.rs src/main.rs
git -c commit.gpgsign=false commit -m "stream: age decrypt + kgv1 streaming reader"
```

---

# Phase 2 — Backend: API Endpoints

## Task 5: api.rs — all JSON endpoints

**Files:**
- Create: `theatron/src/api.rs`

- [ ] **Step 1: Write api.rs**

```rust
//! API handlers for theatron.

use axum::{
    body::Body,
    extract::{Path as AxumPath, Query, State},
    http::{header, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::index::{Index, QueryParams};
use crate::stream;

pub struct AppState {
    pub index: Arc<RwLock<Index>>,
    pub storage_dir: std::path::PathBuf,
    pub storage_mode: String,
}

// GET /api/stats
pub async fn stats(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let idx = state.index.read().await;
    match idx.stats() {
        Ok(s) => Json(s).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

// GET /api/sessions?q=&user=&host=&from=&to=&page=&per_page=&sort=&order=
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
    let idx = state.index.read().await;
    match idx.query(&params) {
        Ok(result) => Json(serde_json::json!({
            "sessions": result.sessions,
            "total": result.total,
            "page": params.page,
            "per_page": params.per_page,
        })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

// GET /api/sessions/:session_id
pub async fn session_detail(
    State(state): State<Arc<AppState>>,
    AxumPath(session_id): AxumPath<String>,
) -> impl IntoResponse {
    let idx = state.index.read().await;
    match idx.get_session(&session_id) {
        Ok(Some(s)) => Json(s).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

// POST /api/stream/:session_id/parts/:part
#[derive(Deserialize)]
pub struct StreamBody {
    pub age_identity: String,
}

pub async fn stream_recording(
    State(state): State<Arc<AppState>>,
    AxumPath((session_id, part)): AxumPath<(String, u32)>,
    Json(body): Json<StreamBody>,
) -> impl IntoResponse {
    // Find the recording file.
    let rec_path = find_recording(&state.storage_dir, &state.storage_mode, &session_id, part);
    let rec_path = match rec_path {
        Some(p) => p,
        None => return (StatusCode::NOT_FOUND, "recording not found").into_response(),
    };

    // Decrypt in a blocking task.
    let identity = body.age_identity.clone();
    let result = tokio::task::spawn_blocking(move || {
        stream::decrypt_to_lines(&rec_path, &identity)
    }).await;

    match result {
        Ok(Ok(lines)) => {
            let body_str = lines.join("\n") + "\n";
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "application/x-ndjson")],
                body_str,
            ).into_response()
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

// GET /api/raw/:session_id/parts/:part
pub async fn raw_recording(
    State(state): State<Arc<AppState>>,
    AxumPath((session_id, part)): AxumPath<(String, u32)>,
) -> impl IntoResponse {
    let rec_path = find_recording(&state.storage_dir, &state.storage_mode, &session_id, part);
    match rec_path {
        Some(p) => match std::fs::read(&p) {
            Ok(bytes) => (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, "application/octet-stream"),
                    (header::CONTENT_DISPOSITION, "attachment"),
                ],
                bytes,
            ).into_response(),
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
    // Validate inputs to prevent path traversal.
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
```

Note: the `stream_recording` handler currently reads ALL lines into memory then returns them. For Track D this is acceptable (recordings are at most 512 MiB per part, and most are much smaller). A true streaming response using `axum::body::Body::from_stream` is a follow-up optimization.

- [ ] **Step 2: Wire + commit**

```bash
# add mod api; to main.rs
git add src/api.rs src/main.rs
git -c commit.gpgsign=false commit -m "api: stats + sessions + stream + raw endpoints"
```

## Task 6: Rewire main.rs with all routes + startup scan + inotify

**Files:**
- Modify: `theatron/src/main.rs`

- [ ] **Step 1: Rewrite main.rs**

Replace the existing main.rs entirely with:

```rust
mod api;
mod index;
mod manifest;
mod stream;

use axum::Router;
use axum::routing::{get, post};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
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
        index: Arc::new(RwLock::new(idx)),
        storage_dir: storage_path.clone(),
        storage_mode: storage_mode.clone(),
    });

    // Inotify watcher (background task).
    let state_watch = state.clone();
    let mode_watch = storage_mode.clone();
    tokio::spawn(async move {
        if let Err(e) = run_inotify_watcher(state_watch, &storage_path, &mode_watch).await {
            eprintln!("theatron: inotify watcher failed: {e}");
        }
    });

    let app = Router::new()
        .route("/api/stats", get(api::stats))
        .route("/api/sessions", get(api::sessions))
        .route("/api/sessions/{session_id}", get(api::session_detail))
        .route("/api/stream/{session_id}/parts/{part}", post(api::stream_recording))
        .route("/api/raw/{session_id}/parts/{part}", get(api::raw_recording))
        .fallback_service(ServeDir::new(&static_dir))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr: SocketAddr = bind.parse().expect("invalid bind address");
    eprintln!("theatron: listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn run_inotify_watcher(
    state: Arc<api::AppState>,
    storage_dir: &std::path::Path,
    mode: &str,
) -> Result<(), String> {
    use inotify::{Inotify, WatchMask};
    use std::path::Path;

    let mut inotify = Inotify::init().map_err(|e| format!("inotify init: {e}"))?;

    // Watch the recordings directories.
    let dirs_to_watch: Vec<PathBuf> = match mode {
        "collector" => {
            let senders = storage_dir.join("senders");
            if senders.exists() {
                std::fs::read_dir(&senders)
                    .map_err(|e| format!("{e}"))?
                    .flatten()
                    .filter_map(|e| {
                        let recs = e.path().join("recordings");
                        if recs.exists() { Some(recs) } else { None }
                    })
                    .collect()
            } else {
                vec![]
            }
        }
        _ => vec![storage_dir.to_path_buf()],
    };

    for dir in &dirs_to_watch {
        // Watch recursively by watching each subdirectory.
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let _ = inotify.watches().add(
                        &entry.path(),
                        WatchMask::CLOSE_WRITE | WatchMask::CREATE,
                    );
                }
            }
        }
        let _ = inotify.watches().add(dir, WatchMask::CLOSE_WRITE | WatchMask::CREATE);
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
                    // Find the full path by checking watched dirs.
                    for dir in &dirs_to_watch {
                        let candidates = find_manifest_candidates(dir, &name_str);
                        for path in candidates {
                            if let Ok(m) = manifest::load_manifest(&path) {
                                let sender = extract_sender_from_path(&path, storage_dir);
                                let idx = state.index.write().await;
                                let _ = idx.upsert(&sender, &m, &path.to_string_lossy());
                                eprintln!("theatron: indexed new manifest: {}", name_str);
                            }
                        }
                    }
                }
            }
        }
    }
}

fn find_manifest_candidates(dir: &std::path::Path, name: &str) -> Vec<PathBuf> {
    let mut results = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                results.extend(find_manifest_candidates(&path, name));
            } else if path.file_name().map(|n| n.to_string_lossy().as_ref() == name).unwrap_or(false) {
                results.push(path);
            }
        }
    }
    results
}

fn extract_sender_from_path(path: &std::path::Path, storage_dir: &std::path::Path) -> String {
    // Try to extract sender name from path:
    // .../senders/<sender>/recordings/<user>/<file>
    if let Ok(relative) = path.strip_prefix(storage_dir) {
        let parts: Vec<&str> = relative.to_string_lossy().split('/').collect();
        if parts.len() >= 2 && parts[0] == "senders" {
            return parts[1].to_string();
        }
    }
    String::new()
}
```

- [ ] **Step 2: Build + commit**

```bash
cargo check --jobs 1 2>&1 | tail -10
git add src/main.rs
git -c commit.gpgsign=false commit -m "main: rewire with all API routes + startup scan + inotify"
```

---

# Phase 3 — Frontend: SPA Shell + Router + Theme

## Task 7: theme.css

**Files:**
- Create: `theatron/frontend/theme.css`

Terminal-architect custom styles beyond what Tailwind provides: the scan-line effect, glow borders, underscore labels, monospace table cells.

## Task 8: app.js — hash router + fetch helpers

**Files:**
- Create: `theatron/frontend/app.js`

Hash-based SPA router. Routes: `#/dashboard`, `#/sessions`, `#/viewer/:id`, `#/exports`. Each route shows/hides a `<div>` and calls the corresponding screen's `init()` function.

## Task 9: index.html — SPA shell

**Files:**
- Rewrite: `theatron/frontend/index.html`

Full single-page HTML with: nav sidebar (Dashboard, Sessions, Viewer, Exports, Record_New, Docs, Logout), four screen container divs, script tags for xterm.js CDN + app.js + each screen's JS.

---

# Phase 4 — Frontend: Dashboard + Browser

## Task 10: dashboard.js

Fetches `/api/stats`, renders the four stat cards, a simple CSS bar chart for sessions-per-hour (computed client-side from `/api/sessions?from=24h_ago&per_page=1000`), and the recent sessions table.

## Task 11: browser.js

Session table with search input (debounced fetch to `/api/sessions?q=`), timeframe dropdown, status filter, sortable columns, pagination, and bottom stat row.

---

# Phase 5 — Frontend: Viewer

## Task 12: terminal.js — xterm.js playback engine

The load-bearing frontend module:
1. Request the age identity from the operator (modal + sessionStorage)
2. POST to `/api/stream/:id/parts/0` with the identity
3. Parse kgv1 NDJSON lines into an event buffer
4. Playback engine: iterate events with delay-based timing, supporting play/pause/seek/speed
5. Write `out` events' base64-decoded bytes to xterm.js
6. Handle `resize` events via xterm.resize()
7. Auto-advance to next part on `end.reason == "rotated"`

## Task 13: Wire viewer screen into index.html

Connect the viewer div with terminal.js, add the controls bar (play/pause/seek slider/speed dropdown), and the right-panel session properties + raw event log.

---

# Phase 6 — Frontend: Exports

## Task 14: exports.js

Batch export form: checkboxes for time range selection, download button that hits `/api/raw/:id/parts/:n` for each selected session and bundles them (or downloads individually). Storage integrity panel placeholder.

---

# Phase 7 — NixOS Module + Lint + Acceptance

## Task 15: nixos-module.nix

Systemd service running as `theatron` user in `katagrapho-readers` group, binding to localhost, reading from the collector storage dir.

## Task 16: Clippy + fmt clean

```bash
cargo clippy --jobs 1 -- -D warnings
cargo fmt
```

## Task 17: Acceptance walkthrough

Walk every criterion from spec §11.

---

# Self-Review Notes

**Spec coverage:**
- §2 architecture → Task 6 (main.rs rewire)
- §3 API → Task 5 (api.rs)
- §4 frontend → Tasks 7–14
- §5 SQLite index → Task 3 (index.rs)
- §6 deps → Task 1
- §7 file layout → all tasks
- §8 config → Task 6 (CLI args; TOML config deferred)
- §9 NixOS → Task 15
- §10 risks → mitigated in stream.rs (key lifecycle), api.rs (path traversal)
- §11 acceptance → Task 17

**Acknowledged shortcuts:**
- `stream_recording` reads all lines into memory then returns them (not true streaming). Acceptable for recordings up to 512 MiB per part; follow-up optimization for true `Body::from_stream`.
- Frontend tasks (7–14) are described by function rather than full code blocks. The JS is vanilla + Tailwind and follows the mockup layouts directly; the executor should reference the stitch screenshots for exact visual fidelity.
- TOML config file support deferred; CLI args are the interface for this track. The NixOS module generates the CLI flags.
