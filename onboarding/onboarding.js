// Onboarding slide controller — directional slide transitions with
// staggered per-element entrances. Shown once on install (background.js
// opens this page with ?reason=install).

import { initTheme } from '../js/theme.js';

const slides = Array.from(document.querySelectorAll('.onb-slide'));
const dotsEl = document.getElementById('onb-dots');
const btnNext = document.getElementById('btn-next');
const btnSkip = document.getElementById('btn-skip');
const btnShortcut = document.getElementById('btn-shortcut');

let current = 0;

function buildDots() {
  slides.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.className = 'onb-dot';
    dot.type = 'button';
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-label', `Go to slide ${i + 1}`);
    dot.addEventListener('click', () => goTo(i));
    dotsEl.appendChild(dot);
  });
}

function render() {
  slides.forEach((slide, i) => {
    slide.classList.toggle('is-active', i === current);
    if (i !== current) {
      slide.classList.remove('is-exit-left', 'is-exit-right');
    }
  });
  Array.from(dotsEl.children).forEach((dot, i) => {
    dot.classList.toggle('is-active', i === current);
  });
  btnNext.textContent = current === slides.length - 1 ? 'Get started' : 'Next';
}

function goTo(index) {
  if (index === current || index < 0 || index >= slides.length) return;
  const forward = index > current;
  const outgoing = slides[current];
  outgoing.classList.remove('is-active');
  outgoing.classList.add(forward ? 'is-exit-left' : 'is-exit-right');
  current = index;
  render();
}

function finish() {
  // Navigate this tab to the dashboard — the natural first stop
  chrome.tabs.update({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
}

function init() {
  buildDots();
  render();

  btnNext.addEventListener('click', () => {
    if (current === slides.length - 1) {
      finish();
    } else {
      goTo(current + 1);
    }
  });

  btnSkip.addEventListener('click', () => finish());

  if (btnShortcut) {
    btnShortcut.addEventListener('click', () => {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') {
      if (current === slides.length - 1) finish();
      else goTo(current + 1);
    } else if (e.key === 'ArrowLeft') {
      goTo(current - 1);
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await initTheme();
  init();
});
