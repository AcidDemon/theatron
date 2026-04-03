# theatron

Web-based session recording playback for [epitropos](https://github.com/AcidDemon/epitropos) + [katagrapho](https://github.com/AcidDemon/katagrapho).

Named after the Greek *theatron* (θέατρον) — the viewing place where recorded sessions are replayed.

## Architecture

Rust backend (axum) serves the recording files and a static SPA frontend. Decryption of age-encrypted recordings happens entirely client-side in the browser — the server never sees the secret key.

```
Browser                          theatron (Rust)              Recordings
┌──────────────────┐            ┌──────────────────┐         ┌──────────────┐
│  SPA + age-wasm  │◄──────────►│  axum HTTP API   │◄───────►│ .cast.age    │
│                  │  encrypted │                  │  files  │ files on     │
│  decrypt in      │  .cast.age │  /api/recordings │         │ disk         │
│  browser with    │  bytes     │  /api/recordings │         └──────────────┘
│  user's key      │            │   /:user/:file   │
└──────────────────┘            └──────────────────┘
```

## Quick Start

```sh
# Build backend
cargo build --release

# Set up frontend (for encrypted playback)
cd frontend
npm init -y
npm install age-encryption
npx esbuild --bundle age-decrypt.js --outfile=dist/age-decrypt.js --format=esm
cp index.html dist/

# Run
./target/release/theatron -d /var/log/ssh-sessions --static frontend/dist
```

Open http://localhost:3000 in your browser. Paste your age secret key to decrypt recordings.

## API

- `GET /api/recordings` — list all recordings (JSON)
- `GET /api/recordings/:user/:filename` — download a recording file (raw bytes)

## Security

- Server serves encrypted files as-is. No decryption server-side.
- Secret key stays in the browser, never transmitted.
- CORS headers allow integration with external frontends.
- Path traversal prevented in filename validation.

## License

MIT
