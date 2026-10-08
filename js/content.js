// Injected on demand (chrome.scripting) into tabs about to be auto-suspended.
// Two jobs:
//   1. "Suspending soon" banner with a Not-now button (bumps the tab's clock)
//   2. Dirty-form check (input.value vs defaultValue, checkbox/radio state)
// Runs in an isolated world; the window guard keeps re-injection idempotent.

(function () {
  if (window.__ramManagerContent) return;
  window.__ramManagerContent = true;

  const BANNER_HOST_ID = 'ram-manager-banner-host';
  const BANNER_MS = 6000;

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
    return false;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.action === 'ramShowWarning') {
      showBanner();
      sendResponse({ ok: true });
    } else if (msg && msg.action === 'ramCheckForm') {
      let dirty = false;
      try {
        dirty = hasDirtyFormData();
      } catch (e) {
        dirty = false;
      }
      sendResponse({ hasFormData: dirty });
    }
    // Synchronous responses — no return true needed
  });
})();
