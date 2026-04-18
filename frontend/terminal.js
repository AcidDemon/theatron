// Session Viewer — xterm.js playback engine

let viewerLoaded = false;
let viewerTerm = null;
let viewerFit = null;
let viewerEvents = [];
let viewerPlaying = false;
let viewerSpeed = (function() { try { return parseFloat(localStorage.getItem('theatron_default_speed') || '1'); } catch(_) { return 1.0; } })();
let viewerIndex = 0;
let viewerTimeout = null;
let viewerSessionId = null;
let viewerMeta = null;

async function initViewer(sessionId) {
  const container = document.getElementById('screen-viewer');
  if (!container) return;

  if (!viewerLoaded) {
    viewerLoaded = true;
    buildViewerDOM(container);
  }

  if (!sessionId) {
    document.getElementById('viewer-title').textContent = 'NO_SESSION_SELECTED';
    return;
  }

  viewerSessionId = sessionId;
  document.getElementById('viewer-title').textContent = 'SESSION::' + sessionId.slice(0, 20).toUpperCase();

  // Load session metadata
  try {
    viewerMeta = await apiGet('/sessions/' + sessionId);
    renderViewerProperties(viewerMeta);
  } catch (e) {
    console.error('viewer meta:', e);
  }

  // Request decryption key if needed
  const identity = getAgeIdentity();
  if (identity) {
    await startPlayback(sessionId, 0, identity);
  } else {
    showIdentityModal(async (id) => {
      await startPlayback(sessionId, 0, id);
    });
  }
}

async function startPlayback(sessionId, part, identity) {
  stopPlayback();
  viewerEvents = [];
  viewerIndex = 0;
  document.getElementById('viewer-event-log').textContent = '';

  if (viewerTerm) {
    viewerTerm.clear();
    viewerTerm.reset();
  }

  const resp = await apiPost('/stream/' + sessionId + '/parts/' + part, {
    age_identity: identity,
  });

  if (resp.status === 403) {
    document.getElementById('viewer-status').textContent = 'DECRYPTION_FAILED';
    sessionStorage.removeItem('age_identity');
    return;
  }
  if (!resp.ok) {
    document.getElementById('viewer-status').textContent = 'ERROR_' + resp.status;
    return;
  }

  const text = await resp.text();
  const lines = text.trim().split('\n').filter(l => l);

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.kind === 'header') {
        if (obj.cols && obj.rows && viewerTerm) {
          viewerTerm.resize(obj.cols, obj.rows);
        }
        addEventLog('HEADER', 0, 'session_start cols=' + obj.cols + ' rows=' + obj.rows);
      } else if (obj.kind === 'out') {
        const bytes = atob(obj.b);
        viewerEvents.push({ t: obj.t, data: bytes });
      } else if (obj.kind === 'resize') {
        viewerEvents.push({ t: obj.t, resize: true, cols: obj.cols, rows: obj.rows });
        addEventLog('TERM_RESIZE', obj.t, obj.cols + 'x' + obj.rows);
      } else if (obj.kind === 'chunk') {
        addEventLog('CHUNK', obj.t || 0, 'seq=' + obj.seq + ' bytes=' + obj.bytes);
      } else if (obj.kind === 'end') {
        addEventLog('END', obj.t, 'reason=' + obj.reason);
        // Check if rotated — auto-advance
        if (obj.reason === 'rotated') {
          // Queue loading next part after current playback
          viewerEvents.push({ t: obj.t, nextPart: part + 1 });
        }
      }
    } catch (e) {
      // skip unparseable lines
    }
  }

  document.getElementById('viewer-total-time').textContent = formatDuration(
    viewerEvents.length > 0 ? viewerEvents[viewerEvents.length - 1].t : 0
  );

  // Auto-play
  viewerPlaying = true;
  document.getElementById('viewer-play-btn').textContent = 'pause';
  playNextEvent();
}

function playNextEvent() {
  if (!viewerPlaying || viewerIndex >= viewerEvents.length) {
    viewerPlaying = false;
    document.getElementById('viewer-play-btn').textContent = 'play_arrow';
    document.getElementById('viewer-status').textContent = 'PLAYBACK_COMPLETE';
    return;
  }

  const evt = viewerEvents[viewerIndex];

  if (evt.nextPart !== undefined) {
    // Auto-advance to next part
    const identity = getAgeIdentity();
    if (identity) {
      startPlayback(viewerSessionId, evt.nextPart, identity);
    }
    return;
  }

  if (evt.resize) {
    if (viewerTerm) viewerTerm.resize(evt.cols, evt.rows);
    viewerIndex++;
    playNextEvent();
    return;
  }

  if (evt.data && viewerTerm) {
    viewerTerm.write(evt.data);
  }

  viewerIndex++;
  updateProgress();

  if (viewerIndex < viewerEvents.length) {
    const nextEvt = viewerEvents[viewerIndex];
    const delay = ((nextEvt.t - evt.t) / viewerSpeed) * 1000;
    const maxDelay = (function() { try { return parseInt(localStorage.getItem('theatron_max_delay') || '5000', 10); } catch(_) { return 5000; } })();
    const clampedDelay = Math.min(Math.max(delay, 0), maxDelay);
    viewerTimeout = setTimeout(playNextEvent, clampedDelay);
  } else {
    viewerPlaying = false;
    document.getElementById('viewer-play-btn').textContent = 'play_arrow';
    document.getElementById('viewer-status').textContent = 'PLAYBACK_COMPLETE';
  }
}

