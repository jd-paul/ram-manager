# RAM Manager — UI/UX Guide

Agent-facing guide to how the extension's UI works: the four surfaces, the design-token
system, the theme engine that powers 30+ themes, and the conventions to follow (and the
known inconsistencies not to propagate). Read `PROJECT.md` first for architecture and
hard constraints — this document assumes them.

---

## 1. Design philosophy

- **Obsidian-inspired, token-driven.** Every color, space, radius, and font size a surface
  uses comes from a CSS custom property. Surfaces never hardcode hex values or pixel
  spacing. This is what makes 30+ themes possible: a theme is just one more variable
  assignment layer.
- **Light-first base, dark by theme.** `css/base.css` `:root` ships light values; darkness
  is applied entirely by theme files. When adding base styles, author them against the
  light defaults and verify they survive dark themes.
- **Compact and utilitarian.** Dense uppercase micro-labels (`--font-size-sm`, wide letter
  spacing) against 14 px body text. Favor information density over whitespace.
- **No build step, no frameworks.** Plain HTML + CSS + ES modules. No CSS preprocessor, no
  utility framework, no npm. If you can't express it in plain CSS, it doesn't belong.
- **Manual verification only.** There are no UI tests. Visual changes are verified by
  loading the unpacked extension (`chrome://extensions` → Load unpacked → repo root) and
  eyeballing every surface in at least one light and one dark theme.

## 2. The four UI surfaces

| Surface | Files | What it is | Size character |
|---|---|---|---|
| Popup | `popup/popup.html` `popup.css` `popup.js` | Toolbar dropdown: status pill, stats strip, suspend/restore, tab list, collapsible sections, toast | 380 px wide, scrollable, dense |
| Dashboard | `dashboard/dashboard.html` `dashboard.css` `dashboard.js` | Full tab: stat cards, donut + bar charts, top memory consumers, session timeline | Wide layout, cards |
| Settings | `settings/settings.html` `settings.css` `settings.js` | Full tab (`options_ui`): toggles, theme picker, whitelist, data management | Mirrors dashboard's layout classes |
| Suspended | `suspended.html` (repo root) `suspended/suspended.css` `suspended.js` | Placeholder shown in place of a frozen tab; centered card + Restore button | Tiny, centered |

Every `<head>` follows the **same include order** (example: `popup/popup.html:6-8`,
`dashboard/dashboard.html:8-10`, `settings/settings.html:8-11`, `suspended.html:8-10`):

1. `js/theme-fouc.js` — classic (non-module) script, **first thing in `<head>`** (see §8)
2. `css/base.css` — tokens + reset + base typography
3. Surface CSS (`popup.css` / `dashboard.css` / `settings.css` / `suspended.css`)
4. Module `<script type="module">` that calls `initTheme()` early

The theme stylesheet is **never in the HTML**. `js/theme.js` injects it at runtime
(see §5), which lands after the surface CSS in the cascade.

There is **no message passing to the background worker** from any surface. Pages import
shared ES modules (`js/storage.js`, `js/utils.js`, `js/theme.js`, …) directly and call
`chrome.*` APIs themselves.

## 3. CSS cascade — the four layers

Runtime order (later wins for equal specificity):

```
base.css  →  surface.css  →  themes/<id>.css (injected)  →  user snippets (injected)
```

1. **`css/base.css`** — defines the full semantic token set on `:root` with light values,
   plus a hard reset and base element styles (body, buttons, inputs, links).
2. **Surface CSS** — component styles, always via `var(--token)`. No new color/spacing
   values; new components compose existing tokens.
3. **Theme CSS** — one rule redefining the ~24 color tokens under a scoped selector.
   Never touches layout, spacing, typography, or radius.
4. **Snippets** — optional user CSS injected after the theme, so users always win.
   Manifest of filenames in `chrome.storage.local` key `snippetFiles`; see
   `js/theme.js:198-264` and `snippets/example-tweak.css` for the contract.

## 4. Design tokens

All tokens live in `css/base.css:7-98`. **Prefer the semantic names** in new code;
the legacy aliases exist only for backward compat and are re-declared in every theme file
so both dialects keep working.

### Semantic tokens (preferred)

