# RAM Manager

Context document for AI coding agents working in this repository. Read this before making changes.

## What this project is

RAM Manager is a Chrome/Edge extension (Manifest V3) that suspends idle browser tabs to free memory, in the spirit of The Great Suspender (see `research/thegreatsuspender/` and `screenshots/competitor-*.png` for reference material gathered during development). It is a vanilla-JavaScript, zero-dependency project with no build step — the repo contents are the extension, loadable directly via "Load unpacked". v1.0.0 exists as `ram-manager-v1.0.0.zip` (gitignored) for distribution.

**Hard constraints — do not violate without asking:**

- Manifest V3 only; minimum Chrome 109. No background pages, no remote code, no `chrome.processes`.
- CSP: `script-src 'self'` — no inline scripts, no CDN scripts, no eval.
- No build tooling, no transpilation, no npm. Plain ES modules (`<script type="module">`).
- No automated tests exist. Verification is manual: load the extension in Chrome, exercise the feature, check the service worker console.

## How suspension works

The core mechanism is a **URL rewrite**, not native tab discard:

1. `freezeTab(tab)` (js/suspension.js) builds `suspended.html?url=<original>&title=<title>&favicon=<favicon>` and navigates the tab there with `chrome.tabs.update`.
2. All restore data lives in the suspended page's query string. `restoreTab` reads `url` back out of the current tab URL and navigates back — no storage lookup is required for restore.
3. `chrome.storage.local.frozenTabs` is a tabId → metadata map (originalUrl, title, favicon, frozenAt) kept **only for history/stats**, not for restore.

Why URL-rewrite instead of `chrome.tabs.discard`: it gives a branded placeholder page (favicon, title, one-click restore), a place to run the dimmed-favicon feature, and a reliable way to detect suspended tabs (`isFrozen` = URL starts with the suspended page prefix). Trade-offs: the tab's URL becomes a `chrome-extension://` URL (history/back-button pollution, the original page is fully reloaded on restore), and the tab must finish loading before it can be suspended (`freezeTab` throws on `status === 'loading'`).

## Repository layout

```
manifest.json          MV3 manifest: service worker, popup, options page, one command, CSP
background.js          Service worker — alarms/auto-suspend, context menus, keyboard command,
                       auto-restore, suspend-on-unfocus, badge, last-active tracking
suspended.html         Placeholder page shown in suspended tabs (restore lives in suspended/)
popup/                 Toolbar popup (popup.html/css/js)
dashboard/             Full-page stats dashboard with charts
settings/              Full settings page (settings.html/css/js, lucide.min.js icons)
js/                    Shared ES modules (see module map below)
themes/                28 catalogued theme CSS files (9 light, 19 dark) + legacy default.css/dark.css
snippets/              Optional user CSS snippets injected on extension pages
icons/, images/        Extension icons and logo assets
research/              Reference material (The Great Suspender source/analysis)
screenshots/           Competitor UI reference screenshots
.DOCUMENTATION/        All markdown docs (README, this file, guides, release notes) — hidden folder
anuppuccin-palettes.json  Unreferenced palette data used to author the themes — safe to ignore
```

## Module map (js/)

