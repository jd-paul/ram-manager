// Tab querying and protection rule utilities
// Chrome Extension Manifest V3 APIs only

import { isFrozen } from './suspension.js';
import { isWhitelisted } from './utils.js';

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
 * Analyzes a tab against the protection rules and reports the first rule
 * that blocks suspension. This is the single source of protection rules —
 * canSuspend() is a thin wrapper over it for engine paths, and UI code uses
 * it to explain *why* a tab won't sleep.
 * @param {chrome.tabs.Tab} tab
 * @param {Object} options
 * @param {boolean} [options.protectActive=true]
 * @param {boolean} [options.protectPinned=true]
 * @param {boolean} [options.protectMedia=true]
 * @param {boolean} [options.protectLocalUrls=true]
 * @param {boolean} [options.warnFormData=true]
 * @param {number} [options.currentTabId]
 * @param {string[]} [options.whitelist] — when provided, matching tabs are blocked with reason 'whitelisted'
 * @returns {{ ok: boolean, reason: string|null }}
 *   reason ∈ null | 'invalid' | 'frozen' | 'discarded' | 'system' | 'loading' |
 *            'active' | 'pinned' | 'audible' | 'local-url' | 'form' | 'whitelisted'
 */
export function analyzeTab(tab, options = {}) {
  if (!tab || !tab.id || !tab.url) return { ok: false, reason: 'invalid' };
  if (isFrozen(tab)) return { ok: false, reason: 'frozen' };
  if (tab.discarded === true) return { ok: false, reason: 'discarded' };

  const url = tab.url;
  if (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('devtools://') ||
    url.startsWith('about:') ||
    url.startsWith('file://') ||
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.startsWith('javascript:')
  ) {
    return { ok: false, reason: 'system' };
  }

  // Not fully loaded — freezeTab would refuse anyway
  if (tab.status === 'loading') return { ok: false, reason: 'loading' };

  const {
    protectActive = true,
    protectPinned = true,
    protectMedia = true,
    protectLocalUrls = true,
    warnFormData = true,
    currentTabId,
    whitelist
  } = options;

  // Protect currently active tab
  if (protectActive && currentTabId !== undefined && tab.id === currentTabId) {
    return { ok: false, reason: 'active' };
  }

  // Protect pinned tabs
  if (protectPinned && tab.pinned === true) {
    return { ok: false, reason: 'pinned' };
  }

  // Protect tabs with audible media
  if (protectMedia && tab.audible === true) {
    return { ok: false, reason: 'audible' };
  }

  // Protect local / development URLs
  if (protectLocalUrls && url) {
    let urlObj;
    try {
      urlObj = new URL(url);
    } catch {
      return { ok: false, reason: 'local-url' };
    }
    const hostname = urlObj.hostname;
    // localhost
    if (hostname === 'localhost') return { ok: false, reason: 'local-url' };
    // 127.0.0.1 / loopback
    if (hostname === '127.0.0.1' || hostname.startsWith('127.')) return { ok: false, reason: 'local-url' };
    // IPv4 private networks: 10.x.x.x, 172.16-31.x.x, 192.168.x.x
    if (/^10\./.test(hostname)) return { ok: false, reason: 'local-url' };
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)) return { ok: false, reason: 'local-url' };
    if (/^192\.168\./.test(hostname)) return { ok: false, reason: 'local-url' };
  }

  // Lightweight heuristic: protect likely form pages when warnFormData is enabled
  if (warnFormData && url) {
    let path;
    try {
      path = new URL(url).pathname.toLowerCase();
    } catch {
      path = '';
    }
    const formPaths = ['/login', '/signin', '/checkout', '/cart', '/payment'];
    if (path && formPaths.some((p) => path.includes(p))) {
      return { ok: false, reason: 'form' };
    }
  }

  if (Array.isArray(whitelist) && isWhitelisted(url, whitelist)) {
    return { ok: false, reason: 'whitelisted' };
  }

  return { ok: true, reason: null };
}

/**
 * Checks if a tab can be frozen based on protection rules.
 * @param {chrome.tabs.Tab} tab
 * @param {Object} options
 * @param {boolean} [options.protectActive=true]
 * @param {boolean} [options.protectPinned=true]
 * @param {boolean} [options.protectMedia=true]
 * @param {boolean} [options.warnFormData=true]
 * @param {number} [options.currentTabId]
 * @returns {boolean}
 */
export function canSuspend(tab, options = {}) {
  return analyzeTab(tab, options).ok;
}
