// Suspension engine — freeze and restore tabs via chrome.tabs.update()
// This module handles the core "freeze" functionality: navigating tabs to a
// local suspended page and restoring them back to their original URL.

import { localGet, localSet } from './storage.js';

const SUSPENDED_PAGE = 'suspended.html';

/**
 * Build the chrome-extension:// URL for the suspended page.
 * @param {Object} params
 * @param {string} params.url — original URL
 * @param {string} params.title — original page title
 * @param {string} params.favicon — original favicon URL
 * @param {number} params.tabId — tab ID
 * @returns {string}
 */
function buildSuspendedUrl({ url, title, favicon, tabId }) {
  const base = chrome.runtime.getURL(SUSPENDED_PAGE);
  const qs = new URLSearchParams();
  qs.set('url', url);
  qs.set('title', title || 'Untitled');
  qs.set('favicon', favicon || '');
  qs.set('tabId', String(tabId));
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
    tabId: tab.id
  });

  // Store original info so we can restore later (and for history)
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
 * @param {number} tabId
 * @returns {Promise<void>}
 */
export async function restoreTab(tabId) {
  const frozenTabs = (await localGet('frozenTabs')) || {};
  const info = frozenTabs[tabId];

  if (!info || !info.originalUrl) {
    throw new Error(`No frozen info found for tab ${tabId}`);
  }

  try {
    await chrome.tabs.update(tabId, { url: info.originalUrl });
  } catch (err) {
    throw new Error(`Failed to restore tab ${tabId}: ${err.message}`);
  }

  // Clean up only after successful update
  delete frozenTabs[tabId];
  await localSet('frozenTabs', frozenTabs);
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
  const frozenTabs = (await localGet('frozenTabs')) || {};
  const tabIds = Object.keys(frozenTabs).map(Number);
  let count = 0;

  for (const tabId of tabIds) {
    try {
      await restoreTab(tabId);
      count++;
    } catch (err) {
      console.error(`Failed to restore tab ${tabId}:`, err);
    }
  }

  return count;
}
