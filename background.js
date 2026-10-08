// Service worker: alarms, auto-suspend, context menu, badge updates, auto-restore, history logging

import { getSettings, setSettings, localGet, localSet, syncGet } from './js/storage.js';
import {
  getAllTabs,
  getSuspendedTabs,
  canSuspend,
  getCurrentTab,
  touchTabLastActive,
  clearKeptAwake,
  getKeptAwakeIds
} from './js/tabs.js';
import { freezeTab, restoreTab, isFrozen } from './js/suspension.js';
import { logHistory, updateBadge } from './js/history.js';
import { normalizeDomain, isWhitelisted } from './js/utils.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasAllUrlsPermission() {
  return new Promise((resolve) => {
    try {
      chrome.permissions.contains({ origins: ['<all_urls>'] }, (ok) => resolve(!!ok));
    } catch (err) {
      resolve(false);
    }
  });
}

function injectContentScript(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.scripting.executeScript(
        { target: { tabId }, files: ['js/content.js'] },
        () => resolve(!chrome.runtime.lastError)
      );
    } catch (err) {
      resolve(false);
    }
  });
}

function sendTabMessage(tabId, message, timeoutMs = 600) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(null); }
    }, timeoutMs);
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) resolve(null);
        else resolve(response || null);
      });
    } catch (err) {
      if (!settled) { settled = true; clearTimeout(timer); resolve(null); }
    }
  });
}

async function initTabLastActive() {
  try {
    const allTabs = await getAllTabs();
    const lastActive = (await localGet('tabLastActive')) || {};
    const now = Date.now();
    const currentIds = new Set(allTabs.map(t => t.id));

    for (const tab of allTabs) {
      if (lastActive[tab.id] === undefined) {
        // Seed from Chrome's own record so auto-suspend/sweep honor real
        // idleness on install and browser restart (Chrome 121+)
        lastActive[tab.id] = tab.lastAccessed || now;
      }
    }

    for (const id of Object.keys(lastActive)) {
      const numId = Number(id);
      if (!currentIds.has(numId)) {
        delete lastActive[id];
      }
    }

    await localSet('tabLastActive', lastActive);
  } catch (err) {
    console.error('initTabLastActive error:', err);
  }
}

/* -------------------------------------------------------------------------- */
/* Auto-suspend pipeline                                                      */
/*                                                                            */
/* One pass = find idle-eligible tabs → optional in-page warning (Not-now     */
/* bumps) → optional dirty-form check → re-validate → batch-freeze.           */
/* Used by the per-minute alarm (warned) and the startup sweep (quiet).       */
/* -------------------------------------------------------------------------- */

function setupAlarm() {
  chrome.alarms.create('auto-suspend', { periodInMinutes: 1 });
}

const WARNING_DELAY_MS = 4000;
let _suspendPassRunning = false;

async function findSuspendableTabs() {
  const [allTabs, settings, whitelistRaw, lastActiveRaw, keptAwake] = await Promise.all([
    getAllTabs(),
    getSettings(),
    syncGet('whitelist'),
    localGet('tabLastActive'),
    getKeptAwakeIds()
  ]);

  const currentTab = await getCurrentTab();
  const currentTabId = currentTab ? currentTab.id : undefined;
  const now = Date.now();
  const thresholdMs = (settings.suspendAfterMinutes || 30) * 60 * 1000;
  const lastActive = lastActiveRaw || {};
  const whitelist = (whitelistRaw || []).map(d => normalizeDomain(d));
  const held = new Set(keptAwake);

  return allTabs.filter((tab) => {
    if (!tab.id || tab.discarded) return false;

    if (!canSuspend(tab, {
      protectActive: settings.protectActive,
      protectPinned: settings.protectPinned,
      protectMedia: settings.protectMedia,
      protectLocalUrls: settings.protectLocalUrls,
      warnFormData: settings.warnFormData,
      currentTabId,
      keptAwake: held
    })) {
      return false;
    }

    if (isWhitelisted(tab.url, whitelist)) return false;

    const last = lastActive[tab.id] ?? tab.lastAccessed;
    if (!last) return false;
    if (now - last < thresholdMs) return false;

    return true;
  });
}

