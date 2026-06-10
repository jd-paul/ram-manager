// Shared utility functions and constants

export const ESTIMATED_BYTES_PER_TAB = 75 * 1024 * 1024; // 75 MB

/**
 * Parse a platform-specific Chrome shortcut string into individual key parts.
 *
 * Windows/Linux: "Ctrl+Shift+X" → ['Ctrl', 'Shift', 'X']
 * macOS:         "⇧⌘X"        → ['⇧', '⌘', 'X']
 * Single key:    "X"          → ['X']
 */
export function parseShortcut(shortcut) {
  if (!shortcut) return [];

  // Windows & Linux format (also handles F-keys, MediaPlayPause, etc.)
  if (shortcut.includes('+')) {
    return shortcut.split('+').map((s) => s.trim()).filter(Boolean);
  }

  // macOS format: modifier symbols followed by the key character
  const modifiers = [];
  for (const char of shortcut) {
    if ('⌘⌥⌃⇧'.includes(char)) {
      modifiers.push(char);
    }
  }
  const key = shortcut.replace(/[⌘⌥⌃⇧]/g, '').trim();
  if (key) modifiers.push(key);
  return modifiers;
}

export function getDomain(url) {
  try {
    if (!url) return 'unknown';
    const u = new URL(url);
    return u.hostname || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function normalizeDomain(input) {
  return input.trim().toLowerCase().replace(/^www\./, '');
}

export function isWhitelisted(url, whitelist) {
  if (!url || !whitelist || !whitelist.length) return false;

  const lowerUrl = url.toLowerCase();

  for (const entry of whitelist) {
    const e = entry.toLowerCase();

    // If entry is a full URL, check if the tab URL starts with it (prefix match)
    if (/^https?:\/\//.test(e)) {
      if (lowerUrl.startsWith(e)) return true;
      continue;
    }

    // Otherwise treat as domain: exact match or subdomain match
    try {
      const urlObj = new URL(lowerUrl);
      const hostname = urlObj.hostname;
      if (hostname === e || hostname.endsWith('.' + e)) return true;
    } catch {
      // Invalid URL, skip domain matching
    }
  }

  return false;
}
