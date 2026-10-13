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

/* -------------------------------------------------------------------------- */
/* List entries (whitelist / force list)                                      */
/*                                                                            */
/* Three entry shapes, matched against the full URL:                          */
/*   /pattern/        — regex (case-insensitive), e.g. /\/(login|checkout)\// */
/*   https://…        — URL prefix match                                      */
/*   example.com      — exact domain or parent domain                         */
/* -------------------------------------------------------------------------- */

export function isRegexEntry(entry) {
  return entry.length > 2 && entry.startsWith('/') && entry.endsWith('/');
}

export function isValidListEntry(input) {
  if (!input || typeof input !== 'string') return false;
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (isRegexEntry(trimmed)) {
    try {
      new RegExp(trimmed.slice(1, -1), 'i');
      return true;
    } catch {
      return false;
    }
  }
  if (/^https?:\/\//.test(trimmed)) {
    try {
      new URL(trimmed);
      return true;
    } catch {
      return false;
    }
  }
  if (/[\/\?:#@]/.test(trimmed)) return false;
  return trimmed.includes('.');
}

export function normalizeListEntry(input) {
  const trimmed = input.trim();
  // Regex entries are stored verbatim — lowercasing would mangle escapes
  // like \W → \w
  if (isRegexEntry(trimmed)) return trimmed;
  if (/^https?:\/\//.test(trimmed)) return trimmed.toLowerCase();
  return trimmed.toLowerCase().replace(/^www\./, '');
}

export function getEntryDisplayLabel(entry) {
  if (isRegexEntry(entry)) return entry;
  if (/^https?:\/\//.test(entry)) {
    try {
      const url = new URL(entry);
      const path = url.pathname + url.search;
      if (path.length > 30) return url.hostname + path.slice(0, 30) + '...';
      return url.hostname + path;
    } catch {
      return entry;
    }
  }
  return entry;
}

export function isWhitelisted(url, whitelist) {
  if (!url || !whitelist || !whitelist.length) return false;

  const lowerUrl = url.toLowerCase();

  for (const rawEntry of whitelist) {
    if (isRegexEntry(rawEntry)) {
      try {
        if (new RegExp(rawEntry.slice(1, -1), 'i').test(url)) return true;
      } catch {
        // Invalid regex never matches
      }
      continue;
    }

    const e = rawEntry.toLowerCase();

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

// Canonical name for engine code matching against any entry list (the
// force list included); isWhitelisted is the historical alias.
export const matchesEntryList = isWhitelisted;

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

/**
 * Smart-freezing master gate: when smartFreezingEnabled is off, the six
 * smart pre-freeze protections are treated as disabled everywhere, without
 * touching their stored values (sub-toggle choices survive power cycles).
 * @param {Object} settings
 * @returns {Object} settings, with smart checks forced off when gated
 */
export function gateSmartChecks(settings) {
  if (!settings || settings.smartFreezingEnabled) return settings;
  return {
    ...settings,
    protectForms: false,
    protectMediaElements: false,
    protectMeetingSites: false,
    protectMusicSites: false,
    protectLiveTitles: false,
    protectInteraction: false
  };
}
