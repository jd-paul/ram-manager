// Tab list view-models, sessions, and tab utilities for the popup.
// Turns raw chrome.tabs.Tab objects into display-ready rows with a
// suspension status, protection reason, and countdown — using the same
// protection rules (analyzeTab) and idle timestamps (tabLastActive) as the
// auto-suspend engine, so the popup never disagrees with what will happen.

import { getSettings, localGet, localSet, syncGet } from './storage.js';
import { analyzeTab } from './tabs.js';
import { isFrozen } from './suspension.js';
import { normalizeDomain, ESTIMATED_BYTES_PER_TAB } from './utils.js';
import { getSavedMemoryToday } from './memory.js';

export const SESSIONS_KEY = 'tabSessions';
const MAX_SESSIONS = 20;

function queryTabs(queryInfo) {
  return new Promise((resolve) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      if (chrome.runtime.lastError) resolve([]);
      else resolve(tabs || []);
    });
  });
}

export function getWindowTabs() {
  return queryTabs({ currentWindow: true });
}

export function getAllWindowsTabs() {
  return queryTabs({});
}

/**
 * Read the original url/title/favicon embedded in a frozen tab's suspended page URL.
 * @param {chrome.tabs.Tab} tab
 * @returns {{ url: string|null, title: string|null, favicon: string|null }}
 */
export function parseFrozenTab(tab) {
  try {
    const params = new URLSearchParams(new URL(tab.url).search);
    return {
      url: params.get('url'),
      title: params.get('title'),
      favicon: params.get('favicon')
    };
  } catch {
    return { url: null, title: null, favicon: null };
  }
}

function isWebUrl(url) {
  return typeof url === 'string' && /^https?:/.test(url);
}

/**
 * Build the popup's per-tab list for the current window plus a summary strip.
 * Row status ∈ 'sleeping' | 'protected' | 'idle'.
 * @returns {Promise<{ items: Array, summary: Object }>}
 */