async function runSuspendPass({ warn, checkForms }) {
  const candidates = await findSuspendableTabs();
  if (candidates.length === 0) return 0;
  const candidateIds = new Set(candidates.map(t => t.id));

  if (warn) {
    for (const tab of candidates) {
      if (!/^https?:/.test(tab.url || '')) continue;
      injectContentScript(tab.id).then((ok) => {
        if (ok) sendTabMessage(tab.id, { action: 'ramShowWarning' });
      });
    }
    await delay(WARNING_DELAY_MS);
  }

  // Real dirty-form detection — only when the optional host permission was
  // granted (toggle-time request); the URL heuristic already ran in
  // findSuspendableTabs for everyone else. Unverified (no answer) blocks.
  const blockedByForm = new Set();
  if (checkForms && await hasAllUrlsPermission()) {
    const checks = candidates
      .filter((t) => /^https?:/.test(t.url || ''))
      .map(async (tab) => {
        const ok = await injectContentScript(tab.id);
        if (!ok) return;
        const res = await sendTabMessage(tab.id, { action: 'ramCheckForm' });
        if (!res || res.hasFormData === true) blockedByForm.add(tab.id);
      });
    await Promise.all(checks);
  }

  // Re-validate after the warning delay — Not-now bumps and keep-awake
  // changes land in storage while we wait
  const settings = await getSettings();
  const thresholdMs = (settings.suspendAfterMinutes || 30) * 60 * 1000;
  const [allTabs, whitelistRaw, lastActiveRaw, keptAwake] = await Promise.all([
    getAllTabs(),
    syncGet('whitelist'),
    localGet('tabLastActive'),
    getKeptAwakeIds()
  ]);
  const lastActive = lastActiveRaw || {};
  const whitelist = (whitelistRaw || []).map(d => normalizeDomain(d));
  const held = new Set(keptAwake);
  const currentTab = await getCurrentTab();
  const currentTabId = currentTab ? currentTab.id : undefined;
  const now = Date.now();

  const toSuspend = allTabs.filter((tab) => {
    if (!candidateIds.has(tab.id)) return false;
    if (blockedByForm.has(tab.id)) return false;
    if (!canSuspend(tab, {
      protectActive: settings.protectActive,
      protectPinned: settings.protectPinned,
      protectMedia: settings.protectMedia,
      protectLocalUrls: settings.protectLocalUrls,
      warnFormData: false,
      currentTabId,
      keptAwake: held
    })) {
      return false;
    }
    if (isWhitelisted(tab.url, whitelist)) return false;
    const last = lastActive[tab.id] ?? tab.lastAccessed;
    if (!last || now - last < thresholdMs) return false;
    return true;
  });

  const BATCH_SIZE = 5;
  let suspendedCount = 0;
  for (let i = 0; i < toSuspend.length; i += BATCH_SIZE) {
    const batch = toSuspend.slice(i, i + BATCH_SIZE);
    for (const tab of batch) {
      try {
        await freezeTab(tab);
        await logHistory('suspend', tab);
        suspendedCount++;
      } catch (err) {
        console.error('Failed to suspend tab', tab.id, err);
      }
    }
  }

  if (suspendedCount > 0) {
    await updateBadge();
  }
  return suspendedCount;
}

async function handleAutoSuspend() {
  const settings = await getSettings();
  if (!settings.autoSuspendEnabled) return;
  if (_suspendPassRunning) return;
  _suspendPassRunning = true;
  try {
    await runSuspendPass({ warn: true, checkForms: settings.warnFormData });
  } catch (err) {
    console.error('handleAutoSuspend error:', err);
  } finally {
    _suspendPassRunning = false;
  }
}

/* -------------------------------------------------------------------------- */
/* Startup sweep — quietly re-suspend restored tabs the user hasn't viewed    */
/* -------------------------------------------------------------------------- */

const STARTUP_SWEEP_ALARM = 'startup-sweep';

function setupStartupSweepAlarm() {
  // Chrome clamps sub-minute delays to 1 minute in released builds
  chrome.alarms.create(STARTUP_SWEEP_ALARM, { delayInMinutes: 1 });
}

async function startupSweep() {
  const settings = await getSettings();
  if (!settings.suspendOnStartup) return;
  if (_suspendPassRunning) return;
  _suspendPassRunning = true;
  try {
    await runSuspendPass({ warn: false, checkForms: false });
  } catch (err) {
    console.error('startupSweep error:', err);
  } finally {
    _suspendPassRunning = false;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'auto-suspend') {
    handleAutoSuspend().catch(err => console.error('handleAutoSuspend error:', err));
  } else if (alarm.name === STARTUP_SWEEP_ALARM) {
    startupSweep().catch(err => console.error('startupSweep error:', err));
  }
});

/* -------------------------------------------------------------------------- */
/* Content-script messages and permission revocation                          */
/* -------------------------------------------------------------------------- */

