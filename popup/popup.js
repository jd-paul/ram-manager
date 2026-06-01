// Popup logic

import { getSettings } from "../js/storage.js";
import {
  getAllTabs,
  getSuspendedTabs,
  suspendTab,
  restoreAll,
  getCurrentTab,
  canSuspend,
} from "../js/tabs.js";
import { formatBytes, getSavedMemoryToday } from "../js/memory.js";
import { initTheme } from "../js/themes.js";

const els = {
  currentTabTitle: document.getElementById("current-tab-title"),
  currentTabStatus: document.getElementById("current-tab-status"),
  suspendedCount: document.getElementById("suspended-count"),
  savedMemory: document.getElementById("saved-memory"),
  estimatedNote: document.getElementById("estimated-note"),
  btnSuspendCurrent: document.getElementById("btn-suspend-current"),
  btnRestoreAll: document.getElementById("btn-restore-all"),
  linkDashboard: document.getElementById("link-dashboard"),
  linkSettings: document.getElementById("link-settings"),
  shortcutHint: document.getElementById("shortcut-hint"),
};

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
    const currentTabId = tab.id;
    const suspendable = canSuspend(tab, {
      protectActive: settings.protectActive,
      protectPinned: settings.protectPinned,
      protectMedia: settings.protectMedia,
      currentTabId,
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
      protectActive: false,
      protectPinned: settings.protectPinned,
      protectMedia: settings.protectMedia,
      currentTabId: tab.id,
    });

    if (!suspendable) {
      console.log("Current tab cannot be suspended");
      return;
    }

    await suspendTab(tab.id);
    console.log(`Suspended tab ${tab.id}`);
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

async function init() {
  await initTheme();
  await Promise.all([
    loadTabStats(),
    loadMemoryInfo(),
    loadCurrentTabStatus(),
    loadShortcutHint(),
  ]);
}

els.btnSuspendCurrent.addEventListener("click", handleSuspendCurrent);
els.btnRestoreAll.addEventListener("click", handleRestoreAll);
els.linkDashboard.addEventListener("click", (e) => {
  e.preventDefault();
  openPage("dashboard/dashboard.html");
});
els.linkSettings.addEventListener("click", (e) => {
  e.preventDefault();
  openPage("settings/settings.html");
});

document.addEventListener("DOMContentLoaded", init);
