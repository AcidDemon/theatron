// Dashboard screen

let dashboardLoaded = false;

async function initDashboard() {
  const container = document.getElementById('screen-dashboard');
  if (!container) return;

  // Build the DOM structure once
  if (!dashboardLoaded) {
    dashboardLoaded = true;
    buildDashboardDOM(container);
  }

  // Fetch and populate
  try {
    const stats = await apiGet('/stats');
    document.getElementById('stat-total').textContent = stats.total_sessions.toLocaleString();
    document.getElementById('stat-storage').textContent = formatBytes(stats.total_bytes);
    document.getElementById('stat-active').textContent = stats.sessions_24h;
    document.getElementById('stat-avg').textContent = formatDuration(stats.avg_duration_secs);
    document.getElementById('stat-users').textContent = stats.unique_users;
  } catch (e) {
    console.error('dashboard stats:', e);
  }

  // Activity chart
  try {
    const activity = await apiGet('/activity');
    renderActivityChart(activity.buckets);
  } catch (e) {
    console.error('dashboard activity:', e);
  }

  // Recent sessions
  try {
    const data = await apiGet('/sessions?per_page=5&sort=started&order=desc');
    const tbody = document.getElementById('recent-tbody');
    tbody.textContent = '';
    for (const s of data.sessions) {
      const tr = document.createElement('tr');

      const tdId = document.createElement('td');
      tdId.className = 'mono';
      const link = document.createElement('a');
      link.href = '#/viewer/' + s.session_id;
      link.textContent = s.session_id.slice(0, 16) + '...';
      link.className = 'text-primary hover:underline';
      tdId.appendChild(link);

      const tdStatus = document.createElement('td');
      const dot = document.createElement('span');
      dot.textContent = (s.end_reason === 'eof' || s.end_reason === 'rotated') ? '● CLOSED' : '● ACTIVE';
      dot.className = (s.end_reason === 'eof' || s.end_reason === 'rotated') ? 'dot-closed' : 'dot-active';
      tdStatus.appendChild(dot);

      const tdDur = document.createElement('td');
      tdDur.className = 'mono';
      tdDur.textContent = formatDuration(s.duration);

      const tdSize = document.createElement('td');
      tdSize.className = 'mono';
      tdSize.textContent = formatBytes(s.total_bytes);

      const tdAction = document.createElement('td');
      const viewBtn = document.createElement('a');
      viewBtn.href = '#/viewer/' + s.session_id;
      viewBtn.className = 'material-symbols-outlined text-on-surface-variant hover:text-primary cursor-pointer';
      viewBtn.textContent = 'visibility';
      tdAction.appendChild(viewBtn);

      tr.appendChild(tdId);
      tr.appendChild(tdStatus);
      tr.appendChild(tdDur);
      tr.appendChild(tdSize);
      tr.appendChild(tdAction);
      tbody.appendChild(tr);
    }
  } catch (e) {
    console.error('dashboard recent:', e);
  }
}

function buildDashboardDOM(container) {
  // Title
  const title = document.createElement('h1');
  title.className = 'text-2xl font-semibold mb-1';
  title.style.fontFamily = 'Space Grotesk';
  title.textContent = 'DASHBOARD_OVERVIEW';

  const subtitle = document.createElement('div');
  subtitle.className = 'label mb-6';
  subtitle.textContent = 'LAST_SYNC: ' + formatTime(Date.now() / 1000);

  // Stats row
  const statsRow = document.createElement('div');
  statsRow.className = 'grid grid-cols-4 gap-4 mb-6';
  statsRow.appendChild(makeStatCard('TOTAL_SESSIONS', 'stat-total', '—'));
  statsRow.appendChild(makeStatCard('STORAGE_USAGE', 'stat-storage', '—'));
  statsRow.appendChild(makeStatCard('SESSIONS_24H', 'stat-active', '—'));
  statsRow.appendChild(makeStatCard('AVG_SESSION_LENGTH', 'stat-avg', '—'));

  // Users stat (hidden in card)
  const usersHidden = document.createElement('span');
  usersHidden.id = 'stat-users';
  usersHidden.style.display = 'none';

  // Recent sessions table
  const recentTitle = document.createElement('div');
  recentTitle.className = 'label mb-3 mt-6';
  recentTitle.textContent = 'RECENT_ACTIVE_SESSIONS';

  const table = document.createElement('table');
  table.className = 'data-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  ['SESSION_ID', 'STATUS', 'DURATION', 'DATA_VOL', 'ACTIONS'].forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  const tbody = document.createElement('tbody');
  tbody.id = 'recent-tbody';

  table.appendChild(thead);
  table.appendChild(tbody);

  // Activity chart
  const chartTitle = document.createElement('div');
  chartTitle.className = 'label mb-2 mt-6';
  chartTitle.textContent = 'NETWORK_ACTIVITY_METRIC';

  const chartSubtitle = document.createElement('div');
  chartSubtitle.className = 'text-xs text-on-surface-variant mb-3';
  chartSubtitle.textContent = 'REAL_TIME_NODE_TRAFFIC_LOGGING';

  const chartContainer = document.createElement('div');
  chartContainer.id = 'activity-chart';
  chartContainer.className = 'card p-4 mb-6';
  chartContainer.style.minHeight = '180px';

  container.appendChild(title);
  container.appendChild(subtitle);
  container.appendChild(statsRow);
  container.appendChild(usersHidden);
  container.appendChild(chartTitle);
  container.appendChild(chartSubtitle);
  container.appendChild(chartContainer);
  container.appendChild(recentTitle);
  container.appendChild(table);
}