// "Not now" on the in-page warning banner — bump the tab's clock so it
// sits out this pass and gets a fresh countdown
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === 'keepTabAwake' && sender.tab && sender.tab.id != null) {
    touchTabLastActive(sender.tab.id).catch(err => console.error('keepTabAwake error:', err));
    sendResponse({ ok: true });
  }
});

// If the user revokes the optional host permission, real form detection
// stops working — fall back to the heuristic instead of silently blocking
chrome.permissions.onRemoved.addListener((permissions) => {
  if (permissions.origins && permissions.origins.includes('<all_urls>')) {
    setSettings({ warnFormData: false })
      .catch(err => console.error('permissions.onRemoved error:', err));
  }
});

/* -------------------------------------------------------------------------- */
/* Context menu                                                               */
/* -------------------------------------------------------------------------- */

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'suspend-this-tab',
      title: 'Suspend this tab',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: 'suspend-all-other-tabs',
      title: 'Suspend all other tabs',
      contexts: ['page']
    });
  });
  setupAlarm();
  setupStartupSweepAlarm();
  initTabLastActive();
  updateBadge();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenuClick(info, tab).catch(err => console.error('contextMenus error:', err));
});

async function handleContextMenuClick(info, tab) {
  const settings = await getSettings();
  const held = new Set(await getKeptAwakeIds());

  if (info.menuItemId === 'suspend-this-tab') {
    const targetTab = tab || await getCurrentTab();
    if (!targetTab || !targetTab.id) return;

    if (!canSuspend(targetTab, {
      protectActive: false,
      protectPinned: settings.protectPinned,
      protectMedia: settings.protectMedia,
      protectLocalUrls: settings.protectLocalUrls,
      warnFormData: settings.warnFormData,
      keptAwake: held
    })) {
      return;
    }

    try {
      await freezeTab(targetTab);
      await logHistory('suspend', targetTab);
      await updateBadge();
    } catch (err) {
      console.error('Suspend this tab failed:', err);
    }
  } else if (info.menuItemId === 'suspend-all-other-tabs') {
    const allTabs = await getAllTabs();
    const targetTab = tab || await getCurrentTab();
    if (!targetTab || !targetTab.id) return;
    const targetTabId = targetTab.id;

    const toSuspend = allTabs.filter(t => t.id !== targetTabId && canSuspend(t, {
      protectActive: settings.protectActive,
      protectPinned: settings.protectPinned,
      protectMedia: settings.protectMedia,
      protectLocalUrls: settings.protectLocalUrls,
      warnFormData: settings.warnFormData,
      currentTabId: targetTabId,
      keptAwake: held
    }));

    const BATCH_SIZE = 5;
    for (let i = 0; i < toSuspend.length; i += BATCH_SIZE) {
      const batch = toSuspend.slice(i, i + BATCH_SIZE);
      for (const t of batch) {
        try {
          await freezeTab(t);
          await logHistory('suspend', t);
        } catch (err) {
          console.error('Suspend all other tabs failed for tab', t.id, err);
        }
      }
    }
    await updateBadge();
  }
}

/* -------------------------------------------------------------------------- */
/* Keyboard shortcut                                                          */
/* -------------------------------------------------------------------------- */

chrome.commands.onCommand.addListener((command) => {
  if (command === 'suspend-active-tab') {
    handleSuspendActiveTab().catch(err => console.error('commands error:', err));
  }
});

async function handleSuspendActiveTab() {
  const tab = await getCurrentTab();
  if (!tab || !tab.id) {
    return;
  }

  // Toggle: restore if frozen, otherwise suspend
  if (isFrozen(tab)) {
    try {
      await restoreTab(tab.id);
      await updateBadge();
    } catch (err) {
      console.error('Keyboard restore failed:', err);
    }
    return;
  }

  const settings = await getSettings();
  const held = new Set(await getKeptAwakeIds());
  if (!canSuspend(tab, {
    protectActive: false,
    protectPinned: settings.protectPinned,
    protectMedia: settings.protectMedia,
    protectLocalUrls: settings.protectLocalUrls,
    keptAwake: held
  })) {
    return;
  }
  try {
    await freezeTab(tab);
    await logHistory('suspend', tab);
    await updateBadge();
  } catch (err) {
    console.error('Keyboard suspend failed:', err);
  }
}

/* -------------------------------------------------------------------------- */
/* Tab activation listener (auto-restore)                                     */
/* -------------------------------------------------------------------------- */

chrome.tabs.onActivated.addListener((activeInfo) => {
  handleTabActivated(activeInfo.tabId).catch(err => console.error('onActivated error:', err));
});

