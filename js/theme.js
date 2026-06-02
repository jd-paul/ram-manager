// Theme loading, switching, system preference, and user snippet support
// Replaces js/themes.js with an Obsidian-style class-based + snippet system

const THEME_DIR = '../themes/';
const SNIPPET_DIR = '../snippets/';
const THEME_LINK_ID = 'ram-manager-theme';
const SNIPPET_CONTAINER_ID = 'ram-manager-snippets';

// ---------------------------------------------------------------------------
// Built-in theme catalogue (from AnuPpuccin Extended)
// ---------------------------------------------------------------------------

const LIGHT_THEMES = [
  { id: 'atom-light',        label: 'Atom' },
  { id: 'everforest-light',  label: 'Everforest' },
  { id: 'gruvbox-light',     label: 'Gruvbox' },
  { id: 'luminescence-light',label: 'Luminescence' },
  { id: 'material-mint-light',label: 'Material Mint' },
  { id: 'nord-light',        label: 'Nord' },
  { id: 'notion-light',      label: 'Notion' },
  { id: 'sandy-beaches-light',label: 'Sandy Beaches' },
  { id: 'solarized-light',   label: 'Solarized' },
];

const DARK_THEMES = [
  { id: 'amoled-dark',       label: 'AMOLED Dark' },
  { id: 'atom-dark',         label: 'Atom' },
  { id: 'biscuit-dark',      label: 'Biscuit' },
  { id: 'coffee-dark',       label: 'Coffee' },
  { id: 'dracula',           label: 'Dracula' },
  { id: 'everforest-dark',   label: 'Everforest' },
  { id: 'flexoki-dark',      label: 'Flexoki' },
  { id: 'generic-dark',      label: 'Dark (Generic)' },
  { id: 'gruvbox-dark',      label: 'Gruvbox' },
  { id: 'kanagawa-dark',     label: 'Kanagawa' },
  { id: 'material-mint-dark',label: 'Material Mint' },
  { id: 'nord-dark',         label: 'Nord' },
  { id: 'nord-darker',       label: 'Nord Darker' },
  { id: 'notion-dark',       label: 'Notion' },
  { id: 'rosebox',           label: 'Rosebox' },
  { id: 'rosepine-dark',     label: 'Rosé Pine' },
  { id: 'royal-velvet',      label: 'Royal Velvet' },
  { id: 'solarized-dark',    label: 'Solarized' },
  { id: 'thorns',            label: 'Thorns' },
];

const ALL_THEMES = [...LIGHT_THEMES, ...DARK_THEMES];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getLightThemes()  { return LIGHT_THEMES; }
export function getDarkThemes()   { return DARK_THEMES; }
export function getAllThemes()    { return ALL_THEMES; }

/**
 * Returns the list of available built-in theme names (legacy compat).
 */
export function getAvailableThemes() {
  return ALL_THEMES.map((t) => t.id);
}

/**
 * Resolves a theme name to the actual CSS file name.
 * 'system' resolves based on prefers-color-scheme and the user's saved flavours.
 */
export async function resolveThemeName(themeName) {
  if (themeName === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? await getSavedDarkThemeAsync() : await getSavedLightThemeAsync();
  }
  return themeName;
}

/**
 * Maps a theme file name to the body class (theme-light / theme-dark).
 */
function getThemeClass(themeFileName) {
  const theme = ALL_THEMES.find((t) => t.id === themeFileName);
  if (theme) {
    return LIGHT_THEMES.some((t) => t.id === themeFileName) ? 'theme-light' : 'theme-dark';
  }
  // Fallback for legacy 'default' / 'dark'
  if (themeFileName === 'dark') return 'theme-dark';
  return 'theme-light';
}

/**
 * Applies the theme class to <body> and injects the theme CSS <link>.
 * Also adds the palette-specific body class (e.g. 'dracula', 'nord-light').
 */
