// Theme loading, switching, and system preference support
// Injected into pages (popup, dashboard, settings) via ES module import

const THEME_DIR = '../themes/';
const THEME_LINK_ID = 'ram-manager-theme';

/**
 * Returns the list of available built-in theme names.
 * Post-MVP: scan the themes/ folder dynamically.
 */
export function getAvailableThemes() {
  return ['default', 'dark'];
}

/**
 * Resolves a theme name to the actual CSS file name.
 * 'system' resolves based on prefers-color-scheme.
 */
export function resolveThemeName(themeName) {
  if (themeName === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'default';
  }
  return themeName;
}

/**
 * Injects (or swaps) the theme CSS <link> into the current document.
 * Creates the element if absent; updates href otherwise.
 */
export function loadTheme(themeName) {
  const resolved = resolveThemeName(themeName);
  const href = chrome.runtime.getURL(`${THEME_DIR}${resolved}.css`);

  let link = document.getElementById(THEME_LINK_ID);
  if (!link) {
    link = document.createElement('link');
    link.id = THEME_LINK_ID;
    link.rel = 'stylesheet';
    link.type = 'text/css';
    document.head.appendChild(link);
  }
  link.href = href;
}

/**
 * Persists the chosen theme to chrome.storage.sync and applies it immediately.
 */
export async function applyTheme(themeName) {
  try {
    await chrome.storage.sync.set({ theme: themeName });
  } catch (err) {
    console.error('themes: failed to save theme preference:', err);
  }
  loadTheme(themeName);
}

/**
 * Reads the saved theme from chrome.storage.sync and applies it.
 * Falls back to 'system' if nothing is stored.
 * Also sets up a listener for system preference changes when theme is 'system'.
 */
export async function initTheme() {
  let themeName = 'system';
  try {
    const result = await chrome.storage.sync.get('theme');
    if (result.theme !== undefined) {
      themeName = result.theme;
    }
  } catch (err) {
    console.error('themes: failed to read theme preference:', err);
  }

  loadTheme(themeName);

  // Re-apply automatically when the OS color scheme changes if user chose 'system'
  if (themeName === 'system') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => loadTheme('system');
    if (mq.addEventListener) {
      mq.addEventListener('change', handler);
    } else if (mq.addListener) {
      // Legacy fallback
      mq.addListener(handler);
    }
  }
}
