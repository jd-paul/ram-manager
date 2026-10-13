// Service worker: alarms, auto-suspend, context menu, badge updates, auto-restore, history logging
//
// Auto-suspend is IDLE-TIME ONLY: one pass per minute finds tabs idle past
// the threshold, warns them, runs the smart pre-freeze checks (js/smarts.js),
// re-validates, and batch-freezes. There are no startup-sweep or
// window-unfocus paths — every freeze goes through the same pipeline.

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
import { normalizeDomain, isWhitelisted, gateSmartChecks } from './js/utils.js';
import {
  hasAllUrlsPermission,
  injectContentScript,
  sendTabMessage,
  getActiveTabIds,
  checkTabSmart
} from './js/smarts.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/**
 * Keep the smart-detection content script resident on http(s) tabs so
 * activity heartbeats and live-title tracking work between checks.
 * The script's window guard makes repeat injection a no-op.
 */
async function ensureContentScriptEverywhere() {
  if (!(await hasAllUrlsPermission())) return;
  try {
    const tabs = await getAllTabs();
    for (const tab of tabs) {
      if (!tab.id || !/^https?:/.test(tab.url || '')) continue;
      if (tab.status === 'loading') continue;
      injectContentScript(tab.id);
    }
  } catch (err) {
    console.error('ensureContentScriptEverywhere error:', err);
  }
}

/**
 * Pre-smart-freezing installs: auto-suspend being on implied every smart
 * check ran. Adopt that into the new master key once, so the update never
 * silently strips protections. smartFreezingEnabled undefined = never set.
 */
async function migrateSmartFreezing() {
  try {
    const smart = await syncGet('smartFreezingEnabled');
    if (smart !== undefined) return;
    const auto = await syncGet('autoSuspendEnabled');
    if (auto === true) {
      await setSettings({ smartFreezingEnabled: true });
    }
  } catch (err) {
    console.error('migrateSmartFreezing error:', err);
  }
}

/* -------------------------------------------------------------------------- */
/* Auto-suspend pipeline                                                      */
/*                                                                            */
/* One pass = find idle-eligible tabs → in-page warning (Not-now bumps) →     */
/* smart pre-freeze checks (forms, media, focus, live titles) →          */
/* re-validate → batch-freeze.                                                */
/* -------------------------------------------------------------------------- */

function setupAlarm() {
  chrome.alarms.create('auto-suspend', { periodInMinutes: 1 });
}

const WARNING_DELAY_MS = 4000;
let _suspendPassRunning = false;

function protectionOptions(settings, activeTabIds) {
  const gated = gateSmartChecks(settings);
  return {
    protectActive: gated.protectActive,
    protectPinned: gated.protectPinned,
    protectMedia: gated.protectMedia,
    protectLocalUrls: gated.protectLocalUrls,
    protectForms: gated.protectForms,
    protectMeetingSites: gated.protectMeetingSites,
    protectMusicSites: gated.protectMusicSites,
    activeTabIds,
    keptAwake: null
  };
}

