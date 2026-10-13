// Injected on demand (chrome.scripting) into tabs, and kept resident on
// http(s) pages (re-injected after each navigation) so activity tracking is
// always live. Three jobs:
//   1. Activity heartbeats — typing/mouse/scroll/focus bumps the tab's idle
//      clock in the background worker, so "in use" beats "background position"
//   2. "Suspending soon" banner with a Not-now button (bumps the tab's clock)
//   3. Smart-state checks for the suspend pipeline: dirty forms, playing
//      media elements, live title changes, focused document
// Runs in an isolated world; the window guard keeps re-injection idempotent.

(function () {
  if (window.__ramManagerContent) return;
  window.__ramManagerContent = true;

  const BANNER_HOST_ID = 'ram-manager-banner-host';
  const BANNER_MS = 6000;
  const HEARTBEAT_MIN_INTERVAL_MS = 5000;

  let lastHeartbeatAt = 0;

  /* ------------------------------------------------------------------------ */
  /* Activity heartbeats                                                      */
  /* ------------------------------------------------------------------------ */

  function sendActivity() {
    const now = Date.now();
    if (now - lastHeartbeatAt < HEARTBEAT_MIN_INTERVAL_MS) return;
    lastHeartbeatAt = now;
    try {
      chrome.runtime.sendMessage({ action: 'ramTabActivity' }, () => {
        chrome.runtime.lastError; // listener may be gone — ignore
      });
    } catch (err) {
      // Extension context invalidated (reload/update) — go quiet
    }
  }

  window.addEventListener('keydown', sendActivity, { capture: true, passive: true });
  window.addEventListener('scroll', sendActivity, { capture: true, passive: true });
  window.addEventListener('focusin', sendActivity, { capture: true, passive: true });
  let mouseThrottle = 0;
  window.addEventListener('mousemove', () => {
    const now = Date.now();
    if (now - mouseThrottle < HEARTBEAT_MIN_INTERVAL_MS) return;
    mouseThrottle = now;
    sendActivity();
  }, { capture: true, passive: true });

  /* ------------------------------------------------------------------------ */
  /* Baseline snapshots for dirty-form detection                              */
  /* ------------------------------------------------------------------------ */

  const selectBaseline = new Map();
  const editableBaseline = new Map();

  function snapshotBaseline() {
    try {
      document.querySelectorAll('select').forEach((el, i) => {
        selectBaseline.set(el, { index: el.selectedIndex, value: el.value, key: i });
      });
      document.querySelectorAll('[contenteditable=""], [contenteditable="true"]').forEach((el, i) => {
        editableBaseline.set(el, { html: el.innerHTML, key: i });
      });
    } catch (err) {
      // Snapshot is best-effort; checks below degrade gracefully
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', snapshotBaseline, { once: true });
  } else {
    snapshotBaseline();
  }

  /* ------------------------------------------------------------------------ */
  /* Live title-change tracking                                               */
  /* ------------------------------------------------------------------------ */

  let lastTitleChangeAt = 0;

  function watchTitle() {
    const titleEl = document.querySelector('title');
    if (!titleEl) return;
    const observer = new MutationObserver(() => {
      lastTitleChangeAt = Date.now();
    });
    observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchTitle, { once: true });
  } else {
    watchTitle();
  }

  /* ------------------------------------------------------------------------ */
  /* Smart-state checks                                                       */
  /* ------------------------------------------------------------------------ */

  function isEditableTarget(el) {
    if (!el) return false;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag === 'input') {
      const type = (el.type || '').toLowerCase();
      return !['submit', 'button', 'hidden', 'file', 'image', 'reset', 'checkbox', 'radio'].includes(type);
    }
    return el.isContentEditable === true;
  }

  function hasBeforeUnloadHandler() {
    try {
      if (typeof window.onbeforeunload === 'function') return true;
      // Pages that register via addEventListener can't be enumerated from the
      // isolated world — dispatch a synthetic cancelable beforeunload and see
      // if a handler tries to block it (most draft-savers call preventDefault).
      const evt = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(evt);
      return evt.defaultPrevented === true || (typeof evt.returnValue === 'string' && evt.returnValue !== '');
    } catch (err) {
      return false;
    }
  }

  function hasDirtyFormData() {
    const fields = document.querySelectorAll('input, textarea');
    for (const el of fields) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'textarea') {
        if (el.value !== el.defaultValue) return true;
        continue;
      }
      const type = (el.type || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        if (el.checked !== el.defaultChecked) return true;
      } else if (
        type !== 'submit' && type !== 'button' && type !== 'hidden' &&
        type !== 'file' && type !== 'image' && type !== 'reset'
      ) {
        if (el.value !== el.defaultValue) return true;
      }
    }

    // Dropdowns whose selection changed since the page loaded
    for (const [el, baseline] of selectBaseline) {
      if (!el.isConnected) continue;
      if (el.selectedIndex !== baseline.index || el.value !== baseline.value) return true;
    }

    // Rich-text / contenteditable editors (Google Docs, Notion, …)
    for (const [el, baseline] of editableBaseline) {
      if (!el.isConnected) continue;
      if (el.innerHTML !== baseline.html) return true;
    }

    // Cursor is sitting in an editable field right now
    if (isEditableTarget(document.activeElement)) return true;

    // Page would warn about unsaved changes — treat as a draft
    if (hasBeforeUnloadHandler()) return true;

    return false;
  }

  function hasPlayingMedia() {
    const media = document.querySelectorAll('audio, video');
    for (const el of media) {
      if (!el.paused && !el.ended && el.readyState >= 2) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------------ */
  /* Suspend warning banner                                                   */
  /* ------------------------------------------------------------------------ */

  function removeBanner() {
    const host = document.getElementById(BANNER_HOST_ID);
    if (host) host.remove();
  }

  function showBanner() {
    // Don't nag in background tabs — the user can't see them anyway
    if (document.visibilityState !== 'visible') return;
    removeBanner();

    const host = document.createElement('div');
    host.id = BANNER_HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .wrap {
        position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
        display: flex; align-items: center; justify-content: center; gap: 12px;
        padding: 10px 16px; box-sizing: border-box;
        font: 600 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
        color: #fff; background: rgba(30, 27, 45, 0.95);
        border-bottom: 2px solid #7c5cff;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
      }
      .msg { display: flex; align-items: center; gap: 8px; }
      button {
        font: 600 12px/1 inherit; font-family: inherit;
        padding: 6px 12px; border: none; border-radius: 6px; cursor: pointer;
        color: #1e1b2d; background: #fff;
      }
      button:hover { background: #e9e4ff; }
    `;

    const wrap = document.createElement('div');
    wrap.className = 'wrap';

    const msg = document.createElement('span');
    msg.className = 'msg';
    msg.textContent = 'Suspending this tab soon to free memory';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Not now';
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'keepTabAwake' }, () => {
        removeBanner();
        chrome.runtime.lastError; // no listener on some paths — ignore
      });
    });

    wrap.appendChild(msg);
    wrap.appendChild(btn);
    shadow.appendChild(style);
    shadow.appendChild(wrap);

    (document.body || document.documentElement).appendChild(host);
    setTimeout(removeBanner, BANNER_MS);
  }

  /* ------------------------------------------------------------------------ */
  /* Message handling                                                         */
  /* ------------------------------------------------------------------------ */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.action === 'ramShowWarning') {
      showBanner();
      sendResponse({ ok: true });
    } else if (msg && msg.action === 'ramCheckTab') {
      let state;
      try {
        state = {
          hasFormData: hasDirtyFormData(),
          hasPlayingMedia: hasPlayingMedia(),
          hasFocus: document.hasFocus(),
          lastTitleChangeAt
        };
      } catch (err) {
        state = { error: String(err && err.message ? err.message : err) };
      }
      sendResponse(state);
    } else if (msg && msg.action === 'ramGetScroll') {
      sendResponse({ x: window.scrollX, y: window.scrollY });
    }
    // Synchronous responses — no return true needed
  });
})();
