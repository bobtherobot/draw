/**
 * CanvasKit selection rendering.
 *
 * Draws selection box, scale handles, and rotate handle in physical canvas-pixel
 * space (canvas.width = CSS width × devicePixelRatio after the DPR fix).
 *
 * Responsibilities after Phase 3:
 *   - Single selection (no activeRotation) → delegates to Overlay.draw()
 *   - activeRotation (live rotate drag)    → drawn here (collection overlay)
 *   - Multi-selection                      → drawn here (union bbox / selectionRotation)
 *
 * Hit areas in _handles[] are always in CSS pixels so handleAtPoint() can
 * compare directly against clientX/clientY offsets from getBoundingClientRect().
 */
import { state, findItem }  from '../core/state.js';
import { unionBBoxes }       from '../utils/geometry/bbox.js';
import { getEditingShapeId } from '../core/TextEdit.js';
import { getCanvasRect }     from '../core/Viewport.js';
import { getCK }             from './renderer.js';
import { getCompanions }     from '../core/item-registry.js';
import {
  css, docToCSS,
  drawBox, drawHandleVisuals, drawOriginCrosshair,
  buildHandles, hitHandle,
  ORIGIN_HIT_R, HIT_PAD,
} from './selection-draw.js';

// Handle hit-areas registered each frame by renderSelection() for collection handles.
// Per-item handles live in each Overlay._localHandles.
const _handles = [];

/**
 * Check whether a mouse event position hits a selection handle.
 * Checks per-item overlay handles first (single selection at rest),
 * then falls back to collection handles (multi-selection / active rotation).
 * @param {number} screenX  e.clientX
 * @param {number} screenY  e.clientY
 * @returns {{ part: string } | null}
 */
export function handleAtPoint(screenX, screenY) {
  const { left, top } = getCanvasRect();
  const cx = screenX - left;
  const cy = screenY - top;

  // Per-item overlay handles (single selection, no live rotate drag)
  if (!state.activeRotation && state.selection.size === 1) {
    const [id] = state.selection;
    const hit = getCompanions(id)?.overlay.hitAtPoint(cx, cy);
    if (hit) return hit;
  }

  // Collection handles (multi-selection, activeRotation)
  return hitHandle(cx, cy, _handles);
}

/**
 * Render selection visuals onto ckCanvas (physical canvas-pixel space).
 * @param {object} ckCanvas  CanvasKit Canvas
 * @param {object} stateArg
 * @param {Function} getBaseObject
 */
