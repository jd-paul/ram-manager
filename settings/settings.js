// Settings page logic — auto-saves on change, manages whitelist, themes, shortcuts, and data

import { getSettings, setSettings, syncGet, syncSet, localGetAll, localSet, localRemove, DEFAULT_SETTINGS } from '../js/storage.js';
import {
  getLightThemes,
  getDarkThemes,
  applyTheme,
  initTheme,
  saveLightThemeFlavor,
  saveDarkThemeFlavor,
  getSavedLightThemeAsync,
  getSavedDarkThemeAsync,
} from '../js/theme.js';
import { loadSettingsIntoUI, bindToggle, bindSelect } from '../js/settings-ui.js';
import { parseShortcut, isValidListEntry, normalizeListEntry, getEntryDisplayLabel } from '../js/utils.js';
import { hasAllUrlsPermission, requestAllUrlsPermission } from '../js/smarts.js';

/* -------------------------------------------------------------------------- */
/* DOM refs                                                                   */
/* -------------------------------------------------------------------------- */

const els = {
  smartFreezingToggle: document.getElementById('smart-freezing-toggle'),
  smartSubSettings: document.getElementById('smart-sub-settings'),
  suspendTimer: document.getElementById('suspend-timer'),
  suspendTimerRow: document.getElementById('suspend-timer-row'),
  protectMedia: document.getElementById('protect-media'),
  protectPinned: document.getElementById('protect-pinned'),
  protectActive: document.getElementById('protect-active'),
  protectLocalUrls: document.getElementById('protect-local-urls'),
  protectForms: document.getElementById('protect-forms'),
  protectMediaElements: document.getElementById('protect-media-elements'),
  protectMeetingSites: document.getElementById('protect-meeting-sites'),
  protectMusicSites: document.getElementById('protect-music-sites'),
  protectLiveTitles: document.getElementById('protect-live-titles'),
  protectInteraction: document.getElementById('protect-interaction'),
  grantPageAccess: document.getElementById('grant-page-access'),
  pageAccessHint: document.getElementById('page-access-hint'),
  whitelistInput: document.getElementById('whitelist-input'),
  whitelistAdd: document.getElementById('whitelist-add'),
  whitelistHint: document.getElementById('whitelist-hint'),
  whitelistList: document.getElementById('whitelist-list'),
  whitelistEmpty: document.getElementById('whitelist-empty'),
  forceListInput: document.getElementById('force-list-input'),
  forceListAdd: document.getElementById('force-list-add'),
  forceListHint: document.getElementById('force-list-hint'),
  forceListList: document.getElementById('force-list-list'),
  forceListEmpty: document.getElementById('force-list-empty'),
  themeModeSelect: document.getElementById('theme-mode-select'),
  lightFlavorRow: document.getElementById('light-flavor-row'),
  lightFlavorSelect: document.getElementById('light-flavor-select'),
  darkFlavorRow: document.getElementById('dark-flavor-row'),
  darkFlavorSelect: document.getElementById('dark-flavor-select'),
  badgeCountToggle: document.getElementById('badge-count-toggle'),
  tabIconToggle: document.getElementById('tab-icon-toggle'),
  autoRestoreToggle: document.getElementById('auto-restore-toggle'),
  discardFrozenToggle: document.getElementById('discard-frozen-toggle'),
  machineIdleToggle: document.getElementById('machine-idle-toggle'),
  exportData: document.getElementById('export-data'),
  importData: document.getElementById('import-data'),
  clearStats: document.getElementById('clear-stats'),
  resetSettings: document.getElementById('reset-settings'),
  dataHint: document.getElementById('data-hint'),
  linkDashboard: document.getElementById('link-dashboard'),
  shortcutDisplay: document.getElementById('shortcut-display'),
};

let currentSettings = {};
let whitelist = [];
let forceList = [];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function openPage(page) {
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url: chrome.runtime.getURL(page) });
  }
}

/* -------------------------------------------------------------------------- */
/* Init                                                                       */
/* -------------------------------------------------------------------------- */

async function init() {
  await initTheme();
  await loadSettings();
  bindEvents();
  if (typeof lucide !== 'undefined' && lucide.createIcons) {
    lucide.createIcons();
  }
}

/* -------------------------------------------------------------------------- */
/* Load settings into UI                                                      */
/* -------------------------------------------------------------------------- */