| Group | Tokens |
|---|---|
| Backgrounds | `--background-primary`, `--background-secondary`, `--background-tertiary`, `--background-modifier-hover`, `--background-modifier-active`, `--background-modifier-border`, `--background-modifier-border-hover` |
| Text | `--text-normal`, `--text-muted`, `--text-faint`, `--text-on-accent` |
| Accent | `--interactive-accent`, `--interactive-accent-hover`, `--interactive-accent-light`, `--interactive-normal`, `--interactive-hover` |
| Functional | `--color-success`, `--color-warning`, `--color-danger`, `--color-danger-light` |
| Shadows | `--shadow-color`, `--shadow-sm`, `--shadow-md`, `--shadow-lg` |

### Non-color tokens (never overridden by themes)

- **Spacing** — `--space-xs: 4px` … `--space-sm: 8px` … `--space-md: 12px`,
  `--space-lg: 16px`, `--space-xl: 24px`, `--space-2xl: 32px`, `--space-3xl: 48px`.
  Always snap to this scale.
- **Radius** — `--radius-s: 4px`, `--radius-m: 6px`, `--radius-l: 8px`,
  `--radius-xl: 12px`, `--radius-full: 9999px`.
- **Type** — Inter-first sans stack (`--font-sans`), mono stack (`--font-mono`);
  sizes `--font-size-xs/sm/md/lg/xl/2xl` (note: `--font-size-xs` is a 7px micro-label
  size, intentionally tiny); weights 400/500/600/700; line-heights 1.25 / 1.5.

### Legacy aliases (existing code only — don't use in new styles)

`--color-bg-*`, `--color-text-*`, `--color-accent-*`, `--color-border`,
`--color-border-light`, `--radius-sm/md/lg` — all `var()` references to the semantic
names (`css/base.css:80-97`). Popup and suspended CSS still lean on these; dashboard and
settings have migrated to semantic names.

**Rule: new CSS uses semantic tokens. When editing a component that uses legacy aliases,
migrate it to the semantic name in the same pass if trivial, otherwise leave it — both
work.**

## 5. The theme engine (how 30+ themes work)

Files: `js/theme.js` (engine + catalogue), `js/theme-fouc.js` (pre-paint), `themes/*.css`
(one file per theme).

### The catalogue is the source of truth

`js/theme.js:13-47` hardcodes two arrays of `{ id, label }`:

- `LIGHT_THEMES` (9): atom-light, everforest-light, gruvbox-light, luminescence-light,
  material-mint-light, nord-light, notion-light, sandy-beaches-light, solarized-light
- `DARK_THEMES` (19): amoled-dark, atom-dark, biscuit-dark, coffee-dark, dracula,
  everforest-dark, flexoki-dark, generic-dark, gruvbox-dark, kanagawa-dark,
  material-mint-dark, nord-dark, nord-darker, notion-dark, rosebox, rosepine-dark,
  royal-velvet, solarized-dark, thorns

**The `id` must equal the filename stem** (`themes/<id>.css`). Registration alone drives
everything: the settings dropdowns (`populateFlavorSelects` in `settings/settings.js`),
the light/dark classification (`getThemeClass`), palette-class cleanup in `loadTheme`,
and the CSS URL.

`themes/default.css` and `themes/dark.css` are **legacy Notion fallbacks** — not
catalogued, kept working via the body-class mirror (see below). Do not use them as a
template for new themes.

### How a theme is applied (`loadTheme`, `js/theme.js:93-141`)

1. `resolveThemeName()` — `'system'` resolves through `prefers-color-scheme` to the
   user's saved light/dark *flavor* (`themeLightFlavor` / `themeDarkFlavor` in
   `chrome.storage.sync`, defaults `notion-light` / `notion-dark`).
2. Sets `theme-light`/`theme-dark` **plus the palette id** (e.g. `dracula`) as classes on
   `<html>`, removing all stale palette classes first — then **mirrors both onto `<body>`**
   so both selector styles work (see below).
3. Writes the resolved light/dark class to
   `localStorage['ram-manager-theme-class']` — this feeds the FOUC script.
4. Injects/swaps a single `<link id="ram-manager-theme" rel="stylesheet">` pointing at
   `chrome.runtime.getURL('../themes/<resolved>.css')`. Nothing references theme files in
   `manifest.json` — no `content_scripts`, no `web_accessible_resources` needed.

`initTheme()` (`js/theme.js:280-318`) is called by every surface's module script and also
listens for OS color-scheme flips — but **only re-applies when mode is `'system'`**.
There is deliberately no `chrome.storage.onChanged` listener: theme changes do not
live-update other open pages; each page re-applies its own theme on load. Don't add one
without considering all four surfaces.

### Anatomy of a theme file

