<div align="center">

<img src="images/logo-with-text.png" alt="RAM Manager" width="360">

**Suspend idle tabs to free memory. Lightweight, fast, and themeable.**

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/llaggikmbcdegbiaioghlmmafhhomnn?label=chrome%20web%20store&color=4285F4&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/ram-manager/llaggikmbcdegbiaioghlmmafhhomnnn)
[![Chrome Web Store Users](https://img.shields.io/chrome-web-store/users/llaggikmbcdegbiaioghlmmafhhomnn)](https://chromewebstore.google.com/detail/ram-manager/llaggikmbcdegbiaioghlmmafhhomnnn)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blueviolet)](#)

</div>

---

RAM Manager is a Chrome/Edge extension (Manifest V3) that puts idle tabs to sleep so your browser stays fast. Suspended tabs are replaced with a lightweight placeholder page and wake instantly with one click — or a keyboard shortcut.

<!-- TODO: add app screenshots here (popup, dashboard, settings, themes) -->

## Features

- **One-click suspension** — suspend the current tab, all others, or everything at once, with live progress
- **Auto-suspend** — optional idle timer (default: 30 min) puts untouched tabs to sleep automatically
- **Smart protections** — skips audible, pinned, and active tabs; localhost/private-network and internal pages are never touched; optional guard for login/checkout/payment pages
- **Whitelist** — protect domains or URL prefixes from ever being suspended
- **Tab sessions** — save and restore whole windows, close duplicate tabs, export a tab list to the clipboard
- **Stats dashboard** — memory saved today and all time, weekly chart, top memory consumers, suspension timeline
- **28 themes** — 9 light and 19 dark flavors, system mode, plus custom CSS snippets on every extension page
- **Keyboard shortcut** — suspend the active tab without opening the popup (`Alt+Shift+X` by default)
- **Minimal permissions** — only `tabs`, `storage`, `alarms`, and `contextMenus`; no trackers, no remote code, zero dependencies

## How it works

Suspension swaps an idle tab's URL for a branded placeholder page that holds the original address. Restoring navigates back — which means the original page reloads fresh, so unsaved form state, media position, and in-page JS state are lost. That trade-off is what keeps the extension simple, predictable, and native to Manifest V3 (no `chrome.processes`, no background pages).

Memory figures shown in the UI are estimates (MV3 doesn't expose real per-tab memory), based on a conservative per-tab average.

## Install

**From the Chrome Web Store** (recommended): [RAM Manager](https://chromewebstore.google.com/detail/ram-manager/llaggikmbcdegbiaioghlmmafhhomnnn)

**Manual (Load unpacked):**

```bash
git clone https://github.com/jd-paul/ram-manager.git
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the cloned folder. The repository root *is* the extension — no build step.

## Support

Bugs, feature requests, and questions: [GitHub Issues](https://github.com/jd-paul/ram-manager/issues) (linked as the extension's official support site on the Chrome Web Store).

## Development

- Manifest V3, minimum Chrome 109; plain ES modules, no build tooling, no npm
- `PROJECT.md` — architecture, storage schema, and conventions (read before making changes)
- `GUIDE-FOR-UPDATES.md` — the full develop → verify → ship workflow, including releases and the Chrome Web Store
- Default branch: `master`
- Release notes: [RELEASE-NOTES.md](RELEASE-NOTES.md)

## License

[MIT](LICENSE) © Paul San Diego
