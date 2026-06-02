// Suspended page logic — reads query params and handles restore

import { restoreTab } from '../js/suspension.js';
import { initTheme } from '../js/theme.js';

const params = new URLSearchParams(window.location.search);
const tabId = Number(params.get('tabId'));
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
  if (!tabId || isNaN(tabId) || tabId <= 0) {
    console.error('Invalid tabId in suspended page');
    els.title.textContent = 'Invalid tab';
    els.url.textContent = '—';
    els.btnRestore.disabled = true;
    return;
  }

  if (title) els.title.textContent = title;
  if (originalUrl) els.url.textContent = originalUrl;
  if (favicon) {
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

    if (!tabId || isNaN(tabId) || tabId <= 0) {
      throw new Error('Missing or invalid tab ID');
    }

    if (!originalUrl) {
      throw new Error('Missing original URL');
    }

    await restoreTab(tabId);
  } catch (err) {
    console.error('Restore failed:', err);
    els.btnRestore.textContent = 'Restore Failed — Click to Retry';
    els.btnRestore.disabled = false;
  }
}

els.btnRestore.addEventListener('click', handleRestore);

init();
