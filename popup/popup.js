// Popup logic

import { getSettings, syncGet, syncSet } from "../js/storage.js";
import {
  getCurrentTab,
  analyzeTab,
  getKeptAwakeIds,
  setKeptAwake,
  touchTabLastActive,
} from "../js/tabs.js";
import { freezeTab, restoreTab, restoreAll } from "../js/suspension.js";
import { formatBytes } from "../js/memory.js";
import { initTheme } from "../js/theme.js";
import { logHistory, updateBadge } from "../js/history.js";
import { parseShortcut, ESTIMATED_BYTES_PER_TAB } from "../js/utils.js";
import {
  loadSettingsIntoUI,
  bindToggle,
  bindSelect,
  saveSetting,
} from "../js/settings-ui.js";
import {
  buildTabList,
  getSuspendableTabs,
  getSessions,
  saveSession,
  deleteSession,
  restoreSession,
  closeDuplicateTabs,
  exportTabsToText,
} from "../js/tablist.js";

const els = {};

const REASON_LABELS = {
  active: "Active tab",
  pinned: "Pinned",
  audible: "Playing audio",
  "local-url": "Local page",
  form: "Form page",
  system: "System page",
  loading: "Loading",
  whitelisted: "Whitelisted",
  discarded: "Discarded",
  invalid: "—",
  "kept-awake": "Kept awake",
};

// Which quick-setting toggle a blocked reason deep-links to
const REASON_TO_TOGGLE = {
  pinned: "protect-pinned",
  audible: "protect-media",
  active: "protect-active",
  "local-url": "protect-local-urls",
  form: "warn-form-data",
};

const SECTION_STATE_KEY = "ram-manager-popup-sections";
const POLL_INTERVAL_MS = 5000;

let pollTimer = null;
let refreshInFlight = false;
let lastTabSignature = "";
let toastTimer = null;

/* -------------------------------------------------------------------------- */
/* Element refs                                                               */
/* -------------------------------------------------------------------------- */

function initElements() {
  els.currentTab = document.getElementById("current-tab");
  els.currentTabTitle = document.getElementById("current-tab-title");
  els.currentTabStatus = document.getElementById("current-tab-status");

  els.statSleeping = document.getElementById("stat-sleeping");
  els.statSleepingValue = document.getElementById("stat-sleeping-value");
  els.statProtectedValue = document.getElementById("stat-protected-value");
  els.statMemory = document.getElementById("stat-memory");
  els.statMemoryValue = document.getElementById("stat-memory-value");
  els.statMemoryText = document.getElementById("stat-memory-text");

  els.btnSuspendOthers = document.getElementById("btn-suspend-others");
  els.btnSuspendCurrent = document.getElementById("btn-suspend-current");
  els.btnSuspendAll = document.getElementById("btn-suspend-all");
  els.btnRestoreAll = document.getElementById("btn-restore-all");
  els.linkDashboard = document.getElementById("link-dashboard");
  els.linkSettings = document.getElementById("link-settings");
  els.shortcutPills = document.getElementById("kbd-pills");
  els.shortcutRow = document.getElementById("shortcut-row");

  els.tabList = document.getElementById("tab-list");
  els.tabListEmpty = document.getElementById("tab-list-empty");
  els.btnTabSearch = document.getElementById("btn-tab-search");
  els.btnCloseDuplicates = document.getElementById("btn-close-duplicates");
  els.btnExportTabs = document.getElementById("btn-export-tabs");
  els.tabSearchRow = document.getElementById("tab-search-row");
  els.tabSearchInput = document.getElementById("tab-search-input");

  els.sessionsSection = document.getElementById("sessions-section");
  els.sessionNameInput = document.getElementById("session-name-input");
  els.btnSaveSession = document.getElementById("btn-save-session");
  els.sessionList = document.getElementById("session-list");
  els.sessionEmpty = document.getElementById("session-empty");

  els.settingsSection = document.getElementById("settings-section");
  els.whitelistSection = document.getElementById("whitelist-section");

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
  els.warnFormData = document.getElementById("warn-form-data");
  els.autoRestoreToggle = document.getElementById("auto-restore-toggle");
  els.suspendOnMinimize = document.getElementById("suspend-on-minimize");

  els.toast = document.getElementById("toast");
}

