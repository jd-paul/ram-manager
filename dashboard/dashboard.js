// Dashboard page logic — v2 with charts
// Imports shared modules and renders stats, charts, consumers, and activity.

import { initTheme } from '../js/theme.js';
import { localGet, localSet } from '../js/storage.js';
import { getAllTabs, getSuspendedTabs } from '../js/tabs.js';
import { getMemoryInfo, formatBytes, getSavedMemoryToday } from '../js/memory.js';

/* -------------------------------------------------------------------------- */
/* DOM References                                                             */
/* -------------------------------------------------------------------------- */

const els = {
  savedToday: document.getElementById('stat-saved-today'),
  savedAllTime: document.getElementById('stat-saved-alltime'),
  suspended: document.getElementById('stat-suspended'),
  totalTabs: document.getElementById('stat-total-tabs'),
  memory: document.getElementById('stat-memory'),
  memoryUnit: document.getElementById('stat-memory-unit'),
  memoryBadge: document.getElementById('memory-badge'),
  donutFill: document.getElementById('donut-fill'),
  sparklineArea: document.getElementById('sparkline-area'),
  sparklineLine: document.getElementById('sparkline-line'),
  sparklineMin: document.getElementById('sparkline-min'),
  sparklineMax: document.getElementById('sparkline-max'),
  consumerList: document.getElementById('consumer-list'),
  timelineList: document.getElementById('timeline-list'),
  activityList: document.getElementById('activity-list'),
  linkSettings: document.getElementById('link-settings')
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function openPage(page) {
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url: chrome.runtime.getURL(page) });
  }
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

/* -------------------------------------------------------------------------- */
/* Chart Helpers — Pure SVG, no libraries                                     */
/* -------------------------------------------------------------------------- */

/**
 * Update the donut chart ring.
 * @param {number} percent — 0 to 100
 */
function updateDonut(percent) {
  const circle = els.donutFill;
  if (!circle) return;
  const circumference = 314.159; // 2 * PI * 50
  const offset = circumference - (Math.min(100, Math.max(0, percent)) / 100) * circumference;
  circle.style.strokeDashoffset = offset;
}

/**
 * Build SVG path data for a sparkline.
 * @param {number[]} data — array of values
 * @param {number} width
 * @param {number} height
 * @param {number} padding
 * @returns {{lineD: string, areaD: string, min: number, max: number}}
 */
function buildSparklinePaths(data, width = 400, height = 120, padding = 4) {
  if (!data || data.length < 2) {
    return { lineD: '', areaD: '', min: 0, max: 0 };
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const chartH = height - padding * 2;

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - padding - ((val - min) / range) * chartH;
    return [x, y];
  });

  const lineD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const areaD = `${lineD} L ${width} ${height} L 0 ${height} Z`;

  return { lineD, areaD, min, max };
}

/**
 * Update the sparkline chart.
 * @param {number[]} history — array of memory values in bytes
 */
function updateSparkline(history) {
  if (!history || history.length < 2) {
    if (els.sparklineLine) els.sparklineLine.setAttribute('d', '');
    if (els.sparklineArea) els.sparklineArea.setAttribute('d', '');
    if (els.sparklineMin) els.sparklineMin.textContent = '—';
    if (els.sparklineMax) els.sparklineMax.textContent = '—';
    return;
  }

  const { lineD, areaD, min, max } = buildSparklinePaths(history);

  if (els.sparklineLine) els.sparklineLine.setAttribute('d', lineD);
  if (els.sparklineArea) els.sparklineArea.setAttribute('d', areaD);
  if (els.sparklineMin) els.sparklineMin.textContent = formatBytes(min);
  if (els.sparklineMax) els.sparklineMax.textContent = formatBytes(max);
}

/* -------------------------------------------------------------------------- */
/* Data Loaders                                                               */
/* -------------------------------------------------------------------------- */

async function loadSummary() {
  try {
    const [allTabs, suspendedTabs, savedToday] = await Promise.all([
      getAllTabs(),
      getSuspendedTabs(),
      getSavedMemoryToday()
    ]);

    const totalCount = allTabs.length;
    const suspendedCount = suspendedTabs.length;

    const savedAllTime = (await localGet('savedMemoryAllTime')) || 0;

    if (els.savedToday) els.savedToday.textContent = formatBytes(savedToday);
    if (els.savedAllTime) els.savedAllTime.textContent = formatBytes(savedAllTime);
    if (els.suspended) els.suspended.textContent = String(suspendedCount);
    if (els.totalTabs) els.totalTabs.textContent = String(totalCount);
  } catch (err) {
    console.error('Dashboard: failed to load summary:', err);
  }
}

async function loadMemoryInfo() {
  try {
    const info = await getMemoryInfo();

    // Update donut chart (assume 8GB total system RAM for percentage)
    const assumedTotalRam = 8 * 1024 * 1024 * 1024;
    const percent = Math.min(100, (info.totalRam / assumedTotalRam) * 100);
    updateDonut(percent);

    // Update memory text
    if (els.memory) {
      const formatted = formatBytes(info.totalRam);
      const parts = formatted.split(' ');
      els.memory.textContent = parts[0];
      if (els.memoryUnit) els.memoryUnit.textContent = parts[1] || '';
    }
    if (els.memoryBadge) {
      els.memoryBadge.hidden = !info.estimated;
    }

    // Update sparkline
    const history = await getMemoryHistory();
    history.push(info.totalRam);
    if (history.length > 20) history.shift();
    await setMemoryHistory(history);
    updateSparkline(history);

    return info;
  } catch (err) {
    console.error('Dashboard: failed to load memory info:', err);
    if (els.memory) els.memory.textContent = '—';
    updateDonut(0);
    return { totalRam: 0, tabs: [], estimated: true };
  }
}

