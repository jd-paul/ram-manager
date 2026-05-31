// Settings page logic — auto-saves on change, manages whitelist, themes, and shortcuts

import { getSettings, setSettings, syncGet, syncSet } from '../js/storage.js';
import { getAvailableThemes, applyTheme, initTheme } from '../js/themes.js';

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
  whitelistInput: document.getElementById('whitelist-input'),
  whitelistAdd: document.getElementById('whitelist-add'),
  whitelistHint: document.getElementById('whitelist-hint'),
  whitelistList: document.getElementById('whitelist-list'),
  whitelistEmpty: document.getElementById('whitelist-empty'),
  themeSelect: document.getElementById('theme-select'),
  shortcutDisplay: document.getElementById('shortcut-display'),
  autoRestoreToggle: document.getElementById('auto-restore-toggle'),
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

  // Theme
  const savedTheme = currentSettings.theme ?? 'system';
  populateThemeSelect();
  els.themeSelect.value = savedTheme;

  // Auto-restore
  els.autoRestoreToggle.checked = currentSettings.autoRestore ?? false;

  // Whitelist
  whitelist = (await syncGet('whitelist')) || [];
  renderWhitelist();
}

function populateThemeSelect() {
  const available = getAvailableThemes(); // ['default', 'dark']
  const options = [
    { value: 'system', label: 'System' },
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
/* Shortcut display                                                           */
/* -------------------------------------------------------------------------- */

async function loadShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    const cmd = commands.find((c) => c.name === 'suspend-active-tab');
    els.shortcutDisplay.textContent = cmd?.shortcut || '—';
  } catch (err) {
    console.error('Failed to load shortcut:', err);
    els.shortcutDisplay.textContent = '—';
  }
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
    btn.textContent = 'Remove';
    btn.addEventListener('click', () => removeWhitelistDomain(domain));

    li.appendChild(span);
    li.appendChild(btn);
    els.whitelistList.appendChild(li);
  }
}

function showHint(message) {
  els.whitelistHint.textContent = message;
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

  // Theme
  els.themeSelect.addEventListener('change', async (e) => {
    const theme = e.target.value;
    await applyTheme(theme);
    currentSettings.theme = theme;
  });

  // Auto-restore
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
}

/* -------------------------------------------------------------------------- */
/* Start                                                                      */
/* -------------------------------------------------------------------------- */

init().catch((err) => console.error('Settings init failed:', err));