async function handleTabActivated(tabId) {
  await touchTabLastActive(tabId);

  const settings = await getSettings();
  if (!settings.autoRestore) return;

  const tab = await new Promise((resolve) => {
    chrome.tabs.get(tabId, (t) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(t);
    });
  });

  if (tab && isFrozen(tab)) {
    try {
      await restoreTab(tab.id);
      await updateBadge();
    } catch (err) {
      console.error('Auto-restore failed:', err);
    }
  }
}

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id) {
    touchTabLastActive(tab.id).catch(err => console.error('onCreated error:', err));
  }
  updateBadge().catch(err => console.error('updateBadge error:', err));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  handleTabRemoved(tabId).catch(err => console.error('onRemoved error:', err));
});

async function handleTabRemoved(tabId) {
  const lastActive = (await localGet('tabLastActive')) || {};
  delete lastActive[tabId];
  await localSet('tabLastActive', lastActive);
  await clearKeptAwake(tabId);
  await updateBadge();
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    touchTabLastActive(tabId).catch(err => console.error('onUpdated error:', err));
  }
  // Audio ending counts as activity — a just-paused media tab gets a
  // fresh countdown instead of being suspended mid-binge
  if (changeInfo.audible === false) {
    touchTabLastActive(tabId).catch(err => console.error('onUpdated audible error:', err));
  }
  if (changeInfo.discarded !== undefined || changeInfo.status !== undefined) {
    updateBadge().catch(err => console.error('updateBadge error:', err));
  }
});

/* -------------------------------------------------------------------------- */
/* Suspend on unfocus (when a Chrome window loses focus to another window)    */
/* -------------------------------------------------------------------------- */

let lastFocusedWindowId = null;

chrome.windows.onFocusChanged.addListener((windowId) => {
  handleWindowFocusChanged(windowId).catch(err => console.error('onFocusChanged error:', err));
});

async function handleWindowFocusChanged(windowId) {
  // Badge counts suspended tabs in the focused window — refresh on focus moves
  updateBadge().catch(err => console.error('updateBadge error:', err));

  const settings = await getSettings();
  if (!settings.suspendOnMinimize) return;

  // WINDOW_ID_NONE (-1) means all Chrome windows lost focus (e.g. user switched to another app)
  // In that case, suspend tabs in the previously focused window
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    if (lastFocusedWindowId !== null) {
      await suspendTabsInWindow(lastFocusedWindowId, settings);
    }
    return;
  }

  // A new Chrome window gained focus. Suspend tabs in the previously focused window
  // (if there was one and it's different from the new one)
  if (lastFocusedWindowId !== null && lastFocusedWindowId !== windowId) {
    await suspendTabsInWindow(lastFocusedWindowId, settings);
  }

  // Update tracking
  lastFocusedWindowId = windowId;
}

async function suspendTabsInWindow(windowId, settings) {
  try {
    const tabs = await new Promise((resolve) => {
      chrome.tabs.query({ windowId }, (result) => {
        if (chrome.runtime.lastError) resolve([]);
        else resolve(result || []);
      });
    });

    if (!tabs.length) return;

    // Get the active tab in the unfocused window to respect protectActive
    const activeTab = tabs.find(t => t.active);
    const currentTabId = activeTab ? activeTab.id : undefined;

    const held = new Set(await getKeptAwakeIds());
    const toSuspend = tabs.filter(tab =>
      canSuspend(tab, {
        protectActive: settings.protectActive,
        protectPinned: settings.protectPinned,
        protectMedia: settings.protectMedia,
        protectLocalUrls: settings.protectLocalUrls,
        warnFormData: settings.warnFormData,
        currentTabId,
        keptAwake: held
      })
    );

    const BATCH_SIZE = 5;
    for (let i = 0; i < toSuspend.length; i += BATCH_SIZE) {
      const batch = toSuspend.slice(i, i + BATCH_SIZE);
      for (const tab of batch) {
        try {
          await freezeTab(tab);
          await logHistory('suspend', tab);
        } catch (err) {
          console.error('Suspend on unfocus failed for tab', tab.id, err);
        }
      }
    }

    if (toSuspend.length > 0) {
      await updateBadge();
    }
  } catch (err) {
    console.error('suspendTabsInWindow error:', err);
  }
}

/* -------------------------------------------------------------------------- */
/* Startup                                                                    */
/* -------------------------------------------------------------------------- */

chrome.runtime.onStartup.addListener(() => {
  setupAlarm();
  setupStartupSweepAlarm();
  initTabLastActive();
  updateBadge();
});

/* -------------------------------------------------------------------------- */
/* Immediate init (covers reload / development)                               */
/* -------------------------------------------------------------------------- */

setupAlarm();
setupStartupSweepAlarm();
initTabLastActive();
updateBadge();