async function loadShortcutDisplay() {
  if (!els.shortcutDisplay) return;
  try {
    const commands = await new Promise((resolve) => {
      if (chrome.commands && chrome.commands.getAll) {
        chrome.commands.getAll(resolve);
      } else {
        resolve([]);
      }
    });
    const suspendCommand = commands.find((c) => c.name === 'suspend-active-tab');
    if (suspendCommand && suspendCommand.shortcut) {
      const parts = parseShortcut(suspendCommand.shortcut);
      els.shortcutDisplay.innerHTML = parts.map((part, i) =>
        `${i > 0 ? '<span class="key-plus">+</span>' : ''}<span class="key-pill">${part}</span>`
      ).join('');
    } else {
      els.shortcutDisplay.innerHTML = '<span class="key-pill">not set</span>';
    }
  } catch (err) {
    console.error('Failed to load shortcut display:', err);
    els.shortcutDisplay.innerHTML = '<span class="key-pill">—</span>';
  }
}

async function loadSettings() {
  currentSettings = await loadSettingsIntoUI(els);
  updateSmartUI(els.smartFreezingToggle.checked);

  // Display — theme mode + flavours
  populateFlavorSelects();
  updateFlavorVisibility(currentSettings.theme ?? 'system');

  const savedLight = await getSavedLightThemeAsync();
  const savedDark = await getSavedDarkThemeAsync();
  els.lightFlavorSelect.value = savedLight;
  els.darkFlavorSelect.value = savedDark;

  // Whitelist
  whitelist = (await syncGet('whitelist')) || [];
  renderWhitelist();

  // Force list
  forceList = (await syncGet('forceList')) || [];
  renderForceList();

  // Keyboard shortcut
  await loadShortcutDisplay();

  // Page-access permission status
  await updatePageAccessUI();
}

function populateFlavorSelects() {
  const lightThemes = getLightThemes();
  const darkThemes = getDarkThemes();

  els.lightFlavorSelect.innerHTML = '';
  for (const t of lightThemes) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.label;
    els.lightFlavorSelect.appendChild(opt);
  }

  els.darkFlavorSelect.innerHTML = '';
  for (const t of darkThemes) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.label;
    els.darkFlavorSelect.appendChild(opt);
  }
}

function updateFlavorVisibility(mode) {
  if (mode === 'system') {
    els.lightFlavorRow.style.display = '';
    els.darkFlavorRow.style.display = '';
    els.lightFlavorRow.style.opacity = '1';
    els.darkFlavorRow.style.opacity = '1';
    els.lightFlavorRow.style.pointerEvents = 'auto';
    els.darkFlavorRow.style.pointerEvents = 'auto';
  } else if (mode === 'light') {
    els.lightFlavorRow.style.display = '';
    els.darkFlavorRow.style.display = 'none';
  } else if (mode === 'dark') {
    els.lightFlavorRow.style.display = 'none';
    els.darkFlavorRow.style.display = '';
  }
}

/* -------------------------------------------------------------------------- */
/* Auto-save helpers                                                          */
/* -------------------------------------------------------------------------- */

async function saveSetting(key, value) {
  if (!(key in DEFAULT_SETTINGS)) {
    console.error(
      `settings: refusing to save unknown setting "${key}" — add it to DEFAULT_SETTINGS in js/storage.js first`
    );
    return;
  }
  currentSettings[key] = value;
  await setSettings({ [key]: value });
}

/* -------------------------------------------------------------------------- */
/* Whitelist                                                                  */
/* -------------------------------------------------------------------------- */

async function addWhitelistEntry() {
  const raw = els.whitelistInput.value;
  if (!isValidListEntry(raw)) {
    showHint('Enter a valid domain (example.com), URL prefix (https://…), or /regex/');
    return;
  }
  const entry = normalizeListEntry(raw);
  if (whitelist.includes(entry)) {
    showHint('Already whitelisted');
    return;
  }
  whitelist.push(entry);
  await syncSet('whitelist', whitelist);
  els.whitelistInput.value = '';
  showHint('');
  renderWhitelist();
}

async function removeWhitelistEntry(entry) {
  whitelist = whitelist.filter((d) => d !== entry);
  await syncSet('whitelist', whitelist);
  renderWhitelist();
}