/* -------------------------------------------------------------------------- */
/* Toast                                                                      */
/* -------------------------------------------------------------------------- */

function showToast(message, durationMs = 2600) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove("show");
  }, durationMs);
}

/* -------------------------------------------------------------------------- */
/* Collapsible section state                                                  */
/* -------------------------------------------------------------------------- */

function restoreSections() {
  try {
    const state = JSON.parse(localStorage.getItem(SECTION_STATE_KEY) || "{}");
    document.querySelectorAll("details.collapsible-section").forEach((d) => {
      if (Object.prototype.hasOwnProperty.call(state, d.id)) {
        d.open = state[d.id];
      }
    });
  } catch {
    // Fresh state — leave markup defaults
  }
}

function persistSections() {
  const state = {};
  document.querySelectorAll("details.collapsible-section").forEach((d) => {
    state[d.id] = d.open;
  });
  localStorage.setItem(SECTION_STATE_KEY, JSON.stringify(state));
}

/* -------------------------------------------------------------------------- */
/* Refresh: stats + tab list + current-tab card                               */
/* -------------------------------------------------------------------------- */

async function refresh() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    const { items, summary } = await buildTabList();
    renderStats(summary);
    renderCurrentTab(items);
    renderTabList(items);
  } catch (err) {
    console.error("Popup refresh failed:", err);
  } finally {
    refreshInFlight = false;
  }
}

function renderStats(summary) {
  if (els.statSleepingValue) {
    els.statSleepingValue.textContent = String(summary.sleeping);
  }
  if (els.statProtectedValue) {
    els.statProtectedValue.textContent = String(summary.protected);
  }
  if (!els.statMemoryValue) return;

  if (summary.savedTodayBytes > 0) {
    els.statMemoryValue.textContent = formatBytes(summary.savedTodayBytes);
    els.statMemoryText.textContent = "Saved today";
    els.statMemory.classList.remove("stat-forecast");
    els.statMemory.title = "Estimated memory saved today by suspending tabs";
  } else if (summary.forecastBytes > 0) {
    els.statMemoryValue.textContent = formatBytes(summary.forecastBytes);
    els.statMemoryText.textContent = "Available";
    els.statMemory.classList.add("stat-forecast");
    els.statMemory.title = "Estimated memory you could free by suspending idle tabs";
  } else {
    els.statMemoryValue.textContent = "—";
    els.statMemoryText.textContent = "Saved today";
    els.statMemory.classList.remove("stat-forecast");
  }
}

function renderCurrentTab(items) {
  if (!els.currentTabTitle || !els.currentTabStatus) return;
  const current = items.find((i) => i.active);

  if (!current) {
    els.currentTabTitle.textContent = "No active tab";
    els.currentTabStatus.textContent = "—";
    els.currentTabStatus.className = "status-pill";
    els.currentTabStatus.dataset.reason = "";
    els.currentTab.title = "";
    return;
  }

  els.currentTabTitle.textContent = current.title;

  if (current.status === "sleeping") {
    els.currentTabStatus.textContent = "Suspended";
    els.currentTabStatus.className = "status-pill status-sleeping";
    els.currentTabStatus.dataset.reason = "";
    els.currentTab.title = "This tab is suspended";
    return;
  }

  if (current.status === "idle") {
    els.currentTabStatus.textContent = "Can suspend";
    els.currentTabStatus.className = "status-pill can-suspend";
    els.currentTabStatus.dataset.reason = "";
    els.currentTab.title = "";
    return;
  }

  const label = REASON_LABELS[current.reason] || "Protected";
  els.currentTabStatus.textContent = label;
  els.currentTabStatus.dataset.reason = current.reason;
  els.currentTab.title = "Won't suspend: " + label;
  const jumpTarget = REASON_TO_TOGGLE[current.reason];
  if (current.reason === "whitelisted") {
    els.currentTabStatus.className = "status-pill status-whitelisted";
    els.currentTab.title = "Won't suspend: whitelisted — click to manage the whitelist";
  } else if (jumpTarget) {
    els.currentTabStatus.className = "status-pill cannot-suspend";
    els.currentTab.title = `Won't suspend: ${label} — click to change this setting`;
  } else {
    els.currentTabStatus.className = "status-pill status-neutral";
  }
}

