import { state } from './state.js';

const svg = () => document.getElementById('canvas');

let _cachedRect = null;
function getSvgRect() {
  if (!_cachedRect) _cachedRect = svg().getBoundingClientRect();
  return _cachedRect;
}
export function invalidateRect() { _cachedRect = null; }

export function screenToDoc(sx, sy) {
  const r = getSvgRect();
  return {
    x: (sx - r.left) / state.viewport.zoom + state.viewport.x,
    y: (sy - r.top)  / state.viewport.zoom + state.viewport.y,
  };
}

export function updateViewBox() {
  const el = svg();
  const { x, y, zoom } = state.viewport;
  const w = el.clientWidth  / zoom;
  const h = el.clientHeight / zoom;
  el.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
}

let spaceDown = false;
let panning   = false;
let panAnchor = null;
let vpAnchor  = null;

export function isPanning() { return panning || spaceDown; }

export function initViewport() {
  const el = svg();

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const before = screenToDoc(e.clientX, e.clientY);
    state.viewport.zoom = Math.max(0.05, Math.min(64, state.viewport.zoom * factor));
    const after = screenToDoc(e.clientX, e.clientY);
    state.viewport.x -= after.x - before.x;
    state.viewport.y -= after.y - before.y;
    updateViewBox();
  }, { passive: false });

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.target.matches('input,textarea')) {
      e.preventDefault();
      spaceDown = true;
      el.style.cursor = 'grab';
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      spaceDown = false;
      if (!panning) el.style.cursor = '';
    }
  });

  el.addEventListener('mousedown', (e) => {
    if (spaceDown) {
      panning   = true;
      panAnchor = { x: e.clientX, y: e.clientY };
      vpAnchor  = { ...state.viewport };
      el.style.cursor = 'grabbing';
      e.stopPropagation();
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!panning) return;
    const z = state.viewport.zoom;
    state.viewport.x = vpAnchor.x - (e.clientX - panAnchor.x) / z;
    state.viewport.y = vpAnchor.y - (e.clientY - panAnchor.y) / z;
    updateViewBox();
  });

  window.addEventListener('mouseup', () => {
    if (panning) {
      panning = false;
      panAnchor = null;
      svg().style.cursor = spaceDown ? 'grab' : '';
    }
  });

  window.addEventListener('resize', () => { invalidateRect(); updateViewBox(); });

  new ResizeObserver(invalidateRect).observe(el);

  fitToArtboard();
}

export function fitToArtboard() {
  const el = svg();
  const { width, height } = state.doc;
  const svgW = el.clientWidth;
  const svgH = el.clientHeight;
  if (!svgW || !svgH) return;
  const pad = 64;
  const zoom = Math.max(0.05, Math.min(64,
    Math.min((svgW - pad * 2) / width, (svgH - pad * 2) / height)
  ));
  state.viewport.zoom = zoom;
  // Center the artboard in the viewport
  state.viewport.x = width  / 2 - svgW / zoom / 2;
  state.viewport.y = height / 2 - svgH / zoom / 2;
  updateViewBox();
}
