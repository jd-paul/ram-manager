// Popup logic

import { getSettings, syncGet, syncSet } from "../js/storage.js";
import {
  getAllTabs,
  getSuspendedTabs,
  getCurrentTab,
  canSuspend,
} from "../js/tabs.js";
import { freezeTab, restoreAll } from "../js/suspension.js";
import { formatBytes, getSavedMemoryToday } from "../js/memory.js";
import { initTheme } from "../js/theme.js";
import { logHistory, updateBadge } from "../js/history.js";
import { getDomain, normalizeDomain, isWhitelisted, parseShortcut } from "../js/utils.js";
import {
  loadSettingsIntoUI,
  bindToggle,
  bindSelect,
} from "../js/settings-ui.js";

const els = {};

function initElements() {
  els.currentTabTitle = document.getElementById("current-tab-title");
  els.currentTabStatus = document.getElementById("current-tab-status");
  els.suspendedCount = document.getElementById("suspended-count");
  els.savedMemory = document.getElementById("saved-memory");
  els.savedMemoryPillText = document.getElementById("saved-memory-pill-text");
  els.estimatedNote = document.getElementById("estimated-note");
  els.btnSuspendCurrent = document.getElementById("btn-suspend-current");
  els.btnSuspendAll = document.getElementById("btn-suspend-all");
  els.btnRestoreAll = document.getElementById("btn-restore-all");
  els.linkDashboard = document.getElementById("link-dashboard");
  els.linkSettings = document.getElementById("link-settings");
  els.shortcutPills = document.getElementById("kbd-pills");

  // Whitelist
  els.whitelistInput = document.getElementById("whitelist-input");
  els.whitelistAdd = document.getElementById("whitelist-add");
  els.whitelistHint = document.getElementById("whitelist-hint");
  els.whitelistList = document.getElementById("whitelist-list");
  els.whitelistEmpty = document.getElementById("whitelist-empty");

  // Toggles
  els.autoSuspendToggle = document.getElementById("auto-suspend-toggle");
  els.suspendTimer = document.getElementById("suspend-timer");
  els.suspendTimerRow = document.getElementById("suspend-timer-row");
  els.protectMedia = document.getElementById("protect-media");
  els.protectPinned = document.getElementById("protect-pinned");
  els.protectActive = document.getElementById("protect-active");
  els.protectLocalUrls = document.getElementById("protect-local-urls");
  els.autoRestoreToggle = document.getElementById("auto-restore-toggle");
  els.suspendOnMinimize = document.getElementById("suspend-on-minimize");
}

async function loadTabStats() {
  try {
    const [allTabs, suspendedTabs] = await Promise.all([
      getAllTabs(),
      getSuspendedTabs(),
    ]);
    const total = allTabs.length;
    const suspended = suspendedTabs.length;
    if (els.suspendedCount) {
      els.suspendedCount.textContent = `${suspended} / ${total}`;
    }
  } catch (err) {
    console.error("Failed to load tab stats:", err);
    if (els.suspendedCount) {
      els.suspendedCount.textContent = "— / —";
    }
  }
}

async function loadMemoryInfo() {
  try {
    const savedBytes = await getSavedMemoryToday();
    const formatted = formatBytes(savedBytes);
    if (els.savedMemory) {
      els.savedMemory.textContent = formatted;
    }
    if (els.savedMemoryPillText) {
      const mb = (savedBytes / (1024 * 1024)).toFixed(1);
      els.savedMemoryPillText.textContent = `${mb} MB saved`;
    }
    if (els.estimatedNote) {
      els.estimatedNote.hidden = true;
    }
  } catch (err) {
    console.error("Failed to load memory info:", err);
    if (els.savedMemory) els.savedMemory.textContent = "—";
    if (els.savedMemoryPillText)
      els.savedMemoryPillText.textContent = "0 MB saved";
    if (els.estimatedNote) els.estimatedNote.hidden = true;
  }
}

async function loadCurrentTabStatus() {
  try {
    const tab = await getCurrentTab();
    if (!tab) {
      els.currentTabTitle.textContent = "No active tab";
      els.currentTabStatus.textContent = "—";
      els.currentTabStatus.className = "status-pill";
      return;
    }

    const title = tab.title || "Untitled";
    els.currentTabTitle.textContent = title;

    const settings = await getSettings();
    const suspendable = canSuspend(tab, {
      protectActive: settings.protectActive,
      protectPinned: settings.protectPinned,
      protectMedia: settings.protectMedia,
      protectLocalUrls: settings.protectLocalUrls,
      warnFormData: settings.warnFormData,
    });

    if (suspendable) {
      els.currentTabStatus.textContent = "can suspend";
      els.currentTabStatus.className = "status-pill can-suspend";
    } else {
      els.currentTabStatus.textContent = "cannot suspend";
      els.currentTabStatus.className = "status-pill cannot-suspend";
    }
  } catch (err) {
    console.error("Failed to load current tab status:", err);
    els.currentTabTitle.textContent = "—";
    els.currentTabStatus.textContent = "—";
    els.currentTabStatus.className = "status-pill";
  }
}

