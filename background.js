// Service worker: alarms, auto-suspend, context menu, badge updates, keyboard shortcut, auto-restore, history logging

import { getSettings, localGet, localSet, syncGet } from './js/storage.js';
import {
  getAllTabs,
  getSuspendedTabs,
  canSuspend,
  getCurrentTab
} from './js/tabs.js';
import { freezeTab, restoreTab } from './js/suspension.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function getDomain(url) {
  try {
    if (!url) return 'unknown';
    const u = new URL(url);
    return u.hostname || 'unknown';
  } catch {
    return 'unknown';
  }
}

function normalizeDomain(input) {
  return input.trim().toLowerCase().replace(/^www\./, '');
}

function isWhitelisted(domain, whitelist) {
  const d = normalizeDomain(domain);
  for (const entry of whitelist) {
    const e = normalizeDomain(entry);
    if (d === e || d.endsWith('.' + e)) return true;
  }
  return false;
}

async function logHistory(action, tab) {
  try {
    const history = (await localGet('suspensionHistory')) || [];
    history.push({
      action,
      tabId: tab.id,
      url: tab.url,
      domain: getDomain(tab.url),
      timestamp: Date.now()
    });
    if (history.length > 500) {
      history.splice(0, history.length - 500);
    }
    await localSet('suspensionHistory', history);

    if (action === 'suspend') {
      const saved = (await localGet('savedMemoryAllTime')) || 0;
      const estimate = 75 * 1024 * 1024; // 75 MB per tab
      await localSet('savedMemoryAllTime', saved + estimate);
    }
  } catch (err) {
    console.error('logHistory error:', err);
  }
}

async function updateBadge() {
  try {
    const suspended = await getSuspendedTabs();
    const count = suspended.length;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
  } catch (err) {
    console.error('updateBadge error:', err);
  }
}

async function updateTabLastActive(tabId) {
  try {
    const lastActive = (await localGet('tabLastActive')) || {};
    lastActive[tabId] = Date.now();
    await localSet('tabLastActive', lastActive);
  } catch (err) {
    console.error('updateTabLastActive error:', err);
  }
}

async function initTabLastActive() {
  try {
    const allTabs = await getAllTabs();
    const lastActive = (await localGet('tabLastActive')) || {};
    const now = Date.now();
    const currentIds = new Set(allTabs.map(t => t.id));

    for (const tab of allTabs) {
      if (lastActive[tab.id] === undefined) {
        lastActive[tab.id] = now;
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
/* Auto-suspend alarm                                                         */
/* -------------------------------------------------------------------------- */

function setupAlarm() {
  chrome.alarms.create('auto-suspend', { periodInMinutes: 1 });
}

async function handleAutoSuspend() {
  const settings = await getSettings();
  if (!settings.autoSuspendEnabled) return;

  const [allTabs, whitelistRaw, lastActiveRaw] = await Promise.all([
    getAllTabs(),
    syncGet('whitelist'),
    localGet('tabLastActive')
  ]);

  const currentTab = await getCurrentTab();
  const currentTabId = currentTab ? currentTab.id : undefined;
  const now = Date.now();
  const thresholdMs = (settings.suspendAfterMinutes || 30) * 60 * 1000;
  const lastActive = lastActiveRaw || {};
  const whitelist = (whitelistRaw || []).map(d => normalizeDomain(d));

  let suspendedCount = 0;

  for (const tab of allTabs) {
    if (!tab.id || tab.discarded) continue;

    if (!canSuspend(tab, {
      protectActive: settings.protectActive,
      protectPinned: settings.protectPinned,
      protectMedia: settings.protectMedia,
      currentTabId
    })) {
      continue;
    }

    const domain = getDomain(tab.url);
    if (isWhitelisted(domain, whitelist)) continue;

    const last = lastActive[tab.id];
    if (!last) continue;
    if (now - last < thresholdMs) continue;

    try {
      await freezeTab(tab);
      await logHistory('suspend', tab);
      suspendedCount++;
    } catch (err) {
      console.error('Failed to suspend tab', tab.id, err);
    }
  }

  if (suspendedCount > 0) {
    await updateBadge();
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'auto-suspend') {
    handleAutoSuspend().catch(err => console.error('handleAutoSuspend error:', err));
  }
});

/* -------------------------------------------------------------------------- */
/* Context menu                                                               */
/* -------------------------------------------------------------------------- */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'suspend-this-tab',
      title: 'Suspend this tab',
      contexts: ['page', 'tab']
    });
    chrome.contextMenus.create({
      id: 'suspend-all-other-tabs',
      title: 'Suspend all other tabs',
      contexts: ['page', 'tab']
    });
  });
  setupAlarm();
  initTabLastActive();
  updateBadge();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenuClick(info, tab).catch(err => console.error('contextMenus error:', err));
});

async function handleContextMenuClick(info, tab) {
  const settings = await getSettings();

  if (info.menuItemId === 'suspend-this-tab') {
    const targetTab = tab || await getCurrentTab();
    if (!targetTab || !targetTab.id) return;

    if (!canSuspend(targetTab, {
      protectActive: false,
      protectPinned: settings.protectPinned,
      protectMedia: settings.protectMedia
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
    const targetTabId = targetTab ? targetTab.id : undefined;

    const toSuspend = allTabs.filter(t => t.id !== targetTabId && canSuspend(t, {
      protectActive: settings.protectActive,
      protectPinned: settings.protectPinned,
      protectMedia: settings.protectMedia,
      currentTabId: targetTabId
    }));

    for (const t of toSuspend) {
      try {
        await freezeTab(t);
        await logHistory('suspend', t);
      } catch (err) {
        console.error('Suspend all other tabs failed for tab', t.id, err);
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
  if (!tab || !tab.id) return;

  const settings = await getSettings();
  if (!canSuspend(tab, {
    protectActive: false,
    protectPinned: settings.protectPinned,
    protectMedia: settings.protectMedia
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
  await updateTabLastActive(tabId);

  const settings = await getSettings();
  if (!settings.autoRestore) return;

  const tab = await new Promise((resolve) => {
    chrome.tabs.get(tabId, (t) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(t);
    });
  });

  if (tab && tab.discarded) {
    try {
      await restoreTab(tab.id);
      await logHistory('restore', tab);
      await updateBadge();
    } catch (err) {
      console.error('Auto-restore failed:', err);
    }
  }
}

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id) {
    updateTabLastActive(tab.id).catch(err => console.error('onCreated error:', err));
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
  await updateBadge();
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    updateTabLastActive(tabId).catch(err => console.error('onUpdated error:', err));
  }
  if (changeInfo.discarded !== undefined || changeInfo.status !== undefined) {
    updateBadge().catch(err => console.error('updateBadge error:', err));
  }
});

/* -------------------------------------------------------------------------- */
/* Startup                                                                    */
/* -------------------------------------------------------------------------- */

chrome.runtime.onStartup.addListener(() => {
  setupAlarm();
  initTabLastActive();
  updateBadge();
});

/* -------------------------------------------------------------------------- */
/* Immediate init (covers reload / development)                               */
/* -------------------------------------------------------------------------- */

setupAlarm();
initTabLastActive();
updateBadge();
