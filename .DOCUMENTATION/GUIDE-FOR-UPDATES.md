# Guide: Making Updates & Pushing Changes

How to develop, verify, commit, push, and ship updates for the RAM Manager Chrome extension. Read `PROJECT.md` first — it documents the architecture and the hard constraints this guide assumes you follow.

## The golden rule

**The repository root IS the extension.** There is no build step, no transpilation, no npm. Every file in this repo (minus `.git/`, the release zip, and `.DS_Store`) is loaded directly by Chrome. If you can load the folder with "Load unpacked", it's a valid extension. If you can't, the repo is broken — fix that before anything else.

## Hard constraints (never violate without asking)

- Manifest V3 only; minimum Chrome 109
- No background pages, no remote code, no `chrome.processes`
- CSP: `script-src 'self'` — no inline scripts, no CDN scripts, no eval
- Plain ES modules only (`<script type="module">`)
- No automated tests, no CI — manual verification is the release gate

## The update workflow

### 1. Branch

Work on a short-lived branch, not directly on `master`:

```bash
git checkout master
git pull origin master
git checkout -b feat/short-description
```

### 2. Make the change

Conventions that keep the codebase consistent (from `PROJECT.md`):

- Chrome APIs are callback-style; `js/storage.js` wraps them in promises. Follow whichever pattern the file you're editing already uses.
- Every multi-tab suspend loop batches with `BATCH_SIZE = 5`.
- After any suspend/restore, call `updateBadge()`; history goes through `logHistory()` — never write `suspensionHistory` directly.
- New settings require all four steps: key in `DEFAULT_SETTINGS` (`js/storage.js`) → wiring in `settings-ui.js` → UI in `settings/settings.html` (and `popup/popup.html` if quick-access) → respect in `background.js` suspend paths.
- New themes: add `themes/<id>.css` and register it in `js/theme.js`'s `LIGHT_THEMES`/`DARK_THEMES` catalogue.
- Keep comments sparse; section banners (`/* --- */`) are the house style. Don't narrate what the code does.

### 3. Verify manually (this is the test suite)

There is no CI. You are the CI. Before every push:

1. Open `chrome://extensions`, enable Developer mode, and click **Reload** on RAM Manager.
2. Click "service worker" (or "Inspect views") to open the worker console. It must be free of errors.
3. Exercise the feature you changed:
   - Suspend/restore a tab (popup + `Alt+Shift+X` shortcut)
   - Suspend all / restore all
   - Whitelist add/remove, quick toggles
   - Settings page: change your setting, reload, confirm it persists
   - Dashboard: stats, charts, timeline
   - Theme switching (light/dark/flavors) — check for FOUC
4. **Restart check:** MV3 service workers are killed aggressively. Fully close and reopen Chrome (or click "Update"/reload the worker repeatedly) and confirm the alarm, badge, and listeners survive. Init code lives at module top level plus the immediate init block at the bottom of `background.js` — never move it behind `onInstalled` only.

If the service worker console shows errors after any of these, the update is not ready.

### 4. Commit & push

The repo uses conventional commits — match the existing history:

```
feat(themes): add everforest light flavor
fix(popup): restore whitelist entry on cancel
refactor: drop unused imports in background.js
```

```bash
git add -A
git commit -m "feat(scope): what and why in one line"
git push -u origin feat/short-description
```

Then open a PR against `master` on `https://github.com/jd-paul/ram-manager`, self-review the diff (read it as if you didn't write it), and merge.

## Shipping a release

### Step 1: Bump the version

`manifest.json` is bumped **by hand**, following semver:

| Change | Bump | Example |
|---|---|---|
| Bug fixes, tweaks, new themes | **patch** | `1.0.0` → `1.0.1` |
| New features, new settings | **minor** | `1.0.0` → `1.1.0` |
| Breaking behavior changes users must relearn | **major** | `1.0.0` → `2.0.0` |

The Chrome Web Store **rejects** a package whose version is not strictly higher than the published one, so never re-use a version.

### Step 2: Build the zip

The release is the repo root zipped in the same shape as `ram-manager-v1.0.0.zip`. Exclude `.git/`, any previous release zip, and `.DS_Store` files:

```bash
zip -r ram-manager-v1.1.0.zip . \
  -x ".git/*" \
  -x "ram-manager-v*.zip" \
  -x "*.DS_Store"
```

Sanity-check the zip before uploading: unzip it to a temp folder and load that folder with "Load unpacked". The icon, popup, options page, and suspended page must all work.

### Step 3: Publish to the Chrome Web Store

1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) and sign in with the publisher account.
2. Select the RAM Manager item → **Package** → **Upload new package** → choose the zip.
3. Fill in the "What's new" field with a user-facing summary of the version's changes.
4. Submit for review. Reviews typically take from a few hours to a few days (can be longer if permissions changed — we deliberately keep permissions minimal: `tabs`, `storage`, `alarms`, `contextMenus`, so reviews are usually smooth).
5. After approval, publish. For anything non-trivial, use **percentage rollout** (e.g. 10%) and monitor for a day before 100%.

### Step 4: Tag the repo

```bash
git tag -a v1.1.0 -m "Release v1.1.0"
git push origin v1.1.0
```

## Pre-push checklist

- [ ] Extension reloads cleanly at `chrome://extensions`
- [ ] Service worker console has no errors
- [ ] Feature exercised end-to-end + one browser restart
- [ ] Constraints respected (MV3, CSP, no inline/CDN scripts, no npm)
- [ ] If it's a release: `manifest.json` version bumped, zip re-tested via "Load unpacked"
- [ ] `README.md` kept in UTF-8 (it is no longer UTF-16 — don't reintroduce a BOM or the diff will explode)

## Quick reference

| I want to... | Do this |
|---|---|
| Fix a bug | Branch → fix → manual verify → conventional commit → PR → merge |
| Add a feature | Same, plus all four settings-plumbing steps if it's a setting |
| Ship to users | Bump version → zip repo root → upload to CWS dashboard → tag `vX.Y.Z` |
| Check what shipped | `git tag -l`, or the store listing's version vs `manifest.json` |