function stopPlayback() {
  viewerPlaying = false;
  if (viewerTimeout) {
    clearTimeout(viewerTimeout);
    viewerTimeout = null;
  }
}

function togglePlayPause() {
  if (viewerPlaying) {
    stopPlayback();
    document.getElementById('viewer-play-btn').textContent = 'play_arrow';
  } else if (viewerEvents.length > 0) {
    if (viewerIndex >= viewerEvents.length) viewerIndex = 0;
    viewerPlaying = true;
    document.getElementById('viewer-play-btn').textContent = 'pause';
    playNextEvent();
  }
}

function seekTo(fraction) {
  stopPlayback();
  if (viewerEvents.length === 0) return;
  const maxT = viewerEvents[viewerEvents.length - 1].t;
  const targetT = maxT * fraction;

  // Replay from start to the target time (instant)
  if (viewerTerm) {
    viewerTerm.clear();
    viewerTerm.reset();
  }
  for (let i = 0; i < viewerEvents.length; i++) {
    if (viewerEvents[i].t > targetT) {
      viewerIndex = i;
      break;
    }
    const evt = viewerEvents[i];
    if (evt.resize && viewerTerm) viewerTerm.resize(evt.cols, evt.rows);
    if (evt.data && viewerTerm) viewerTerm.write(evt.data);
    viewerIndex = i + 1;
  }
  updateProgress();
}

function updateProgress() {
  if (viewerEvents.length === 0) return;
  const currentT = viewerIndex < viewerEvents.length ? viewerEvents[viewerIndex].t : viewerEvents[viewerEvents.length - 1].t;
  document.getElementById('viewer-current-time').textContent = formatDuration(currentT);

  const maxT = viewerEvents[viewerEvents.length - 1].t;
  const slider = document.getElementById('viewer-seek');
  if (slider && maxT > 0) slider.value = (currentT / maxT) * 1000;
}

function addEventLog(kind, t, detail) {
  const log = document.getElementById('viewer-event-log');
  if (!log) return;
  const line = document.createElement('div');
  line.className = 'text-xs mono py-0.5';
  const timeSpan = document.createElement('span');
  timeSpan.className = 'text-on-surface-variant';
  timeSpan.textContent = formatDuration(t);
  const kindSpan = document.createElement('span');
  kindSpan.className = 'text-primary ml-2';
  kindSpan.textContent = kind;
  const detailSpan = document.createElement('span');
  detailSpan.className = 'text-on-surface-variant ml-2';
  detailSpan.textContent = detail;
  line.appendChild(timeSpan);
  line.appendChild(kindSpan);
  line.appendChild(detailSpan);
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function renderViewerProperties(meta) {
  const panel = document.getElementById('viewer-properties');
  if (!panel || !meta) return;
  panel.textContent = '';

  const fields = [
    ['USER', meta.user],
    ['HOST', meta.host],
    ['SENDER', meta.sender],
    ['STARTED', formatTime(meta.started)],
    ['DURATION', formatDuration(meta.duration)],
    ['SIZE', formatBytes(meta.total_bytes)],
    ['PARTS', meta.parts],
    ['END_REASON', meta.end_reason],
    ['SSH_CLIENT', meta.ssh_client || '—'],
  ];

  fields.forEach(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'flex justify-between py-1 border-b border-outline-variant';
    const lbl = document.createElement('span');
    lbl.className = 'label';
    lbl.textContent = label;
    const val = document.createElement('span');
    val.className = 'mono text-sm';
    val.textContent = value;
    row.appendChild(lbl);
    row.appendChild(val);
    panel.appendChild(row);
  });
}

let viewerFullscreen = false;

function toggleViewerFullscreen() {
  viewerFullscreen = !viewerFullscreen;
  const screen = document.getElementById('screen-viewer');
  if (!screen) return;

  if (viewerFullscreen) {
    screen.classList.add('viewer-fullscreen');
  } else {
    screen.classList.remove('viewer-fullscreen');
  }

  // Update button icon
  const btn = screen.querySelector('[title="FULLSCREEN"], [title="EXIT_FULLSCREEN"]');
  if (btn) {
    btn.textContent = viewerFullscreen ? 'fullscreen_exit' : 'fullscreen';
    btn.title = viewerFullscreen ? 'EXIT_FULLSCREEN' : 'FULLSCREEN';
  }

  // Refit terminal after layout change
  setTimeout(() => { if (viewerFit) viewerFit.fit(); }, 100);
}

// Exit fullscreen on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && viewerFullscreen) {
    toggleViewerFullscreen();
  }
});