async function handleSuspendCurrent() {
  try {
    els.btnSuspendCurrent.disabled = true;
    const tab = await getCurrentTab();
    if (!tab || !tab.id) {
      console.log("No current tab to suspend");
      return;
    }

    const settings = await getSettings();
    const suspendable = canSuspend(tab, {
      protectActive: settings.protectActive,
      protectPinned: settings.protectPinned,
      protectMedia: settings.protectMedia,
      protectLocalUrls: settings.protectLocalUrls,
      warnFormData: settings.warnFormData,
      currentTabId: tab.id,
    });

    if (!suspendable) {
      console.log("Current tab cannot be suspended");
      return;
    }

    await freezeTab(tab);
    await logHistory("suspend", tab);
    await updateBadge();
    console.log(`Frozen tab ${tab.id}`);
    await loadTabStats();
    await loadCurrentTabStatus();
  } catch (err) {
    console.error("Suspend current tab failed:", err);
  } finally {
    els.btnSuspendCurrent.disabled = false;
  }
}

async function handleRestoreAll() {
  try {
    els.btnRestoreAll.disabled = true;
    const count = await restoreAll();
    console.log(`Restored ${count} tabs`);
    await loadTabStats();
    await loadCurrentTabStatus();
  } catch (err) {
    console.error("Restore all failed:", err);
  } finally {
    els.btnRestoreAll.disabled = false;
  }
}

async function handleSuspendAll() {
  try {
    els.btnSuspendAll.disabled = true;

    const [allTabs, settings, whitelistRaw, currentTab] = await Promise.all([
      getAllTabs(),
      getSettings(),
      syncGet("whitelist"),
      getCurrentTab(),
    ]);

    const currentTabId = currentTab ? currentTab.id : undefined;
    const whitelist = (whitelistRaw || []).map((d) => normalizeDomain(d));

    const toSuspend = allTabs.filter((tab) => {
      if (
        !canSuspend(tab, {
          protectActive: settings.protectActive,
          protectPinned: settings.protectPinned,
          protectMedia: settings.protectMedia,
          protectLocalUrls: settings.protectLocalUrls,
          warnFormData: settings.warnFormData,
          currentTabId,
        })
      ) {
        return false;
      }
      const domain = getDomain(tab.url);
      return !isWhitelisted(tab.url, whitelist);
    });

    const BATCH_SIZE = 5;
    let count = 0;
    for (let i = 0; i < toSuspend.length; i += BATCH_SIZE) {
      const batch = toSuspend.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map((tab) =>
          freezeTab(tab)
            .then(() => logHistory("suspend", tab))
            .catch((err) =>
              console.error(`Failed to freeze tab ${tab.id}:`, err),
            ),
        ),
      );
      count += batch.length;
    }

    await updateBadge();
    console.log(`Frozen ${count} tabs`);
    await loadTabStats();
    await loadCurrentTabStatus();
  } catch (err) {
    console.error("Suspend all failed:", err);
  } finally {
    els.btnSuspendAll.disabled = false;
  }
}

function openPage(path) {
  const url = chrome.runtime.getURL(path);
  chrome.tabs.create({ url }, () => {
    window.close();
  });
}