export async function buildTabList() {
  const [tabs, settings, whitelistRaw, lastActiveRaw, savedTodayBytes] = await Promise.all([
    getWindowTabs(),
    getSettings(),
    syncGet('whitelist'),
    localGet('tabLastActive'),
    getSavedMemoryToday()
  ]);

  const whitelist = (whitelistRaw || []).map((d) => normalizeDomain(d));
  const lastActive = lastActiveRaw || {};
  const now = Date.now();
  const thresholdMs = (settings.suspendAfterMinutes || 30) * 60 * 1000;
  const currentTab = tabs.find((t) => t.active);
  const currentTabId = currentTab ? currentTab.id : undefined;

  const items = tabs.map((tab) => {
    const base = {
      id: tab.id,
      title: tab.title || 'Untitled',
      url: tab.url || '',
      favIconUrl: tab.favIconUrl || '',
      pinned: tab.pinned === true,
      audible: tab.audible === true,
      active: tab.active === true,
      status: 'idle',
      reason: null,
      timeLeft: null
    };

    if (isFrozen(tab)) {
      const frozen = parseFrozenTab(tab);
      return {
        ...base,
        title: frozen.title || base.title,
        url: frozen.url || base.url,
        favIconUrl: frozen.favicon || base.favIconUrl,
        status: 'sleeping'
      };
    }

    const { ok, reason } = analyzeTab(tab, {
      protectActive: settings.protectActive,
      protectPinned: settings.protectPinned,
      protectMedia: settings.protectMedia,
      protectLocalUrls: settings.protectLocalUrls,
      warnFormData: settings.warnFormData,
      currentTabId,
      whitelist
    });

    if (!ok) {
      return { ...base, status: 'protected', reason };
    }

    // Idle — countdown only means something when the engine will actually fire
    if (settings.autoSuspendEnabled) {
      const last = lastActive[tab.id] ?? tab.lastAccessed ?? now;
      const remainingMs = thresholdMs - (now - last);
      base.timeLeft = Math.max(0, Math.ceil(remainingMs / 60000));
    }

    return base;
  });

  const sleeping = items.filter((i) => i.status === 'sleeping').length;
  const protectedCount = items.filter((i) => i.status === 'protected').length;
  const idle = items.length - sleeping - protectedCount;

  return {
    items,
    summary: {
      total: items.length,
      sleeping,
      protected: protectedCount,
      idle,
      savedTodayBytes,
      forecastBytes: idle * ESTIMATED_BYTES_PER_TAB,
      autoSuspendEnabled: settings.autoSuspendEnabled
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Sessions — save/restore flat tab sets across all windows                   */
/* -------------------------------------------------------------------------- */

export async function getSessions() {
  return (await localGet(SESSIONS_KEY)) || [];
}

function defaultSessionName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Session ${pad(d.getDate())}-${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Save all http(s) tabs across every window as one flat session.
 * Frozen and internal tabs are skipped.
 * @param {string} [name]
 * @returns {Promise<Object>} the saved session
 */
export async function saveSession(name) {
  const allTabs = await getAllWindowsTabs();
  const tabs = allTabs
    .filter((tab) => isWebUrl(tab.url) && !isFrozen(tab))
    .map((tab) => ({
      url: tab.url,
      title: tab.title || '',
      favIconUrl: tab.favIconUrl || '',
      pinned: tab.pinned === true
    }));

  const session = {
    id: `session_${Date.now()}`,
    name: (name || '').trim() || defaultSessionName(),
    createdAt: Date.now(),
    tabs
  };

  const sessions = await getSessions();
  sessions.unshift(session);
  if (sessions.length > MAX_SESSIONS) sessions.length = MAX_SESSIONS;
  await localSet(SESSIONS_KEY, sessions);
  return session;
}

export async function deleteSession(id) {
  const sessions = (await getSessions()).filter((s) => s.id !== id);
  await localSet(SESSIONS_KEY, sessions);
}

/**
 * Restore a session. mode 'open' appends tabs to the current window;
 * mode 'replace' closes the current window's tabs first (session tabs are
 * created before any closing, so the window is never left empty).
 * @returns {Promise<number>} tabs opened
 */
export async function restoreSession(id, mode) {
  const session = (await getSessions()).find((s) => s.id === id);
  if (!session) return 0;

  const windowTabs = await getWindowTabs();
  const created = [];
  let opened = 0;

  for (const t of session.tabs) {
    try {
      const createdTab = await chrome.tabs.create({
        url: t.url,
        active: false,
        pinned: t.pinned === true
      });
      created.push(createdTab.id);
      opened++;
    } catch (err) {
      console.error(`restoreSession: failed to open ${t.url}:`, err);
    }
  }

  if (mode === 'replace') {
    const oldIds = windowTabs.map((t) => t.id).filter((id) => !created.includes(id));
    if (oldIds.length) {
      try {
        await chrome.tabs.remove(oldIds);
      } catch (err) {
        console.error('restoreSession: failed to remove old tabs:', err);
      }
    }
    // Leave the user on a real tab instead of whatever Chrome picks
    if (created.length) {
      try {
        await chrome.tabs.update(created[0], { active: true });
      } catch (err) {
        console.error('restoreSession: failed to activate tab:', err);
      }
    }
  }

  return opened;
}

/* -------------------------------------------------------------------------- */
/* Tab utilities                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Close exact-URL duplicates in the current window, keeping the first
 * (leftmost) occurrence. Pinned, active, and frozen tabs are never closed.
 * @returns {Promise<number>} closed count
 */
export async function closeDuplicateTabs() {
  const tabs = await getWindowTabs();
  const seen = new Set();
  const toClose = [];

  for (const tab of tabs) {
    if (tab.pinned || tab.active || isFrozen(tab)) continue;
    if (!isWebUrl(tab.url)) continue;
    if (seen.has(tab.url)) {
      toClose.push(tab.id);
    } else {
      seen.add(tab.url);
    }
  }

  if (toClose.length) {
    try {
      await chrome.tabs.remove(toClose);
    } catch (err) {
      console.error('closeDuplicateTabs failed:', err);
      return 0;
    }
  }

  return toClose.length;
}

/**
 * All http(s) tabs across every window as `title\nurl` blocks, one blank
 * line between tabs. Frozen tabs contribute their original URL/title.
 * @returns {Promise<string>}
 */
export async function exportTabsToText() {
  const tabs = await getAllWindowsTabs();
  const blocks = [];

  for (const tab of tabs) {
    let { url, title } = tab;
    if (isFrozen(tab)) {
      const frozen = parseFrozenTab(tab);
      url = frozen.url || url;
      title = frozen.title || title;
    }
    if (!isWebUrl(url)) continue;
    blocks.push(`${title || url}\n${url}`);
  }

  return blocks.join('\n\n');
}

/* -------------------------------------------------------------------------- */
/* Suspend helpers shared by popup actions                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every suspendable tab in the current window, honoring protections + whitelist.
 * @param {number} [excludeTabId] — skip this tab (e.g. the active one)
 * @returns {Promise<chrome.tabs.Tab[]>}
 */
export async function getSuspendableTabs(excludeTabId) {
  const [tabs, settings, whitelistRaw] = await Promise.all([
    getWindowTabs(),
    getSettings(),
    syncGet('whitelist')
  ]);

  const whitelist = (whitelistRaw || []).map((d) => normalizeDomain(d));

  return tabs.filter((tab) => {
    if (tab.id === excludeTabId) return false;
    return analyzeTab(tab, {
      protectActive: settings.protectActive,
      protectPinned: settings.protectPinned,
      protectMedia: settings.protectMedia,
      protectLocalUrls: settings.protectLocalUrls,
      warnFormData: settings.warnFormData,
      whitelist
    }).ok;
  });
}