function renderWhitelist() {
  els.whitelistList.innerHTML = '';
  if (whitelist.length === 0) {
    els.whitelistEmpty.style.display = 'block';
    return;
  }
  els.whitelistEmpty.style.display = 'none';

  for (const entry of whitelist) {
    const li = document.createElement('li');
    li.className = 'whitelist-item';

    const span = document.createElement('span');
    span.textContent = getEntryDisplayLabel(entry);
    span.title = entry; // full entry on hover

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--danger';
    btn.innerHTML = '<i data-lucide="x" class="lucide btn-icon"></i> Remove';
    btn.addEventListener('click', () => removeWhitelistEntry(entry));

    li.appendChild(span);
    li.appendChild(btn);
    els.whitelistList.appendChild(li);
  }

  if (typeof lucide !== 'undefined' && lucide.createIcons) {
    lucide.createIcons();
  }
}

function showHint(message) {
  els.whitelistHint.textContent = message;
}

/* -------------------------------------------------------------------------- */
/* Force list                                                                 */
/* -------------------------------------------------------------------------- */

function showForceListHint(message) {
  els.forceListHint.textContent = message;
}

async function addForceListEntry() {
  const raw = els.forceListInput.value;
  if (!isValidListEntry(raw)) {
    showForceListHint('Enter a valid domain (example.com), URL prefix (https://…), or /regex/');
    return;
  }
  const entry = normalizeListEntry(raw);
  if (forceList.includes(entry)) {
    showForceListHint('Already in the force list');
    return;
  }
  forceList.push(entry);
  await syncSet('forceList', forceList);
  els.forceListInput.value = '';
  showForceListHint('');
  renderForceList();
}

async function removeForceListEntry(entry) {
  forceList = forceList.filter((d) => d !== entry);
  await syncSet('forceList', forceList);
  renderForceList();
}

function renderForceList() {
  els.forceListList.innerHTML = '';
  if (forceList.length === 0) {
    els.forceListEmpty.style.display = 'block';
    return;
  }
  els.forceListEmpty.style.display = 'none';

  for (const entry of forceList) {
    const li = document.createElement('li');
    li.className = 'whitelist-item';

    const span = document.createElement('span');
    span.textContent = getEntryDisplayLabel(entry);
    span.title = entry;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--danger';
    btn.innerHTML = '<i data-lucide="x" class="lucide btn-icon"></i> Remove';
    btn.addEventListener('click', () => removeForceListEntry(entry));

    li.appendChild(span);
    li.appendChild(btn);
    els.forceListList.appendChild(li);
  }

  if (typeof lucide !== 'undefined' && lucide.createIcons) {
    lucide.createIcons();
  }
}

function showPageAccessHint(message, isError = false) {
  if (!els.pageAccessHint) return;
  els.pageAccessHint.textContent = message;
  els.pageAccessHint.style.color = isError ? 'var(--color-danger)' : 'var(--color-success)';
}

async function updatePageAccessUI() {
  if (!els.grantPageAccess) return;
  const granted = await hasAllUrlsPermission();
  els.grantPageAccess.disabled = granted;
  const label = document.getElementById('grant-page-access-label');
  if (label) label.textContent = granted ? 'Page Access Granted' : 'Grant Page Access';
  showPageAccessHint(
    granted
      ? 'Smart detection is active'
      : 'Not granted — smart protections will skip tabs they cannot verify'
  );
}

function showDataHint(message, isError = false) {
  els.dataHint.textContent = message;
  els.dataHint.style.color = isError ? 'var(--color-danger)' : 'var(--color-success)';
}

/* -------------------------------------------------------------------------- */
/* Data Management                                                            */
/* -------------------------------------------------------------------------- */

