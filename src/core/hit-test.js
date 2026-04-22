/**
 * Unified hit-testing.
 *
 * Priority order:
 *   1. Overlay handles (scale/rotate) — data-handle attribute on DOM element
 *   2. ObjectType.hitPart() on selected shapes (front-to-back)
 *   3. ObjectType.hitPart() on all shapes (front-to-back)
 *   4. null → empty canvas
 */
import { state, allDisplayItems, findItem } from './state.js';

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
 * @param {Function} getObjectType  - registry.getObjectType
 * @param {Function} getElement     - renderer.getElement
 * @returns {HitResult|null}
 */
export function hitTest(screenX, screenY, getObjectType, getElement) {
  // 1. Overlay handles (scale, rotate)
  const el = document.elementFromPoint(screenX, screenY);
  if (el) {
    const handle = el.closest('[data-handle]');
    if (handle) {
      const shapeId = handle.dataset.shapeId ?? null;
      const shape   = shapeId ? findItem(shapeId) : null;
      return {
        objectType: shape?.type ?? null,
        part:       handle.dataset.handle,
        shape:      shape ?? null,
        isHandle:   true,
      };
    }
  }

  // Convert screen → doc coords
  const { x: vx, y: vy, zoom } = state.viewport;
  const canvasRect = document.getElementById('canvas')?.getBoundingClientRect();
  if (!canvasRect) return null;
  const docX = (screenX - canvasRect.left) / zoom + vx;
  const docY = (screenY - canvasRect.top)  / zoom + vy;

  // 2. Selected shapes first (front-to-back within selection)
  const selectedShapes = allDisplayItems().filter(s => state.selection.has(s.id));
  const hit2 = _hitShapes(selectedShapes, docX, docY, zoom, getObjectType, getElement);
  if (hit2) return hit2;

  // 3. All shapes front-to-back
  const all  = allDisplayItems();
  const hit3 = _hitShapes(all, docX, docY, zoom, getObjectType, getElement);
  if (hit3) return hit3;

  return null;
}

function _hitShapes(shapes, docX, docY, zoom, getObjectType, getElement) {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape  = shapes[i];
    const ot     = getObjectType(shape.type);
    if (!ot) continue;
    const el     = getElement(shape.id);
    const result = ot.hitPart(shape, docX, docY, zoom, el);
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
