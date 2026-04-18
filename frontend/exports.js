// Exports screen

let exportsLoaded = false;

async function initExports() {
  const container = document.getElementById('screen-exports');
  if (!container) return;

  if (!exportsLoaded) {
    exportsLoaded = true;
    buildExportsDOM(container);
  }

  // Load recent sessions for export selection
  try {
    const data = await apiGet('/sessions?per_page=50&sort=started&order=desc');
    renderExportTable(data.sessions);
  } catch (e) {
    console.error('exports load:', e);
  }
}

function renderExportTable(sessions) {
  const tbody = document.getElementById('exports-tbody');
  tbody.textContent = '';

  for (const s of sessions) {
    const tr = document.createElement('tr');

    const tdCheck = document.createElement('td');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'export-check';
    cb.dataset.sessionId = s.session_id;
    cb.dataset.parts = s.parts;
    tdCheck.appendChild(cb);

    const tdFile = document.createElement('td');
    tdFile.className = 'mono';
    tdFile.textContent = s.session_id + '.part0.kgv1.age';

    const tdTime = document.createElement('td');
    tdTime.className = 'mono text-on-surface-variant';
    tdTime.textContent = formatTime(s.started);

    const tdSize = document.createElement('td');
    tdSize.className = 'mono';
    tdSize.textContent = formatBytes(s.total_bytes);

    const tdEnc = document.createElement('td');
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = 'X25519';
    tdEnc.appendChild(tag);

    const tdStatus = document.createElement('td');
    tdStatus.className = 'text-secondary mono text-sm';
    tdStatus.textContent = 'READY';

    const tdAction = document.createElement('td');
    const dlBtn = document.createElement('button');
    dlBtn.className = 'btn-outline';
    dlBtn.style.cssText = 'padding:0.25rem 0.75rem;font-size:0.7rem';
    dlBtn.textContent = 'DOWNLOAD_';
    dlBtn.onclick = () => downloadRecording(s.session_id, 0);
    tdAction.appendChild(dlBtn);

    tr.appendChild(tdCheck);
    tr.appendChild(tdFile);
    tr.appendChild(tdTime);
    tr.appendChild(tdSize);
    tr.appendChild(tdEnc);
    tr.appendChild(tdStatus);
    tr.appendChild(tdAction);
    tbody.appendChild(tr);
  }
}

function downloadRecording(sessionId, part) {
  window.open('/api/raw/' + sessionId + '/parts/' + part, '_blank');
}

function downloadSelected() {
  const checked = document.querySelectorAll('.export-check:checked');
  if (checked.length === 0) return;
  // Download each selected recording individually
  checked.forEach(cb => {
    const id = cb.dataset.sessionId;
    const parts = parseInt(cb.dataset.parts) || 1;
    for (let p = 0; p < parts; p++) {
      downloadRecording(id, p);
    }
  });
}

function buildExportsDOM(container) {
  const title = document.createElement('h1');
  title.className = 'text-2xl font-semibold mb-1';
  title.style.fontFamily = 'Space Grotesk';
  title.textContent = 'EXPORT_CENTER';

  const subtitle = document.createElement('div');
  subtitle.className = 'label mb-6';
  subtitle.textContent = 'Vault Management';

  // Batch export row
  const batchRow = document.createElement('div');
  batchRow.className = 'card p-4 mb-6 flex items-center justify-between';

  const batchLabel = document.createElement('div');
  batchLabel.className = 'label';
  batchLabel.textContent = 'BATCH_EXPORT_PROTOCOL';

  const batchBtn = document.createElement('button');
  batchBtn.className = 'btn-primary';
  batchBtn.textContent = 'EXECUTE_BATCH_EXPORT';
  batchBtn.onclick = downloadSelected;

  batchRow.appendChild(batchLabel);
  batchRow.appendChild(batchBtn);

  // Files heading
  const filesTitle = document.createElement('div');
  filesTitle.className = 'label mb-3';
  filesTitle.textContent = 'GENERATED_AGE_FILES';

  // Table
  const table = document.createElement('table');
  table.className = 'data-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  ['', 'FILE_IDENTIFIER', 'TIMESTAMP', 'SIZE', 'ENCRYPTION', 'STATUS', 'ACTION'].forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  const tbody = document.createElement('tbody');
  tbody.id = 'exports-tbody';

  table.appendChild(thead);
  table.appendChild(tbody);

  container.appendChild(title);
  container.appendChild(subtitle);
  container.appendChild(batchRow);
  container.appendChild(filesTitle);
  container.appendChild(table);
}