/* Badge icon set — 12px line icons matching the house SVG style */
const BADGE_ICON_SVG = {
  asleep: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
  "clock-off": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 7 12 12 15 14"></polyline><line x1="4" y1="4" x2="20" y2="20"></line></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M9 10.76 7.21 11.66A2 2 0 0 0 6 13.43V15a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1.57a2 2 0 0 0-1.21-1.77L15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"></path></svg>',
  volume: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>',
  coffee: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"></path><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"></path></svg>',
  form: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>',
  local: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="12" x2="2" y2="12"></line><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path><line x1="6" y1="16" x2="6.01" y2="16"></line><line x1="10" y1="16" x2="10.01" y2="16"></line></svg>',
  loading: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>',
};

function badgeFor(item) {
  if (item.status === "sleeping") {
    return {
      text: "Asleep",
      sub: item.sleepFor ? `· ${item.sleepFor}` : null,
      className: "badge-asleep",
      icon: "asleep",
    };
  }
  if (item.status === "protected") {
    switch (item.reason) {
      case "active":
        return { text: "Active", sub: null, className: "badge-active", icon: "eye" };
      case "pinned":
        return { text: "Pinned", sub: null, className: "badge-pinned", icon: "pin" };
      case "audible":
        return { text: "Audio", sub: null, className: "badge-audible", icon: "volume" };
      case "local-url":
        return { text: "Local", sub: null, className: "badge-local-url", icon: "local" };
      case "form":
        return { text: "Form", sub: null, className: "badge-form", icon: "form" };
      case "system":
        return { text: "System", sub: null, className: "badge-system", icon: "lock" };
      case "whitelisted":
        return { text: "Whitelisted", sub: null, className: "badge-whitelisted", icon: "shield" };
      case "kept-awake":
        return { text: "Keep awake", sub: null, className: "badge-kept-awake", icon: "coffee" };
      case "loading":
        return { text: "Loading", sub: null, className: "badge-loading", icon: "loading" };
      default:
        return { text: "Protected", sub: null, className: "", icon: "shield" };
    }
  }
  // idle
  if (item.timeLeft === null) return { text: "Paused", sub: null, className: "badge-paused", icon: "clock-off" };
  if (item.timeLeft <= 0) return { text: "Soon", sub: null, className: "badge-soon", icon: "clock" };
  return { text: `${item.timeLeft}m`, sub: null, className: "badge-val", icon: "clock" };
}

function buildTabRow(item) {
  const row = document.createElement("div");
  row.className = "tab-row" + (item.status === "sleeping" ? " sleeping" : "");
  row.dataset.status = item.status;
  row.dataset.tabId = String(item.id);
  row.dataset.title = item.title;
  row.dataset.url = item.url;
  row.dataset.reason = item.reason || "";
  row.setAttribute("role", "button");
  row.setAttribute("tabindex", "0");
  row.title = item.url || item.title;

  const favicon = document.createElement("span");
  favicon.className = "tab-favicon";
  if (item.favIconUrl && /^https?:/.test(item.favIconUrl)) {
    const img = document.createElement("img");
    img.src = item.favIconUrl;
    img.alt = "";
    img.addEventListener("error", () => img.remove());
    favicon.appendChild(img);
  } else {
    const letter = (item.title || "?").trim().charAt(0) || "?";
    favicon.textContent = letter;
  }
  row.appendChild(favicon);

  const title = document.createElement("span");
  title.className = "tab-title";
  title.textContent = item.title;
  row.appendChild(title);

  const badge = document.createElement("span");
  const b = badgeFor(item);
  badge.className = "tab-badge " + b.className;
  if (b.icon && BADGE_ICON_SVG[b.icon]) {
    badge.innerHTML = BADGE_ICON_SVG[b.icon];
  }
  const label = document.createElement("span");
  label.textContent = b.text;
  badge.appendChild(label);
  if (b.sub) {
    const sub = document.createElement("span");
    sub.className = "tab-badge-sub";
    sub.textContent = b.sub;
    badge.appendChild(sub);
  }
  row.appendChild(badge);

  if (item.status === "idle" || item.reason === "kept-awake") {
    const held = item.reason === "kept-awake";
    const kaBtn = document.createElement("button");
    kaBtn.className = "tab-keepawake-btn";
    kaBtn.type = "button";
    kaBtn.title = held ? "Allow sleep" : "Keep this tab awake";
    kaBtn.innerHTML = held
      ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>'
      : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"></path><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"></path><line x1="6" y1="2" x2="6" y2="4"></line><line x1="10" y1="2" x2="10" y2="4"></line><line x1="14" y1="2" x2="14" y2="4"></line></svg>';
    kaBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleKeepAwake(item.id, !held);
    });
    row.appendChild(kaBtn);
  }

  if (item.status === "idle") {
    const btn = document.createElement("button");
    btn.className = "tab-suspend-btn";
    btn.type = "button";
    btn.title = "Suspend this tab";
    btn.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="9" y1="5" x2="9" y2="19"></line><line x1="15" y1="5" x2="15" y2="19"></svg>';
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      suspendTabById(item.id);
    });
    row.appendChild(btn);
  }

  row.addEventListener("click", () => onTabRowClick(item));
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onTabRowClick(item);
    }
  });

  return row;
}