| Module | Exports | Notes |
|---|---|---|
| `storage.js` | `getSettings`, `setSettings`, `localGet/Set/Remove/GetAll`, `syncGet/Set/Remove/SetMultiple/GetAll`, `DEFAULT_SETTINGS` | Promise wrappers over callback-style `chrome.storage`. Settings merge stored sync values over `DEFAULT_SETTINGS`. |
| `tabs.js` | `getAllTabs`, `getSuspendedTabs`, `getCurrentTab`, `canSuspend`, `analyzeTab` | `analyzeTab` is the single source of protection rules — it returns `{ ok, reason }` and `canSuspend` wraps it. Every suspend path funnels through it. |
| `tablist.js` | `buildTabList`, `getSuspendableTabs`, `getSessions`, `saveSession`, `deleteSession`, `restoreSession`, `closeDuplicateTabs`, `exportTabsToText`, `parseFrozenTab`, `SESSIONS_KEY` | Popup view-models: per-tab status/reason/countdown rows (same rules + `tabLastActive` as the engine), flat sessions across all windows, duplicate closing, clipboard export. |
| `suspension.js` | `freezeTab`, `restoreTab`, `restoreAll`, `freezeAll`, `isFrozen`, `getFrozenOriginalUrl` | Core engine. `isFrozen` is a URL-prefix check. |
| `history.js` | `logHistory`, `updateBadge` | History writes are serialized through an in-memory promise queue (`_historyQueue`) to stop concurrent batch suspends from clobbering each other. Do not bypass. |
| `memory.js` | `getMemoryInfo`, `formatBytes`, `estimateMemory`, `getSavedMemoryToday` | Memory numbers are estimates only (see trade-offs). |
| `utils.js` | `ESTIMATED_BYTES_PER_TAB`, `getDomain`, `normalizeDomain`, `isWhitelisted`, `parseShortcut` | |
| `theme.js` | `initTheme`, `applyTheme`, `loadTheme`, `resolveThemeName`, theme catalog getters, snippet registration | Obsidian-style: injects one `<link>` to `themes/<id>.css` and sets `theme-light`/`theme-dark` + palette classes on `<html>`, mirrored to `<body>`. |
| `theme-fouc.js` | (none — IIFE) | Classic script loaded synchronously in `<head>` of every page; reads the cached class from `localStorage['ram-manager-theme-class']` and applies it before first paint. |
| `settings-ui.js` | `loadSettingsIntoUI`, `saveSetting`, `bindToggle`, `bindSelect` | Shared settings binding for popup and settings pages. Defaults derive from `DEFAULT_SETTINGS`; `saveSetting` refuses unknown keys. |

## UI pages

- **popup/popup.js** — current-tab card with protection-reason pill (click deep-links to the blocking setting), 3-stat strip (sleeping/protected/saved-or-forecast), Suspend Current / Suspend Others / Suspend All with live progress, Restore All, per-tab list for the current window (countdown badges, hover-suspend, click to focus/wake), tab search / close-duplicates / export-to-clipboard, sessions save/restore, whitelist editor, quick toggles, keyboard-shortcut display. Refreshes on a 5 s poll while open.
- **dashboard/dashboard.js** — saved-today / all-time stats, suspended/total tabs, active-vs-suspended donut, weekly bar chart, per-domain "top consumers", activity timeline.
- **settings/settings.js** — all settings, theme mode + light/dark flavor pickers, whitelist, data export/import (HTML5 anchor download; the `downloads` permission was deliberately removed), clear stats, reset settings.
- **suspended/suspended.js** — reads query params, renders restore UI, optionally dims the favicon via canvas (`changeTabIconWhenSuspended`).

Every page calls `initTheme()` on load and includes `js/theme-fouc.js` as a classic head script.

## Storage schema

**`chrome.storage.sync`** (roamed, quota-limited — keep values small):

| Key | Shape | Written by |
|---|---|---|
| settings keys | per `DEFAULT_SETTINGS` | `setSettings` / `bindToggle` / `bindSelect` |
| `whitelist` | string[] — domains (`normalizeDomain` form) or full URLs | popup.js, settings.js |
| `theme` | `'system'` or a theme id | applyTheme |
| `themeLightFlavor`, `themeDarkTheme` | theme id (used when `theme: 'system'`) | saveLightThemeFlavor / saveDarkThemeFlavor |

**`chrome.storage.local`** (per-device):

