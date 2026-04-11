# Track D(a) — Theatron: Web UI + Session Playback

**Status:** Design approved 2026-04-07
**Predecessors:** Tracks A + B + C (katagrapho kgv1 format, signed manifests,
collector storage layout)
**Repo:** `/home/acid/Workspace/repos/theatron/`

Theatron is a standalone web UI for browsing and replaying session
recordings. It reads manifest sidecars and encrypted recordings
directly from the collector's (or local katagrapho's) filesystem.
No network API between theatron and the collector — filesystem only.

## 1. Goals

1. **Operator-facing audit tool.** Browse, search, filter, and replay
   any session recording stored on the collector host.
2. **Client-side key control.** The operator's age decryption key is
   pasted in the browser, sent to theatron over localhost HTTPS per-
   request, used to decrypt in server memory, and discarded. No
   persistent key on the theatron host.
3. **Terminal architect aesthetic.** Match the stitch mockups: dark
   theme (#131313 surface), phosphor green (#00ff41 primary),
   monospace fonts (Share Tech Mono), underscore_case labels.
4. **Four screens:** Dashboard, Session Browser, Session Viewer,
   Exports — as specified in the stitch mockups.
5. **Fast search.** In-memory SQLite FTS index built at startup from
   sidecar JSONs, kept live via inotify.

**Non-goals:**
- Built-in authentication (bind to localhost; reverse proxy for
  remote access)
- Multi-collector federation
- Real-time live session viewing (Track E)
- Persistent index database (in-memory only in this track)

## 2. Architecture

```
Operator's browser
    │
    │  HTTP (localhost:3000)
    ▼
┌─────────────────────────────┐
│          theatron            │
│     (axum + tower-http)     │
│                             │
│  GET  /api/stats            │ ← aggregates from SQLite
│  GET  /api/sessions         │ ← FTS search + filters
│  GET  /api/sessions/:id     │ ← full manifest metadata
│  POST /api/stream/:id/:part │ ← decrypt + stream kgv1
│  GET  /api/raw/:id/:part    │ ← raw .kgv1.age bytes
│  GET  /api/export           │ ← batch download
│  /*                         │ ← static frontend
│                             │
│  [inotify watcher]          │ ← new sidecar → re-index
│  [in-memory SQLite]         │ ← session metadata FTS
└─────────────────────────────┘
    │
    │  fs::read (no network)
    ▼
/var/lib/epitropos-collector/senders/*/recordings/
  OR  /var/log/ssh-sessions/  (local mode)
```

Theatron runs on the same host as the collector (or on a standalone
host that runs katagrapho directly). It needs read access to the
recording and sidecar files — membership in `katagrapho-readers`
(collector mode) or `ssh-sessions` (local mode).

## 3. Backend API

### 3.1 Stats

```
GET /api/stats
→ {
    total_sessions: 1248,
    total_bytes: 68853964800,
    unique_users: 28,
    avg_duration_secs: 8040,
    sessions_24h: 14,
    storage_used_display: "64.2 GB"
  }
```

Computed from the SQLite index on every request (fast — single
aggregate query).

### 3.2 Session list with search

```
GET /api/sessions?q=<text>&user=<u>&host=<h>&from=<ts>&to=<ts>
                 &status=<active|closed|all>&page=<n>&per_page=<n>
                 &sort=<started|duration|size>&order=<asc|desc>
→ {
    sessions: [{
      session_id, sender, user, host, started, ended,
      duration, parts, total_bytes, end_reason, exit_code,
      ssh_client, audit_session_id
    }, ...],
    total: 1248,
    page: 1,
    per_page: 25
  }
```

`q` triggers FTS search across session_id, user, host, ssh_client.
Other params are exact filters layered on top.

### 3.3 Session detail

```
GET /api/sessions/{session_id}
→ full manifest JSON for all parts (array if multi-part), plus
  computed fields (total_duration, total_bytes, chain_verified)
```

### 3.4 Streaming decryption

```
POST /api/stream/{session_id}/parts/{part}
Body: { "age_identity": "AGE-SECRET-KEY-1..." }
Content-Type: application/json

→ 200 streaming body: decrypted kgv1 NDJSON lines
   Content-Type: application/x-ndjson

→ 403 if the identity cannot decrypt the file
→ 404 if the recording doesn't exist
```

The server:
1. Reads the age identity from the POST body.
2. Opens the `.kgv1.age` file.
3. Creates an `age::Decryptor` with the provided identity.
4. Streams the decrypted plaintext line by line as the response body.
5. Drops the identity and decryptor when the stream ends or the
   client disconnects.

The identity is **never** written to disk, never logged, never stored
beyond the lifetime of the HTTP request handler.

### 3.5 Raw download (client-side decryption fallback)

```
GET /api/raw/{session_id}/parts/{part}
→ raw encrypted .kgv1.age bytes
   Content-Type: application/octet-stream
   Content-Disposition: attachment
```

For operators who prefer to decrypt locally or archive the encrypted
file.

### 3.6 Batch export

```
GET /api/export?ids=session1,session2&format=encrypted
→ application/zip containing the selected .kgv1.age + .manifest.json
   files bundled as a zip archive
```

`format=encrypted` is the only option in this track (plaintext export
would require the server to hold a key persistently, which violates
the key-hygiene model).

## 4. Frontend

### 4.1 Technology

- **Tailwind CSS** via CDN (config from the existing `index.html`)
- **xterm.js** via CDN for terminal emulation
- **Vanilla JS** — no framework, no build step
- Hash-based client-side routing: `#/dashboard`, `#/sessions`,
  `#/viewer/SESSION_ID`, `#/exports`
- **Share Tech Mono** + **Space Grotesk** fonts
- **Material Symbols Outlined** icons

### 4.2 Theme (from stitch mockups)

| Token | Value |
|---|---|
| Surface | #131313 |
| Surface container | #201f1f |
| Surface container high | #2a2a2a |
| Primary (phosphor green) | #00ff41 |
| Primary container | #00e639 |
| Secondary | #56e15b |
| On-surface (text) | #e5e2e1 |
| Error | #ffb4ab |
| Outline | #84967e |

All labels use `UPPER_SNAKE_CASE` styling per the mockups. Monospace
font for data values; Space Grotesk for headings.

### 4.3 Dashboard (`#/dashboard`)

Per the `dashboard_updated_name` mockup:
- **Top stat cards:** total sessions (+% vs yesterday), storage
  usage (% used), active streams, global latency
- **Network activity chart:** sessions per hour, last 24h (simple
  bar chart drawn with CSS or a tiny canvas helper — no charting
  library)
- **Event stream panel:** latest 10 session events (start/end/error),
  auto-updating via periodic fetch
- **Recent active sessions table:** last 5, with status dot + link
  to viewer
- **Footer:** build version, kernel, region, copyright

### 4.4 Session Browser (`#/sessions`)

Per the `session_browser_updated_name` mockup:
- **Search bar:** real-time debounced filtering via `/api/sessions?q=`
- **Timeframe dropdown:** last 1h / 24h / 7d / 30d / all
- **Status filter:** active / closed / all
- **Sortable columns:** session ID, user, host, start time, duration,
  size, actions
- **Actions column:** PLAYBACK button (links to `#/viewer/SESSION_ID`),
  WATCH button for active sessions (reserved for Track E)
- **Pagination:** `< 1 2 3 ... >`
- **Bottom stat row:** total volume 24h, unique operators, avg
  session length

### 4.5 Session Viewer (`#/viewer/:session_id`)

Per the `session_viewer_updated_name` mockup:
- **Center:** xterm.js terminal (~60% width)
- **Playback controls bar:** play ▶ / pause ⏸, skip back ◀◀,
  skip forward ▶▶, seek slider, current time / total time, speed
  dropdown (0.5x / 1.0x / 2.0x / 4.0x), fullscreen toggle, code
  view toggle
- **Right panel — session properties:** origin IP, protocol,
  encryption type, user tags (from manifest metadata)
- **Right panel — raw event log:** scrollable timestamped event
  list parsed from the kgv1 stream (TERM_RESIZE, KEY_PRESS,
  CMD_EXEC, AUTH_FAIL, OUT_STREAM_CH, etc.)
- **Top bar:** LIVE_FEED indicator (grayed out if not live),
  session title, EXPORT_LOGS + TERMINATE_NODE buttons
- **Bottom bar:** input rate, jump-to-command search, delta timer
- **Left sidebar:** nav (Dashboard, Sessions, Viewer, Exports)
  with RECORD_NEW button, DOCS link, LOGOUT link

### 4.6 Exports (`#/exports`)

Per the `export_download_updated_name` mockup:
- **Batch export form:** selection range checkboxes (last 24h, all
  security events, network log fragments), encryption layer
  dropdown, passphrase override field, EXECUTE_BATCH_EXPORT button
- **Storage integrity panel:** visual indicator (from the latest
  `katagrapho-verify --check-chain` output if available)
- **Generated files table:** filename, timestamp, size, encryption
  status (X25519 / SSH_KEY / NONE), download/retry actions
- **Pagination for the file list**

### 4.7 Playback flow (detailed)

1. Navigate to `#/viewer/SESSION_ID`
2. `GET /api/sessions/SESSION_ID` → load metadata, populate right panel
3. Check `sessionStorage.getItem('age_identity')`
   - If absent → show modal: "Paste your age identity" + textarea
   - On submit → `sessionStorage.setItem('age_identity', value)`
4. `POST /api/stream/SESSION_ID/parts/0` with `{ age_identity }`
5. Read the response as a `ReadableStream`; decode lines:
   - `header` → populate session properties
   - `out` → base64-decode → push to a local event buffer with
     timestamp
   - `resize` → `xterm.resize(cols, rows)`
   - `chunk` → update progress bar (chunk.bytes / manifest.total_bytes)
   - `end` → mark stream complete
6. Playback engine reads the event buffer:
   - **Play:** iterate events, sleep `(event.t - prev.t) / speed`
     between writes to xterm
   - **Pause:** stop the iterator
   - **Seek:** jump the iterator index to the event nearest the
     target time, replay the terminal from the start (or from the
     nearest resize event) up to that point instantly, then resume
     normal-speed playback
   - **Speed:** adjust the sleep divisor
7. Multi-part: when `end.reason == "rotated"`, automatically
   `POST /api/stream/SESSION_ID/parts/N+1` and continue

## 5. SQLite index

### 5.1 Schema

```sql
CREATE TABLE sessions (
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
);
```

### 5.2 Startup scan

Walk `<storage_dir>/senders/*/recordings/*/*.manifest.json` (collector
mode) or `<storage_dir>/*/*.manifest.json` (local mode). Parse each
as JSON, insert into `sessions` table. Multi-part sessions: the
highest-part manifest's `ended` and `end_reason` win; `total_bytes`
and `duration` are summed across parts.

Expected performance: 10K manifests (~1 KB each) → <1 second on
modern NVMe.

### 5.3 Inotify

Watch all `recordings/` directories with `IN_CLOSE_WRITE`. On a new
`.manifest.json` file event, parse and upsert into the index. On
file deletion (if someone cleans up), remove from the index.

Inotify runs as a background tokio task alongside the axum server.

## 6. Dependencies (additions to existing Cargo.toml)

```toml
rusqlite = { version = "0.32", features = ["bundled"] }
inotify = "0.11"
age = { version = "0.11", default-features = false }
```

`rusqlite` with `bundled` feature compiles SQLite from source —
no system SQLite dependency. `age` for server-side decryption.
`inotify` is already a transitive dep of the proxy crate but
theatron is a separate binary, so it's listed explicitly.

## 7. File layout

```
theatron/
├── Cargo.toml              # MODIFY: add rusqlite, inotify, age
├── src/
│   ├── main.rs             # MODIFY: startup scan, inotify task, routes
│   ├── index.rs            # CREATE: SQLite schema + scan + upsert + query
│   ├── stream.rs           # CREATE: age decrypt + kgv1 streaming
│   ├── api.rs              # CREATE: stats, sessions, session detail, export
│   └── manifest.rs         # CREATE: serde types for manifest parsing
├── frontend/
│   ├── index.html          # REWRITE: full SPA shell with nav + 4 screen divs
│   ├── app.js              # CREATE: router + screen controllers + fetch helpers
│   ├── terminal.js         # CREATE: xterm.js playback engine with seek/speed
│   ├── dashboard.js        # CREATE: dashboard screen logic + chart
│   ├── browser.js          # CREATE: session browser table + search + pagination
│   ├── exports.js          # CREATE: exports screen logic
│   ├── theme.css           # CREATE: terminal-architect custom CSS
│   └── age-decrypt.js      # KEEP: fallback client-side decryption
└── nixos-module.nix        # CREATE: theatron systemd service
```

## 8. Configuration

`/etc/theatron/theatron.toml`:

```toml
[server]
bind = "127.0.0.1:3000"

[storage]
dir = "/var/lib/epitropos-collector"
mode = "collector"  # "collector" or "local"

[frontend]
static_dir = "/share/theatron/frontend"
```

`mode = "collector"` scans `<dir>/senders/*/recordings/*/`.
`mode = "local"` scans `<dir>/*/` (flat user directories).

## 9. NixOS module

```nix
services.theatron = {
  enable = mkEnableOption "theatron session recording web UI";
  package = mkOption { type = types.package; };
  bind = mkOption { type = types.str; default = "127.0.0.1:3000"; };
  storageDir = mkOption { type = types.path; };
  storageMode = mkOption { type = types.enum [ "collector" "local" ]; default = "collector"; };
};
```

When enabled:
- Creates `theatron` system user in `katagrapho-readers` group
  (collector mode) or `ssh-sessions` (local mode)
- `systemd.services.theatron`: `Type=simple`, binds to localhost,
  `ProtectSystem=strict`, `ReadOnlyPaths=[ storageDir ]`,
  no write paths (stateless), `NoNewPrivileges`, `PrivateTmp`

## 10. Risks and mitigations

1. **Age identity in server memory.** The key lives in the axum
   handler's stack for the duration of one streaming request. A core
   dump or memory inspection by root could extract it. Mitigation:
   theatron runs with `PR_SET_DUMPABLE(0)` (or the systemd
   `ProtectSystem` equivalent), and the key is held in a non-Copy
   `String` that is dropped at the end of the handler. This is the
   same posture as any TLS terminator (the TLS private key is in
   memory too).

2. **Reverse proxy header logging.** The age identity is in the POST
   body, not a header, so reverse proxies with verbose header logging
   don't leak it. Operators who enable full request-body logging on
   their proxy are explicitly choosing to log all traffic including
   secrets — that's their call, not theatron's.

3. **xterm.js XSS.** Recording output may contain ANSI escape
   sequences designed to exploit terminal emulators. xterm.js is the
   standard defense — it sanitizes terminal output the same way a
   real terminal does. No additional sanitization needed beyond what
   xterm.js provides.

4. **SQLite index out of sync.** Inotify misses events if the watch
   is set up after the file is created (race at startup). Mitigation:
   full scan at startup AFTER setting up inotify watches. Any file
   created between "set up watch" and "finish scan" is caught by
   inotify; any file that existed before is caught by the scan.

5. **Large recording streaming OOM.** Decryption is streaming (age's
   `StreamReader`), not buffered. Memory usage is O(line_length),
   not O(file_size). A 512 MiB recording streams through ~64 KB of
   server RAM.

6. **Seek is expensive.** Seeking to minute 45 of an hour-long
   session requires re-decrypting from the start of the part (age
   streaming doesn't support random access). For Track D, this is
   acceptable — the seek re-streams silently and the frontend skips
   to the target timestamp. A future optimization could cache
   decrypted chunks.

## 11. Acceptance criteria

1. `cargo build --release` succeeds.
2. Startup scans all sidecars into SQLite within 2 seconds for 10K
   manifests.
3. `GET /api/stats` returns correct aggregates.
4. `GET /api/sessions?q=alice` returns matching sessions.
5. `GET /api/sessions?from=<24h_ago>` filters by timeframe.
6. `GET /api/sessions/SESSION_ID` returns full manifest metadata.
7. `POST /api/stream/SESSION_ID/parts/0` with valid identity
   streams decrypted kgv1 NDJSON.
8. `POST /api/stream/SESSION_ID/parts/0` with wrong identity
   returns 403.
9. Dashboard screen renders with stats and activity chart.
10. Session Browser shows searchable, sortable, paginated table.
11. Session Viewer plays a recording in xterm.js with
    play/pause/seek/speed controls.
12. Session Viewer auto-advances to the next part on rotation.
13. Exports page shows recordings with encrypted download links.
14. Inotify detects new sidecars and updates the index live.
15. `theatron --version` prints version and exits 0.
16. NixOS module deploys the service on localhost.
17. Frontend matches the terminal-architect theme from the stitch
    mockups (dark surface, phosphor green, monospace, UPPER_SNAKE
    labels).
