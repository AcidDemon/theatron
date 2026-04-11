//! Server-side age decryption + kgv1 streaming.

use std::io::{BufRead, BufReader};
use std::path::Path;

/// Decrypt a .kgv1.age file and return all lines as strings.
pub fn decrypt_to_lines(path: &Path, identity_str: &str) -> Result<Vec<String>, String> {
    let identity: age::x25519::Identity = identity_str
        .trim()
        .parse()
        .map_err(|e| format!("parse identity: {e}"))?;

    let file =
        std::fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;

    let decryptor =
        age::Decryptor::new(file).map_err(|e| format!("age decryptor: {e}"))?;

    let reader = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .map_err(|e| format!("decrypt: {e}"))?;

    let buf = BufReader::new(reader);
    let mut lines = Vec::new();
    for line in buf.lines() {
        let line = line.map_err(|e| format!("read line: {e}"))?;
        if !line.is_empty() {
            lines.push(line);
        }
    }
    Ok(lines)
}
