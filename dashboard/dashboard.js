// Dashboard page logic — v2 with charts
// Imports shared modules and renders stats, charts, consumers, and activity.

import { ESTIMATED_BYTES_PER_TAB } from '../js/utils.js';
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
  donutFillActive: document.getElementById('donut-fill-active'),
  donutFillSuspended: document.getElementById('donut-fill-suspended'),
  barChartBars: document.getElementById('bar-chart-bars'),
  barChartLabels: document.getElementById('bar-chart-labels'),
  chartWeekLabel: document.getElementById('chart-week-label'),
  consumerList: document.getElementById('consumer-list'),
  timelineList: document.getElementById('timeline-list'),
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
/* Week / Locale Helpers                                                      */
/* -------------------------------------------------------------------------- */

function getWeekStartDay() {
  try {
    const locale = navigator.language || 'en-US';
    const sundayStartLocales = ['en-US', 'en-CA', 'es-MX', 'ja-JP', 'zh-CN'];
    if (sundayStartLocales.some(l => locale.startsWith(l))) return 0;
    return 1;
  } catch {
    return 1;
  }
}

function getDayIndex(date, weekStart) {
  const day = date.getDay();
  let idx = day - weekStart;
  if (idx < 0) idx += 7;
  return idx;
}

function getDayName(index, weekStart) {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const actualDay = (index + weekStart) % 7;
  return names[actualDay];
}

function getWeekRangeLabel(weekStart) {
  const now = new Date();
  const idx = getDayIndex(now, weekStart);
  const start = new Date(now);
  start.setDate(now.getDate() - idx);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  const fmt = (d) => `${d.getDate()} ${d.toLocaleString('default', { month: 'short' })}`;
  return `${fmt(start)} — ${fmt(end)}`;
}

/* -------------------------------------------------------------------------- */
/* Chart Helpers — Pure SVG, no libraries                                     */
/* -------------------------------------------------------------------------- */

function updateDonut(activeBytes, suspendedBytes) {
  const total = activeBytes + suspendedBytes || 1;
  const activePct = Math.min(100, Math.max(0, (activeBytes / total) * 100));
  const suspendedPct = Math.min(100, Math.max(0, (suspendedBytes / total) * 100));

  const circumference = 314.159;

  const activeOffset = circumference - (activePct / 100) * circumference;
  if (els.donutFillActive) {
    els.donutFillActive.style.strokeDasharray = `${circumference} ${circumference}`;
    els.donutFillActive.style.strokeDashoffset = activeOffset;
  }

  const suspendedOffset = circumference - (suspendedPct / 100) * circumference;
  if (els.donutFillSuspended) {
    els.donutFillSuspended.style.strokeDasharray = `${circumference} ${circumference}`;
    els.donutFillSuspended.style.strokeDashoffset = suspendedOffset;
    const activeDeg = (activePct / 100) * 360;
    els.donutFillSuspended.style.transform = `rotate(${activeDeg}deg)`;
    els.donutFillSuspended.style.transformOrigin = '60px 60px';
  }
}

/**
 * Render the weekly bar chart.
 * @param {number[]} values — 7 daily savings values in bytes
 * @param {number} weekStart — 0 = Sunday, 1 = Monday
 */
function updateBarChart(values, weekStart) {
  if (!els.barChartBars || !els.barChartLabels) return;

  const svg = els.barChartBars;
  const labels = els.barChartLabels;
  svg.innerHTML = '';
  labels.innerHTML = '';

  if (!values || values.length !== 7) return;

  const maxVal = Math.max(...values, 1);
  const chartW = 560;
  const chartH = 180;
  const barW = 48;
  const gap = (chartW - barW * 7) / 8;
  const now = new Date();
  const todayIdx = getDayIndex(now, weekStart);

  for (let i = 0; i < 7; i++) {
    const val = values[i];
    const barH = (val / maxVal) * (chartH - 30);
    const x = gap + i * (barW + gap);
    const y = chartH - barH - 10;

    // Bar rect
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', barW);
    rect.setAttribute('height', Math.max(2, barH));
    rect.setAttribute('class', 'bar-rect');
    svg.appendChild(rect);

    // Value label above bar
    if (val > 0) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x + barW / 2);
      text.setAttribute('y', Math.max(14, y - 6));
      text.setAttribute('class', 'bar-value-label');
      text.textContent = formatBytes(val);
      svg.appendChild(text);
    }

    // Day label below
    const dayLabel = document.createElement('span');
    dayLabel.className = 'bar-day-label';
    if (i === todayIdx) dayLabel.classList.add('today');
    dayLabel.textContent = getDayName(i, weekStart);
    labels.appendChild(dayLabel);
  }

  if (els.chartWeekLabel) {
    els.chartWeekLabel.textContent = getWeekRangeLabel(weekStart);
  }
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
    const [allTabs, suspendedTabs] = await Promise.all([
      getAllTabs(),
      getSuspendedTabs()
    ]);

    const activeCount = Math.max(0, allTabs.length - suspendedTabs.length);
    const activeBytes = activeCount * ESTIMATED_BYTES_PER_TAB;
    const suspendedBytes = suspendedTabs.length * ESTIMATED_BYTES_PER_TAB;

    updateDonut(activeBytes, suspendedBytes);

    if (els.memory) {
      const formatted = formatBytes(activeBytes);
      const parts = formatted.split(' ');
      els.memory.textContent = parts[0];
      if (els.memoryUnit) els.memoryUnit.textContent = parts[1] || '';
    }
    if (els.memoryBadge) {
      els.memoryBadge.hidden = false;
    }

    // Update weekly bar chart
    const weekStart = getWeekStartDay();
    const weekly = await getWeeklySavings();
    updateBarChart(weekly.values || [0,0,0,0,0,0,0], weekStart);

    return { totalRam: activeBytes + suspendedBytes, tabs: [], estimated: true };
  } catch (err) {
    console.error('Dashboard: failed to load memory info:', err);
    if (els.memory) els.memory.textContent = '—';
    updateDonut(0, 0);
    return { totalRam: 0, tabs: [], estimated: true };
  }
}

async function loadTopConsumers() {
  try {
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
  } catch (err) {
    console.error('Dashboard: failed to load top consumers:', err);
    if (els.consumerList) {
      els.consumerList.innerHTML = '';
      const empty = document.createElement('li');
      empty.className = 'consumer-empty';
      empty.textContent = 'No tab memory data available.';
      els.consumerList.appendChild(empty);
    }
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
/* Weekly Savings Storage                                                     */
/* -------------------------------------------------------------------------- */

const WEEKLY_SAVINGS_KEY = 'weeklySavings';

async function getWeeklySavings() {
  try {
    const stored = await localGet(WEEKLY_SAVINGS_KEY);
    if (stored && stored.values && Array.isArray(stored.values) && stored.values.length === 7) {
      return stored;
    }
  } catch (err) {
    console.error('Dashboard: failed to read weekly savings:', err);
  }
  return { values: [0, 0, 0, 0, 0, 0, 0], weekStart: 1, lastUpdated: Date.now() };
}

/* -------------------------------------------------------------------------- */
/* Refresh                                                                    */
/* -------------------------------------------------------------------------- */

async function refreshAll() {
  await Promise.all([
    loadSummary(),
    loadMemoryInfo(),
    loadTopConsumers(),
    loadTimeline()
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

  const refreshInterval = setInterval(refreshAll, 30000);
  window.addEventListener('beforeunload', () => {
    if (refreshInterval) clearInterval(refreshInterval);
  });
}

init().catch((err) => {
  console.error('Dashboard: init failed:', err);
});
