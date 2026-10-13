// Suspension engine — freeze and restore tabs via chrome.tabs.update()
// This module handles the core "freeze" functionality: navigating tabs to a
// local suspended page and restoring them back to their original URL.

import { localGet, localSet, sessionGet, sessionSet, getSettings } from './storage.js';
import { logHistory, updateBadge } from './history.js';
import { hasAllUrlsPermission, sendTabMessage } from './smarts.js';

const SUSPENDED_PAGE = 'suspended.html';

/**
 * Read the tab's scroll position from the resident content script. Returns
 * null when capture is off, impossible (no page access / non-web tab), or
 * pointless (page is at the top).
 */
async function captureScrollPosition(tab) {
  try {
    const settings = await getSettings();
    if (!settings.restoreScrollPosition) return null;
    if (!/^https?:/.test(tab.url || '')) return null;
    if (!(await hasAllUrlsPermission())) return null;
    const res = await sendTabMessage(tab.id, { action: 'ramGetScroll' });
    if (res && typeof res.x === 'number' && typeof res.y === 'number' && (res.x > 0 || res.y > 0)) {
      return { x: Math.round(res.x), y: Math.round(res.y) };
    }
  } catch (err) {
    // Capture is best-effort — never block a freeze on it
  }
  return null;
}

/**
 * Stash a pending scroll target for a tab that is about to be restored.
 * Session storage survives service-worker restarts mid-navigation.
 */
async function stashPendingScroll(tabId, params) {
  try {
    const sx = Number(params.get('sx'));
    const sy = Number(params.get('sy'));
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || (sx <= 0 && sy <= 0)) return;
    const pending = (await sessionGet('pendingScroll')) || {};
    pending[tabId] = { x: sx, y: sy };
    await sessionSet('pendingScroll', pending);
  } catch (err) {
    console.error('stashPendingScroll error:', err);
  }
}

/**
 * Build the chrome-extension:// URL for the suspended page.
 * All data needed to restore is embedded in the URL itself — no storage lookup needed.
 * @param {Object} params
 * @param {string} params.url — original URL
 * @param {string} params.title — original page title
 * @param {string} params.favicon — original favicon URL
 * @param {{ x: number, y: number }} [params.scroll] — scroll position to restore
 * @returns {string}
 */
function buildSuspendedUrl({ url, title, favicon, scroll }) {
  const base = chrome.runtime.getURL(SUSPENDED_PAGE);
  const qs = new URLSearchParams();
  qs.set('url', url);
  qs.set('title', title || 'Untitled');
  qs.set('favicon', favicon || '');
  if (scroll) {
    qs.set('sx', String(scroll.x));
    qs.set('sy', String(scroll.y));
  }
  return `${base}?${qs.toString()}`;
}

/**
 * Freeze a single tab: store its original info and navigate to suspended page.
 * @param {chrome.tabs.Tab} tab
 * @returns {Promise<void>}
 */
export async function freezeTab(tab) {
  if (!tab || !tab.id) {
    throw new Error('Invalid tab');
  }

  if (tab.status === 'loading') {
    throw new Error('Tab is loading, skipping suspension');
  }

  const suspendedUrl = buildSuspendedUrl({
    url: tab.url,
    title: tab.title,
    favicon: tab.favIconUrl,
    scroll: await captureScrollPosition(tab)
  });

  // Store original info for history tracking only (not needed for restore)
  const frozenTabs = (await localGet('frozenTabs')) || {};
  frozenTabs[tab.id] = {
    originalUrl: tab.url,
    title: tab.title,
    favicon: tab.favIconUrl,
    frozenAt: Date.now()
  };
  await localSet('frozenTabs', frozenTabs);

  // Navigate tab to suspended page
  await chrome.tabs.update(tab.id, { url: suspendedUrl });
}

/**
 * Restore a frozen tab back to its original URL.
 * Uses the URL embedded in the suspended page — no storage lookup needed.
 * @param {number} tabId
 * @param {string} [originalUrl] — optional, if known. If not provided, reads from the tab's current URL.
 * @returns {Promise<void>}
 */
