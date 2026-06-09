// Popup logic

import { getSettings, syncGet } from "../js/storage.js";
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
import { getDomain, normalizeDomain, isWhitelisted } from "../js/utils.js";
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
  els.estimatedNote = document.getElementById("estimated-note");
  els.btnSuspendCurrent = document.getElementById("btn-suspend-current");
  els.btnSuspendAll = document.getElementById("btn-suspend-all");
  els.btnRestoreAll = document.getElementById("btn-restore-all");
  els.linkDashboard = document.getElementById("link-dashboard");
  els.linkSettings = document.getElementById("link-settings");
  els.shortcutHint = document.getElementById("shortcut-hint");

  // Toggles
  els.togglesHeader = document.getElementById("toggles-header");
  els.togglesBody = document.getElementById("toggles-body");
  els.togglesChevron = document.getElementById("toggles-chevron");
  els.autoSuspendToggle = document.getElementById("auto-suspend-toggle");
  els.suspendTimer = document.getElementById("suspend-timer");
  els.suspendTimerRow = document.getElementById("suspend-timer-row");
  els.protectMedia = document.getElementById("protect-media");
  els.protectPinned = document.getElementById("protect-pinned");
  els.protectActive = document.getElementById("protect-active");
  els.protectLocalUrls = document.getElementById("protect-local-urls");
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
    els.suspendedCount.textContent = `${suspended} / ${total}`;
  } catch (err) {
    console.error("Failed to load tab stats:", err);
    els.suspendedCount.textContent = "— / —";
  }
}

async function loadMemoryInfo() {
  try {
    const savedBytes = await getSavedMemoryToday();
    els.savedMemory.textContent = formatBytes(savedBytes);
    els.estimatedNote.hidden = true;
  } catch (err) {
    console.error("Failed to load memory info:", err);
    els.savedMemory.textContent = "—";
    els.estimatedNote.hidden = true;
  }
}

async function loadCurrentTabStatus() {
  try {
    const tab = await getCurrentTab();
    if (!tab) {
      els.currentTabTitle.textContent = "No active tab";
      els.currentTabStatus.textContent = "—";
      els.currentTabStatus.className = "current-tab-status";
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
      els.currentTabStatus.className = "current-tab-status can-suspend";
    } else {
      els.currentTabStatus.textContent = "cannot suspend";
      els.currentTabStatus.className = "current-tab-status cannot-suspend";
    }
  } catch (err) {
    console.error("Failed to load current tab status:", err);
    els.currentTabTitle.textContent = "—";
    els.currentTabStatus.textContent = "—";
    els.currentTabStatus.className = "current-tab-status";
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
  chrome.tabs.create({ url });
  window.close();
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
      els.shortcutHint.textContent = `Keyboard shortcut: ${suspendCommand.shortcut}`;
    } else {
      els.shortcutHint.textContent = "Keyboard shortcut: not set";
    }
  } catch (err) {
    console.error("Failed to load shortcut hint:", err);
    els.shortcutHint.textContent = "Keyboard shortcut: —";
  }
}

/* -------------------------------------------------------------------------- */
/* Toggles UI helpers                                                         */
/* -------------------------------------------------------------------------- */

function toggleTimerRow(enabled) {
  if (!els.suspendTimerRow) return;
  els.suspendTimerRow.style.opacity = enabled ? "1" : "0.5";
  els.suspendTimerRow.style.pointerEvents = enabled ? "auto" : "none";
}

function toggleQuickSettings() {
  const section = document.getElementById("toggles-section");
  const header = document.getElementById("toggles-header");
  const isCollapsed = section.classList.toggle("is-collapsed");
  header.setAttribute("aria-expanded", String(!isCollapsed));
}

function bindToggles() {
  // Shared bindings
  bindToggle(els.autoSuspendToggle, "autoSuspendEnabled");
  bindSelect(els.suspendTimer, "suspendAfterMinutes", "number");
  bindToggle(els.protectMedia, "protectMedia");
  bindToggle(els.protectPinned, "protectPinned");
  bindToggle(els.protectActive, "protectActive");
  bindToggle(els.protectLocalUrls, "protectLocalUrls");
  bindToggle(els.suspendOnMinimize, "suspendOnMinimize");

  // Quick Settings collapsible
  if (els.togglesHeader) {
    els.togglesHeader.addEventListener("click", toggleQuickSettings);
  }
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
}

document.addEventListener("DOMContentLoaded", init);