function renderTabList(items) {
  if (!els.tabList) return;
  const signature =
    items
      .map((i) => [i.id, i.status, i.reason, i.timeLeft, i.title, i.favIconUrl, i.sleepFor].join("|"))
      .join(";") + "#" + (els.tabSearchInput ? els.tabSearchInput.value : "");
  if (signature === lastTabSignature) return;
  lastTabSignature = signature;

  const scrollTop = els.tabList.scrollTop;
  els.tabList.innerHTML = "";
  for (const item of items) {
    els.tabList.appendChild(buildTabRow(item));
  }
  els.tabList.scrollTop = scrollTop;
  applyTabFilter();
}

function applyTabFilter() {
  if (!els.tabList) return;
  const query = (els.tabSearchInput ? els.tabSearchInput.value : "").trim().toLowerCase();
  let visible = 0;
  for (const row of els.tabList.children) {
    const match =
      !query ||
      (row.dataset.title || "").toLowerCase().includes(query) ||
      (row.dataset.url || "").toLowerCase().includes(query);
    row.hidden = !match;
    if (match) visible++;
  }
  if (els.tabListEmpty) {
    els.tabListEmpty.hidden = visible !== 0;
  }
}

/* -------------------------------------------------------------------------- */
/* Tab row interactions                                                       */
/* -------------------------------------------------------------------------- */

