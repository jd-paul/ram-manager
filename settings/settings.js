// Settings page logic — auto-saves on change, manages whitelist, themes, shortcuts, and data

import { getSettings, setSettings, syncGet, syncSet, localGetAll, localSet, localRemove } from '../js/storage.js';
import {
  getAvailableThemes,
  applyTheme,
  initTheme,
} from '../js/theme.js';

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
  warnFormData: document.getElementById('warn-form-data'),
  whitelistInput: document.getElementById('whitelist-input'),
  whitelistAdd: document.getElementById('whitelist-add'),
  whitelistHint: document.getElementById('whitelist-hint'),
  whitelistList: document.getElementById('whitelist-list'),
  whitelistEmpty: document.getElementById('whitelist-empty'),
  themeSelect: document.getElementById('theme-select'),
  shortcutDisplay: document.getElementById('shortcut-display'),
  badgeCountToggle: document.getElementById('badge-count-toggle'),
  tabIconToggle: document.getElementById('tab-icon-toggle'),
  autoRestoreToggle: document.getElementById('auto-restore-toggle'),
  exportData: document.getElementById('export-data'),
  importData: document.getElementById('import-data'),
  clearStats: document.getElementById('clear-stats'),
  dataHint: document.getElementById('data-hint'),
};

let currentSettings = {};
let whitelist = [];

/* -------------------------------------------------------------------------- */
/* Init                                                                       */
/* -------------------------------------------------------------------------- */

async function init() {
  await initTheme();
  await loadSettings();
  await loadShortcut();
  bindEvents();
  lucide.createIcons();
}

/* -------------------------------------------------------------------------- */
/* Load settings into UI                                                      */
/* -------------------------------------------------------------------------- */

async function loadSettings() {
  currentSettings = await getSettings();

  // Auto Suspend
  els.autoSuspendToggle.checked = currentSettings.autoSuspendEnabled ?? true;
  toggleTimerRow(els.autoSuspendToggle.checked);
  const timerValue = currentSettings.suspendAfterMinutes ?? 30;
  els.suspendTimer.value = String(timerValue);

  // Protection
  els.protectMedia.checked = currentSettings.protectMedia ?? true;
  els.protectPinned.checked = currentSettings.protectPinned ?? true;
  els.protectActive.checked = currentSettings.protectActive ?? true;
  els.warnFormData.checked = currentSettings.warnFormData ?? true;

  // Display
  const savedTheme = currentSettings.theme ?? 'system';
  populateThemeSelect();
  els.themeSelect.value = savedTheme;
  els.badgeCountToggle.checked = currentSettings.badgeCountEnabled ?? true;
  els.tabIconToggle.checked = currentSettings.changeTabIconWhenSuspended ?? true;
  els.autoRestoreToggle.checked = currentSettings.autoRestore ?? false;

  // Whitelist
  whitelist = (await syncGet('whitelist')) || [];
  renderWhitelist();
}

function populateThemeSelect() {
  const available = getAvailableThemes(); // ['default', 'dark']
  const options = [
    { value: 'system', label: 'Auto (System)' },
    ...available.map((t) => ({
      value: t,
      label: t === 'default' ? 'Light' : t.charAt(0).toUpperCase() + t.slice(1),
    })),
  ];

  els.themeSelect.innerHTML = '';
  for (const opt of options) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    els.themeSelect.appendChild(option);
  }
}

/* -------------------------------------------------------------------------- */
/* Shortcut display — visual key pills                                        */
/* -------------------------------------------------------------------------- */

function isMac() {
  return navigator.platform?.toLowerCase().includes('mac') ||
         navigator.userAgent?.toLowerCase().includes('mac');
}

function formatShortcutForDisplay(shortcut) {
  if (shortcut === '—') return [{ label: '—', symbol: '—' }];

  const isMacOS = isMac();
  const keys = shortcut.split(/\+/).map(k => k.trim());

  return keys.map(key => {
    const lower = key.toLowerCase();

    if (lower === 'alt') {
      return isMacOS
        ? { label: 'Option', symbol: '⌥' }
        : { label: 'Alt', symbol: 'Alt' };
    }

    if (lower === 'ctrl') {
      return isMacOS
        ? { label: 'Control', symbol: '⌃' }
        : { label: 'Ctrl', symbol: 'Ctrl' };
    }

    if (lower === 'shift') {
      return isMacOS
        ? { label: 'Shift', symbol: '⇧' }
        : { label: 'Shift', symbol: 'Shift' };
    }

    if (lower === 'command' || lower === 'cmd' || lower === 'meta') {
      return { label: 'Command', symbol: '⌘' };
    }

    // Single letter or other key
    return { label: key.toUpperCase(), symbol: key.toUpperCase() };
  });
}