| Key | Shape | Notes |
|---|---|---|
| `tabLastActive` | `{ [tabId]: timestamp }` | Backbone of auto-suspend. Stamped on activate/create/URL change; pruned on tab close and at startup. |
| `frozenTabs` | `{ [tabId]: {originalUrl, title, favicon, frozenAt} }` | Metadata only; restore does not read it. |
| `suspensionHistory` | Array of `{action, tabId, url, domain, title, timestamp}`, capped at 500 entries (oldest dropped) | Source for dashboard timeline and "saved today". |
| `weeklySavings` | `{values: number[7], weekStart, lastUpdated}` | Bytes per weekday; week rollover zeroes it. |
| `savedMemoryAllTime` | number (bytes, estimated) | |
| `snippetFiles` | string[] — filenames under `snippets/` | |
| `tabSessions` | `{ id, name, createdAt, tabs: [{url, title, favIconUrl, pinned}] }[]`, capped at 20 (oldest dropped) | Popup sessions; saved flat across all windows, frozen/internal tabs excluded |

**`localStorage`** (page-origin only): `ram-manager-theme-class` — cached `theme-light`/`theme-dark` for FOUC prevention. Do not rename without updating `theme-fouc.js` and `theme.js` together. `ram-manager-popup-sections` — open/closed state of the popup's collapsible sections.

## Settings and defaults

From `js/storage.js` (`DEFAULT_SETTINGS`). Defaults are deliberate — conservative, protections on, automation off:

| Key | Default | Meaning |
|---|---|---|
| `autoSuspendEnabled` | `false` | 1-minute alarm tick suspends tabs idle past `suspendAfterMinutes` |
| `suspendAfterMinutes` | `30` | Idle threshold |
| `protectMedia` / `protectPinned` / `protectActive` | `true` | Skip audible / pinned / active tabs |
| `protectLocalUrls` | `true` | Skip localhost, 127.x, 10.x, 172.16–31.x, 192.168.x, file:// |
| `warnFormData` | `false` | Skip pages whose path contains /login /signin /checkout /cart /payment (heuristic) |
| `suspendOnMinimize` | `false` | Suspend tabs of a Chrome window when focus leaves it |
| `autoRestore` | `false` | Restore a suspended tab when it is activated |
| `theme` | `'system'` | |
| `badgeCountEnabled` | `false` | Toolbar badge = suspended tab count |
| `changeTabIconWhenSuspended` | `false` | Dim favicon on the suspended page |

Suspend paths that always apply regardless of settings: never suspend `chrome://`, `chrome-extension://` (including our own suspended page), `edge://`, `devtools://`, `about:`, `file://`, `data:`, `blob:`, `javascript:` URLs, already-discarded tabs, or tabs still loading.

## Conventions

- **Chrome APIs**: callback-style. `storage.js` wraps them in promises; elsewhere modules use `new Promise` around `chrome.tabs.query`-style calls. Follow whichever the surrounding file does.
- **Batching**: every multi-tab suspend loop uses `BATCH_SIZE = 5` to avoid hammering the tab strip.
- **After any suspend/restore**: call `updateBadge()` and refresh stats. History logging goes through `logHistory('suspend'|'restore', tab)` — never write `suspensionHistory` directly.
- **Comments**: sparse; section banners (`/* --- */`) are the house style in background.js and page scripts. Don't add narrating comments.
- **Settings plumbing**: new settings need (1) a key in `DEFAULT_SETTINGS`, (2) UI elements in both `settings/settings.html` and (if quick-access) `popup/popup.html`, (3) wiring via `loadSettingsIntoUI` + `bindToggle`/`bindSelect` in `settings-ui.js`, (4) respect in `background.js` suspend paths.
- **Themes**: add the CSS file to `themes/` and register it in `theme.js`'s `LIGHT_THEMES`/`DARK_THEMES` catalogue. `anuppuccin-palettes.json` is palette reference for authoring, not loaded by code.

## Gotchas and known issues

