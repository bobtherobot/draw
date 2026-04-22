/**
 * Selection bounding box, scale handles, and rotate handle.
 * Rendered into the 'selection' overlay layer via OverlayManager.
 */
import { findItem }         from '../core/state.js';
import { unionBBoxes }      from '../geometry/bbox.js';
import { getEditingShapeId } from '../textedit.js';
import { rotatePoint }      from '../geometry/path-utils.js';

const HANDLE_SIZE  = 6;   // screen px
const ROTATE_DIST  = 20;  // screen px above the top-center handle
const ROTATE_SIZE  = 6;   // screen px radius of rotate dot

/**
 * Render selection visuals into the given overlay layer.
 *
 * @param {import('./overlay.js').OverlayLayer} layer
 * @param {import('../core/state.js').state} state
 * @param {Function} getObjectType  — (typeId) → ObjectType
 * @param {Function} getElement     — (shapeId) → SVGElement|null
 */
export function renderSelection(layer, state, getObjectType, getElement) {
  layer.clear();

  if (state.selection.size === 0) return;

  const { viewport: { zoom } } = state;

  const hs = HANDLE_SIZE / zoom;
  const rd = ROTATE_DIST / zoom;
  const rs = ROTATE_SIZE / zoom;

  // During a rotation drag use the initial bbox rotated rigidly.
  if (state.activeRotation) {
    _drawRotatedSelection(layer, state.activeRotation, hs, rd, rs);
    return;
  }

  const editingId = getEditingShapeId();

  // Collect selected shapes (excluding any currently being text-edited).
  const selected = [];
  for (const id of state.selection) {
    if (id === editingId) continue;
    const shape = findItem(id);
    if (shape) selected.push(shape);
  }
  if (selected.length === 0) return;

  // If all selected shapes carry committed rotation display metadata from the
  // same drag (same angle + center), keep the rotated box visible after release.
  const firstRot = selected[0]._rotDisplay;
  if (firstRot && selected.every(s => s._rotDisplay &&
      s._rotDisplay.angle    === firstRot.angle &&
      s._rotDisplay.center.x === firstRot.center.x &&
      s._rotDisplay.center.y === firstRot.center.y)) {
    _drawRotatedSelection(layer, firstRot, hs, rd, rs);
    return;
  }

  // AABB path — gather bboxes.
  const bboxes = [];
  for (const shape of selected) {
    const ot = getObjectType(shape.type);
    if (!ot) continue;
    const el = getElement(shape.id);
    const bb = ot.getBBox(shape, el);
    if (bb) bboxes.push(bb);
  }

  const bb = unionBBoxes(bboxes);
  if (!bb) return;

  // Selection bounding box — clear any stale rotation transform from the element pool.
  const box = layer.borrow('rect');
  box.removeAttribute('transform');
  box.setAttribute('x',      bb.x);
  box.setAttribute('y',      bb.y);
  box.setAttribute('width',  bb.width);
  box.setAttribute('height', bb.height);
  box.setAttribute('class',  'selection-box');
  box.setAttribute('vector-effect', 'non-scaling-stroke');

  // Scale handles — 8 cardinal/corner positions.
  const handles = [
    { id: 'nw', x: bb.x,                   y: bb.y },
    { id: 'n',  x: bb.x + bb.width / 2,    y: bb.y },
    { id: 'ne', x: bb.x + bb.width,         y: bb.y },
    { id: 'e',  x: bb.x + bb.width,         y: bb.y + bb.height / 2 },
    { id: 'se', x: bb.x + bb.width,         y: bb.y + bb.height },
    { id: 's',  x: bb.x + bb.width / 2,     y: bb.y + bb.height },
    { id: 'sw', x: bb.x,                    y: bb.y + bb.height },
    { id: 'w',  x: bb.x,                    y: bb.y + bb.height / 2 },
  ];

  for (const h of handles) {
    const el = layer.borrow('rect');
    el.removeAttribute('transform');
    el.setAttribute('x',      h.x - hs / 2);
    el.setAttribute('y',      h.y - hs / 2);
    el.setAttribute('width',  hs);
    el.setAttribute('height', hs);
    el.setAttribute('class',  'selection-handle');
    el.setAttribute('data-handle', h.id);
    el.setAttribute('vector-effect', 'non-scaling-stroke');
  }

  // Rotate stem.
  const stemX = bb.x + bb.width / 2;
  const stem  = layer.borrow('line');
  stem.setAttribute('x1',    stemX);
  stem.setAttribute('y1',    bb.y);
  stem.setAttribute('x2',    stemX);
  stem.setAttribute('y2',    bb.y - rd);
  stem.setAttribute('class', 'selection-rotate-stem');
  stem.setAttribute('vector-effect', 'non-scaling-stroke');

  // Rotate handle dot.
  const rot = layer.borrow('circle');
  rot.setAttribute('cx',     stemX);
  rot.setAttribute('cy',     bb.y - rd);
  rot.setAttribute('r',      rs);
  rot.setAttribute('class',  'selection-rotate-handle');
  rot.setAttribute('data-handle', 'rotate');
  rot.setAttribute('vector-effect', 'non-scaling-stroke');
}

