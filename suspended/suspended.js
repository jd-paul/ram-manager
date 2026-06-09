// Suspended page logic — reads query params and handles restore
// All restore data is embedded in the URL itself — no storage or tabId needed.

import { initTheme } from '../js/theme.js';
import { getSettings } from '../js/storage.js';

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

  await updateTabFavicon();
}

async function updateTabFavicon() {
  try {
    const settings = await getSettings();
    if (!settings.changeTabIconWhenSuspended) return;

    if (!favicon || !(favicon.startsWith('http://') || favicon.startsWith('https://') || favicon.startsWith('data:'))) {
      return;
    }

    const dimmedFavicon = await createDimmedFavicon(favicon);
    const linkEl = document.querySelector('link[rel="icon"]');
    if (linkEl) {
      linkEl.href = dimmedFavicon;
    }
  } catch (err) {
    console.error('Failed to update tab favicon:', err);
  }
}

function createDimmedFavicon(faviconUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 32, 32);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(0, 0, 32, 32);
      try {
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        resolve(faviconUrl);
      }
    };
    img.onerror = () => resolve(faviconUrl);
    img.src = faviconUrl;
  });
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
