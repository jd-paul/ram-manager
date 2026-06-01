// Tab querying and protection rule utilities
// Chrome Extension Manifest V3 APIs only

import { isFrozen } from './suspension.js';

/**
 * Returns all tabs across all windows.
 * @returns {Promise<chrome.tabs.Tab[]>}
 */
export function getAllTabs() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({}, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(tabs || []);
      }
    });
  });
}

/**
 * Returns tabs that are currently frozen (on suspended page).
 * @returns {Promise<chrome.tabs.Tab[]>}
 */
export async function getSuspendedTabs() {
  const tabs = await getAllTabs();
  return tabs.filter((tab) => isFrozen(tab));
}

/**
 * Returns the active tab in the current window.
 * @returns {Promise<chrome.tabs.Tab | undefined>}
 */
export function getCurrentTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(tabs && tabs[0]);
      }
    });
  });
}

/**
 * Checks if a tab can be frozen based on protection rules.
 * @param {chrome.tabs.Tab} tab
 * @param {Object} options
 * @param {boolean} [options.protectActive=true]
 * @param {boolean} [options.protectPinned=true]
 * @param {boolean} [options.protectMedia=true]
 * @param {number} [options.currentTabId]
 * @returns {boolean}
 */
export function canSuspend(tab, options = {}) {
  if (!tab || !tab.id) return false;

  // Already frozen
  if (isFrozen(tab)) return false;

  // Chrome internal URLs
  if (tab.url && tab.url.startsWith('chrome://')) return false;

  // Chrome extension URLs (including our own suspended page)
  if (tab.url && tab.url.startsWith('chrome-extension://')) return false;

  // File URLs (optional safeguard)
  if (tab.url && tab.url.startsWith('file://')) return false;

  const {
    protectActive = true,
    protectPinned = true,
    protectMedia = true,
    currentTabId
  } = options;

  // Protect currently active tab
  if (protectActive && currentTabId !== undefined && tab.id === currentTabId) {
    return false;
  }

  // Protect pinned tabs
  if (protectPinned && tab.pinned === true) {
    return false;
  }

  // Protect tabs with audible media
  if (protectMedia && tab.audible === true) {
    return false;
  }

  return true;
}