function buildViewerDOM(container) {
  // Top bar
  const topBar = document.createElement('div');
  topBar.className = 'flex items-center justify-between mb-4 viewer-top-bar';

  const titleDiv = document.createElement('div');
  const title = document.createElement('h2');
  title.id = 'viewer-title';
  title.className = 'text-lg font-semibold';
  title.style.fontFamily = 'Space Grotesk';
  title.textContent = 'NO_SESSION_SELECTED';
  const status = document.createElement('div');
  status.id = 'viewer-status';
  status.className = 'label text-secondary';
  status.textContent = 'READY';
  titleDiv.appendChild(title);
  titleDiv.appendChild(status);
  topBar.appendChild(titleDiv);

  // Main layout: terminal left, properties right
  const layout = document.createElement('div');
  layout.className = 'flex gap-4 viewer-layout';

  // Terminal column (60%)
  const termCol = document.createElement('div');
  termCol.className = 'viewer-term-col';
  termCol.style.flex = '3';

  const termContainer = document.createElement('div');
  termContainer.className = 'terminal-container';
  termContainer.id = 'viewer-terminal';
  termContainer.style.minHeight = '400px';

  // Playback controls
  const controls = document.createElement('div');
  controls.className = 'playback-bar';

  const playBtn = document.createElement('button');
  playBtn.id = 'viewer-play-btn';
  playBtn.className = 'material-symbols-outlined';
  playBtn.textContent = 'play_arrow';
  playBtn.onclick = togglePlayPause;

  const seekSlider = document.createElement('input');
  seekSlider.type = 'range';
  seekSlider.id = 'viewer-seek';
  seekSlider.min = 0;
  seekSlider.max = 1000;
  seekSlider.value = 0;
  seekSlider.oninput = () => seekTo(seekSlider.value / 1000);

  const currentTime = document.createElement('span');
  currentTime.id = 'viewer-current-time';
  currentTime.className = 'mono text-sm';
  currentTime.textContent = '0s';

  const sep = document.createElement('span');
  sep.className = 'text-on-surface-variant';
  sep.textContent = '/';

  const totalTime = document.createElement('span');
  totalTime.id = 'viewer-total-time';
  totalTime.className = 'mono text-sm';
  totalTime.textContent = '0s';

  const speedLabel = document.createElement('span');
  speedLabel.className = 'label';
  speedLabel.textContent = 'SPEED:';

  const speedSelect = document.createElement('select');
  speedSelect.className = 'bg-surface border border-outline-variant text-sm mono px-2 py-1';
  [0.5, 1, 2, 4].forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s + 'x';
    if (s === 1) opt.selected = true;
    speedSelect.appendChild(opt);
  });
  speedSelect.onchange = () => { viewerSpeed = parseFloat(speedSelect.value); };

  const fullscreenBtn = document.createElement('button');
  fullscreenBtn.className = 'material-symbols-outlined';
  fullscreenBtn.textContent = 'fullscreen';
  fullscreenBtn.title = 'FULLSCREEN';
  fullscreenBtn.onclick = () => toggleViewerFullscreen();

  controls.appendChild(playBtn);
  controls.appendChild(seekSlider);
  controls.appendChild(currentTime);
  controls.appendChild(sep);
  controls.appendChild(totalTime);
  controls.appendChild(speedLabel);
  controls.appendChild(speedSelect);
  controls.appendChild(fullscreenBtn);

  termCol.appendChild(termContainer);
  termCol.appendChild(controls);

  // Right panel (40%)
  const rightCol = document.createElement('div');
  rightCol.className = 'viewer-right-col';
  rightCol.style.flex = '2';

  const propsTitle = document.createElement('div');
  propsTitle.className = 'label mb-2';
  propsTitle.textContent = 'SESSION_PROPERTIES';

  const propsPanel = document.createElement('div');
  propsPanel.id = 'viewer-properties';
  propsPanel.className = 'card p-3 mb-4';

  const logTitle = document.createElement('div');
  logTitle.className = 'label mb-2';
  logTitle.textContent = 'RAW_EVENT_LOG';

  const logPanel = document.createElement('div');
  logPanel.id = 'viewer-event-log';
  logPanel.className = 'card p-3';
  logPanel.style.cssText = 'max-height:300px;overflow-y:auto';

  rightCol.appendChild(propsTitle);
  rightCol.appendChild(propsPanel);
  rightCol.appendChild(logTitle);
  rightCol.appendChild(logPanel);

  layout.appendChild(termCol);
  layout.appendChild(rightCol);

  container.appendChild(topBar);
  container.appendChild(layout);

  // Initialize xterm.js
  viewerTerm = new Terminal({
    theme: {
      background: '#0a0a0a',
      foreground: '#e5e2e1',
      cursor: '#00ff41',
      cursorAccent: '#0a0a0a',
      selectionBackground: 'rgba(0, 255, 65, 0.3)',
    },
    fontFamily: 'Share Tech Mono, monospace',
    fontSize: 14,
    cursorBlink: true,
  });
  viewerFit = new FitAddon.FitAddon();
  viewerTerm.loadAddon(viewerFit);
  viewerTerm.open(termContainer);
  viewerFit.fit();

  window.addEventListener('resize', () => {
    if (viewerFit) viewerFit.fit();
  });
}