- **Settings defaults have one source of truth: `DEFAULT_SETTINGS`.** This was hard-won: `loadSettingsIntoUI` once hardcoded `?? true` fallbacks, so any toggle key absent from `DEFAULT_SETTINGS` (or stored as `null`) rendered checked while the engine treated it as off — and worse, `bindToggle`/`saveSetting` writes of unknown keys landed in sync storage but were silently dropped by `getSettings()`, so the feature saved yet never worked. Now the fallbacks derive from `DEFAULT_SETTINGS` and both `saveSetting` implementations log an error and refuse unknown keys. Still load-bearing: a setting key not in `DEFAULT_SETTINGS` does not exist as far as the engine is concerned — add it there first, then wire the UI.
- **Duplicated helpers** (leftover drift, refactor only with care): `getDomain` exists in `utils.js`, `memory.js`, and `history.js`; `getWeekStartDay`/`getDayIndex`/`getWeekStartTimestamp` are duplicated in `history.js` and `dashboard.js`. `background.js` imports `getDomain` from utils but also never uses some imports (`getSuspendedTabs`) — harmless.
- **History cap**: `suspensionHistory` is trimmed to 500 entries. Stats derived from it ("saved today", weekly bars, all-time) are only as complete as that window plus `savedMemoryAllTime`/`weeklySavings` accumulators.
- **Service worker lifecycle**: listeners are registered at module top level and an immediate init block (`setupAlarm(); initTabLastActive(); updateBadge()`) at the bottom of background.js covers reloads where `onInstalled` doesn't fire. Keep it that way — moving init behind `onInstalled` alone breaks reloaded workers.
- **`tabLastActive` is keyed by tabId**, which is only unique per session; the map is pruned on close/startup, so stale ids are mostly harmless.
- **Whitelist matching** (`utils.js isWhitelisted`): entries starting with `http(s)://` are prefix-matched against the full URL; everything else is matched as exact domain or parent domain (`example.com` also covers `www.example.com` after normalization).
- **The suspended tab counts as a normal tab** for `getAllTabs`, so stats/UI compute suspended-vs-active by `isFrozen` URL check, and `canSuspend` refuses already-frozen tabs. Keep any new tab iteration consistent with that.
- **Auto-suspend timer granularity**: the alarm fires once per minute; `tabLastActive` updates on activation, creation, and URL change only — scrolling/reading a page does not count as activity.
- **`.DOCUMENTATION/README.md` must stay UTF-8.** It used to be UTF-16 with only a title; it is now a full project README (badges, store link, features). If an edit tool mangles the encoding, convert back with `iconv -f UTF-16LE -t UTF-8`.

## Design trade-offs (accepted, don't "fix" silently)

- **All memory figures are estimates.** MV3 removed `chrome.processes`, so everything derives from `ESTIMATED_BYTES_PER_TAB = 75MB` (js/utils.js) times tab/suspend counts. The UI historically hid the "estimated" disclaimer — decide deliberately before surfacing it.
- **Suspend-by-navigation** (see "How suspension works") means restore is a full page reload; form state, media position, and JS state are lost. That is the product's intended behavior, and `warnFormData` exists only as a light guardrail.
- **Auto-restore is off by default** because restoring on activation makes the toggle shortcut (`Alt+Shift+X`) the saner primary flow.
- **Settings in `chrome.storage.sync`** are subject to sync quotas (~8KB/item, ~102KB total) — the whitelist lives there too, which bounds how many entries a user can practically have.
- **No tests, no CI.** Manual verification is the standard: reload the extension at `chrome://extensions`, open the service worker inspector, and exercise suspend/restore/settings/theme flows plus one restart (MV3 service workers are killed aggressively; the alarm and listeners must survive).

## Quick index for common tasks

| Task | Start here |
|---|---|
| Change/add a protection rule | `js/tabs.js` `canSuspend`, then the options passed in `background.js` |
| Add a setting | `js/storage.js` `DEFAULT_SETTINGS` → `settings-ui.js` → both HTML pages → `background.js` |
| Add a theme | `themes/<id>.css` + `js/theme.js` catalogue (pick light or dark list) |
| Change suspend/restore mechanics | `js/suspension.js`; check every caller (`background.js`, `popup/popup.js`) |
| Change stats/badges | `js/history.js` (logging, badge), `js/memory.js` (estimates), `dashboard/dashboard.js` (rendering) |
| Change the suspended placeholder | `suspended.html` + `suspended/suspended.js` + `suspended/suspended.css` |
| Release | Zip the repo root (same shape as `ram-manager-v1.0.0.zip`); manifest version is bumped by hand |
