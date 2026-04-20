/**
 * Selection bounding box, scale handles, and rotate handle.
 * Rendered into the 'selection' overlay layer via OverlayManager.
 */
import { findItem }    from '../core/state.js';
import { unionBBoxes } from '../geometry/bbox.js';

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

  // Gather bboxes for selected shapes
  const bboxes = [];
  for (const id of state.selection) {
    const shape = findItem(id);
    if (!shape) continue;
    const ot = getObjectType(shape.type);
    if (!ot) continue;
    const el = getElement(id);
    const bb = ot.getBBox(shape, el);
    if (bb) bboxes.push(bb);
  }

  const bb = unionBBoxes(bboxes);
  if (!bb) return;

  const hs = HANDLE_SIZE / zoom;  // handle size in doc coords
  const rd = ROTATE_DIST / zoom;
  const rs = ROTATE_SIZE / zoom;

  // Selection bounding box
  const box = layer.borrow('rect');
  box.setAttribute('x',      bb.x);
  box.setAttribute('y',      bb.y);
  box.setAttribute('width',  bb.width);
  box.setAttribute('height', bb.height);
  box.setAttribute('class',  'selection-box');
  box.setAttribute('vector-effect', 'non-scaling-stroke');

  // Scale handles — 8 cardinal/corner positions
  const handles = [
    { id: 'handle-nw', x: bb.x,                   y: bb.y },
    { id: 'handle-n',  x: bb.x + bb.width / 2,    y: bb.y },
    { id: 'handle-ne', x: bb.x + bb.width,         y: bb.y },
    { id: 'handle-e',  x: bb.x + bb.width,         y: bb.y + bb.height / 2 },
    { id: 'handle-se', x: bb.x + bb.width,         y: bb.y + bb.height },
    { id: 'handle-s',  x: bb.x + bb.width / 2,     y: bb.y + bb.height },
    { id: 'handle-sw', x: bb.x,                    y: bb.y + bb.height },
    { id: 'handle-w',  x: bb.x,                    y: bb.y + bb.height / 2 },
  ];

  for (const h of handles) {
    const el = layer.borrow('rect');
    el.setAttribute('x',      h.x - hs / 2);
    el.setAttribute('y',      h.y - hs / 2);
    el.setAttribute('width',  hs);
    el.setAttribute('height', hs);
    el.setAttribute('class',  'selection-handle');
    el.setAttribute('data-handle', h.id);
    el.setAttribute('vector-effect', 'non-scaling-stroke');
  }

  // Rotate stem
  const stemX = bb.x + bb.width / 2;
  const stem  = layer.borrow('line');
  stem.setAttribute('x1',    stemX);
  stem.setAttribute('y1',    bb.y);
  stem.setAttribute('x2',    stemX);
  stem.setAttribute('y2',    bb.y - rd);
  stem.setAttribute('class', 'selection-rotate-stem');
  stem.setAttribute('vector-effect', 'non-scaling-stroke');

  // Rotate handle dot
  const rot = layer.borrow('circle');
  rot.setAttribute('cx',     stemX);
  rot.setAttribute('cy',     bb.y - rd);
  rot.setAttribute('r',      rs);
  rot.setAttribute('class',  'selection-rotate-handle');
  rot.setAttribute('data-handle', 'rotate');
  rot.setAttribute('vector-effect', 'non-scaling-stroke');
}

