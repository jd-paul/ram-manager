// Shared utility functions and constants

export const ESTIMATED_BYTES_PER_TAB = 75 * 1024 * 1024; // 75 MB

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

export function isWhitelisted(domain, whitelist) {
  const d = normalizeDomain(domain);
  for (const entry of whitelist) {
    const e = normalizeDomain(entry);
    if (d === e || d.endsWith('.' + e)) return true;
  }
  return false;
}
