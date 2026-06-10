// Shared history logging and badge updates
// Used by background.js and popup.js

import { ESTIMATED_BYTES_PER_TAB } from './utils.js';
import { localGet, localSet, getSettings } from './storage.js';

function getDomain(url) {
  try {
    if (!url) return 'unknown';
    const u = new URL(url);
    return u.hostname || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function recordDailySavings(savedBytes) {
  try {
    const weekStart = getWeekStartDay();
    const now = new Date();
    const todayIndex = getDayIndex(now, weekStart);

    let weekly = (await localGet('weeklySavings')) || {};
    if (!weekly.values || !Array.isArray(weekly.values) || weekly.values.length !== 7) {
      weekly = { values: [0, 0, 0, 0, 0, 0, 0], weekStart, lastUpdated: Date.now() };
    }

    const currentWeekStart = getWeekStartTimestamp(now, weekStart);
    const storedWeekStart = weekly.lastUpdated ? getWeekStartTimestamp(new Date(weekly.lastUpdated), weekStart) : currentWeekStart;

    if (currentWeekStart !== storedWeekStart) {
      weekly.values = [0, 0, 0, 0, 0, 0, 0];
    }

    weekly.values[todayIndex] += savedBytes;
    weekly.weekStart = weekStart;
    weekly.lastUpdated = Date.now();

    await localSet('weeklySavings', weekly);
  } catch (err) {
    console.error('recordDailySavings error:', err);
  }
}

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

function getWeekStartTimestamp(date, weekStart) {
  const d = new Date(date);
  const day = d.getDay();
  let diff = day - weekStart;
  if (diff < 0) diff += 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Serialize all history logging through a single in-memory queue so that
// concurrent calls (e.g. batch tab suspends) do not read the same stale
// storage value and overwrite each other's updates.
let _historyQueue = Promise.resolve();

export function logHistory(action, tab) {
  _historyQueue = _historyQueue.then(async () => {
    try {
      const history = (await localGet('suspensionHistory')) || [];
      history.push({
        action,
        tabId: tab.id,
        url: tab.url,
        domain: getDomain(tab.url),
        title: tab.title,
        timestamp: Date.now()
      });
      if (history.length > 500) {
        history.splice(0, history.length - 500);
      }
      await localSet('suspensionHistory', history);

      if (action === 'suspend') {
        const estimate = ESTIMATED_BYTES_PER_TAB;
        const saved = (await localGet('savedMemoryAllTime')) || 0;
        await localSet('savedMemoryAllTime', saved + estimate);
        await recordDailySavings(estimate);
      }
    } catch (err) {
      console.error('logHistory error:', err);
    }
  }).catch(() => {});
  return _historyQueue;
}

export async function updateBadge() {
  try {
    const settings = await getSettings();
    if (!settings.badgeCountEnabled) {
      chrome.action.setBadgeText({ text: '' });
      return;
    }

    // Inline getSuspendedTabs logic to avoid circular dependency
    const tabs = await new Promise((resolve) => {
      chrome.tabs.query({}, (result) => {
        if (chrome.runtime.lastError) resolve([]);
        else resolve(result || []);
      });
    });
    const suspendedPrefix = chrome.runtime.getURL('suspended.html');
    const count = tabs.filter((t) => t.url && t.url.startsWith(suspendedPrefix)).length;

    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
  } catch (err) {
    console.error('updateBadge error:', err);
  }
}
