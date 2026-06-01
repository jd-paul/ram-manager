// Theme loading, switching, system preference, and user snippet support
// Replaces js/themes.js with an Obsidian-style class-based + snippet system

const THEME_DIR = '../themes/';
const SNIPPET_DIR = '../snippets/';
const THEME_LINK_ID = 'ram-manager-theme';
const SNIPPET_CONTAINER_ID = 'ram-manager-snippets';

/**
 * Returns the list of available built-in theme names.
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
 * Maps a theme file name to the body class (theme-light / theme-dark).
 */
function getThemeClass(themeFileName) {
  if (themeFileName === 'dark') return 'theme-dark';
  return 'theme-light';
}

/**
 * Applies the theme class to <body> and injects the theme CSS <link>.
 */
export function loadTheme(themeName) {
  const resolved = resolveThemeName(themeName);
  const themeClass = getThemeClass(resolved);

  // 1. Update body class
  document.body.classList.remove('theme-light', 'theme-dark');
  document.body.classList.add(themeClass);

  // 2. Inject / swap theme CSS link
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
 * Discovers user snippets from the snippets/ folder and injects them.
 * In a Chrome extension we can't read the directory, so we maintain a
 * manifest of known snippet files in chrome.storage.local.
 * Users add snippet filenames via the settings page or manually register them.
 */
export async function loadSnippets() {
  let snippetFiles = [];
  try {
    const result = await chrome.storage.local.get('snippetFiles');
    snippetFiles = result.snippetFiles || [];
  } catch (err) {
    console.error('theme: failed to read snippet manifest:', err);
    return;
  }

  // Remove old snippet links
  let container = document.getElementById(SNIPPET_CONTAINER_ID);
  if (container) {
    container.remove();
  }

  if (snippetFiles.length === 0) return;

  container = document.createElement('div');
  container.id = SNIPPET_CONTAINER_ID;
  container.style.display = 'none';
  document.head.appendChild(container);

  for (const filename of snippetFiles) {
    const href = chrome.runtime.getURL(`${SNIPPET_DIR}${filename}`);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = href;
    container.appendChild(link);
  }
}

/**
 * Registers a snippet filename so it gets loaded on all pages.
 */
export async function registerSnippet(filename) {
  if (!filename || typeof filename !== 'string') return;
  const clean = filename.trim();
  if (!clean) return;

  let snippetFiles = [];
  try {
    const result = await chrome.storage.local.get('snippetFiles');
    snippetFiles = result.snippetFiles || [];
  } catch (err) {
    console.error('theme: failed to read snippet manifest:', err);
  }

  if (!snippetFiles.includes(clean)) {
    snippetFiles.push(clean);
    try {
      await chrome.storage.local.set({ snippetFiles });
    } catch (err) {
      console.error('theme: failed to save snippet manifest:', err);
    }
  }
}

/**
 * Unregisters a snippet filename.
 */
export async function unregisterSnippet(filename) {
  let snippetFiles = [];
  try {
    const result = await chrome.storage.local.get('snippetFiles');
    snippetFiles = (result.snippetFiles || []).filter((f) => f !== filename);
    await chrome.storage.local.set({ snippetFiles });
  } catch (err) {
    console.error('theme: failed to update snippet manifest:', err);
  }
}

/**
 * Returns the list of registered snippet filenames.
 */
export async function getRegisteredSnippets() {
  try {
    const result = await chrome.storage.local.get('snippetFiles');
    return result.snippetFiles || [];
  } catch (err) {
    console.error('theme: failed to read snippet manifest:', err);
    return [];
  }
}

/**
 * Persists the chosen theme to chrome.storage.sync and applies it immediately.
 */
export async function applyTheme(themeName) {
  try {
    await chrome.storage.sync.set({ theme: themeName });
  } catch (err) {
    console.error('theme: failed to save theme preference:', err);
  }
  loadTheme(themeName);
}

/**
 * Reads the saved theme from chrome.storage.sync and applies it.
 * Falls back to 'system' if nothing is stored.
 * Also loads user snippets and sets up system-preference listener.
 */
export async function initTheme() {
  let themeName = 'system';
  try {
    const result = await chrome.storage.sync.get('theme');
    if (result.theme !== undefined) {
      themeName = result.theme;
    }
  } catch (err) {
    console.error('theme: failed to read theme preference:', err);
  }

  loadTheme(themeName);
  await loadSnippets();

  // Re-apply automatically when the OS color scheme changes if user chose 'system'
  if (themeName === 'system') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => loadTheme('system');
    if (mq.addEventListener) {
      mq.addEventListener('change', handler);
    } else if (mq.addListener) {
      mq.addListener(handler);
    }
  }
}