async function loadShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    const cmd = commands.find((c) => c.name === 'suspend-active-tab');
    const shortcut = cmd?.shortcut || '—';

    const keys = formatShortcutForDisplay(shortcut);

    els.shortcutDisplay.innerHTML = keys.map((k, i) => {
      const pill = `<span class="key-pill" title="${escapeHtml(k.label)}">${escapeHtml(k.symbol)}</span>`;
      const plus = i < keys.length - 1 ? '<span class="key-plus">+</span>' : '';
      return pill + plus;
    }).join('');
  } catch (err) {
    console.error('Failed to load shortcut:', err);
    els.shortcutDisplay.innerHTML = '<span class="key-pill">—</span>';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/* -------------------------------------------------------------------------- */
/* Auto-save helpers                                                          */
/* -------------------------------------------------------------------------- */

async function saveSetting(key, value) {
  currentSettings[key] = value;
  await setSettings({ [key]: value });
}

/* -------------------------------------------------------------------------- */
/* Whitelist                                                                  */
/* -------------------------------------------------------------------------- */

function isValidDomain(input) {
  if (!input || typeof input !== 'string') return false;
  const trimmed = input.trim();
  if (!trimmed) return false;
  // Reject protocols, paths, queries
  if (/[\/\?:#@]/.test(trimmed)) return false;
  // Must contain at least one dot (e.g. example.com)
  if (!trimmed.includes('.')) return false;
  return true;
}

function normalizeDomain(input) {
  return input.trim().toLowerCase().replace(/^www\./, '');
}

async function addWhitelistDomain() {
  const raw = els.whitelistInput.value;
  if (!isValidDomain(raw)) {
    showHint('Enter a valid domain (e.g. example.com)');
    return;
  }
  const domain = normalizeDomain(raw);
  if (whitelist.includes(domain)) {
    showHint('Domain already whitelisted');
    return;
  }
  whitelist.push(domain);
  await syncSet('whitelist', whitelist);
  els.whitelistInput.value = '';
  showHint('');
  renderWhitelist();
}

async function removeWhitelistDomain(domain) {
  whitelist = whitelist.filter((d) => d !== domain);
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

  for (const domain of whitelist) {
    const li = document.createElement('li');
    li.className = 'whitelist-item';

    const span = document.createElement('span');
    span.textContent = domain;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--danger';
    btn.innerHTML = '<i data-lucide="x" class="lucide btn-icon"></i> Remove';
    btn.addEventListener('click', () => removeWhitelistDomain(domain));

    li.appendChild(span);
    li.appendChild(btn);
    els.whitelistList.appendChild(li);
  }

  // Re-init lucide icons for dynamically added content
  lucide.createIcons();
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
  try {
    const data = await localGetAll();
    // Also include sync settings
    const syncData = await syncGet(null);
    const exportPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      local: data,
      sync: syncData || {},
    };

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().split('T')[0];
    await chrome.downloads.download({
      url,
      filename: `ram-manager-backup-${date}.json`,
      saveAs: true,
    });
    showDataHint('Data exported successfully');
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Export failed:', err);
    showDataHint('Export failed: ' + err.message, true);
  }
}

async function importData(file) {
  try {
    const text = await file.text();
    const payload = JSON.parse(text);

    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid file format');
    }

    // Validate version
    if (payload.version !== 1) {
      throw new Error('Unsupported backup version');
    }

    // Merge local data
    if (payload.local && typeof payload.local === 'object') {
      for (const [key, value] of Object.entries(payload.local)) {
        await localSet(key, value);
      }
    }

    // Merge sync data (settings)
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
    await localRemove('savedMemoryToday');
    await localRemove('tabLastActive');
    showDataHint('Statistics cleared successfully');
  } catch (err) {
    console.error('Clear stats failed:', err);
    showDataHint('Failed to clear statistics: ' + err.message, true);
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
  // Auto Suspend
  els.autoSuspendToggle.addEventListener('change', async (e) => {
    toggleTimerRow(e.target.checked);
    await saveSetting('autoSuspendEnabled', e.target.checked);
  });

  els.suspendTimer.addEventListener('change', async (e) => {
    await saveSetting('suspendAfterMinutes', Number(e.target.value));
  });

  // Protection
  els.protectMedia.addEventListener('change', async (e) => {
    await saveSetting('protectMedia', e.target.checked);
  });
  els.protectPinned.addEventListener('change', async (e) => {
    await saveSetting('protectPinned', e.target.checked);
  });
  els.protectActive.addEventListener('change', async (e) => {
    await saveSetting('protectActive', e.target.checked);
  });
  els.warnFormData.addEventListener('change', async (e) => {
    await saveSetting('warnFormData', e.target.checked);
  });

  // Display
  els.themeSelect.addEventListener('change', async (e) => {
    const theme = e.target.value;
    await applyTheme(theme);
    currentSettings.theme = theme;
  });
  els.badgeCountToggle.addEventListener('change', async (e) => {
    await saveSetting('badgeCountEnabled', e.target.checked);
  });
  els.tabIconToggle.addEventListener('change', async (e) => {
    await saveSetting('changeTabIconWhenSuspended', e.target.checked);
  });
  els.autoRestoreToggle.addEventListener('change', async (e) => {
    await saveSetting('autoRestore', e.target.checked);
  });

  // Whitelist
  els.whitelistAdd.addEventListener('click', addWhitelistDomain);
  els.whitelistInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addWhitelistDomain();
    }
  });

  // Data Management
  els.exportData.addEventListener('click', exportData);
  els.importData.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      importData(file);
      e.target.value = ''; // reset so same file can be selected again
    }
  });
  els.clearStats.addEventListener('click', clearStatistics);
}

/* -------------------------------------------------------------------------- */
/* Start                                                                      */
/* -------------------------------------------------------------------------- */

init().catch((err) => console.error('Settings init failed:', err));
