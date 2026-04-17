//! In-memory SQLite FTS index over manifest sidecars.

use rusqlite::{params, Connection};
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
        let conn =
            Connection::open_in_memory().map_err(|e| format!("sqlite open: {e}"))?;
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
            );",
        )
        .map_err(|e| format!("schema: {e}"))?;
        Ok(Self { conn })
    }

    pub fn upsert(
        &self,
        sender: &str,
        m: &manifest::Manifest,
        path: &str,
    ) -> Result<(), String> {
        let existing: Option<(i64, i32)> = self
            .conn
            .query_row(
                "SELECT total_bytes, parts FROM sessions WHERE session_id = ?1 AND sender = ?2",
                params![m.session_id, sender],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        if let Some((prev_bytes, prev_parts)) = existing {
            self.conn
                .execute(
                    "UPDATE sessions SET ended = ?1, duration = ?2,
                     total_bytes = ?3, parts = ?4, end_reason = ?5, exit_code = ?6,
                     manifest_path = ?7
                     WHERE session_id = ?8 AND sender = ?9",
                    params![
                        m.ended,
                        m.ended - m.started,
                        prev_bytes + m.recording_size as i64,
                        prev_parts + 1,
                        m.end_reason,
                        m.exit_code,
                        path,
                        m.session_id,
                        sender
                    ],
                )
                .map_err(|e| format!("update: {e}"))?;
        } else {
            self.conn
                .execute(
                    "INSERT INTO sessions (session_id, sender, user, host, started, ended,
                     duration, total_bytes, parts, end_reason, exit_code, boot_id,
                     audit_session_id, ssh_client, manifest_path)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1,?9,?10,?11,?12,?13,?14)",
                    params![
                        m.session_id,
                        sender,
                        m.user,
                        m.host,
                        m.started,
                        m.ended,
                        m.duration(),
                        m.recording_size as i64,
                        m.end_reason,
                        m.exit_code,
                        m.boot_id,
                        m.audit_session_id.map(|v| v as i32),
                        "",
                        path
                    ],
                )
                .map_err(|e| format!("insert: {e}"))?;

            let rowid = self.conn.last_insert_rowid();
            self.conn
                .execute(
                    "INSERT INTO sessions_fts (rowid, session_id, user, host, ssh_client)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![rowid, m.session_id, m.user, m.host, ""],
                )
                .map_err(|e| format!("fts insert: {e}"))?;
        }
        Ok(())
    }

    pub fn stats(&self) -> Result<Stats, String> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        let cutoff_24h = now - 86400.0;

        let total_sessions: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap_or(0);
        let total_bytes: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(SUM(total_bytes), 0) FROM sessions",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let unique_users: i64 = self
            .conn
            .query_row("SELECT COUNT(DISTINCT user) FROM sessions", [], |r| {
                r.get(0)
            })
            .unwrap_or(0);
        let avg_duration: f64 = self
            .conn
            .query_row(
                "SELECT COALESCE(AVG(duration), 0) FROM sessions",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0.0);
        let sessions_24h: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sessions WHERE started > ?1",
                params![cutoff_24h],
                |r| r.get(0),
            )
            .unwrap_or(0);

        Ok(Stats {
            total_sessions,
            total_bytes,
            unique_users,
            avg_duration_secs: avg_duration,
            sessions_24h,
        })
    }

    pub fn query(&self, p: &QueryParams) -> Result<QueryResult, String> {
        let mut where_parts: Vec<String> = Vec::new();

        if let Some(ref q) = p.q
            && !q.is_empty()
        {
            where_parts.push(format!(
                "id IN (SELECT rowid FROM sessions_fts WHERE sessions_fts MATCH '{}')",
                q.replace('\'', "''")
            ));
        }
        if let Some(ref user) = p.user {
            where_parts.push(format!("user = '{}'", user.replace('\'', "''")));
        }
        if let Some(ref host) = p.host {
            where_parts.push(format!("host = '{}'", host.replace('\'', "''")));
        }
        if let Some(from) = p.from {
            where_parts.push(format!("started >= {from}"));
        }
        if let Some(to) = p.to {
            where_parts.push(format!("started <= {to}"));
        }

        let where_clause = if where_parts.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", where_parts.join(" AND "))
        };

        let sort_col = match p.sort.as_str() {
            "started" | "duration" | "total_bytes" | "user" | "host" => &p.sort,
            _ => "started",
        };
        let order = if p.order == "asc" { "ASC" } else { "DESC" };
        let offset = (p.page.saturating_sub(1)) * p.per_page;

        let count_sql = format!("SELECT COUNT(*) FROM sessions {where_clause}");
        let total: i64 = self
            .conn
            .query_row(&count_sql, [], |r| r.get(0))
            .unwrap_or(0);

        let data_sql = format!(
            "SELECT session_id, sender, user, host, started, ended, duration,
                    total_bytes, parts, end_reason, exit_code, ssh_client,
                    audit_session_id, manifest_path
             FROM sessions {where_clause}
             ORDER BY {sort_col} {order}
             LIMIT {} OFFSET {}",
            p.per_page, offset
        );

        let mut stmt = self.conn.prepare(&data_sql).map_err(|e| format!("prepare: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
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
            })
            .map_err(|e| format!("query: {e}"))?;

        let sessions: Vec<SessionRow> = rows.filter_map(|r| r.ok()).collect();
        Ok(QueryResult { sessions, total })
    }

    pub fn get_session(&self, session_id: &str) -> Result<Option<SessionRow>, String> {
        self.conn
            .query_row(
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
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                _ => Err(format!("get_session: {e}")),
            })
    }

    /// Sessions per hour for the last 24 hours. Returns 24 buckets
    /// ordered oldest→newest, each with the hour's unix timestamp
    /// and the session count.
    pub fn activity_24h(&self) -> Result<Vec<(i64, i64)>, String> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let start = now - 86400;
        // Round start down to the hour boundary.
        let start_hour = start - (start % 3600);

        let mut buckets = Vec::with_capacity(24);
        for i in 0..24 {
            let bucket_start = start_hour + i * 3600;
            let bucket_end = bucket_start + 3600;
            let count: i64 = self
                .conn
                .query_row(
                    "SELECT COUNT(*) FROM sessions WHERE started >= ?1 AND started < ?2",
                    params![bucket_start as f64, bucket_end as f64],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            buckets.push((bucket_start, count));
        }
        Ok(buckets)
    }
}