async function loadTopConsumers() {
  const info = await getMemoryInfo();
  const list = els.consumerList;
  if (!list) return;

  const sorted = info.tabs
    .slice()
    .sort((a, b) => b.memory - a.memory)
    .slice(0, 5);

  list.innerHTML = '';

  if (sorted.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'consumer-empty';
    empty.textContent = 'No tab memory data available.';
    list.appendChild(empty);
    return;
  }

  const maxMemory = sorted[0].memory || 1;

  for (const tab of sorted) {
    const li = document.createElement('li');
    li.className = 'consumer-item';

    const row = document.createElement('div');
    row.className = 'consumer-row';

    const domain = document.createElement('span');
    domain.className = 'consumer-domain';
    domain.textContent = tab.domain || 'unknown';
    domain.title = tab.domain || 'unknown';

    const memory = document.createElement('span');
    memory.className = 'consumer-memory';
    memory.textContent = formatBytes(tab.memory);

    row.appendChild(domain);
    row.appendChild(memory);

    const barWrap = document.createElement('div');
    barWrap.className = 'consumer-bar-wrap';

    const bar = document.createElement('div');
    bar.className = 'consumer-bar';
    bar.style.width = `${Math.max(2, (tab.memory / maxMemory) * 100)}%`;

    barWrap.appendChild(bar);
    li.appendChild(row);
    li.appendChild(barWrap);
    list.appendChild(li);
  }
}

async function loadTimeline() {
  const list = els.timelineList;
  if (!list) return;

  try {
    const history = (await localGet('suspensionHistory')) || [];
    const recent = history.slice(-8).reverse();

    list.innerHTML = '';

    if (recent.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'timeline-empty';
      empty.textContent = 'No recent activity.';
      list.appendChild(empty);
      return;
    }

    for (const entry of recent) {
      const li = document.createElement('li');
      const actionClass = entry.action === 'suspend' ? 'suspend' : entry.action === 'restore' ? 'restore' : '';
      li.className = `timeline-item ${actionClass}`;

      const text = document.createElement('div');
      text.className = 'timeline-text';
      const action = entry.action === 'suspend' ? 'Suspended' : entry.action === 'restore' ? 'Restored' : entry.action || 'Action';
      const domain = entry.domain || entry.url || 'unknown';
      text.textContent = `${action} — ${domain}`;

      const time = document.createElement('div');
      time.className = 'timeline-time';
      time.textContent = formatTimeAgo(entry.timestamp);

      li.appendChild(text);
      li.appendChild(time);
      list.appendChild(li);
    }
  } catch (err) {
    console.error('Dashboard: failed to load timeline:', err);
    list.innerHTML = '';
    const empty = document.createElement('li');
    empty.className = 'timeline-empty';
    empty.textContent = 'Unable to load timeline.';
    list.appendChild(empty);
  }
}

async function loadRecentActivity() {
  const list = els.activityList;
  if (!list) return;

  try {
    const history = (await localGet('suspensionHistory')) || [];
    const recent = history.slice(-10).reverse();

    list.innerHTML = '';

    if (recent.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'activity-empty';
      empty.textContent = 'No recent activity.';
      list.appendChild(empty);
      return;
    }

    for (const entry of recent) {
      const li = document.createElement('li');
      li.className = 'activity-item';

      const text = document.createElement('span');
      text.className = 'activity-text';
      const action = entry.action === 'suspend' ? 'Suspended' : entry.action === 'restore' ? 'Restored' : entry.action || 'Action';
      const domain = entry.domain || entry.url || 'unknown';
      text.textContent = `${action} — ${domain}`;

      const time = document.createElement('span');
      time.className = 'activity-time';
      time.textContent = formatTimeAgo(entry.timestamp);

      li.appendChild(text);
      li.appendChild(time);
      list.appendChild(li);
    }
  } catch (err) {
    console.error('Dashboard: failed to load activity:', err);
    list.innerHTML = '';
    const empty = document.createElement('li');
    empty.className = 'activity-empty';
    empty.textContent = 'Unable to load activity.';
    list.appendChild(empty);
  }
}

/* -------------------------------------------------------------------------- */
/* Memory History Storage                                                     */
/* -------------------------------------------------------------------------- */

const MEMORY_HISTORY_KEY = 'memoryHistory';

async function getMemoryHistory() {
  try {
    const stored = await localGet(MEMORY_HISTORY_KEY);
    return Array.isArray(stored) ? stored : [];
  } catch (err) {
    console.error('Dashboard: failed to read memory history:', err);
    return [];
  }
}

async function setMemoryHistory(history) {
  try {
    await localSet(MEMORY_HISTORY_KEY, history);
  } catch (err) {
    console.error('Dashboard: failed to save memory history:', err);
  }
}

/* -------------------------------------------------------------------------- */
/* Refresh                                                                    */
/* -------------------------------------------------------------------------- */

async function refreshAll() {
  await Promise.all([
    loadSummary(),
    loadMemoryInfo(),
    loadTopConsumers(),
    loadTimeline(),
    loadRecentActivity()
  ]);
}

/* -------------------------------------------------------------------------- */
/* Init                                                                       */
/* -------------------------------------------------------------------------- */

async function init() {
  await initTheme();
  await refreshAll();

  if (els.linkSettings) {
    els.linkSettings.addEventListener('click', (e) => {
      e.preventDefault();
      openPage('settings/settings.html');
    });
  }

  setInterval(refreshAll, 30000);
}

init().catch((err) => {
  console.error('Dashboard: init failed:', err);
});
