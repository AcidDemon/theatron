// theatron — SPA router + shared utilities

const screens = ['dashboard', 'sessions', 'viewer', 'exports'];
let currentScreen = null;

function navigate(hash) {
  const h = hash || window.location.hash || '#/dashboard';
  const parts = h.replace('#/', '').split('/');
  const screen = parts[0] || 'dashboard';
  const param = parts.slice(1).join('/');

  screens.forEach(s => {
    const el = document.getElementById('screen-' + s);
    if (el) el.style.display = s === screen ? 'block' : 'none';
  });

  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.remove('nav-active');
    if (el.dataset.screen === screen) el.classList.add('nav-active');
  });

  currentScreen = screen;

  switch (screen) {
    case 'dashboard':
      if (typeof initDashboard === 'function') initDashboard();
      break;
    case 'sessions':
      if (typeof initBrowser === 'function') initBrowser();
      break;
    case 'viewer':
      if (typeof initViewer === 'function') initViewer(param);
      break;
    case 'exports':
      if (typeof initExports === 'function') initExports();
      break;
  }
}

window.addEventListener('hashchange', () => navigate());

// Shared fetch helpers
async function apiGet(path) {
  const resp = await fetch('/api' + path);
  if (!resp.ok) throw new Error(`${resp.status}: ${await resp.text()}`);
  return resp.json();
}

async function apiPost(path, body) {
  const resp = await fetch('/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return resp;
}

// Formatting helpers
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(1) + ' GB';
}

function formatDuration(secs) {
  if (!secs || secs <= 0) return '0s';
  if (secs < 60) return Math.floor(secs) + 's';
  if (secs < 3600) return Math.floor(secs / 60) + 'm ' + Math.floor(secs % 60) + 's';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h + 'h ' + m + 'm';
}

function formatTime(unix) {
  if (!unix) return '—';
  const d = new Date(unix * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Age identity management (sessionStorage)
// Wrapped in try/catch: some browsers block storage on http://
function getAgeIdentity() {
  try { return sessionStorage.getItem('age_identity'); } catch(_) { return null; }
}

function setAgeIdentity(identity) {
  try { sessionStorage.setItem('age_identity', identity); } catch(_) { /* insecure context */ }
}

function showIdentityModal(onSubmit) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const box = document.createElement('div');
  box.className = 'modal-box';

  const label = document.createElement('div');
  label.className = 'label';
  label.style.marginBottom = '1rem';
  label.textContent = 'DECRYPTION_KEY_REQUIRED';

  const desc = document.createElement('p');
  desc.style.cssText = 'color:var(--on-surface-variant);font-size:0.85rem;margin-bottom:1rem';
  desc.textContent = 'Paste your age identity to decrypt this recording. The key is stored in your browser tab only and never persisted.';

  const textarea = document.createElement('textarea');
  textarea.id = 'age-input';
  textarea.rows = 3;
  textarea.placeholder = 'AGE-SECRET-KEY-1...';
  textarea.style.cssText = 'width:100%;background:var(--surface);color:var(--primary);border:1px solid var(--outline-variant);padding:0.5rem;font-family:Share Tech Mono,monospace;font-size:0.8rem;resize:vertical';

  const btns = document.createElement('div');
  btns.style.cssText = 'margin-top:1rem;display:flex;gap:1rem';

  const submitBtn = document.createElement('button');
  submitBtn.className = 'btn-primary';
  submitBtn.textContent = 'DECRYPT';
  submitBtn.onclick = () => {
    const val = textarea.value.trim();
    if (val) {
      setAgeIdentity(val);
      overlay.remove();
      onSubmit(val);
    }
  };

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-outline';
  cancelBtn.textContent = 'CANCEL';
  cancelBtn.onclick = () => overlay.remove();

  btns.appendChild(submitBtn);
  btns.appendChild(cancelBtn);
  box.appendChild(label);
  box.appendChild(desc);
  box.appendChild(textarea);
  box.appendChild(btns);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// Boot
document.addEventListener('DOMContentLoaded', () => navigate());
