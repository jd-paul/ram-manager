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

/* -------------------------------------------------------------------------- */
/* Site-category heuristics                                                   */
/*                                                                            */
/* Hostname lists matched as exact host or subdomain (e.g. "zoom.us" matches  */
/* "us02web.zoom.us"). Real media/WebRTC state isn't reliably observable by   */
/* extensions, so meeting/music protection is pattern-based.                  */
/* -------------------------------------------------------------------------- */

export const MEETING_HOSTS = [
  'meet.google.com',
  'zoom.us',
  'teams.microsoft.com',
  'teams.live.com',
  'webex.com',
  'discord.com',
  'discordapp.com',
  'slack.com',
  'messenger.com',
  'whatsapp.com',
  'web.whatsapp.com',
  'gather.town',
  'daily.co',
  'jit.si',
  'whereby.com',
  'goto.com',
  'ringcentral.com',
  'bluejeans.com'
];

export const MUSIC_HOSTS = [
  'music.youtube.com',
  'open.spotify.com',
  'spotify.com',
  'music.apple.com',
  'soundcloud.com',
  'tidal.com',
  'deezer.com',
  'pandora.com',
  'music.amazon.com',
  'iheart.com',
  'tunein.com',
  'last.fm',
  'bandcamp.com',
  'live365.com',
  'siriusxm.com'
];

/**
 * True when the URL's hostname is one of the given hosts or a subdomain of one.
 * @param {string} url
 * @param {string[]} hosts
 * @returns {boolean}
 */
export function matchesHostCategory(url, hosts) {
  if (!url) return false;
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return hosts.some((h) => hostname === h || hostname.endsWith('.' + h));
}
