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