function _drawRotatedSelection(layer, { bbox: bb, center, angle }, hs, rd, rs) {
  const cx = center.x, cy = center.y;

  // Selection box: use the initial rect dimensions with an SVG rotate transform.
  const box = layer.borrow('rect');
  box.setAttribute('x',         bb.x);
  box.setAttribute('y',         bb.y);
  box.setAttribute('width',     bb.width);
  box.setAttribute('height',    bb.height);
  box.setAttribute('transform', `rotate(${angle},${cx},${cy})`);
  box.setAttribute('class',     'selection-box');
  box.setAttribute('vector-effect', 'non-scaling-stroke');

  // Scale handles — rotate each unrotated position around the rotation center.
  const unrotHandles = [
    { id: 'nw', x: bb.x,                   y: bb.y },
    { id: 'n',  x: bb.x + bb.width / 2,    y: bb.y },
    { id: 'ne', x: bb.x + bb.width,         y: bb.y },
    { id: 'e',  x: bb.x + bb.width,         y: bb.y + bb.height / 2 },
    { id: 'se', x: bb.x + bb.width,         y: bb.y + bb.height },
    { id: 's',  x: bb.x + bb.width / 2,     y: bb.y + bb.height },
    { id: 'sw', x: bb.x,                    y: bb.y + bb.height },
    { id: 'w',  x: bb.x,                    y: bb.y + bb.height / 2 },
  ];

  for (const h of unrotHandles) {
    const p  = rotatePoint(h.x, h.y, cx, cy, angle);
    const el = layer.borrow('rect');
    el.setAttribute('x',      p.x - hs / 2);
    el.setAttribute('y',      p.y - hs / 2);
    el.setAttribute('width',  hs);
    el.setAttribute('height', hs);
    el.setAttribute('class',  'selection-handle');
    el.setAttribute('data-handle', h.id);
    el.setAttribute('vector-effect', 'non-scaling-stroke');
  }

  // Rotate stem and handle — rotate both endpoints of the unrotated stem.
  const stemUnrotX = bb.x + bb.width / 2;
  const stemStart  = rotatePoint(stemUnrotX, bb.y,      cx, cy, angle);
  const stemEnd    = rotatePoint(stemUnrotX, bb.y - rd, cx, cy, angle);

  const stem = layer.borrow('line');
  stem.setAttribute('x1',    stemStart.x);
  stem.setAttribute('y1',    stemStart.y);
  stem.setAttribute('x2',    stemEnd.x);
  stem.setAttribute('y2',    stemEnd.y);
  stem.setAttribute('class', 'selection-rotate-stem');
  stem.setAttribute('vector-effect', 'non-scaling-stroke');

  const rot = layer.borrow('circle');
  rot.setAttribute('cx',     stemEnd.x);
  rot.setAttribute('cy',     stemEnd.y);
  rot.setAttribute('r',      rs);
  rot.setAttribute('class',  'selection-rotate-handle');
  rot.setAttribute('data-handle', 'rotate');
  rot.setAttribute('vector-effect', 'non-scaling-stroke');
}

