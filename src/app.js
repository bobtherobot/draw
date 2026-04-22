/**
 * Application DOM bootstrap.
 * Builds the complete #app DOM structure from JS — no HTML hardcoding.
 * All UI elements are created here and handed to their owning control modules.
 */
import { state }          from './core/state.js';
import { emit }           from './core/events.js';
import { setIconTheme }   from './core/icons.js';
import { invalidateRect } from './viewport.js';

/** Build and mount the complete application shell into #app. */
export function buildApp() {
  const app = document.getElementById('app');
  if (!app) throw new Error('Missing #app element');

  app.innerHTML = '';
  app.dataset.theme = state.options.theme;

  // ── Menubar ────────────────────────────────────────────────────────────────
  const menubar = _el('div', 'menubar');
  menubar.id = 'menubar';

  // ── Layout: toolbar | canvas-wrap | panels ─────────────────────────────────
  const toolbar    = _el('div', 'toolbar');
  const canvasWrap = _el('div', 'canvas-wrap');
  const workspace  = _el('div', 'workspace');

  workspace.append(toolbar, canvasWrap);
  app.append(menubar, workspace);

  // ── Canvas 2D ─────────────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.id = 'canvas';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  canvasWrap.appendChild(canvas);

  // Set initial pixel dimensions synchronously so the first render is sharp.
  const initRect = canvasWrap.getBoundingClientRect();
  canvas.width  = Math.round(initRect.width)  || 800;
  canvas.height = Math.round(initRect.height) || 600;

  // ── Status bar ─────────────────────────────────────────────────────────────
  const statusbar = _el('div', 'statusbar');
  workspace.appendChild(statusbar);

  // ── Command bar (floating) — built by controls/commandbar.js ───────────────
  const commandbar = _el('div', 'commandbar');
  commandbar.id = 'commandbar';
  workspace.appendChild(commandbar);

  // ── Resize → update canvas pixel dimensions, re-render ────────────────────
  new ResizeObserver(entries => {
    const { width, height } = entries[0].contentRect;
    canvas.width  = Math.round(width)  || 1;
    canvas.height = Math.round(height) || 1;
    invalidateRect();
    emit('resize');
  }).observe(canvasWrap);

  return { menubar, toolbar, canvasWrap, canvas, statusbar, commandbar };
}

/** Apply theme: set data-theme, update icon loader, push cursor CSS vars. */
export function applyTheme(themeName) {
  document.body.dataset.theme = themeName;
  state.options.theme = themeName;

  // Use a theme-specific icon path only when that theme ships its own icons.
  // CSS-only themes (light, etc.) have no icon overrides and must fall back to default.
  const THEMES_WITH_ICONS = new Set([]); // add theme names here when they ship custom icon sets
  const themeSuffix = THEMES_WITH_ICONS.has(themeName) ? themeName : 'default';
  // Absolute URL so CSS var() url() values resolve correctly regardless of which
  // stylesheet consumes the var (browsers resolve url() in vars relative to the sheet).
  const iconBase = new URL(`../assets/themes/${themeSuffix}`, import.meta.url).href;
  setIconTheme(iconBase);

  // Push cursor custom properties so canvas.less cursor rules resolve correctly
  const cursors = [
    ['--cursor-pen',      `url('${iconBase}/icons/cursors/cursor-pen.svg') 2 2, crosshair`],
    ['--cursor-pen-close',`url('${iconBase}/icons/cursors/cursor-pen-close.svg') 2 2, crosshair`],
    ['--cursor-text',     `url('${iconBase}/icons/cursors/cursor-text.svg') 12 12, text`],
    ['--cursor-grab',     `url('${iconBase}/icons/cursors/cursor-grab.svg') 8 8, grab`],
    ['--cursor-grabbing', `url('${iconBase}/icons/cursors/cursor-grabbing.svg') 8 8, grabbing`],
    ['--cursor-zoom-in',  `url('${iconBase}/icons/cursors/cursor-zoom-in.svg') 10 10, zoom-in`],
    ['--cursor-zoom-out', `url('${iconBase}/icons/cursors/cursor-zoom-out.svg') 10 10, zoom-out`],
  ];
  for (const [prop, val] of cursors) {
    document.documentElement.style.setProperty(prop, val);
  }

  emit('theme-change', { theme: themeName });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _el(tag, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}