Exactly one rule, scoped `body.theme-light.<id>` or `body.theme-dark.<id>` (legacy
exceptions use bare `.theme-light` / `.theme-dark` — the `<body>` mirror exists precisely
to keep those working; don't create new bare-selector themes). The rule redefines, in the
same commented section order:

- Backgrounds (7 vars), Text (4), Accent (5), Functional colors (4), `--shadow-color`,
  then the 14 legacy aliases as `var()` passthroughs.

Conventions within a theme file:

- Use `rgb()` triplets for opaque colors and `rgba(..., 0.15–0.25)` for the *-light
  variants (`--interactive-accent-light`, `--color-danger-light`).
- `--interactive-accent-hover` uses the **double declaration** pattern: a flat fallback
  line, then `color-mix(in srgb, <accent>, white 15%)` for dark themes / `black 15%`
  for light (Chrome ≥111). See `themes/dracula.css:21-23`.
- Never redefine spacing, radius, typography, or shadows other than `--shadow-color`.

### How to add a new theme

1. Copy the closest existing file in `themes/` to `themes/<new-id>.css`.
2. Rename the selector to `body.theme-light.<new-id>` or `body.theme-dark.<new-id>`.
3. Recolor the ~24 variables. `anuppuccin-palettes.json` is an authoring reference
   (Catppuccin/AnuPpuccin palette families with `"type"` and pre-chosen `"accent"` per
   palette) — **not loaded by any code**. Pick a palette, map its `base/surface/overlay`
   → backgrounds, `text/subtext*` → text, `accent` → `--interactive-accent`, and derive
   hover via the `color-mix` pattern.
4. Add `{ id: '<new-id>', label: 'Display Name' }` to `LIGHT_THEMES` or `DARK_THEMES`
   in `js/theme.js`.
5. Done — no manifest change, no HTML change, no storage migration. Verify in Settings →
   Appearance and in the popup in both system modes.

## 6. Component conventions

Class names are **kebab-case**. Two modifier dialects coexist — match whichever the
surrounding component uses:

- Second class for state: `.status-pill.status-sleeping`, `.tab-row.sleeping`,
  `.legend-dot.active`
- BEM double-dash: `.setting-row--toggle`, `.btn--primary`, `.chart-card--wide`

Standard patterns to reuse rather than reinvent:

- **Cards** — `.card`: `--background-primary` bg, 1px `--background-modifier-border`,
  `--radius-l`, `--space-xl` padding, `--shadow-sm` (identical in dashboard.css and
  settings.css).
- **Toggle switch** — pure-CSS checkbox hack:
  `<label class="toggle"><input type="checkbox"><span class="toggle-slider"></span></label>`.
  Two implementations exist with different sizes (`popup.css:729-776` 36×20px,
  `settings.css:192-239` 44×24px) — reuse the one local to your surface.
- **Buttons** — three dialects coexist (popup gradient `.btn-suspend` / outline
  `.btn-secondary`; settings `.btn--primary/--secondary/--link/--danger` with
  `.btn-icon` slots; suspended `.btn` + `.btn-primary`). **Match the surface you're
  editing.** Don't invent a fourth system; see §10.
- **Pills/badges** — `.status-pill`, `.tab-badge` (`--radius-full`, uppercase,
  `--font-size-xs`), `.memory-badge`. State variants compose the functional colors.
- **Lists** — plain `<ul>`, `list-style: none`, flex column, separators via sibling
  selector (`.setting-row + .setting-row { border-top: ... }`).
- **Inputs** — focus ring: `border-color: var(--interactive-accent)` plus a soft
  `box-shadow` ring using `var(--interactive-accent-light)`.
- **Section headers** — dashboard and settings share structural classes
  (`dashboard-header`, `dashboard-main`, `dashboard-footer`, `header-subtitle`), with the
  rules duplicated across their CSS files. Keep them in sync when editing.

Inline styles are essentially forbidden. The only accepted exceptions today are
JS-driven show/hide (`style.display`, `style.opacity/pointerEvents` in `popup.js`) and
one legacy inline in `dashboard.html:51`. New UI must use classes.

## 7. Motion, focus, scrollbars

- **Transitions** — the house standard is `0.15s ease` for hover/color, `0.2s ease` for
  toggle slides, `transform: scale(0.97–0.98)` with `0.1s ease` for press feedback.
  Charts animate `stroke-dashoffset 0.8s` / width/height `0.5–0.6s`. The only keyframe
  animation is `setting-flash` (`popup.css:779-791`), a highlight for deep-linked
  settings. Keep new motion within this tempo.
- **Focus** — `:focus-visible` with `outline: 2px solid var(--interactive-accent)` on
  interactive rows/toggles; text inputs use the focus-ring shadow instead. Dashboard and
  suspended currently have none — add `:focus-visible` styles when touching interactive
  elements there.
- **Scrollbars** — intentionally unstyled (browser defaults) everywhere. Do not add
  `::-webkit-scrollbar` rules; the plain look is part of the aesthetic and stays theme
  proof.

## 8. FOUC prevention

`js/theme-fouc.js` is a 13-line synchronous IIFE, loaded **before any stylesheet** in
every surface. It reads `localStorage['ram-manager-theme-class']` (written by
`loadTheme` on every theme application) and sets `theme-light`/`theme-dark` on
`<html>` before first paint. It deliberately caches only the light/dark class — the
pre-paint palette comes from `base.css` `:root` defaults, so a flash of the wrong *color*
is still possible; only the wrong *mode* is prevented.

When adding a new HTML page, replicate the exact head order from §2 or it will flash.

## 9. Icons

- **Settings** uses Lucide via the bundled UMD build `settings/lucide.min.js`
  (v1.17.0 — do not upgrade casually; it's vendored). Placeholder elements
  `<i data-lucide="timer" class="lucide section-icon">` are replaced by
  `lucide.createIcons()` at init and again after any dynamic re-render that injects
  `<i data-lucide>` via `innerHTML`. Available names are limited to what the build's
  icon set contains — check before using a new one.
- **Popup and dashboard** use hand-written inline SVGs in the same visual language:
  `stroke="currentColor" stroke-width="2"`, round caps/joins, `fill: none`. Match that
  style — no icon fonts, no emoji, no external icon CDNs (CSP forbids them anyway).

## 10. Known inconsistencies (do not "fix" silently, do not propagate)

These are accepted trade-offs (same policy as `PROJECT.md`). When editing nearby code,
migrate toward consistency only if the change is small and self-contained; never rewrite
a whole surface in passing.

1. **Three button dialects**, including the near-collision `.btn-primary` (suspended)
   vs `.btn--primary` (settings). New buttons should follow the settings BEM dialect.
2. **Two toggle implementations** and **two keycap styles** (`.kbd-pill` vs `.key-pill`),
   differently sized per surface.
3. **Legacy-alias vs semantic token split** across surfaces (§4).
4. **Theme selector scoping split** — 28 themes use `body.theme-*.<id>`, the 2 legacy
   files use bare `.theme-*`; the body-class mirror papers over it.
5. **Duplicated structural CSS** between dashboard.css and settings.css
   (`.card`, header/footer layout). A shared surface-agnostic stylesheet has been
   considered but would be a deliberate refactor, not a drive-by.
6. **Partially dead/WIP code**: dashboard `.activity-*` styles + `renderActivity()`
   have no container; popup tab-list classes (`tab-row`, `tab-badge`, `tab-suspend-btn`)
   have no renderer yet (`js/tablist.js` is untracked WIP). Don't build on these or
   delete them without checking the WIP state.
7. **Snippet UI is backend-only** — `registerSnippet`/`unregisterSnippet`/
   `getRegisteredSnippets` exist in `js/theme.js` and `snippets/example-tweak.css`
   documents the format, but no settings UI exposes them yet.

## 11. Rules for agents

**Do**

- Style exclusively through tokens from `css/base.css`; never hardcode colors, spacing
  pixels, or radii in surface CSS.
- Use semantic token names in new code; scope user-facing color overrides to semantic
  variables only (see the snippet contract).
- Follow each surface's existing head include order and class dialect.
- Verify visually: load unpacked, cycle Settings → theme mode (system/light/dark) and at
  least three flavors across light and dark, open all four surfaces.
- When adding a theme, follow §5 exactly: file + one catalogue entry, nothing else.

**Don't**

- Don't add `::-webkit-scrollbar` styling, inline `style="..."` in HTML, icon fonts, or
  external CSS/JS CDNs (CSP forbids the latter two outright).
- Don't register themes, snippets, or CSS files in `manifest.json` — runtime injection
  via `chrome.runtime.getURL` is the mechanism.
- Don't redefine layout/spacing/typography tokens in a theme file — themes re-skin
  colors only.
- Don't add a `chrome.storage.onChanged` theme listener or live-sync between pages
  without an explicit request.
- Don't rename tokens, delete legacy aliases, or consolidate the button/toggle dialects
  as a drive-by — those are deliberate trade-offs documented above.
