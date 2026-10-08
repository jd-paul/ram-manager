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
import { parseShortcut } from '../js/utils.js';

/* -------------------------------------------------------------------------- */
/* DOM refs                                                                   */
/* -------------------------------------------------------------------------- */

const els = {
  autoSuspendToggle: document.getElementById('auto-suspend-toggle'),
  suspendTimer: document.getElementById('suspend-timer'),
  suspendTimerRow: document.getElementById('suspend-timer-row'),
  protectMedia: document.getElementById('protect-media'),
  protectPinned: document.getElementById('protect-pinned'),
  protectActive: document.getElementById('protect-active'),
  protectLocalUrls: document.getElementById('protect-local-urls'),
  warnFormData: document.getElementById('warn-form-data'),
  suspendOnMinimize: document.getElementById('suspend-on-minimize'),
  suspendOnStartup: document.getElementById('suspend-on-startup'),
  whitelistInput: document.getElementById('whitelist-input'),
  whitelistAdd: document.getElementById('whitelist-add'),
  whitelistHint: document.getElementById('whitelist-hint'),
  whitelistList: document.getElementById('whitelist-list'),
  whitelistEmpty: document.getElementById('whitelist-empty'),
  themeModeSelect: document.getElementById('theme-mode-select'),
  lightFlavorRow: document.getElementById('light-flavor-row'),
  lightFlavorSelect: document.getElementById('light-flavor-select'),
  darkFlavorRow: document.getElementById('dark-flavor-row'),
  darkFlavorSelect: document.getElementById('dark-flavor-select'),
  badgeCountToggle: document.getElementById('badge-count-toggle'),
  tabIconToggle: document.getElementById('tab-icon-toggle'),
  autoRestoreToggle: document.getElementById('auto-restore-toggle'),
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
  toggleTimerRow(els.autoSuspendToggle.checked);

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

  // Keyboard shortcut
  await loadShortcutDisplay();
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

function isValidWhitelistEntry(input) {
  if (!input || typeof input !== 'string') return false;
  const trimmed = input.trim();
  if (!trimmed) return false;

  // Allow full URLs (must start with http:// or https://)
  if (/^https?:\/\//.test(trimmed)) {
    try {
      new URL(trimmed);
      return true;
    } catch {
      return false;
    }
  }

  // Allow domains (legacy behavior)
  if (/[\/\?:#@]/.test(trimmed)) return false;
  if (!trimmed.includes('.')) return false;
  return true;
}

function normalizeWhitelistEntry(input) {
  const trimmed = input.trim();
  // If it's a URL, return as-is (lowercased)
  if (/^https?:\/\//.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  // Otherwise treat as domain
  return trimmed.toLowerCase().replace(/^www\./, '');
}

function getWhitelistDisplayLabel(entry) {
  // If it's a URL, show a shortened version
  if (/^https?:\/\//.test(entry)) {
    try {
      const url = new URL(entry);
      const path = url.pathname + url.search;
      if (path.length > 30) {
        return url.hostname + path.slice(0, 30) + '...';
      }
      return url.hostname + path;
    } catch {
      return entry;
    }
  }
  return entry;
}

async function addWhitelistEntry() {
  const raw = els.whitelistInput.value;
  if (!isValidWhitelistEntry(raw)) {
    showHint('Enter a valid domain (e.g. example.com) or URL (e.g. https://youtube.com/watch?v=...)');
    return;
  }
  const entry = normalizeWhitelistEntry(raw);
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
    span.textContent = getWhitelistDisplayLabel(entry);
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
      'autoSuspendEnabled', 'suspendAfterMinutes', 'protectMedia', 'protectPinned',
      'protectActive', 'protectLocalUrls', 'warnFormData', 'suspendOnMinimize',
      'suspendOnStartup',
      'theme', 'autoRestore', 'badgeCountEnabled',
      'changeTabIconWhenSuspended', 'whitelist'
    ]);
    const knownLocalKeys = new Set([
      'suspensionHistory', 'savedMemoryAllTime', 'savedMemoryToday', 'tabLastActive',
      'lightThemeFlavor', 'darkThemeFlavor'
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

  // Auto Suspend
  els.autoSuspendToggle.addEventListener('change', async (e) => {
    toggleTimerRow(e.target.checked);
  });

  // Shared bindings (from settings-ui.js)
  bindToggle(els.autoSuspendToggle, 'autoSuspendEnabled');
  bindSelect(els.suspendTimer, 'suspendAfterMinutes', 'number');
  bindToggle(els.protectMedia, 'protectMedia');
  bindToggle(els.protectPinned, 'protectPinned');
  bindToggle(els.protectActive, 'protectActive');
  bindToggle(els.protectLocalUrls, 'protectLocalUrls');
  bindToggle(els.suspendOnMinimize, 'suspendOnMinimize');
  bindToggle(els.suspendOnStartup, 'suspendOnStartup');

  // Real form detection reads page content — request the optional host
  // permission at toggle-time; without it the URL heuristic still applies
  if (els.warnFormData) {
    els.warnFormData.addEventListener('change', async (e) => {
      if (e.target.checked) {
        let granted = false;
        try {
          granted = await new Promise((resolve) => {
            chrome.permissions.request({ origins: ['<all_urls>'] }, (ok) => resolve(!!ok));
          });
        } catch (err) {
          granted = false;
        }
        if (!granted) {
          e.target.checked = false;
          const row = e.target.closest('.setting-row');
          const desc = row ? row.querySelector('.setting-desc') : null;
          if (desc) {
            const original = desc.textContent;
            desc.textContent = 'Needs the optional page-access permission — allow it when prompted to enable';
            desc.style.color = 'var(--color-danger)';
            setTimeout(() => { desc.textContent = original; desc.style.color = ''; }, 4500);
          }
          return;
        }
      }
      await saveSetting('warnFormData', e.target.checked);
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

  // Whitelist
  els.whitelistAdd.addEventListener('click', addWhitelistEntry);
  els.whitelistInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addWhitelistEntry();
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
