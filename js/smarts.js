// Smart pre-freeze checks — the "is this tab actually safe to freeze" layer.
//
// analyzeTab() (js/tabs.js) covers sync tab metadata + URL heuristics. This
// module covers everything that requires looking INSIDE the page: dirty
// forms, playing media elements, live title changes, focused documents, and
// in-progress downloads.
//
// Policy (user-configured default): when an enabled check cannot run —
// missing page-access permission, injection failure, no response, or an
// in-page error — the tab is NOT frozen this pass. Unverifiable means unsafe.

/** A tab whose title keeps changing is "live" (dashboard, tracker) — don't freeze it while updating. */
export const LIVE_TITLE_WINDOW_MS = 10 * 60 * 1000;

const MESSAGE_TIMEOUT_MS = 1500;

export function hasAllUrlsPermission() {
  return new Promise((resolve) => {
    try {
      chrome.permissions.contains({ origins: ['<all_urls>'] }, (ok) => resolve(!!ok));
    } catch (err) {
      resolve(false);
    }
  });
}

export function requestAllUrlsPermission() {
  return new Promise((resolve) => {
    try {
      chrome.permissions.request({ origins: ['<all_urls>'] }, (ok) => resolve(!!ok));
    } catch (err) {
      resolve(false);
    }
  });
}

export function injectContentScript(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.scripting.executeScript(
        { target: { tabId }, files: ['js/content.js'] },
        () => resolve(!chrome.runtime.lastError)
      );
    } catch (err) {
      resolve(false);
    }
  });
}

export function sendTabMessage(tabId, message, timeoutMs = MESSAGE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(null); }
    }, timeoutMs);
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) resolve(null);
        else resolve(response || null);
      });
    } catch (err) {
      if (!settled) { settled = true; clearTimeout(timer); resolve(null); }
    }
  });
}

/**
 * Active tab IDs across every Chrome window.
 * @returns {Promise<Set<number>>}
 */
export function getActiveTabIds() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true }, (tabs) => {
      if (chrome.runtime.lastError) resolve(new Set());
      else resolve(new Set((tabs || []).map((t) => t.id).filter((id) => id != null)));
    });
  });
}

/**
 * True when any download is currently in progress.
 * @returns {Promise<boolean>}
 */
export function hasActiveDownloads() {
  return new Promise((resolve) => {
    try {
      chrome.downloads.search({ state: 'in_progress' }, (items) => {
        if (chrome.runtime.lastError) resolve(false);
        else resolve((items || []).length > 0);
      });
    } catch (err) {
      resolve(false);
    }
  });
}

function needsPageAccess(settings) {
  return Boolean(
    settings.protectForms ||
    settings.protectMediaElements ||
    settings.protectLiveTitles ||
    settings.protectInteraction
  );
}

/**
 * Run all enabled in-page checks against a tab.
 * @param {chrome.tabs.Tab} tab
 * @param {Object} settings
 * @returns {Promise<{ ok: boolean, unknown: boolean, reasons: string[] }>}
 *   ok=false + unknown=true  → a check couldn't run; skip this tab this pass
 *   ok=false + reasons=[...]  → tab is protected by a detected signal
 */
export async function checkTabSmart(tab, settings) {
  const reasons = [];

  if (settings.protectDownloads && await hasActiveDownloads()) {
    reasons.push('downloading');
  }

  if (!needsPageAccess(settings)) {
    return { ok: reasons.length === 0, unknown: false, reasons };
  }

  if (!/^https?:/.test(tab.url || '')) {
    // Non-web tabs (shouldn't reach here — analyzeTab filters them) — unverifiable
    return { ok: false, unknown: true, reasons };
  }

  if (!(await hasAllUrlsPermission())) {
    // An enabled check needs to read the page and we can't — skip on doubt
    return { ok: false, unknown: true, reasons };
  }

  if (!(await injectContentScript(tab.id))) {
    return { ok: false, unknown: true, reasons };
  }

  const res = await sendTabMessage(tab.id, { action: 'ramCheckTab' });
  if (!res || res.error) {
    return { ok: false, unknown: true, reasons };
  }

  if (settings.protectForms && res.hasFormData === true) {
    reasons.push('form-dirty');
  }
  if (settings.protectMediaElements && res.hasPlayingMedia === true) {
    reasons.push('media-playing');
  }
  if (settings.protectInteraction && res.hasFocus === true) {
    reasons.push('focused');
  }
  if (
    settings.protectLiveTitles &&
    typeof res.lastTitleChangeAt === 'number' &&
    res.lastTitleChangeAt > 0 &&
    Date.now() - res.lastTitleChangeAt < LIVE_TITLE_WINDOW_MS
  ) {
    reasons.push('live-title');
  }

  return { ok: reasons.length === 0, unknown: false, reasons };
}
