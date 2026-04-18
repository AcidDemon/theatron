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

// --- Notifications dropdown ---
let notifOpen = false;

async function toggleNotifications() {
  notifOpen = !notifOpen;
  const dd = document.getElementById('notif-dropdown');
  if (!dd) return;
  dd.style.display = notifOpen ? 'block' : 'none';
  if (notifOpen) {
    try {
      const data = await apiGet('/sessions?per_page=10&sort=started&order=desc');
      const list = document.getElementById('notif-list');
      if (!list) return;
      list.textContent = '';
      if (data.sessions.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'text-xs text-on-surface-variant p-2';
        empty.textContent = 'NO_RECENT_EVENTS';
        list.appendChild(empty);
        return;
      }
      for (const s of data.sessions) {
        const item = document.createElement('a');
        item.href = '#/viewer/' + s.session_id;
        item.className = 'flex items-center gap-3 p-2 hover:bg-surface-high cursor-pointer';
        item.style.borderBottom = '1px solid var(--outline-variant)';
        item.onclick = () => { notifOpen = false; dd.style.display = 'none'; };

        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined text-sm';
        icon.style.color = 'var(--primary)';
        icon.textContent = 'terminal';

        const info = document.createElement('div');
        info.style.flex = '1';
        const line1 = document.createElement('div');
        line1.className = 'mono text-xs';
        line1.textContent = s.user + '@' + s.host;
        const line2 = document.createElement('div');
        line2.className = 'text-xs';
        line2.style.color = 'var(--on-surface-variant)';
        line2.textContent = formatTime(s.started) + ' · ' + formatDuration(s.duration);

        info.appendChild(line1);
        info.appendChild(line2);
        item.appendChild(icon);
        item.appendChild(info);
        list.appendChild(item);
      }
    } catch (e) {
      console.error('notifications:', e);
    }
  }
}

// Close notifications when clicking elsewhere
document.addEventListener('click', (e) => {
  if (notifOpen && !e.target.closest('#notif-dropdown') && e.target.textContent !== 'notifications') {
    notifOpen = false;
    const dd = document.getElementById('notif-dropdown');
    if (dd) dd.style.display = 'none';
  }
});

// --- Docs overlay ---
let docsOpen = false;

function toggleDocs() {
  docsOpen = !docsOpen;
  let overlay = document.getElementById('docs-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'docs-overlay';
    overlay.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal-box';
    box.style.maxWidth = '600px';

    const title = document.createElement('div');
    title.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem';
    const h = document.createElement('span');
    h.className = 'text-lg font-semibold';
    h.style.fontFamily = 'Space Grotesk';
    h.textContent = 'DOCUMENTATION';
    const closeBtn = document.createElement('span');
    closeBtn.className = 'material-symbols-outlined cursor-pointer hover:text-primary';
    closeBtn.textContent = 'close';
    closeBtn.onclick = () => { docsOpen = false; overlay.style.display = 'none'; };
    title.appendChild(h);
    title.appendChild(closeBtn);

    const content = document.createElement('div');
    content.className = 'mono text-sm';
    content.style.color = 'var(--on-surface-variant)';

    const sections = [
      ['KEYBOARD_SHORTCUTS', 'Enter in search bar → jump to session browser with query\nSpace → play/pause in viewer\n← / → → seek in viewer'],
      ['SESSION_BROWSER', 'Search by user, host, or session ID.\nClick column headers to sort.\nUse timeframe dropdown to filter.'],
      ['SESSION_VIEWER', 'Paste your age decryption key when prompted.\nUse speed dropdown (0.5x–4x) to control playback.\nSeek slider jumps to any point in the session.'],
      ['SETTINGS', 'Click the gear icon to open settings.\nToggle dark/light mode.\nManage your decryption key.\nSet default playback speed.'],
      ['ARCHITECTURE', 'theatron reads session recordings from the\nepitropos-collector storage directory.\nNo data is modified. Read-only access.'],
    ];

    sections.forEach(([heading, body]) => {
      const sec = document.createElement('div');
      sec.style.marginBottom = '1rem';
      const lbl = document.createElement('div');
      lbl.className = 'label mb-1';
      lbl.style.color = 'var(--primary)';
      lbl.textContent = heading;
      const txt = document.createElement('pre');
      txt.style.cssText = 'white-space:pre-wrap;font-size:0.8rem;line-height:1.5';
      txt.textContent = body;
      sec.appendChild(lbl);
      sec.appendChild(txt);
      content.appendChild(sec);
    });

    box.appendChild(title);
    box.appendChild(content);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }
  overlay.style.display = docsOpen ? 'flex' : 'none';
}

// Boot
document.addEventListener('DOMContentLoaded', () => navigate());
