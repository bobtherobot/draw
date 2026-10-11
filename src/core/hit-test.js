/**
 * Unified hit-testing.
 *
 * Priority order:
 *   1. Overlay handles (scale/rotate) — data-handle attribute on DOM element
 *   2. Container.hitPart() on selected shapes (front-to-back)
 *   3. Container.hitPart() on all shapes (front-to-back)
 *   4. null → empty canvas
 */
import { state, allDisplayShapes } from './state.js';
import { handleAtPoint }          from '../render/selection.js';
import { getCanvasRect }          from './Viewport.js';

/**
 * @typedef {Object} HitResult
 * @property {string}      objectType
 * @property {string}      part
 * @property {object}      shape
 * @property {*}           [detail]
 */

/**
 * @param {number}   screenX
 * @param {number}   screenY
 * @param {Function} getDisplayObject  - registry.getDisplayObject
 * @returns {HitResult|null}
 */
export function hitTest(screenX, screenY, getDisplayObject) {
  // 1. Overlay handles (scale, rotate)
  const handle = handleAtPoint(screenX, screenY);
  if (handle) {
    return {
      objectType: null,
      part:       handle.part,
      shape:      null,
      isHandle:   true,
    };
  }

  // Convert screen → doc coords
  const { x: vx, y: vy, zoom } = state.viewport;
  const { left, top } = getCanvasRect();
  const docX = (screenX - left) / zoom + vx;
  const docY = (screenY - top)  / zoom + vy;

  // 2. Selected shapes first (front-to-back within selection)
  const selectedShapes = allDisplayShapes().filter(s => state.selection.has(s.id));
  const hit2 = _hitShapes(selectedShapes, docX, docY, zoom, getDisplayObject);
  if (hit2) return hit2;

  // 3. All shapes front-to-back
  const all  = allDisplayShapes();
  const hit3 = _hitShapes(all, docX, docY, zoom, getDisplayObject);
  if (hit3) return hit3;

  return null;
}

function _hitShapes(shapes, docX, docY, zoom, getDisplayObject) {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape  = shapes[i];
    const ot     = getDisplayObject(shape.type);
    if (!ot) continue;
    const result = ot.hitPart(shape, docX, docY, zoom);
    if (result) {
      return { objectType: shape.type, part: result.part, detail: result.detail, shape };
    }
  }
  return null;
}

/**
 * Compute an Intent object from a hit result and current state.
 * @param {HitResult|null} hit
 * @returns {import('./state.js').Intent}
 */
export function computeIntent(hit) {
  return {
    tool:          state.activeTool,
    effectiveTool: state.intent.effectiveTool,
    mode:          state.activeMode,
    objectType:    hit?.objectType ?? null,
    part:          hit?.part ?? null,
    shape:         hit?.shape ?? null,
    modifiers:     { ...state.intent.modifiers },
  };
}