function renderActivityChart(buckets) {
  const container = document.getElementById('activity-chart');
  if (!container) return;
  container.textContent = '';

  if (!buckets || buckets.length === 0) {
    container.textContent = 'NO_DATA';
    return;
  }

  const maxCount = Math.max(...buckets.map(b => b.count), 1);
  const chartHeight = 140;

  // Compute nice Y-axis tick values that adapt to the data range.
  const ticks = computeYTicks(maxCount);

  // Outer layout: Y-axis labels on the left, chart bars on the right.
  const outer = document.createElement('div');
  outer.style.cssText = 'display:flex;gap:0';

  // Y-axis column
  const yAxis = document.createElement('div');
  yAxis.style.cssText = `display:flex;flex-direction:column;justify-content:space-between;height:${chartHeight}px;padding-right:8px;min-width:30px;align-items:flex-end`;

  // Render ticks top (max) to bottom (0).
  for (let i = ticks.length - 1; i >= 0; i--) {
    const tick = document.createElement('div');
    tick.className = 'mono';
    tick.style.cssText = 'font-size:0.6rem;color:var(--on-surface-variant);line-height:1';
    tick.textContent = ticks[i];
    yAxis.appendChild(tick);
  }

  // Chart area with gridlines + bars
  const chartArea = document.createElement('div');
  chartArea.style.cssText = `flex:1;position:relative;height:${chartHeight}px`;

  // Horizontal gridlines at each tick position
  for (let i = 0; i < ticks.length; i++) {
    const line = document.createElement('div');
    const yPct = (ticks[i] / (ticks[ticks.length - 1] || 1)) * 100;
    line.style.cssText = `position:absolute;left:0;right:0;bottom:${yPct}%;height:1px;background:var(--outline-variant);opacity:0.4`;
    chartArea.appendChild(line);
  }

  // Bar container (flex row inside the chart area)
  const barRow = document.createElement('div');
  barRow.style.cssText = `display:flex;align-items:flex-end;gap:3px;height:100%;position:relative;z-index:1`;

  const yMax = ticks[ticks.length - 1] || 1;

  for (const bucket of buckets) {
    const col = document.createElement('div');
    col.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;height:100%';

    const barWrap = document.createElement('div');
    barWrap.style.cssText = 'flex:1;display:flex;align-items:flex-end;width:100%';
    const bar = document.createElement('div');
    const heightPct = yMax > 0 ? (bucket.count / yMax) * 100 : 0;
    bar.style.cssText = `width:100%;background:var(--primary);border-radius:2px 2px 0 0;min-height:${bucket.count > 0 ? 2 : 1}px;height:${heightPct}%;opacity:${bucket.count > 0 ? 0.8 : 0.15}`;
    bar.title = bucket.count + ' session(s)';
    barWrap.appendChild(bar);

    col.appendChild(barWrap);
    barRow.appendChild(col);
  }

  chartArea.appendChild(barRow);

  outer.appendChild(yAxis);
  outer.appendChild(chartArea);
  container.appendChild(outer);

  // X-axis labels row below the chart
  const xRow = document.createElement('div');
  xRow.style.cssText = 'display:flex;gap:3px;margin-left:38px'; // offset to match bars

  for (const bucket of buckets) {
    const label = document.createElement('div');
    const d = new Date(bucket.hour * 1000);
    label.className = 'mono';
    label.style.cssText = 'flex:1;text-align:center;font-size:0.55rem;color:var(--on-surface-variant);margin-top:4px';
    label.textContent = String(d.getHours()).padStart(2, '0') + ':00';
    xRow.appendChild(label);
  }
  container.appendChild(xRow);
}

/// Compute nice Y-axis tick values (always includes 0 and a rounded max).
function computeYTicks(maxVal) {
  if (maxVal <= 0) return [0];
  if (maxVal <= 5) {
    // Small range: tick every 1
    const t = [];
    for (let i = 0; i <= maxVal; i++) t.push(i);
    return t;
  }
  // Find a nice step: 1, 2, 5, 10, 20, 50, ...
  const raw = maxVal / 4; // aim for ~4-5 ticks
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  let step;
  if (raw / mag < 1.5) step = mag;
  else if (raw / mag < 3.5) step = 2 * mag;
  else if (raw / mag < 7.5) step = 5 * mag;
  else step = 10 * mag;

  const ticks = [];
  for (let v = 0; v <= maxVal + step * 0.1; v += step) {
    ticks.push(Math.round(v));
  }
  // Ensure the last tick covers maxVal
  if (ticks[ticks.length - 1] < maxVal) {
    ticks.push(ticks[ticks.length - 1] + Math.round(step));
  }
  return ticks;
}

function makeStatCard(label, valueId, initial) {
  const card = document.createElement('div');
  card.className = 'stat-card';

  const lbl = document.createElement('div');
  lbl.className = 'label mb-2';
  lbl.textContent = label;

  const val = document.createElement('div');
  val.className = 'stat-value glow';
  val.id = valueId;
  val.textContent = initial;

  card.appendChild(lbl);
  card.appendChild(val);
  return card;
}
