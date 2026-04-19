/**
 * Application DOM bootstrap.
 * Builds the complete #app DOM structure from JS — no HTML hardcoding.
 * All UI elements are created here and handed to their owning control modules.
 */
import { state }          from './core/state.js';
import { emit, on }       from './core/events.js';
import { setIconTheme }   from './core/icons.js';
import { fitToArtboard, updateViewBox, invalidateRect } from './viewport.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Build and mount the complete application shell into #app. */
export function buildApp() {
  const app = document.getElementById('app');
  if (!app) throw new Error('Missing #app element');

  app.innerHTML = '';
  app.dataset.theme = state.options.theme;

  // ── Layout: toolbar | canvas-wrap | panels ─────────────────────────────────
  const toolbar     = _el('div', 'toolbar');
  const canvasWrap  = _el('div', 'canvas-wrap');
  const panels      = _el('div', 'panels');

  app.append(toolbar, canvasWrap, panels);

  // ── SVG canvas ─────────────────────────────────────────────────────────────
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.id = 'canvas';
  svg.setAttribute('xmlns', SVG_NS);
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';

  // SVG layer structure (matches CLAUDE.md spec)
  const artboardLayer  = _svgG('artboard-layer');
  const docRoot        = _svgG('doc-root');
  const textGuides     = _svgG('text-guides');
  const overlayHit     = _svgG('overlay-hit');
  const overlay        = _svgG('overlay');

  docRoot.appendChild(textGuides);
  svg.append(artboardLayer, docRoot, overlayHit, overlay);
  canvasWrap.appendChild(svg);

  // ── Status bar ─────────────────────────────────────────────────────────────
  const statusbar = _el('div', 'statusbar');
  app.appendChild(statusbar);

  // ── Command bar (floating) — built by controls/commandbar.js ───────────────
  const commandbar = _el('div', 'commandbar');
  commandbar.id = 'commandbar';
  app.appendChild(commandbar);

  // ── Window resize → invalidate cached rect ─────────────────────────────────
  new ResizeObserver(() => {
    invalidateRect();
    updateViewBox();
  }).observe(canvasWrap);

  return {
    toolbar,
    canvasWrap,
    panels,
    svg,
    statusbar,
    commandbar,
  };
}

/** Apply theme: set data-theme, update icon loader, push cursor CSS vars. */
export function applyTheme(themeName) {
  document.body.dataset.theme = themeName;
  state.options.theme = themeName;

  const iconPath = themeName === 'dark' ? 'assets/themes/default' : `assets/themes/${themeName}`;
  setIconTheme(iconPath);

  // Push cursor custom properties so canvas.less cursor rules resolve correctly
  const cursors = [
    ['--cursor-pen',      `url('${iconPath}/icons/cursors/cursor-pen.svg') 2 2, crosshair`],
    ['--cursor-pen-close',`url('${iconPath}/icons/cursors/cursor-pen-close.svg') 2 2, crosshair`],
    ['--cursor-text',     `url('${iconPath}/icons/cursors/cursor-text.svg') 12 12, text`],
    ['--cursor-grab',     `url('${iconPath}/icons/cursors/cursor-grab.svg') 8 8, grab`],
    ['--cursor-grabbing', `url('${iconPath}/icons/cursors/cursor-grabbing.svg') 8 8, grabbing`],
    ['--cursor-zoom-in',  `url('${iconPath}/icons/cursors/cursor-zoom-in.svg') 10 10, zoom-in`],
    ['--cursor-zoom-out', `url('${iconPath}/icons/cursors/cursor-zoom-out.svg') 10 10, zoom-out`],
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

function _svgG(id) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.id = id;
  return g;
}
