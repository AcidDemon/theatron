// Session Browser screen

let browserLoaded = false;
let browserPage = 1;
let browserPerPage = 25;
let browserSort = 'started';
let browserOrder = 'desc';
let browserDebounce = null;

async function initBrowser() {
  const container = document.getElementById('screen-sessions');
  if (!container) return;

  if (!browserLoaded) {
    browserLoaded = true;
    buildBrowserDOM(container);
  }
  await loadSessions();
}

async function loadSessions() {
  const q = (document.getElementById('browser-search') || {}).value || '';
  const timeframe = (document.getElementById('browser-timeframe') || {}).value || '';

  let params = `?page=${browserPage}&per_page=${browserPerPage}&sort=${browserSort}&order=${browserOrder}`;
  if (q) params += '&q=' + encodeURIComponent(q);
  if (timeframe) {
    const now = Date.now() / 1000;
    const offsets = { '1h': 3600, '24h': 86400, '7d': 604800, '30d': 2592000 };
    if (offsets[timeframe]) params += '&from=' + (now - offsets[timeframe]);
  }

  try {
    const data = await apiGet('/sessions' + params);
    renderSessionTable(data.sessions);
    renderPagination(data.total, data.page, data.per_page);
    document.getElementById('browser-showing').textContent =
      `SHOWING_${data.sessions.length}_OF_${data.total}_SESSIONS`;
  } catch (e) {
    console.error('browser load:', e);
  }
}

function renderSessionTable(sessions) {
  const tbody = document.getElementById('browser-tbody');
  tbody.textContent = '';

  for (const s of sessions) {
    const tr = document.createElement('tr');

    const cells = [
      { text: s.session_id.slice(0, 16), cls: 'mono text-on-surface-variant' },
      { text: s.user, cls: 'mono' },
      { text: s.host, cls: 'mono text-on-surface-variant' },
      { text: formatTime(s.started), cls: 'mono text-on-surface-variant' },
      { text: formatDuration(s.duration), cls: 'mono' },
      { text: formatBytes(s.total_bytes), cls: 'mono text-on-surface-variant' },
    ];

    cells.forEach(c => {
      const td = document.createElement('td');
      td.className = c.cls;
      td.textContent = c.text;
      tr.appendChild(td);
    });

    // Action column
    const tdAction = document.createElement('td');
    const btn = document.createElement('a');
    btn.href = '#/viewer/' + s.session_id;
    btn.className = 'btn-outline';
    btn.style.cssText = 'padding:0.25rem 0.75rem;font-size:0.7rem';
    btn.textContent = 'PLAYBACK_';
    tdAction.appendChild(btn);
    tr.appendChild(tdAction);

    tbody.appendChild(tr);
  }
}

function renderPagination(total, page, perPage) {
  const container = document.getElementById('browser-pagination');
  container.textContent = '';

  const totalPages = Math.ceil(total / perPage) || 1;

  const prevBtn = document.createElement('button');
  prevBtn.className = 'btn-outline';
  prevBtn.style.cssText = 'padding:0.25rem 0.5rem;font-size:0.7rem';
  prevBtn.textContent = '<';
  prevBtn.disabled = page <= 1;
  prevBtn.onclick = () => { browserPage = Math.max(1, page - 1); loadSessions(); };

  container.appendChild(prevBtn);

  for (let i = 1; i <= Math.min(totalPages, 5); i++) {
    const btn = document.createElement('button');
    btn.style.cssText = 'padding:0.25rem 0.5rem;font-size:0.7rem;min-width:2rem';
    btn.className = i === page ? 'btn-primary' : 'btn-outline';
    btn.textContent = i;
    btn.onclick = () => { browserPage = i; loadSessions(); };
    container.appendChild(btn);
  }

  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn-outline';
  nextBtn.style.cssText = 'padding:0.25rem 0.5rem;font-size:0.7rem';
  nextBtn.textContent = '>';
  nextBtn.disabled = page >= totalPages;
  nextBtn.onclick = () => { browserPage = Math.min(totalPages, page + 1); loadSessions(); };

  container.appendChild(nextBtn);
}

function buildBrowserDOM(container) {
  // Search + filters row
  const filterRow = document.createElement('div');
  filterRow.className = 'flex items-center gap-4 mb-4';

  const searchLabel = document.createElement('div');
  searchLabel.className = 'label';
  searchLabel.textContent = 'QUERY_SESSIONS';

  const searchInput = document.createElement('input');
  searchInput.id = 'browser-search';
  searchInput.type = 'text';
  searchInput.placeholder = 'Search by ID, User, or Host...';
  searchInput.className = 'bg-surface border border-outline-variant px-4 py-2 text-sm mono flex-1 focus:border-primary focus:outline-none';
  searchInput.oninput = () => {
    clearTimeout(browserDebounce);
    browserDebounce = setTimeout(() => { browserPage = 1; loadSessions(); }, 300);
  };

  const timeSelect = document.createElement('select');
  timeSelect.id = 'browser-timeframe';
  timeSelect.className = 'bg-surface border border-outline-variant px-3 py-2 text-sm mono focus:border-primary focus:outline-none';
  [['', 'ALL_TIME'], ['1h', 'L_1H'], ['24h', 'L_24_HOURS'], ['7d', 'L_7_DAYS'], ['30d', 'L_30_DAYS']].forEach(([val, text]) => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = text;
    timeSelect.appendChild(opt);
  });
  timeSelect.onchange = () => { browserPage = 1; loadSessions(); };

  filterRow.appendChild(searchLabel);
  filterRow.appendChild(searchInput);
  filterRow.appendChild(timeSelect);

  // Table
  const table = document.createElement('table');
  table.className = 'data-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const headers = ['SESSION_ID', 'USER', 'HOST', 'START_TIME', 'DURATION', 'SIZE', 'ACTIONS'];
  const sortable = { 'SESSION_ID': 'session_id', 'USER': 'user', 'HOST': 'host', 'START_TIME': 'started', 'DURATION': 'duration', 'SIZE': 'total_bytes' };

  headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    th.style.cursor = sortable[h] ? 'pointer' : 'default';
    if (sortable[h]) {
      th.onclick = () => {
        if (browserSort === sortable[h]) {
          browserOrder = browserOrder === 'asc' ? 'desc' : 'asc';
        } else {
          browserSort = sortable[h];
          browserOrder = 'desc';
        }
        loadSessions();
      };
    }
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  const tbody = document.createElement('tbody');
  tbody.id = 'browser-tbody';

  table.appendChild(thead);
  table.appendChild(tbody);

  // Pagination + info
  const footerRow = document.createElement('div');
  footerRow.className = 'flex items-center justify-between mt-4';

  const showing = document.createElement('div');
  showing.id = 'browser-showing';
  showing.className = 'label';
  showing.textContent = 'LOADING...';

  const pagination = document.createElement('div');
  pagination.id = 'browser-pagination';
  pagination.className = 'flex items-center gap-2';

  footerRow.appendChild(showing);
  footerRow.appendChild(pagination);

  container.appendChild(filterRow);
  container.appendChild(table);
  container.appendChild(footerRow);
}
