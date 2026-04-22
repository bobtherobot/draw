/**
 * Pan, zoom, coordinate conversion.
 * All shape positions are in document space; this module converts to/from screen space.
 */
import { state, getActiveArtboard } from './core/state.js';
import { emit } from './core/events.js';

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 64;

let _canvasRect = null;

/** Invalidate the cached canvas bounding rect (call after resize). */
export function invalidateRect() { _canvasRect = null; }

/** @returns {DOMRect} */
export function getCanvasRect() {
  if (!_canvasRect) _canvasRect = document.getElementById('canvas').getBoundingClientRect();
  return _canvasRect;
}

/**
 * Convert screen coordinates to document coordinates.
 * @param {number} sx
 * @param {number} sy
 * @returns {{x: number, y: number}}
 */
export function screenToDoc(sx, sy) {
  const rect = getCanvasRect();
  const { x, y, zoom } = state.viewport;
  return {
    x: (sx - rect.left)  / zoom + x,
    y: (sy - rect.top)   / zoom + y,
  };
}

/**
 * Convert document coordinates to screen coordinates.
 * @param {number} dx
 * @param {number} dy
 * @returns {{x: number, y: number}}
 */
export function docToScreen(dx, dy) {
  const rect = getCanvasRect();
  const { x, y, zoom } = state.viewport;
  return {
    x: (dx - x) * zoom + rect.left,
    y: (dy - y) * zoom + rect.top,
  };
}

/**
 * Apply the current viewport transform to a CanvasKit canvas.
 * Call at the start of each render frame (after clear, before drawing).
 * Matrix maps doc coords → canvas pixel coords: x' = (docX - vx) * zoom
 * @param {object} ckCanvas  CanvasKit Canvas
 */
export function applyTransform(ckCanvas) {
  const { x, y, zoom } = state.viewport;
  // Row-major 3×3 matrix: [zoom, 0, -x*zoom, 0, zoom, -y*zoom, 0, 0, 1]
  ckCanvas.concat([zoom, 0, -x * zoom, 0, zoom, -y * zoom, 0, 0, 1]);
}

/**
 * Zoom around a screen-space point.
 * @param {number} factor   - multiply current zoom by this
 * @param {number} [sx]     - screen X pivot (defaults to canvas center)
 * @param {number} [sy]     - screen Y pivot
 */
export function zoomAt(factor, sx, sy) {
  const rect  = getCanvasRect();
  sx = sx ?? rect.left + rect.width  / 2;
  sy = sy ?? rect.top  + rect.height / 2;

  const { x, y, zoom } = state.viewport;
  const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
  if (newZoom === zoom) return;

  // Keep the doc point under the cursor fixed
  state.viewport.x = (sx - rect.left) / zoom - (sx - rect.left) / newZoom + x;
  state.viewport.y = (sy - rect.top)  / zoom - (sy - rect.top)  / newZoom + y;
  state.viewport.zoom = newZoom;

  emit('viewport-change');
}

/**
 * Pan the viewport by (dx, dy) screen pixels.
 * @param {number} dx
 * @param {number} dy
 */
export function panBy(dx, dy) {
  const { zoom } = state.viewport;
  state.viewport.x -= dx / zoom;
  state.viewport.y -= dy / zoom;
  emit('viewport-change');
}

/**
 * Fit the artboard into the canvas with 64px screen padding.
 */
export function fitToArtboard() {
  const rect  = getCanvasRect();
  const pad   = 64;
  const ab    = getActiveArtboard();
  const aw    = ab?.attrs.width  ?? 800;
  const ah    = ab?.attrs.height ?? 600;
  const zoom  = Math.min((rect.width - pad * 2) / aw, (rect.height - pad * 2) / ah);
  const ax = ab?.attrs.x ?? 0;
  const ay = ab?.attrs.y ?? 0;
  state.viewport.zoom = zoom;
  state.viewport.x    = ax - (rect.width  / zoom - aw) / 2;
  state.viewport.y    = ay - (rect.height / zoom - ah) / 2;
  emit('viewport-change');
}