async function findSuspendableTabs() {
  const [allTabs, settings, whitelistRaw, lastActiveRaw, keptAwake, activeTabIds] = await Promise.all([
    getAllTabs(),
    getSettings(),
    syncGet('whitelist'),
    localGet('tabLastActive'),
    getKeptAwakeIds(),
    getActiveTabIds()
  ]);

  const now = Date.now();
  const thresholdMs = (settings.suspendAfterMinutes || 60) * 60 * 1000;
  const lastActive = lastActiveRaw || {};
  const whitelist = (whitelistRaw || []).map(d => normalizeDomain(d));
  const held = new Set(keptAwake);

  return allTabs.filter((tab) => {
    if (!tab.id || tab.discarded) return false;

    if (!canSuspend(tab, {
      ...protectionOptions(settings, activeTabIds),
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

async function runSuspendPass({ warn }) {
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

  // Smart pre-freeze checks: dirty forms, playing media, focused document,
  // live title changes. Unverifiable tabs are skipped —
  // when in doubt, never freeze. The smart-freezing master switch gates
  // these checks off entirely when powered down.
  const settings = gateSmartChecks(await getSettings());
  const blocked = new Set();
  const checks = candidates.map(async (tab) => {
    const verdict = await checkTabSmart(tab, settings);
    if (!verdict.ok) blocked.add(tab.id);
  });
  await Promise.all(checks);

  // Re-validate after the warning delay — Not-now bumps and keep-awake
  // changes land in storage while we wait
  const [allTabs, whitelistRaw, lastActiveRaw, keptAwake, activeTabIds] = await Promise.all([
    getAllTabs(),
    syncGet('whitelist'),
    localGet('tabLastActive'),
    getKeptAwakeIds(),
    getActiveTabIds()
  ]);
  const lastActive = lastActiveRaw || {};
  const whitelist = (whitelistRaw || []).map(d => normalizeDomain(d));
  const held = new Set(keptAwake);
  const now = Date.now();
  const thresholdMs = (settings.suspendAfterMinutes || 60) * 60 * 1000;

  const toSuspend = allTabs.filter((tab) => {
    if (!candidateIds.has(tab.id)) return false;
    if (blocked.has(tab.id)) return false;
    if (!canSuspend(tab, { ...protectionOptions(settings, activeTabIds), keptAwake: held })) {
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
    await runSuspendPass({ warn: true });
  } catch (err) {
    console.error('handleAutoSuspend error:', err);
  } finally {
    _suspendPassRunning = false;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'auto-suspend') {
    handleAutoSuspend().catch(err => console.error('handleAutoSuspend error:', err));
  }
});

/* -------------------------------------------------------------------------- */
/* Content-script messages                                                    */
/* -------------------------------------------------------------------------- */

// "Not now" on the in-page warning banner — bump the tab's clock so it
// sits out this pass and gets a fresh countdown
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === 'keepTabAwake' && sender.tab && sender.tab.id != null) {
    touchTabLastActive(sender.tab.id).catch(err => console.error('keepTabAwake error:', err));
    sendResponse({ ok: true });
  } else if (msg && msg.action === 'ramTabActivity' && sender.tab && sender.tab.id != null) {
    // Real user activity in the page (typing, mouse, scroll, focus) — the
    // tab is in use even if background-position in its window; reset its clock
    touchTabLastActive(sender.tab.id).catch(err => console.error('ramTabActivity error:', err));
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
  initTabLastActive();
  migrateSmartFreezing();
  ensureContentScriptEverywhere();
  updateBadge();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenuClick(info, tab).catch(err => console.error('contextMenus error:', err));
});

async function handleContextMenuClick(info, tab) {
  const settings = gateSmartChecks(await getSettings());
  const held = new Set(await getKeptAwakeIds());

  if (info.menuItemId === 'suspend-this-tab') {
    const targetTab = tab || await getCurrentTab();
    if (!targetTab || !targetTab.id) return;

    if (!canSuspend(targetTab, {
      protectActive: false,
      protectPinned: settings.protectPinned,
      protectMedia: settings.protectMedia,
      protectLocalUrls: settings.protectLocalUrls,
      protectForms: false,
      protectMeetingSites: settings.protectMeetingSites,
      protectMusicSites: settings.protectMusicSites,
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
    const activeTabIds = await getActiveTabIds();

    const toSuspend = allTabs.filter(t => t.id !== targetTab.id && canSuspend(t, {
      protectActive: settings.protectActive,
      protectPinned: settings.protectPinned,
      protectMedia: settings.protectMedia,
      protectLocalUrls: settings.protectLocalUrls,
      protectForms: false,
      protectMeetingSites: settings.protectMeetingSites,
      protectMusicSites: settings.protectMusicSites,
      activeTabIds,
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

  const settings = gateSmartChecks(await getSettings());
  const held = new Set(await getKeptAwakeIds());
  if (!canSuspend(tab, {
    protectActive: false,
    protectPinned: settings.protectPinned,
    protectMedia: settings.protectMedia,
    protectLocalUrls: settings.protectLocalUrls,
    protectForms: false,
    protectMeetingSites: settings.protectMeetingSites,
    protectMusicSites: settings.protectMusicSites,
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
  if (changeInfo.status === 'complete' && /^https?:/.test(tab.url || '')) {
    // Keep the resident content script alive across navigations
    hasAllUrlsPermission().then((granted) => {
      if (granted) injectContentScript(tabId);
    });
  }
  if (changeInfo.discarded !== undefined || changeInfo.status !== undefined) {
    updateBadge().catch(err => console.error('updateBadge error:', err));
  }
});

chrome.windows.onFocusChanged.addListener(() => {
  // Badge counts suspended tabs in the focused window — refresh on focus moves
  updateBadge().catch(err => console.error('onFocusChanged error:', err));
});

/* -------------------------------------------------------------------------- */
/* Startup                                                                    */
/* -------------------------------------------------------------------------- */

chrome.runtime.onStartup.addListener(() => {
  setupAlarm();
  initTabLastActive();
  migrateSmartFreezing();
  ensureContentScriptEverywhere();
  updateBadge();
});

/* -------------------------------------------------------------------------- */
/* Immediate init (covers reload / development)                               */
/* -------------------------------------------------------------------------- */

setupAlarm();
initTabLastActive();
migrateSmartFreezing();
ensureContentScriptEverywhere();
updateBadge();
