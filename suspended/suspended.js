// Suspended page logic — reads query params and handles restore
// All restore data is embedded in the URL itself — no storage or tabId needed.

import { initTheme } from '../js/theme.js';

const params = new URLSearchParams(window.location.search);
const originalUrl = params.get('url');
const title = params.get('title');
const favicon = params.get('favicon');

const els = {
  favicon: document.getElementById('favicon'),
  title: document.getElementById('title'),
  url: document.getElementById('url'),
  btnRestore: document.getElementById('btn-restore')
};

async function init() {
  await initTheme();
  if (!originalUrl) {
    console.error('No restore URL in suspended page');
    els.title.textContent = 'Invalid tab';
    els.url.textContent = '—';
    els.btnRestore.disabled = true;
    return;
  }

  if (title) els.title.textContent = title;
  els.url.textContent = originalUrl;
  if (favicon && (favicon.startsWith('http://') || favicon.startsWith('https://') || favicon.startsWith('data:'))) {
    els.favicon.src = favicon;
    els.favicon.hidden = false;
  } else {
    els.favicon.hidden = true;
  }
}

async function handleRestore() {
  try {
    els.btnRestore.disabled = true;
    els.btnRestore.textContent = 'Restoring…';

    if (!originalUrl) {
      throw new Error('Missing original URL');
    }

    // Navigate this tab directly to the original URL — no storage lookup needed
    await chrome.tabs.update({ url: originalUrl });
  } catch (err) {
    console.error('Restore failed:', err);
    els.btnRestore.textContent = 'Restore Failed — Click to Retry';
    els.btnRestore.disabled = false;
  }
}

els.btnRestore.addEventListener('click', handleRestore);

init();
