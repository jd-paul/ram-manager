// Shared UI helpers for reading/writing settings in popup and settings pages
// Both pages must use these helpers to avoid duplicated logic.

import { getSettings, setSettings, DEFAULT_SETTINGS } from './storage.js';

/**
 * Load settings from storage and apply them to UI elements.
 * Fallbacks derive from DEFAULT_SETTINGS so UI and engine agree; a key absent
 * from DEFAULT_SETTINGS renders unchecked instead of defaulting to on.
 * @param {Object} els - map of element IDs to DOM elements
 * @returns {Promise<Object>} the loaded settings object
 */
export async function loadSettingsIntoUI(els) {
  const settings = await getSettings();

  // Auto Suspend
  if (els.autoSuspendToggle) {
    els.autoSuspendToggle.checked = settings.autoSuspendEnabled ?? DEFAULT_SETTINGS.autoSuspendEnabled;
  }
  if (els.suspendTimer) {
    els.suspendTimer.value = String(settings.suspendAfterMinutes ?? DEFAULT_SETTINGS.suspendAfterMinutes);
  }

  // Protection toggles
  if (els.protectMedia) {
    els.protectMedia.checked = settings.protectMedia ?? DEFAULT_SETTINGS.protectMedia;
  }
  if (els.protectPinned) {
    els.protectPinned.checked = settings.protectPinned ?? DEFAULT_SETTINGS.protectPinned;
  }
  if (els.protectActive) {
    els.protectActive.checked = settings.protectActive ?? DEFAULT_SETTINGS.protectActive;
  }
  if (els.protectLocalUrls) {
    els.protectLocalUrls.checked = settings.protectLocalUrls ?? DEFAULT_SETTINGS.protectLocalUrls;
  }
  if (els.warnFormData) {
    els.warnFormData.checked = settings.warnFormData ?? DEFAULT_SETTINGS.warnFormData;
  }

  // Suspend on minimize
  if (els.suspendOnMinimize) {
    els.suspendOnMinimize.checked = settings.suspendOnMinimize ?? DEFAULT_SETTINGS.suspendOnMinimize;
  }

  // Display toggles
  if (els.badgeCountToggle) {
    els.badgeCountToggle.checked = settings.badgeCountEnabled ?? DEFAULT_SETTINGS.badgeCountEnabled;
  }
  if (els.tabIconToggle) {
    els.tabIconToggle.checked = settings.changeTabIconWhenSuspended ?? DEFAULT_SETTINGS.changeTabIconWhenSuspended;
  }
  if (els.autoRestoreToggle) {
    els.autoRestoreToggle.checked = settings.autoRestore ?? DEFAULT_SETTINGS.autoRestore;
  }

  // Theme mode
  if (els.themeModeSelect) {
    els.themeModeSelect.value = settings.theme ?? DEFAULT_SETTINGS.theme;
  }

  return settings;
}

/**
 * Save a single setting key to storage.
 * @param {string} key
 * @param {*} value
 */
export async function saveSetting(key, value) {
  if (!(key in DEFAULT_SETTINGS)) {
    console.error(
      `settings-ui: refusing to save unknown setting "${key}" — add it to DEFAULT_SETTINGS in js/storage.js first`
    );
    return;
  }
  await setSettings({ [key]: value });
}

/**
 * Bind a checkbox toggle so changes auto-save to storage.
 * @param {HTMLInputElement} el
 * @param {string} settingKey
 */
export function bindToggle(el, settingKey) {
  if (!el) return;
  el.addEventListener('change', async (e) => {
    await saveSetting(settingKey, e.target.checked);
  });
}

/**
 * Bind a <select> so changes auto-save to storage.
 * @param {HTMLSelectElement} el
 * @param {string} settingKey
 * @param {'number'|'string'} [cast='number'] - cast selected value
 */
export function bindSelect(el, settingKey, cast = 'number') {
  if (!el) return;
  el.addEventListener('change', async (e) => {
    const raw = e.target.value;
    const value = cast === 'number' ? Number(raw) : raw;
    await saveSetting(settingKey, value);
  });
}
