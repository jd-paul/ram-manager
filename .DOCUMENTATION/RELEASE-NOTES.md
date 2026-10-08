# Release Notes

> **Draft for the first GitHub release.** When ready: tag `v1.0.0` on `master`
> (`git tag -a v1.0.0 -m "Release v1.0.0" && git push origin v1.0.0`), publish a
> GitHub release with the body below, and attach `ram-manager-v1.0.0.zip`.

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
