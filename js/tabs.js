// Tab querying, suspension, and restoration utilities
// Chrome Extension Manifest V3 APIs only

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
 * Returns tabs where tab.discarded === true.
 * @returns {Promise<chrome.tabs.Tab[]>}
 */
export async function getSuspendedTabs() {
  const tabs = await getAllTabs();
  return tabs.filter((tab) => tab.discarded === true);
}

/**
 * Suspends a single tab via chrome.tabs.discard.
 * @param {number} tabId
 * @returns {Promise<chrome.tabs.Tab>}
 */
export function suspendTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.discard(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(tab);
      }
    });
  });
}

/**
 * Reloads a suspended tab via chrome.tabs.reload.
 * @param {number} tabId
 * @returns {Promise<void>}
 */
export function restoreTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.reload(tabId, {}, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
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
 * Checks if a tab can be suspended based on protection rules.
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

  // Already discarded
  if (tab.discarded === true) return false;

  // Chrome internal URLs
  if (tab.url && tab.url.startsWith('chrome://')) return false;

  // Chrome extension URLs
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

/**
 * Suspends all tabs except protected ones.
 * @param {Object} options — passed through to canSuspend
 * @returns {Promise<number>} count of tabs suspended
 */
export async function suspendAll(options = {}) {
  const tabs = await getAllTabs();
  const currentTab = await getCurrentTab();
  const currentTabId = currentTab ? currentTab.id : undefined;

  const mergedOptions = {
    ...options,
    currentTabId: options.currentTabId !== undefined ? options.currentTabId : currentTabId
  };

  const toSuspend = tabs.filter((tab) => canSuspend(tab, mergedOptions));
  const results = await Promise.allSettled(
    toSuspend.map((tab) => suspendTab(tab.id))
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  return succeeded;
}

/**
 * Restores all suspended tabs.
 * @returns {Promise<number>} count of tabs restored
 */
export async function restoreAll() {
  const suspended = await getSuspendedTabs();
  const results = await Promise.allSettled(
    suspended.map((tab) => restoreTab(tab.id))
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  return succeeded;
}