export async function restoreTab(tabId, originalUrl) {
  const tab = await new Promise((resolve) => {
    chrome.tabs.get(tabId, (t) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(t);
    });
  });

  // If originalUrl not provided, extract it from the suspended page URL
  if (!originalUrl) {
    if (!tab || !tab.url) {
      throw new Error(`Tab ${tabId} not found or has no URL`);
    }

    const params = new URLSearchParams(new URL(tab.url).search);
    originalUrl = params.get('url');

    if (!originalUrl) {
      throw new Error(`No restore URL found in suspended page for tab ${tabId}`);
    }
  }

  // Carry the captured scroll position across the restore navigation
  if (tab && tab.url) {
    try {
      await stashPendingScroll(tabId, new URLSearchParams(new URL(tab.url).search));
    } catch (err) {
      // Not a suspended URL / no params — nothing to carry
    }
  }

  try {
    await chrome.tabs.update(tabId, { url: originalUrl });
  } catch (err) {
    throw new Error(`Failed to restore tab ${tabId}: ${err.message}`);
  }

  // Clean up storage entry (best effort — not critical for restore)
  try {
    const frozenTabs = (await localGet('frozenTabs')) || {};
    if (frozenTabs[tabId]) {
      delete frozenTabs[tabId];
      await localSet('frozenTabs', frozenTabs);
    }
  } catch (err) {
    console.error('Cleanup frozenTabs failed:', err);
  }

  // Log the restore action
  try {
    const tab = await new Promise((resolve) => {
      chrome.tabs.get(tabId, (t) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(t);
      });
    });
    if (tab) {
      await logHistory('restore', tab);
    }
  } catch (err) {
    console.error('Restore history log failed:', err);
  }
}

/**
 * Check if a tab is currently frozen (on a suspended page).
 * @param {chrome.tabs.Tab} tab
 * @returns {boolean}
 */
export function isFrozen(tab) {
  if (!tab || !tab.url) return false;
  const suspendedPrefix = chrome.runtime.getURL(SUSPENDED_PAGE);
  return tab.url.startsWith(suspendedPrefix);
}

/**
 * Get the original URL of a frozen tab.
 * @param {number} tabId
 * @returns {Promise<string|null>}
 */
export async function getFrozenOriginalUrl(tabId) {
  const frozenTabs = (await localGet('frozenTabs')) || {};
  const info = frozenTabs[tabId];
  return info ? info.originalUrl : null;
}

/**
 * Freeze all tabs that pass the predicate.
 * @param {chrome.tabs.Tab[]} tabs
 * @param {Function} predicate — (tab) => boolean
 * @returns {Promise<number>} count frozen
 */
export async function freezeAll(tabs, predicate = () => true) {
  const toFreeze = tabs.filter(predicate);
  let count = 0;

  for (const tab of toFreeze) {
    try {
      await freezeTab(tab);
      count++;
    } catch (err) {
      console.error(`Failed to freeze tab ${tab.id}:`, err);
    }
  }

  return count;
}

/**
 * Restore all frozen tabs.
 * @returns {Promise<number>} count restored
 */
export async function restoreAll() {
  // Get all tabs that are on our suspended page
  const tabs = await new Promise((resolve) => {
    chrome.tabs.query({}, (result) => {
      if (chrome.runtime.lastError) resolve([]);
      else resolve(result || []);
    });
  });

  const suspendedPrefix = chrome.runtime.getURL(SUSPENDED_PAGE);
  const suspendedTabs = tabs.filter((t) => t.url && t.url.startsWith(suspendedPrefix));

  let count = 0;

  for (const tab of suspendedTabs) {
    try {
      // Extract original URL from the suspended page's query params
      const params = new URLSearchParams(new URL(tab.url).search);
      const originalUrl = params.get('url');

      if (!originalUrl) {
        console.error(`No restore URL found in suspended tab ${tab.id}`);
        continue;
      }

      await stashPendingScroll(tab.id, params);
      await chrome.tabs.update(tab.id, { url: originalUrl });
      count++;
    } catch (err) {
      console.error(`Failed to restore tab ${tab.id}:`, err);
    }
  }

  // Clean up all frozenTabs entries (best effort)
  try {
    await localSet('frozenTabs', {});
  } catch (err) {
    console.error('Cleanup frozenTabs failed:', err);
  }

  if (count > 0) {
    await updateBadge();
  }

  return count;
}