async function loadShortcutHint() {
  try {
    const commands = await new Promise((resolve) => {
      if (chrome.commands && chrome.commands.getAll) {
        chrome.commands.getAll(resolve);
      } else {
        resolve([]);
      }
    });
    const suspendCommand = commands.find(
      (c) => c.name === "suspend-active-tab",
    );
    if (suspendCommand && suspendCommand.shortcut) {
      const parts = parseShortcut(suspendCommand.shortcut);
      const pillsHtml = parts
        .map(
          (part, i) =>
            `${i > 0 ? '<span class="kbd-plus">+</span>' : ""}<span class="kbd-pill">${part}</span>`,
        )
        .join("");
      if (els.shortcutPills) {
        els.shortcutPills.innerHTML = pillsHtml;
      }
    } else {
      if (els.shortcutPills) {
        els.shortcutPills.innerHTML = '<span class="kbd-pill">not set</span>';
      }
    }
  } catch (err) {
    console.error("Failed to load shortcut hint:", err);
    if (els.shortcutPills) {
      els.shortcutPills.innerHTML = '<span class="kbd-pill">—</span>';
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Whitelist helpers                                                          */
/* -------------------------------------------------------------------------- */

let popupWhitelist = [];

function isValidWhitelistEntry(input) {
  if (!input || typeof input !== 'string') return false;
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (/^https?:\/\//.test(trimmed)) {
    try { new URL(trimmed); return true; } catch { return false; }
  }
  if (/[\/\?:#@]/.test(trimmed)) return false;
  if (!trimmed.includes('.')) return false;
  return true;
}

function normalizeWhitelistEntry(input) {
  const trimmed = input.trim();
  if (/^https?:\/\//.test(trimmed)) return trimmed.toLowerCase();
  return trimmed.toLowerCase().replace(/^www\./, '');
}

function getWhitelistDisplayLabel(entry) {
  if (/^https?:\/\//.test(entry)) {
    try {
      const url = new URL(entry);
      const path = url.pathname + url.search;
      if (path.length > 30) return url.hostname + path.slice(0, 30) + '...';
      return url.hostname + path;
    } catch { return entry; }
  }
  return entry;
}

function showWhitelistHint(message) {
  if (els.whitelistHint) els.whitelistHint.textContent = message;
}

async function addPopupWhitelistEntry() {
  const raw = els.whitelistInput.value;
  if (!isValidWhitelistEntry(raw)) {
    showWhitelistHint('Enter a valid domain or URL');
    return;
  }
  const entry = normalizeWhitelistEntry(raw);
  if (popupWhitelist.includes(entry)) {
    showWhitelistHint('Already whitelisted');
    return;
  }
  popupWhitelist.push(entry);
  await syncSet('whitelist', popupWhitelist);
  els.whitelistInput.value = '';
  showWhitelistHint('');
  renderPopupWhitelist();
}

async function removePopupWhitelistEntry(entry) {
  popupWhitelist = popupWhitelist.filter((d) => d !== entry);
  await syncSet('whitelist', popupWhitelist);
  renderPopupWhitelist();
}

function renderPopupWhitelist() {
  if (!els.whitelistList) return;
  els.whitelistList.innerHTML = '';
  if (popupWhitelist.length === 0) {
    if (els.whitelistEmpty) els.whitelistEmpty.style.display = 'block';
    return;
  }
  if (els.whitelistEmpty) els.whitelistEmpty.style.display = 'none';
  for (const entry of popupWhitelist) {
    const li = document.createElement('li');
    li.className = 'whitelist-item';
    const span = document.createElement('span');
    span.textContent = getWhitelistDisplayLabel(entry);
    span.title = entry;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Remove';
    btn.addEventListener('click', () => removePopupWhitelistEntry(entry));
    li.appendChild(span);
    li.appendChild(btn);
    els.whitelistList.appendChild(li);
  }
}

async function loadPopupWhitelist() {
  popupWhitelist = (await syncGet('whitelist')) || [];
  renderPopupWhitelist();
}

/* -------------------------------------------------------------------------- */
/* Toggles UI helpers                                                         */
/* -------------------------------------------------------------------------- */

function toggleTimerRow(enabled) {
  if (!els.suspendTimerRow) return;
  els.suspendTimerRow.style.opacity = enabled ? "1" : "0.5";
  els.suspendTimerRow.style.pointerEvents = enabled ? "auto" : "none";
}

function bindToggles() {
  // Shared bindings
  bindToggle(els.autoSuspendToggle, "autoSuspendEnabled");
  bindSelect(els.suspendTimer, "suspendAfterMinutes", "number");
  bindToggle(els.protectMedia, "protectMedia");
  bindToggle(els.protectPinned, "protectPinned");
  bindToggle(els.protectActive, "protectActive");
  bindToggle(els.protectLocalUrls, "protectLocalUrls");
  bindToggle(els.autoRestoreToggle, "autoRestore");
  bindToggle(els.suspendOnMinimize, "suspendOnMinimize");
}

/* -------------------------------------------------------------------------- */
/* Init                                                                       */
/* -------------------------------------------------------------------------- */

async function init() {
  initElements();
  await initTheme();
  await Promise.all([
    loadTabStats(),
    loadMemoryInfo(),
    loadCurrentTabStatus(),
    loadShortcutHint(),
    loadSettingsIntoUI(els),
    loadPopupWhitelist(),
  ]);

  // Apply timer row state after settings loaded
  toggleTimerRow(els.autoSuspendToggle ? els.autoSuspendToggle.checked : true);
  bindToggles();

  if (els.btnSuspendCurrent)
    els.btnSuspendCurrent.addEventListener("click", handleSuspendCurrent);
  if (els.btnSuspendAll)
    els.btnSuspendAll.addEventListener("click", handleSuspendAll);
  if (els.btnRestoreAll)
    els.btnRestoreAll.addEventListener("click", handleRestoreAll);
  if (els.linkDashboard)
    els.linkDashboard.addEventListener("click", (e) => {
      e.preventDefault();
      openPage("dashboard/dashboard.html");
    });
  if (els.linkSettings)
    els.linkSettings.addEventListener("click", (e) => {
      e.preventDefault();
      openPage("settings/settings.html");
    });
  if (els.whitelistAdd)
    els.whitelistAdd.addEventListener("click", addPopupWhitelistEntry);
  if (els.whitelistInput)
    els.whitelistInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addPopupWhitelistEntry();
      }
    });
}

document.addEventListener("DOMContentLoaded", init);