async function onTabRowClick(item) {
  try {
    if (item.status === "sleeping" && item.ours) {
      await restoreTab(item.id);
      await updateBadge();
    }
    // Chrome-discarded rows (ours === false) just get focused — Chrome
    // natively reloads a discarded tab on activation
    await chrome.tabs.update(item.id, { active: true });
    const tab = await chrome.tabs.get(item.id).catch(() => null);
    if (tab) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch (err) {
    console.error("Tab row click failed:", err);
  }
  await refresh();
}

async function suspendTabById(tabId) {
  try {
    if ((await getKeptAwakeIds()).includes(tabId)) {
      showToast("Kept awake — release it first");
      return;
    }
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return;
    const settings = await getSettings();
    const { ok, reason } = analyzeTab(tab, {
      protectActive: false,
      protectPinned: settings.protectPinned,
      protectMedia: settings.protectMedia,
      protectLocalUrls: settings.protectLocalUrls,
      warnFormData: settings.warnFormData,
    });
    if (!ok) {
      showToast(`Can't suspend: ${REASON_LABELS[reason] || "protected"}`);
      return;
    }
    await freezeTab(tab);
    await logHistory("suspend", tab);
    await updateBadge();
  } catch (err) {
    console.error("Suspend tab failed:", err);
    showToast("Suspend failed");
  }
  await refresh();
}

async function toggleKeepAwake(tabId, on) {
  try {
    await setKeptAwake(tabId, on);
    if (!on) {
      // Releasing gives the tab a fresh countdown
      await touchTabLastActive(tabId);
    }
  } catch (err) {
    console.error("toggleKeepAwake failed:", err);
    showToast("Couldn't update keep-awake");
  }
  await refresh();
}

/* -------------------------------------------------------------------------- */
/* Suspend actions (current / others / all) with live progress                */
/* -------------------------------------------------------------------------- */

async function suspendBatchWithProgress(button, tabs) {
  if (!tabs.length) {
    showToast("Nothing to suspend");
    return;
  }
  const originalLabel = button.textContent;
  button.disabled = true;

  const BATCH_SIZE = 5;
  let done = 0;
  let failed = 0;

  for (let i = 0; i < tabs.length; i += BATCH_SIZE) {
    const batch = tabs.slice(i, i + BATCH_SIZE);
    for (const tab of batch) {
      try {
        await freezeTab(tab);
        await logHistory("suspend", tab);
        done++;
      } catch (err) {
        console.error(`Failed to freeze tab ${tab.id}:`, err);
        failed++;
      }
    }
    button.textContent = `Suspending ${done + failed}/${tabs.length}`;
  }

  button.textContent = originalLabel;
  button.disabled = false;

  await updateBadge();
  await refresh();

  const parts = [`Suspended ${done}`];
  if (done > 0) parts.push(`~${formatBytes(done * ESTIMATED_BYTES_PER_TAB)} freed`);
  if (failed > 0) parts.push(`${failed} failed`);
  showToast(parts.join(" · "));
}

async function handleSuspendOthers() {
  try {
    const currentTab = await getCurrentTab();
    const tabs = await getSuspendableTabs(currentTab ? currentTab.id : undefined);
    await suspendBatchWithProgress(els.btnSuspendOthers, tabs);
  } catch (err) {
    console.error("Suspend others failed:", err);
    showToast("Suspend failed");
  }
}

async function handleSuspendAll() {
  try {
    const tabs = await getSuspendableTabs(undefined);
    await suspendBatchWithProgress(els.btnSuspendAll, tabs);
  } catch (err) {
    console.error("Suspend all failed:", err);
    showToast("Suspend failed");
  }
}

async function handleSuspendCurrent() {
  try {
    const tab = await getCurrentTab();
    if (!tab || !tab.id) {
      showToast("No active tab");
      return;
    }

    if ((await getKeptAwakeIds()).includes(tab.id)) {
      showToast("Kept awake — release it first");
      return;
    }

    // Explicit user action — overrides the active-tab protection,
    // same as the keyboard shortcut and context menu paths
    const settings = await getSettings();
    const { ok, reason } = analyzeTab(tab, {
      protectActive: false,
      protectPinned: settings.protectPinned,
      protectMedia: settings.protectMedia,
      protectLocalUrls: settings.protectLocalUrls,
      warnFormData: settings.warnFormData,
    });

    if (!ok) {
      showToast(`Can't suspend: ${REASON_LABELS[reason] || "protected"}`);
      return;
    }

    await freezeTab(tab);
    await logHistory("suspend", tab);
    await updateBadge();
  } catch (err) {
    console.error("Suspend current tab failed:", err);
    showToast("Suspend failed");
  }
  await refresh();
}

async function handleRestoreAll() {
  try {
    els.btnRestoreAll.disabled = true;
    const count = await restoreAll();
    showToast(count > 0 ? `Restored ${count} tab${count === 1 ? "" : "s"}` : "Nothing to restore");
    await refresh();
  } catch (err) {
    console.error("Restore all failed:", err);
    showToast("Restore failed");
  } finally {
    els.btnRestoreAll.disabled = false;
  }
}

/* -------------------------------------------------------------------------- */
/* Tab utilities: search, duplicates, export                                  */
/* -------------------------------------------------------------------------- */

function bindTabTools() {
  if (els.btnTabSearch) {
    els.btnTabSearch.addEventListener("click", () => {
      const show = els.tabSearchRow.hidden;
      els.tabSearchRow.hidden = !show;
      if (show) {
        els.tabSearchInput.focus();
      } else {
        els.tabSearchInput.value = "";
        applyTabFilter();
        els.btnTabSearch.focus();
      }
    });
  }
  if (els.tabSearchInput) {
    els.tabSearchInput.addEventListener("input", applyTabFilter);
    els.tabSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        els.tabSearchInput.value = "";
        applyTabFilter();
        els.tabSearchRow.hidden = true;
        els.btnTabSearch.focus();
      }
    });
  }
  if (els.btnCloseDuplicates) {
    els.btnCloseDuplicates.addEventListener("click", async () => {
      try {
        const closed = await closeDuplicateTabs();
        showToast(closed > 0 ? `Closed ${closed} duplicate tab${closed === 1 ? "" : "s"}` : "No duplicates found");
      } catch (err) {
        console.error("Close duplicates failed:", err);
        showToast("Couldn't close duplicates");
      }
      await refresh();
    });
  }
  if (els.btnExportTabs) {
    els.btnExportTabs.addEventListener("click", async () => {
      try {
        const text = await exportTabsToText();
        if (!text) {
          showToast("Nothing to copy");
          return;
        }
        await navigator.clipboard.writeText(text);
        const count = text.split("\n\n").length;
        showToast(`Copied ${count} tab${count === 1 ? "" : "s"} to clipboard`);
      } catch (err) {
        console.error("Export tabs failed:", err);
        showToast("Copy failed");
      }
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                   */
/* -------------------------------------------------------------------------- */

function formatSessionDate(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function buildSessionRow(session) {
  const li = document.createElement("li");
  li.className = "session-item";

  const header = document.createElement("div");
  header.className = "session-item-header";
  const name = document.createElement("span");
  name.className = "session-name";
  name.textContent = session.name;
  name.title = session.name;
  const meta = document.createElement("span");
  meta.className = "session-meta";
  meta.textContent = `${session.tabs.length} tab${session.tabs.length === 1 ? "" : "s"} · ${formatSessionDate(session.createdAt)}`;
  header.appendChild(name);
  header.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "session-actions";

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.textContent = "Open";
  openBtn.title = "Open these tabs alongside your current ones";
  openBtn.addEventListener("click", () => handleRestoreSession(session.id, "open"));

  const replaceBtn = document.createElement("button");
  replaceBtn.type = "button";
  replaceBtn.textContent = "Replace";
  replaceBtn.title = "Close this window's tabs and open these instead";
  replaceBtn.addEventListener("click", () => handleRestoreSession(session.id, "replace"));

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "session-delete";
  deleteBtn.textContent = "Delete";
  let confirmTimer = null;
  deleteBtn.addEventListener("click", async () => {
    if (!deleteBtn.classList.contains("confirm")) {
      deleteBtn.classList.add("confirm");
      deleteBtn.textContent = "Sure?";
      confirmTimer = setTimeout(() => {
        deleteBtn.classList.remove("confirm");
        deleteBtn.textContent = "Delete";
      }, 3000);
      return;
    }
    clearTimeout(confirmTimer);
    await deleteSession(session.id);
    showToast("Session deleted");
    await renderSessions();
  });

  actions.appendChild(openBtn);
  actions.appendChild(replaceBtn);
  actions.appendChild(deleteBtn);

  li.appendChild(header);
  li.appendChild(actions);
  return li;
}

async function renderSessions() {
  if (!els.sessionList) return;
  const sessions = await getSessions();
  els.sessionList.innerHTML = "";
  for (const session of sessions) {
    els.sessionList.appendChild(buildSessionRow(session));
  }
  if (els.sessionEmpty) {
    els.sessionEmpty.style.display = sessions.length ? "none" : "block";
  }
}

async function handleSaveSession() {
  try {
    const session = await saveSession(els.sessionNameInput ? els.sessionNameInput.value : "");
    if (els.sessionNameInput) els.sessionNameInput.value = "";
    showToast(`Saved "${session.name}" — ${session.tabs.length} tab${session.tabs.length === 1 ? "" : "s"}`);
    await renderSessions();
  } catch (err) {
    console.error("Save session failed:", err);
    showToast("Couldn't save session");
  }
}

async function handleRestoreSession(id, mode) {
  try {
    const opened = await restoreSession(id, mode);
    showToast(opened > 0 ? `Opened ${opened} tab${opened === 1 ? "" : "s"}` : "Couldn't restore session");
  } catch (err) {
    console.error("Restore session failed:", err);
    showToast("Couldn't restore session");
  }
  await refresh();
}

/* -------------------------------------------------------------------------- */
/* "Why won't this sleep" deep link                                           */
/* -------------------------------------------------------------------------- */

function flashElement(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("setting-flash");
  void el.offsetWidth; // restart animation
  el.classList.add("setting-flash");
}

function handleCurrentTabClick() {
  const reason = els.currentTabStatus ? els.currentTabStatus.dataset.reason : null;
  if (!reason) return;

  if (reason === "whitelisted") {
    if (els.whitelistSection) els.whitelistSection.open = true;
    flashElement(els.whitelistInput ? els.whitelistInput.closest(".whitelist-input-row") : null);
    return;
  }

  const toggleId = REASON_TO_TOGGLE[reason];
  if (!toggleId) return;
  if (els.settingsSection) els.settingsSection.open = true;
  const input = document.getElementById(toggleId);
  flashElement(input ? input.closest(".toggle-row") : null);
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

function requestHostPermission() {
  return new Promise((resolve) => {
    try {
      chrome.permissions.request({ origins: ["<all_urls>"] }, (granted) => resolve(!!granted));
    } catch (err) {
      resolve(false);
    }
  });
}

function bindToggles() {
  // Shared bindings
  bindToggle(els.autoSuspendToggle, "autoSuspendEnabled");
  bindSelect(els.suspendTimer, "suspendAfterMinutes", "number");
  bindToggle(els.protectMedia, "protectMedia");
  bindToggle(els.protectPinned, "protectPinned");
  bindToggle(els.protectActive, "protectActive");
  bindToggle(els.protectLocalUrls, "protectLocalUrls");

  // Real form detection reads page content, so it needs the optional host
  // permission — ask at toggle-time instead of install-time; without it we
  // keep the URL-path heuristic
  if (els.warnFormData) {
    els.warnFormData.addEventListener("change", async (e) => {
      if (e.target.checked) {
        const granted = await requestHostPermission();
        if (!granted) {
          e.target.checked = false;
          showToast("Form detection needs the optional permission");
          return;
        }
      }
      await saveSetting("warnFormData", e.target.checked);
    });
  }

  bindToggle(els.autoRestoreToggle, "autoRestore");
  bindToggle(els.suspendOnMinimize, "suspendOnMinimize");

  if (els.autoSuspendToggle) {
    els.autoSuspendToggle.addEventListener("change", () => refresh());
  }
  if (els.suspendTimer) {
    els.suspendTimer.addEventListener("change", () => refresh());
  }
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                       */
/* -------------------------------------------------------------------------- */

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
    } else if (els.shortcutPills) {
      els.shortcutPills.innerHTML = '<span class="kbd-pill">not set</span>';
    }

    // Clickable either way — Chrome only applies suggested_key at first
    // install, so users may need the shortcuts page to assign or change it
    if (els.shortcutRow) {
      els.shortcutRow.classList.add("shortcut-row--actionable");
      els.shortcutRow.title = "Click to customise the keyboard shortcut";
      els.shortcutRow.addEventListener("click", () => {
        chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
      });
    }
  } catch (err) {
    console.error("Failed to load shortcut hint:", err);
    if (els.shortcutPills) {
      els.shortcutPills.innerHTML = '<span class="kbd-pill">—</span>';
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Poll loop                                                                  */
/* -------------------------------------------------------------------------- */

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (document.hidden) return;
    refresh();
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/* -------------------------------------------------------------------------- */
/* Init                                                                       */
/* -------------------------------------------------------------------------- */

async function init() {
  initElements();
  restoreSections();
  await initTheme();
  await Promise.all([
    loadShortcutHint(),
    loadSettingsIntoUI(els),
    loadPopupWhitelist(),
    renderSessions(),
  ]);

  // Apply timer row state after settings loaded
  toggleTimerRow(els.autoSuspendToggle ? els.autoSuspendToggle.checked : true);
  bindToggles();

  if (els.btnSuspendOthers)
    els.btnSuspendOthers.addEventListener("click", handleSuspendOthers);
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
  if (els.btnSaveSession)
    els.btnSaveSession.addEventListener("click", handleSaveSession);
  if (els.sessionNameInput)
    els.sessionNameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSaveSession();
      }
    });
  if (els.currentTab)
    els.currentTab.addEventListener("click", handleCurrentTabClick);

  document.querySelectorAll("details.collapsible-section").forEach((d) => {
    d.addEventListener("toggle", persistSections);
  });

  bindTabTools();

  await refresh();
  startPolling();
}

document.addEventListener("DOMContentLoaded", init);
