// Dashboard page logic
// Imports shared modules and renders stats, top consumers, and activity feed.

import { initTheme } from '../js/themes.js';
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
  memoryBadge: document.getElementById('memory-badge'),
  consumerList: document.getElementById('consumer-list'),
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

    // All-time saved memory from storage (fallback to 0)
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
    if (els.memory) els.memory.textContent = formatBytes(info.totalRam);
    if (els.memoryBadge) {
      els.memoryBadge.hidden = !info.estimated;
    }
    return info;
  } catch (err) {
    console.error('Dashboard: failed to load memory info:', err);
    if (els.memory) els.memory.textContent = '—';
    return { totalRam: 0, tabs: [], estimated: true };
  }
}

async function loadTopConsumers() {
  const info = await loadMemoryInfo();
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

  for (const tab of sorted) {
    const li = document.createElement('li');
    li.className = 'consumer-item';

    const domain = document.createElement('span');
    domain.className = 'consumer-domain';
    domain.textContent = tab.domain || 'unknown';

    const memory = document.createElement('span');
    memory.className = 'consumer-memory';
    memory.textContent = formatBytes(tab.memory);

    li.appendChild(domain);
    li.appendChild(memory);
    list.appendChild(li);
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
/* Refresh                                                                    */
/* -------------------------------------------------------------------------- */

async function refreshAll() {
  await Promise.all([
    loadSummary(),
    loadTopConsumers(),
    loadRecentActivity()
  ]);
}

/* -------------------------------------------------------------------------- */
/* Init                                                                       */
/* -------------------------------------------------------------------------- */

async function init() {
  await initTheme();
  await refreshAll();

  // Settings link
  if (els.linkSettings) {
    els.linkSettings.addEventListener('click', (e) => {
      e.preventDefault();
      openPage('settings/settings.html');
    });
  }

  // Auto-refresh every 30 seconds
  setInterval(refreshAll, 30000);
}

init().catch((err) => {
  console.error('Dashboard: init failed:', err);
});
