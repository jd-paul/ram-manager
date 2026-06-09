// Shared UI helpers for reading/writing settings in popup and settings pages
// Both pages must use these helpers to avoid duplicated logic.

import { getSettings, setSettings } from './storage.js';

/**
 * Load settings from storage and apply them to UI elements.
 * @param {Object} els - map of element IDs to DOM elements
 * @returns {Promise<Object>} the loaded settings object
 */
export async function loadSettingsIntoUI(els) {
  const settings = await getSettings();

  // Auto Suspend
  if (els.autoSuspendToggle) {
    els.autoSuspendToggle.checked = settings.autoSuspendEnabled ?? true;
  }
  if (els.suspendTimer) {
    els.suspendTimer.value = String(settings.suspendAfterMinutes ?? 30);
  }

  // Protection toggles
  if (els.protectMedia) {
    els.protectMedia.checked = settings.protectMedia ?? true;
  }
  if (els.protectPinned) {
    els.protectPinned.checked = settings.protectPinned ?? true;
  }
  if (els.protectActive) {
    els.protectActive.checked = settings.protectActive ?? true;
  }
  if (els.protectLocalUrls) {
    els.protectLocalUrls.checked = settings.protectLocalUrls ?? true;
  }
  if (els.warnFormData) {
    els.warnFormData.checked = settings.warnFormData ?? true;
  }

  // Suspend on minimize
  if (els.suspendOnMinimize) {
    els.suspendOnMinimize.checked = settings.suspendOnMinimize ?? false;
  }

  // Display toggles
  if (els.badgeCountToggle) {
    els.badgeCountToggle.checked = settings.badgeCountEnabled ?? true;
  }
  if (els.tabIconToggle) {
    els.tabIconToggle.checked = settings.changeTabIconWhenSuspended ?? true;
  }
  if (els.autoRestoreToggle) {
    els.autoRestoreToggle.checked = settings.autoRestore ?? false;
  }

  // Theme mode
  if (els.themeModeSelect) {
    els.themeModeSelect.value = settings.theme ?? 'system';
  }

  return settings;
}

/**
 * Save a single setting key to storage.
 * @param {string} key
 * @param {*} value
 */
export async function saveSetting(key, value) {
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