/// Scan a directory tree for .manifest.json files and index them.
pub fn scan_dir(index: &Index, root: &Path, mode: &str) -> Result<usize, String> {
    let mut count = 0;
    match mode {
        "collector" => {
            let senders = root.join("senders");
            if !senders.exists() {
                return Ok(0);
            }
            for sender_entry in std::fs::read_dir(&senders)
                .map_err(|e| format!("{e}"))?
                .flatten()
            {
                let sender_name = sender_entry.file_name().to_string_lossy().to_string();
                let recs = sender_entry.path().join("recordings");
                if !recs.exists() {
                    continue;
                }
                count += scan_recordings(index, &recs, &sender_name)?;
            }
        }
        _ => {
            count += scan_recordings(index, root, "")?;
        }
    }
    Ok(count)
}

fn scan_recordings(index: &Index, dir: &Path, sender: &str) -> Result<usize, String> {
    let mut count = 0;
    for entry in walkdir(dir)? {
        let name = entry.to_string_lossy();
        if name.ends_with(".manifest.json") {
            match manifest::load_manifest(&entry) {
                Ok(m) => {
                    index.upsert(sender, &m, &name)?;
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
    if !dir.exists() {
        return Ok(result);
    }
    let read =
        std::fs::read_dir(dir).map_err(|e| format!("readdir {}: {e}", dir.display()))?;
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

    fn sample_manifest(session_id: &str, user: &str) -> manifest::Manifest {
        manifest::Manifest {
            v: "katagrapho-manifest-v1".into(),
            session_id: session_id.into(),
            part: 0,
            user: user.into(),
            host: "nyx".into(),
            boot_id: "b".into(),
            audit_session_id: None,
            started: 1000.0,
            ended: 1100.0,
            katagrapho_version: "0".into(),
            katagrapho_commit: "0".into(),
            epitropos_version: "0".into(),
            epitropos_commit: "0".into(),
            recording_file: format!("{session_id}.part0.kgv1.age"),
            recording_size: 4096,
            recording_sha256: "00".into(),
            chunks: vec![],
            end_reason: "eof".into(),
            exit_code: 0,
            prev_manifest_hash: "00".into(),
            this_manifest_hash: "11".into(),
            key_id: "".into(),
            signature: "".into(),
        }
    }

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
        idx.upsert("sender-a", &sample_manifest("s1", "alice"), "/tmp/s1.json")
            .unwrap();
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
        idx.upsert("", &sample_manifest("s1", "bob"), "/tmp/s1.json")
            .unwrap();
        let q = QueryParams {
            q: Some("bob".into()),
            ..Default::default()
        };
        assert_eq!(idx.query(&q).unwrap().total, 1);
        let q2 = QueryParams {
            q: Some("nonexistent".into()),
            ..Default::default()
        };
        assert_eq!(idx.query(&q2).unwrap().total, 0);
    }

    #[test]
    fn get_session_returns_none_for_missing() {
        let idx = Index::new().unwrap();
        assert!(idx.get_session("nope").unwrap().is_none());
    }
}