async function exportData() {
  let url;
  try {
    const data = await localGetAll();
    const syncData = await syncGet(null);
    const exportPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      local: data,
      sync: syncData || {},
    };

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
    url = URL.createObjectURL(blob);
    const date = new Date().toISOString().split('T')[0];
    const a = document.createElement('a');
    a.href = url;
    a.download = `ram-manager-backup-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showDataHint('Data exported successfully');
  } catch (err) {
    console.error('Export failed:', err);
    showDataHint('Export failed: ' + err.message, true);
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

async function importData(file) {
  try {
    const text = await file.text();
    const payload = JSON.parse(text);

    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid file format');
    }

    if (payload.version !== 1) {
      throw new Error('Unsupported backup version');
    }

    // Basic schema validation
    if (payload.local !== undefined && (typeof payload.local !== 'object' || payload.local === null)) {
      throw new Error('Invalid local data');
    }
    if (payload.sync !== undefined && (typeof payload.sync !== 'object' || payload.sync === null)) {
      throw new Error('Invalid sync data');
    }

    // Known/expected keys whitelist
    const knownSyncKeys = new Set([
      'smartFreezingEnabled', 'autoSuspendEnabled', 'suspendAfterMinutes', 'protectMedia', 'protectPinned',
      'protectActive', 'protectLocalUrls', 'protectForms', 'protectMediaElements',
      'protectMeetingSites', 'protectMusicSites', 'protectLiveTitles',
      'protectInteraction',
      'theme', 'autoRestore', 'badgeCountEnabled',
      'changeTabIconWhenSuspended', 'discardFrozenTabs', 'freezeOnlyWhenMachineIdle',
      'whitelist', 'forceList'
    ]);
    const knownLocalKeys = new Set([
      'suspensionHistory', 'savedMemoryAllTime', 'savedMemoryToday', 'tabLastActive',
      'lightThemeFlavor', 'darkThemeFlavor', 'smartFreezeSnoozeUntil'
    ]);

    function validateKeys(obj, allowed) {
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) {
          throw new Error(`Unexpected key in backup: ${key}`);
        }
      }
    }

    if (payload.local) validateKeys(payload.local, knownLocalKeys);
    if (payload.sync) validateKeys(payload.sync, knownSyncKeys);

    // Rough size guard (< 5 MB total string length)
    if (text.length > 5 * 1024 * 1024) {
      throw new Error('Backup file is too large');
    }

    if (payload.local && typeof payload.local === 'object') {
      for (const [key, value] of Object.entries(payload.local)) {
        await localSet(key, value);
      }
    }

    if (payload.sync && typeof payload.sync === 'object') {
      for (const [key, value] of Object.entries(payload.sync)) {
        await syncSet(key, value);
      }
    }

    showDataHint('Data imported successfully. Reloading...');
    setTimeout(() => window.location.reload(), 1200);
  } catch (err) {
    console.error('Import failed:', err);
    showDataHint('Import failed: ' + err.message, true);
  }
}

async function clearStatistics() {
  if (!confirm('Are you sure you want to clear all statistics? This will reset your suspension history and memory saved counters. Your settings and whitelist will be preserved.')) {
    return;
  }

  try {
    await localRemove('suspensionHistory');
    await localRemove('savedMemoryAllTime');
    await localRemove('tabLastActive');
    await localRemove('weeklySavings');
    showDataHint('Statistics cleared successfully');
  } catch (err) {
    console.error('Clear stats failed:', err);
    showDataHint('Failed to clear statistics: ' + err.message, true);
  }
}

async function resetSettingsToDefault() {
  if (!confirm('Are you sure you want to reset all settings to their default values? This will not affect your whitelist or statistics.')) {
    return;
  }

  try {
    await setSettings(DEFAULT_SETTINGS);
    showDataHint('Settings reset to defaults. Reloading...');
    setTimeout(() => window.location.reload(), 800);
  } catch (err) {
    console.error('Reset settings failed:', err);
    showDataHint('Failed to reset settings: ' + err.message, true);
  }
}

/* -------------------------------------------------------------------------- */
/* UI helpers                                                                 */
/* -------------------------------------------------------------------------- */

function toggleTimerRow(enabled) {
  els.suspendTimerRow.style.opacity = enabled ? '1' : '0.5';
  els.suspendTimerRow.style.pointerEvents = enabled ? 'auto' : 'none';
  els.suspendTimer.disabled = !enabled;
}

const SMART_SUB_TOGGLES = [
  'protectForms', 'protectMediaElements', 'protectMeetingSites',
  'protectMusicSites', 'protectLiveTitles', 'protectInteraction'
];

function updateSmartUI(enabled) {
  toggleTimerRow(enabled);
  if (els.smartSubSettings) {
    els.smartSubSettings.classList.toggle('smart-off', !enabled);
  }
  for (const key of SMART_SUB_TOGGLES) {
    if (els[key]) els[key].disabled = !enabled;
  }
}

/* -------------------------------------------------------------------------- */
/* Event binding                                                              */
/* -------------------------------------------------------------------------- */

function bindEvents() {
  // Header navigation
  if (els.linkDashboard) {
    els.linkDashboard.addEventListener('click', (e) => {
      e.preventDefault();
      openPage('dashboard/dashboard.html');
    });
  }

  // Smart Freezing master switch: powers auto-suspend and gates the smart
  // checks; sub-toggle choices are stored untouched and survive power cycles
  els.smartFreezingToggle.addEventListener('change', async (e) => {
    const on = e.target.checked;
    await saveSetting('smartFreezingEnabled', on);
    await saveSetting('autoSuspendEnabled', on);
    updateSmartUI(on);
  });

  // Shared bindings (from settings-ui.js)
  bindSelect(els.suspendTimer, 'suspendAfterMinutes', 'number');
  bindToggle(els.protectMedia, 'protectMedia');
  bindToggle(els.protectPinned, 'protectPinned');
  bindToggle(els.protectActive, 'protectActive');
  bindToggle(els.protectLocalUrls, 'protectLocalUrls');
  bindToggle(els.protectForms, 'protectForms');
  bindToggle(els.protectMediaElements, 'protectMediaElements');
  bindToggle(els.protectMeetingSites, 'protectMeetingSites');
  bindToggle(els.protectMusicSites, 'protectMusicSites');
  bindToggle(els.protectLiveTitles, 'protectLiveTitles');
  bindToggle(els.protectInteraction, 'protectInteraction');

  // Form/media/activity detection reads page content — request the optional
  // host permission here; without it those protections skip freezing on doubt
  if (els.grantPageAccess) {
    els.grantPageAccess.addEventListener('click', async () => {
      const granted = await requestAllUrlsPermission();
      if (!granted) {
        showPageAccessHint('Permission denied — smart protections will skip tabs they cannot verify', true);
        return;
      }
      await updatePageAccessUI();
    });
  }

  // Display — theme mode
  els.themeModeSelect.addEventListener('change', async (e) => {
    const mode = e.target.value;
    updateFlavorVisibility(mode);
    await saveSetting('theme', mode);

    if (mode === 'system') {
      // Re-apply using saved flavours
      await applyTheme('system');
    } else if (mode === 'light') {
      const flavor = els.lightFlavorSelect.value;
      await applyTheme(flavor);
    } else if (mode === 'dark') {
      const flavor = els.darkFlavorSelect.value;
      await applyTheme(flavor);
    }
  });

  // Light flavour
  els.lightFlavorSelect.addEventListener('change', async (e) => {
    const flavor = e.target.value;
    await saveLightThemeFlavor(flavor);
    const mode = els.themeModeSelect.value;
    if (mode === 'light') {
      await applyTheme(flavor);
    } else if (mode === 'system') {
      await applyTheme('system');
    }
  });

  // Dark flavour
  els.darkFlavorSelect.addEventListener('change', async (e) => {
    const flavor = e.target.value;
    await saveDarkThemeFlavor(flavor);
    const mode = els.themeModeSelect.value;
    if (mode === 'dark') {
      await applyTheme(flavor);
    } else if (mode === 'system') {
      await applyTheme('system');
    }
  });

  bindToggle(els.badgeCountToggle, 'badgeCountEnabled');
  bindToggle(els.tabIconToggle, 'changeTabIconWhenSuspended');
  bindToggle(els.autoRestoreToggle, 'autoRestore');
  bindToggle(els.discardFrozenToggle, 'discardFrozenTabs');
  bindToggle(els.machineIdleToggle, 'freezeOnlyWhenMachineIdle');

  // Whitelist
  els.whitelistAdd.addEventListener('click', addWhitelistEntry);
  els.whitelistInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addWhitelistEntry();
    }
  });

  // Force list events
  els.forceListAdd.addEventListener('click', addForceListEntry);
  els.forceListInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addForceListEntry();
    }
  });

  // Data Management
  els.exportData.addEventListener('click', exportData);
  els.importData.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      importData(file);
      e.target.value = '';
    }
  });
  els.clearStats.addEventListener('click', clearStatistics);
  if (els.resetSettings) {
    els.resetSettings.addEventListener('click', resetSettingsToDefault);
  }
}

/* -------------------------------------------------------------------------- */
/* Start                                                                      */
/* -------------------------------------------------------------------------- */

init().catch((err) => console.error('Settings init failed:', err));