export async function loadTheme(themeName) {
  const resolved = await resolveThemeName(themeName);
  const themeClass = getThemeClass(resolved);
  const paletteClass = resolved; // e.g. 'dracula', 'nord-light'

  // 1. Update body classes — keep palette class for CSS scoping
  document.body.classList.remove('theme-light', 'theme-dark');
  document.body.classList.add(themeClass);

  // Remove old palette classes
  for (const t of ALL_THEMES) {
    document.body.classList.remove(t.id);
  }
  document.body.classList.add(paletteClass);

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

// ---------------------------------------------------------------------------
// Saved flavour preferences (used when theme is 'system')
// ---------------------------------------------------------------------------

const STORAGE_KEY_LIGHT = 'themeLightFlavor';
const STORAGE_KEY_DARK  = 'themeDarkFlavor';

function getSavedLightTheme() {
  // Cannot read storage synchronously; default to notion-light
  return 'notion-light';
}

function getSavedDarkTheme() {
  // Cannot read storage synchronously; default to notion-dark
  return 'notion-dark';
}

export async function getSavedLightThemeAsync() {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEY_LIGHT);
    return result[STORAGE_KEY_LIGHT] || 'notion-light';
  } catch {
    return 'notion-light';
  }
}

export async function getSavedDarkThemeAsync() {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEY_DARK);
    return result[STORAGE_KEY_DARK] || 'notion-dark';
  } catch {
    return 'notion-dark';
  }
}

export async function saveLightThemeFlavor(flavor) {
  try {
    await chrome.storage.sync.set({ [STORAGE_KEY_LIGHT]: flavor });
  } catch (err) {
    console.error('theme: failed to save light flavor:', err);
  }
}

export async function saveDarkThemeFlavor(flavor) {
  try {
    await chrome.storage.sync.set({ [STORAGE_KEY_DARK]: flavor });
  } catch (err) {
    console.error('theme: failed to save dark flavor:', err);
  }
}

// ---------------------------------------------------------------------------
// User snippets
// ---------------------------------------------------------------------------

export async function loadSnippets() {
  let snippetFiles = [];
  try {
    const result = await chrome.storage.local.get('snippetFiles');
    snippetFiles = result.snippetFiles || [];
  } catch (err) {
    console.error('theme: failed to read snippet manifest:', err);
    return;
  }

  let container = document.getElementById(SNIPPET_CONTAINER_ID);
  if (container) container.remove();
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

export async function getRegisteredSnippets() {
  try {
    const result = await chrome.storage.local.get('snippetFiles');
    return result.snippetFiles || [];
  } catch (err) {
    console.error('theme: failed to read snippet manifest:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Apply / init
// ---------------------------------------------------------------------------

export async function applyTheme(themeName) {
  try {
    await chrome.storage.sync.set({ theme: themeName });
  } catch (err) {
    console.error('theme: failed to save theme preference:', err);
  }
  const resolved = await resolveThemeName(themeName);
  await loadTheme(resolved);
}

export async function initTheme() {
  let themeName = 'system';
  try {
    const result = await chrome.storage.sync.get('theme');
    if (result.theme !== undefined) themeName = result.theme;
  } catch (err) {
    console.error('theme: failed to read theme preference:', err);
  }

  // If system, resolve using saved flavours
  if (themeName === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const flavor = prefersDark
      ? await getSavedDarkThemeAsync()
      : await getSavedLightThemeAsync();
    await loadTheme(flavor);
  } else {
    await loadTheme(themeName);
  }

  await loadSnippets();

  // Re-apply automatically when the OS color scheme changes if user chose 'system'
  if (themeName === 'system') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = async () => {
      const prefersDark = mq.matches;
      const flavor = prefersDark
        ? await getSavedDarkThemeAsync()
        : await getSavedLightThemeAsync();
      await loadTheme(flavor);
    };
    if (mq.addEventListener) {
      mq.addEventListener('change', handler);
    } else if (mq.addListener) {
      mq.addListener(handler);
    }
  }
}