export function renderSelection(ckCanvas, stateArg, getBaseObject) {
  _handles.length = 0;
  if (stateArg.selection.size === 0) return;

  const CK = getCK();
  if (!CK) return;

  const dpr    = window.devicePixelRatio || 1;
  const dc     = docToCSS(stateArg.viewport);
  const accent = css('--theme-accent')    || '#4a9eff';
  const bg     = css('--theme-bg-raised') || '#ffffff';

  // ── Live rotate drag overlay (collection, any selection size) ─────────────
  if (stateArg.activeRotation) {
    _drawRotated(ckCanvas, CK, stateArg.activeRotation, dc, dpr, accent, bg);
    const rotSelected = [...stateArg.selection].map(id => findItem(id)).filter(Boolean);
    const rotOrigin = stateArg.selectionOrigin ?? _uniformOriginFromSelected(rotSelected);
    const rotPt_ = rotOrigin ?? stateArg.activeRotation.center;
    const op = dc(rotPt_.x, rotPt_.y);
    drawOriginCrosshair(ckCanvas, CK, op, dpr, accent);
    _handles.push({ part: 'origin', x: op.x, y: op.y, r: ORIGIN_HIT_R + HIT_PAD });
    return;
  }

  const editId   = getEditingShapeId();
  const selected = [];
  for (const id of stateArg.selection) {
    if (id === editId) continue;
    const s = findItem(id);
    if (s) selected.push(s);
  }
  if (!selected.length) return;

  // ── Single selection → delegate to Overlay ──────────────────────────
  if (selected.length === 1) {
    const id    = selected[0].id;
    const comps = getCompanions(id);
    if (comps?.overlay) {
      comps.overlay.draw(ckCanvas, CK, comps.abstract, stateArg.viewport, dpr, stateArg.selectionOrigin);
    }
    return;
  }

  // ── Multi-selection ────────────────────────────────────────────────────────
  let originX, originY;

  const firstRot   = selected[0]._rotDisplay;
  const uniformRot = firstRot && selected.every(s => s._rotDisplay &&
      s._rotDisplay.angle    === firstRot.angle &&
      s._rotDisplay.center.x === firstRot.center.x &&
      s._rotDisplay.center.y === firstRot.center.y) ? firstRot : null;
  const collectionRot = !uniformRot && stateArg.selectionRotation && selected.length > 1
    ? stateArg.selectionRotation : null;
  const rotData = uniformRot ?? collectionRot;

  if (rotData) {
    _drawRotated(ckCanvas, CK, rotData, dc, dpr, accent, bg);
    const uOrigin = _uniformOriginFromSelected(selected) ?? stateArg.selectionOrigin;
    originX = uOrigin?.x ?? rotData.center.x;
    originY = uOrigin?.y ?? rotData.center.y;
  } else {
    const bboxes = selected
      .map(s => getBaseObject(s.type)?.getBBox(s))
      .filter(Boolean);
    const bb = unionBBoxes(bboxes);
    if (!bb) return;

    const tl = dc(bb.x,            bb.y);
    const br = dc(bb.x + bb.width, bb.y + bb.height);
    const bx_css = tl.x, by_css = tl.y, bw_css = br.x - tl.x, bh_css = br.y - tl.y;
    const bx = bx_css * dpr, by = by_css * dpr, bw = bw_css * dpr, bh = bh_css * dpr;

    ckCanvas.save();
    drawBox(ckCanvas, CK, bx, by, bw, bh, accent, dpr);
    drawHandleVisuals(ckCanvas, CK, bx, by, bw, bh, dpr, accent, bg);
    ckCanvas.restore();

    _handles.push(...buildHandles(bx_css, by_css, bw_css, bh_css, null));

    const uOrigin = _uniformOriginFromSelected(selected) ?? stateArg.selectionOrigin;
    originX = uOrigin?.x ?? (bb.x + bb.width  / 2);
    originY = uOrigin?.y ?? (bb.y + bb.height / 2);
  }

  const op = dc(originX, originY);
  drawOriginCrosshair(ckCanvas, CK, op, dpr, accent);
  _handles.push({ part: 'origin', x: op.x, y: op.y, r: ORIGIN_HIT_R + HIT_PAD });
}

// ── Private ──────────────────────────────────────────────────────────────────

function _drawRotated(ckCanvas, CK, { bbox: bb, center, angle }, dc, dpr, accent, bg) {
  const cp_css = dc(center.x, center.y);
  const tl_css = dc(bb.x, bb.y);
  const br_css = dc(bb.x + bb.width, bb.y + bb.height);
  const bx_css = tl_css.x, by_css = tl_css.y;
  const bw_css = br_css.x - tl_css.x, bh_css = br_css.y - tl_css.y;
  const cp  = { x: cp_css.x * dpr, y: cp_css.y * dpr };
  const bx  = bx_css * dpr, by  = by_css * dpr;
  const bw  = bw_css * dpr, bh  = bh_css * dpr;
  const rad = angle * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);

  ckCanvas.save();
  ckCanvas.concat([
    cos, -sin, cp.x * (1 - cos) + cp.y * sin,
    sin,  cos, cp.y * (1 - cos) - cp.x * sin,
    0, 0, 1,
  ]);
  drawBox(ckCanvas, CK, bx, by, bw, bh, accent, dpr);
  drawHandleVisuals(ckCanvas, CK, bx, by, bw, bh, dpr, accent, bg);
  ckCanvas.restore();

  _handles.push(...buildHandles(bx_css, by_css, bw_css, bh_css, { cx: cp_css.x, cy: cp_css.y, rad }));
}

function _uniformOriginFromSelected(shapes) {
  if (!shapes.length) return null;
  const first = shapes[0]._origin;
  if (!first) return null;
  for (let i = 1; i < shapes.length; i++) {
    const o = shapes[i]._origin;
    if (!o || o.x !== first.x || o.y !== first.y) return null;
  }
  return first;
}
