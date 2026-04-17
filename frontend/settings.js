// Settings slide-out panel

let settingsOpen = false;
let settingsBuilt = false;

function toggleSettings() {
  const panel = document.getElementById('settings-panel');
  if (!panel) { console.error('settings: no panel'); return; }
  settingsOpen = !settingsOpen;
  panel.style.transform = settingsOpen ? 'translateX(0)' : 'translateX(100%)';
  if (settingsOpen) {
    if (!settingsBuilt) {
      settingsBuilt = true;
      buildSettingsPanel();
    }
    refreshSettingsData().catch(function(e) { console.error('settings refresh:', e); });
  }
}

function buildSettingsPanel() {
  const panel = document.getElementById('settings-content');
  if (!panel) { console.error('settings: no settings-content div'); return; }

  // --- APPEARANCE ---
  const appearanceSection = makeSection('APPEARANCE');

  const themeRow = document.createElement('div');
  themeRow.className = 'flex items-center justify-between py-2';
  const themeLabel = document.createElement('span');
  themeLabel.className = 'text-sm';
  themeLabel.textContent = 'Theme';
  const themeToggle = document.createElement('button');
  themeToggle.id = 'theme-toggle';
  themeToggle.className = 'btn-outline';
  themeToggle.style.cssText = 'padding:0.3rem 0.8rem;font-size:0.7rem';
  themeToggle.textContent = getCurrentTheme() === 'dark' ? 'DARK_MODE' : 'LIGHT_MODE';
  themeToggle.onclick = () => {
    const next = getCurrentTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    themeToggle.textContent = next === 'dark' ? 'DARK_MODE' : 'LIGHT_MODE';
  };
  themeRow.appendChild(themeLabel);
  themeRow.appendChild(themeToggle);
  appearanceSection.appendChild(themeRow);

  // --- CONNECTION ---
  const connSection = makeSection('CONNECTION');
  const connInfo = document.createElement('div');
  connInfo.id = 'settings-conn-info';
  connInfo.className = 'mono text-sm';
  connInfo.textContent = 'LOADING...';
  connSection.appendChild(connInfo);

  // --- DECRYPTION ---
  const decryptSection = makeSection('DECRYPTION');

  const keyStatus = document.createElement('div');
  keyStatus.id = 'settings-key-status';
  keyStatus.className = 'text-sm mb-3';

  const keyBtns = document.createElement('div');
  keyBtns.className = 'flex gap-2';

  const pasteBtn = document.createElement('button');
  pasteBtn.className = 'btn-outline';
  pasteBtn.style.cssText = 'padding:0.3rem 0.8rem;font-size:0.7rem';
  pasteBtn.textContent = 'SET_KEY';
  pasteBtn.onclick = () => {
    showIdentityModal(() => refreshKeyStatus());
  };

  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn-outline';
  clearBtn.style.cssText = 'padding:0.3rem 0.8rem;font-size:0.7rem;border-color:var(--error);color:var(--error)';
  clearBtn.textContent = 'CLEAR_KEY';
  clearBtn.onclick = () => {
    sessionStorage.removeItem('age_identity');
    refreshKeyStatus();
  };

  keyBtns.appendChild(pasteBtn);
  keyBtns.appendChild(clearBtn);
  decryptSection.appendChild(keyStatus);
  decryptSection.appendChild(keyBtns);

  // --- PLAYBACK ---
  const playSection = makeSection('PLAYBACK');

  const speedRow = document.createElement('div');
  speedRow.className = 'flex items-center justify-between py-2';
  const speedLabel = document.createElement('span');
  speedLabel.className = 'text-sm';
  speedLabel.textContent = 'Default speed';
  const speedSelect = document.createElement('select');
  speedSelect.className = 'bg-surface border border-outline-variant text-sm mono px-2 py-1';
  const currentSpeed = storageGet('theatron_default_speed', '1');
  [0.5, 1, 2, 4].forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s + 'x';
    if (String(s) === currentSpeed) opt.selected = true;
    speedSelect.appendChild(opt);
  });
  speedSelect.onchange = () => {
    storageSet('theatron_default_speed', speedSelect.value);
  };
  speedRow.appendChild(speedLabel);
  speedRow.appendChild(speedSelect);

  const delayRow = document.createElement('div');
  delayRow.className = 'flex items-center justify-between py-2';
  const delayLabel = document.createElement('span');
  delayLabel.className = 'text-sm';
  delayLabel.textContent = 'Max delay cap (ms)';
  const delayInput = document.createElement('input');
  delayInput.type = 'number';
  delayInput.min = 100;
  delayInput.max = 30000;
  delayInput.step = 100;
  delayInput.value = storageGet('theatron_max_delay', '5000');
  delayInput.className = 'bg-surface border border-outline-variant text-sm mono px-2 py-1 w-20 text-right';
  delayInput.onchange = () => {
    storageSet('theatron_max_delay', delayInput.value);
  };
  delayRow.appendChild(delayLabel);
  delayRow.appendChild(delayInput);

  playSection.appendChild(speedRow);
  playSection.appendChild(delayRow);

  // Assemble
  panel.appendChild(appearanceSection);
  panel.appendChild(connSection);
  panel.appendChild(decryptSection);
  panel.appendChild(playSection);
}

function makeSection(title) {
  const section = document.createElement('div');
  section.className = 'mb-6';
  const heading = document.createElement('div');
  heading.className = 'label mb-3 pb-2';
  heading.style.borderBottom = '1px solid var(--outline-variant)';
  heading.textContent = title;
  section.appendChild(heading);
  return section;
}

async function refreshSettingsData() {
  refreshKeyStatus();
  try {
    const info = await apiGet('/info');
    const el = document.getElementById('settings-conn-info');
    if (el) {
      el.textContent = '';
      const fields = [
        ['VERSION', info.version],
        ['STORAGE_DIR', info.storage_dir],
        ['STORAGE_MODE', info.storage_mode],
        ['TOTAL_SESSIONS', info.total_sessions],
      ];
      fields.forEach(([k, v]) => {
        const row = document.createElement('div');
        row.className = 'flex justify-between py-1';
        const lbl = document.createElement('span');
        lbl.className = 'label';
        lbl.textContent = k;
        const val = document.createElement('span');
        val.textContent = v;
        row.appendChild(lbl);
        row.appendChild(val);
        el.appendChild(row);
      });
    }
  } catch (e) {
    console.error('settings info:', e);
  }
}

function refreshKeyStatus() {
  const el = document.getElementById('settings-key-status');
  if (!el) return;
  const identity = getAgeIdentity();
  if (identity) {
    const preview = identity.slice(0, 20) + '...';
    el.textContent = 'KEY_LOADED: ' + preview;
    el.style.color = 'var(--primary)';
  } else {
    el.textContent = 'NO_KEY_SET';
    el.style.color = 'var(--on-surface-variant)';
  }
}

// --- Theme management ---

// Safe localStorage wrapper — some browsers block storage on http://
function storageGet(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch (_) { /* insecure context */ }
}

function getCurrentTheme() {
  return storageGet('theatron_theme', 'dark');
}

function setTheme(theme) {
  storageSet('theatron_theme', theme);
  if (theme === 'light') {
    document.documentElement.classList.add('light');
  } else {
    document.documentElement.classList.remove('light');
  }
}

// Apply saved theme on load
(function () {
  const saved = getCurrentTheme();
  if (saved === 'light') {
    document.documentElement.classList.add('light');
  }
})();
