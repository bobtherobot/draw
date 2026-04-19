# Theme Guide

## How theming works
A single compiled `dist/main.css` supports all themes at runtime. The default (dark) theme is defined in `styles/core/variables.less` as `:root { --theme-*: ... }`. Light and custom themes override only what differs using `body[data-theme="name"] { --theme-*: ... }`.

JS switches themes by setting `document.body.dataset.theme = 'name'` (see `src/app.js` → `applyTheme()`). The icon loader also updates its path to prefer theme-specific icons.

## CSS custom property reference

| Token | Default (dark) | Purpose |
|---|---|---|
| `--theme-bg` | `#1e1e1e` | App background |
| `--theme-bg-raised` | `#2a2a2a` | Panel / dialog background |
| `--theme-bg-hover` | `#333333` | Button hover |
| `--theme-bg-active` | `#444444` | Button pressed / selected |
| `--theme-border` | `#3a3a3a` | Borders between elements |
| `--theme-fg` | `#e0e0e0` | Primary text and icons |
| `--theme-fg-dim` | `#888888` | Secondary/dimmed text |
| `--theme-accent` | `#4a9eff` | Selections, active states, focus |
| `--theme-accent-fg` | `#ffffff` | Text on accent background |
| `--theme-accent-hover` | `#6ab4ff` | Accent hover state |
| `--theme-selection` | `rgba(74,158,255,0.25)` | Selection box fill |
| `--theme-danger` | `#ff5f57` | Destructive actions, none indicator |
| `--theme-shadow` | `rgba(0,0,0,0.4)` | Drop shadows |
| `--theme-pasteboard` | `#141414` | Canvas background outside artboard |
| `--theme-artboard-bg` | `#ffffff` | Artboard fill |
| `--theme-icon-path` | `'assets/themes/default'` | Icon folder — set by JS in applyTheme() |

## Creating a new theme

### 1. Create the LESS file
```
styles/themes/my-theme.less
```
Override only the tokens that differ from the default. See `styles/themes/light.less` as a reference.

### 2. Import in main.less
```less
// At the end of styles/main.less:
@import 'themes/my-theme';
```

### 3. Create the icon folder
```
assets/themes/my-theme/
  icons/
    tools/      ← override any tool icons (omit to inherit from default)
    ui/
    objects/
    handles/
    cursors/
```
Only override files that differ. Missing icons automatically fall back to `assets/themes/default/`.

### 4. Activate programmatically
```js
import { applyTheme } from './src/app.js';
applyTheme('my-theme');
```
Or set on body at startup: `document.body.dataset.theme = 'my-theme'`.

## Icon SVG conventions (cursors need special treatment)
Regular icons use `fill="currentColor"` and are tinted by CSS `color`.
Cursor SVGs use hardcoded black because they are OS cursors — `currentColor` doesn't apply.

## Runtime switching (no page reload)
```js
import { applyTheme } from './src/app.js';
document.getElementById('theme-btn').addEventListener('click', () => {
  applyTheme(document.body.dataset.theme === 'light' ? 'dark' : 'light');
});
```
