# Release Notes

> **Draft for the first GitHub release.** When ready: tag `v1.0.0` on `master`
> (`git tag -a v1.0.0 -m "Release v1.0.0" && git push origin v1.0.0`), publish a
> GitHub release with the body below, and attach `ram-manager-v1.0.0.zip`.

## v1.1.0 — The control update

A ground-up popup rebuild plus a safety pass — inspired by what the best
tab suspenders get right.

**Popup**

- Per-tab list for the current window: live countdown badges (`13m`, `Soon`,
  `Paused`), icon + label badges for every state (Asleep with duration,
  Active, Pinned, Audio, System, Local, Form, Whitelisted, Keep awake), hover
  actions to suspend or keep a tab awake
- Stats strip: sleeping / protected counts and memory saved today, with an
  "available" forecast for new users
- Suspend Others and Suspend All with live progress; Restore All; current-tab
  card that names exactly why a tab won't suspend and jumps to the setting
- Tab search, close exact-URL duplicates, export tabs to clipboard, and named
  sessions (open or replace)
- Quick Settings and Whitelist collapsible with animated chevrons; themed
  scrollbars on every page

**Safety**

- In-page "Suspending soon" banner with a Not-now button before auto-suspend
- Keep any tab awake from the popup (resets on browser restart)
- Real form protection: detects typed input before suspending (optional page
  access, requested only when you enable it; URL heuristic remains otherwise)
- Suspend on startup: after a browser restart, restored tabs you haven't
  viewed are re-suspended
- Smarter activity: pausing audio gives a tab a fresh countdown; idle clocks
  survive restarts
- Toolbar badge counts suspended tabs in the focused window (on by default);
  saved-today no longer double-counts rapid suspend cycles

**First run**

- Three-slide onboarding tour with transitions, opened automatically on
  install; keyboard-shortcut deep link (Chrome only applies default shortcuts
  at first install, so the tour and popup link straight to the shortcuts page)

**Permissions change**

- Added `scripting` (drives the warning banner and form detection) and
  optional `<all_urls>` host access, requested at toggle-time — never at
  install. Everything else unchanged: strict CSP, no remote code, zero
  dependencies.

## v1.0.0 — Initial release

First public release of RAM Manager.

**Core**

- Suspend the current tab, all other tabs, or all tabs at once — from the popup or with a keyboard shortcut (`Alt+Shift+X` by default)
- Auto-suspend after a configurable idle timeout (off by default; 30 minutes when enabled)
- One-click restore from a branded suspended page; optional auto-restore on tab focus

**Protections**

- Never suspends audible, pinned, or active tabs (individually configurable)
- Never touches internal pages (`chrome://`, `edge://`, extension pages, devtools, `file:`, `data:`, …) or private-network/local addresses
- Optional heuristic guard for login/signin/checkout/cart/payment pages
- Whitelist by domain or URL prefix

**Organization**

- Tab sessions: save a window and restore it later, close duplicate tabs, export tabs to the clipboard
- Stats dashboard: memory saved today and all time, weekly bar chart, top memory consumers, suspension timeline
- Optional toolbar badge showing the suspended tab count

**Looks**

- 28 built-in themes (9 light, 19 dark) with system light/dark mode
- Custom CSS snippets on every extension page

**Under the hood**

- Manifest V3 with strict CSP (`script-src 'self'`), no remote code, zero dependencies, no build step
- Minimal permissions: `tabs`, `storage`, `alarms`, `contextMenus` (the `downloads` permission and broad `web_accessible_resources` were deliberately removed for store compliance)
- Settings sync across signed-in browsers via `chrome.storage.sync`; export/import for backups
