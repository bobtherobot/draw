/**
 * CanvasKit selection rendering.
 *
 * Draws selection box, scale handles, and rotate handle in physical canvas-pixel
 * space (canvas.width = CSS width × devicePixelRatio after the DPR fix).
 *
 * Hit areas stored in _handles[] are always in CSS pixels so handleAtPoint()
 * can compare directly against clientX/clientY offsets from getBoundingClientRect().
 */
import { findItem }          from '../core/state.js';
import { unionBBoxes }       from '../geometry/bbox.js';
import { getEditingShapeId } from '../textedit.js';
import { getCanvasRect }     from '../viewport.js';
import { getCK }             from './renderer.js';

const HANDLE_SIZE      = 6;   // CSS px side length of scale handle squares
const HIT_PAD          = 3;   // CSS px added to handle hit areas
const ORIGIN_ARM       = 6;   // CSS px half-length of plus-sign arms
const ORIGIN_HIT_R     = 9;   // CSS px hit radius for origin handle
const ROTATE_BUFFER    = 5;   // CSS px gap between scale handle edge and rotate zone
const ROTATE_ZONE_OUT  = 20;  // CSS px outer reach of corner rotate zone from corner center
const ROTATE_INNER     = HANDLE_SIZE / 2 + HIT_PAD + ROTATE_BUFFER; // 11 px — inner boundary

const _ROTATE_CORNER_NAMES = ['nw', 'ne', 'se', 'sw'];
const _ROTATE_CORNER_IDX   = [0, 2, 4, 6]; // indices into _pts() for corners

// Handle hit-areas registered each frame. Positions in CSS px.
// Shape: { part, x, y, w, h } for squares  |  { part, x, y, r } for circles
const _handles = [];

/**
 * Check whether a mouse event position hits a selection handle.
 * @param {number} screenX  e.clientX
 * @param {number} screenY  e.clientY
 * @returns {{ part: string } | null}
 */
export function handleAtPoint(screenX, screenY) {
  const { left, top } = getCanvasRect();
  const cx = screenX - left;
  const cy = screenY - top;
  for (const h of _handles) {
    if (h.r !== undefined) {
      if (Math.hypot(cx - h.x, cy - h.y) <= h.r) return { part: h.part };
    } else {
      if (cx >= h.x && cx <= h.x + h.w && cy >= h.y && cy <= h.y + h.h) {
        // Rotate zones: enforce inner buffer (must be outside scale handle + gap)
        // and reject the inward quadrant (inside the selection box).
        if (h.ix !== undefined) {
          if (Math.max(Math.abs(cx - h.pcx), Math.abs(cy - h.pcy)) <= ROTATE_INNER) continue;
          if ((cx - h.pcx) * h.ix > 0 && (cy - h.pcy) * h.iy > 0) continue;
        }
        return { part: h.part };
      }
    }
  }
  return null;
}

/**
 * Render selection visuals onto ckCanvas (physical canvas-pixel space).
 * @param {object} ckCanvas  CanvasKit Canvas
 * @param {object} state
 * @param {Function} getObjectType
 */
export function renderSelection(ckCanvas, state, getObjectType) {
  _handles.length = 0;
  if (state.selection.size === 0) return;

  const CK = getCK();
  if (!CK) return;

  const dpr = window.devicePixelRatio || 1;
  const { x: vx, y: vy, zoom } = state.viewport;
  // dc: doc coords → CSS screen pixels (used for hit registration)
  const dc = (dx, dy) => ({ x: (dx - vx) * zoom, y: (dy - vy) * zoom });

  const accent = _css('--theme-accent')    || '#4a9eff';
  const bg     = _css('--theme-bg-raised') || '#ffffff';

  if (state.activeRotation) {
    _drawRotated(ckCanvas, CK, state.activeRotation, dc, dpr, accent, bg);
    const rotSelected = [...state.selection].map(id => findItem(id)).filter(Boolean);
    const rotOrigin = state.selectionOrigin ?? _uniformOriginFromSelected(rotSelected);
    const rotPt = rotOrigin ?? state.activeRotation.center;
    const op = dc(rotPt.x, rotPt.y);
    _drawOriginCrosshair(ckCanvas, CK, op, dpr, accent);
    _handles.push({ part: 'origin', x: op.x, y: op.y, r: ORIGIN_HIT_R + HIT_PAD });
    return;
  }

  const editId   = getEditingShapeId();
  const selected = [];
  for (const id of state.selection) {
    if (id === editId) continue;
    const s = findItem(id);
    if (s) selected.push(s);
  }
  if (!selected.length) return;

  let originX, originY;

  const firstRot = selected[0]._rotDisplay;
  const uniformRot = firstRot && selected.every(s => s._rotDisplay &&
      s._rotDisplay.angle    === firstRot.angle &&
      s._rotDisplay.center.x === firstRot.center.x &&
      s._rotDisplay.center.y === firstRot.center.y) ? firstRot : null;
  // For multi-selection, _uniformRotDisplay fails because each shape has its own
  // center. Fall back to the persistent collection rotation state instead.
  const collectionRot = !uniformRot && state.selectionRotation && selected.length > 1
    ? state.selectionRotation : null;
  const rotData = uniformRot ?? collectionRot;

  if (rotData) {
    _drawRotated(ckCanvas, CK, rotData, dc, dpr, accent, bg);
    const uOrigin = _uniformOriginFromSelected(selected) ?? state.selectionOrigin;
    originX = uOrigin?.x ?? rotData.center.x;
    originY = uOrigin?.y ?? rotData.center.y;
  } else {
    const bboxes = selected
      .map(s => getObjectType(s.type)?.getBBox(s))
      .filter(Boolean);
    const bb = unionBBoxes(bboxes);
    if (!bb) return;

    const tl = dc(bb.x,            bb.y);
    const br = dc(bb.x + bb.width, bb.y + bb.height);
    const bx_css = tl.x, by_css = tl.y, bw_css = br.x - tl.x, bh_css = br.y - tl.y;
    const bx = bx_css * dpr, by = by_css * dpr, bw = bw_css * dpr, bh = bh_css * dpr;

    ckCanvas.save();
    _drawBox(ckCanvas, CK, bx, by, bw, bh, accent, dpr);
    _drawHandleVisuals(ckCanvas, CK, bx, by, bw, bh, dpr, accent, bg);
    ckCanvas.restore();

    _registerHandles(bx_css, by_css, bw_css, bh_css, null);

    const uOrigin = _uniformOriginFromSelected(selected) ?? state.selectionOrigin;
    originX = uOrigin?.x ?? (bb.x + bb.width  / 2);
    originY = uOrigin?.y ?? (bb.y + bb.height / 2);
  }

  const op = dc(originX, originY);
  _drawOriginCrosshair(ckCanvas, CK, op, dpr, accent);
  _handles.push({ part: 'origin', x: op.x, y: op.y, r: ORIGIN_HIT_R + HIT_PAD });
}

// ── Private ──────────────────────────────────────────────────────────────────

function _drawRotated(ckCanvas, CK, { bbox: bb, center, angle }, dc, dpr, accent, bg) {
  // CSS pixels (for registration)
  const cp_css = dc(center.x, center.y);
  const tl_css = dc(bb.x, bb.y);
  const br_css = dc(bb.x + bb.width, bb.y + bb.height);
  const bx_css = tl_css.x, by_css = tl_css.y;
  const bw_css = br_css.x - tl_css.x, bh_css = br_css.y - tl_css.y;

  // Physical pixels (for drawing)
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
  _drawBox(ckCanvas, CK, bx, by, bw, bh, accent, dpr);
  _drawHandleVisuals(ckCanvas, CK, bx, by, bw, bh, dpr, accent, bg);
  ckCanvas.restore();

  _registerHandles(bx_css, by_css, bw_css, bh_css, { cx: cp_css.x, cy: cp_css.y, rad });
}

function _drawBox(ckCanvas, CK, bx, by, bw, bh, accent, dpr) {
  const paint = new CK.Paint();
  paint.setStyle(CK.PaintStyle.Stroke);
  paint.setColor(CK.parseColorString(accent));
  paint.setStrokeWidth(dpr);
  paint.setAntiAlias(false);
  const dashEffect = CK.PathEffect.MakeDash([4 * dpr, 3 * dpr]);
  paint.setPathEffect(dashEffect);
  ckCanvas.drawRect(CK.XYWHRect(bx, by, bw, bh), paint);
  dashEffect.delete();
  paint.delete();
}

function _drawHandleVisuals(ckCanvas, CK, bx, by, bw, bh, dpr, accent, bg) {
  const hs = HANDLE_SIZE * dpr;
  const hh = hs / 2;

  const fillPaint = new CK.Paint();
  const strPaint  = new CK.Paint();
  fillPaint.setStyle(CK.PaintStyle.Fill);
  fillPaint.setColor(CK.parseColorString(bg));
  fillPaint.setAntiAlias(false);
  strPaint.setStyle(CK.PaintStyle.Stroke);
  strPaint.setColor(CK.parseColorString(accent));
  strPaint.setStrokeWidth(1.5 * dpr);
  strPaint.setAntiAlias(true);

  for (const { x, y } of _pts(bx, by, bw, bh)) {
    const r = CK.XYWHRect(x - hh, y - hh, hs, hs);
    ckCanvas.drawRect(r, fillPaint);
    ckCanvas.drawRect(r, strPaint);
  }

  fillPaint.delete();
  strPaint.delete();
}

function _registerHandles(bx, by, bw, bh, rot) {
  // All inputs and outputs in CSS pixels — compared against clientX/Y in handleAtPoint.
  const hs  = HANDLE_SIZE;
  const pad = HIT_PAD;
  const hh  = hs / 2;

  const ids = ['nw','n','ne','e','se','s','sw','w'];
  const pts = _pts(bx, by, bw, bh);
  for (let i = 0; i < pts.length; i++) {
    const p = rot ? _rotPt(pts[i].x, pts[i].y, rot) : pts[i];
    _handles.push({ part: ids[i], x: p.x - hh - pad, y: p.y - hh - pad, w: hs + pad * 2, h: hs + pad * 2 });
  }
  // Invisible rotate zones at the 4 corners, registered after scale handles so
  // scale handles take priority when the mouse is dead-on the corner.
  // Each handle stores the corner position (pcx/pcy) and the inward direction
  // (ix/iy = sign of vector from corner toward selection center) so handleAtPoint
  // can reject hits that fall inside the selection box.
  const rz = ROTATE_ZONE_OUT + pad;
  const selCx = rot ? _rotPt(bx + bw / 2, by + bh / 2, rot).x : bx + bw / 2;
  const selCy = rot ? _rotPt(bx + bw / 2, by + bh / 2, rot).y : by + bh / 2;
  for (let i = 0; i < 4; i++) {
    const p = rot ? _rotPt(pts[_ROTATE_CORNER_IDX[i]].x, pts[_ROTATE_CORNER_IDX[i]].y, rot)
                  : pts[_ROTATE_CORNER_IDX[i]];
    _handles.push({
      part: `rotate-${_ROTATE_CORNER_NAMES[i]}`,
      x: p.x - rz, y: p.y - rz, w: rz * 2, h: rz * 2,
      pcx: p.x, pcy: p.y,
      ix: Math.sign(selCx - p.x),
      iy: Math.sign(selCy - p.y),
    });
  }
}

function _pts(bx, by, bw, bh) {
  return [
    { x: bx,        y: by        },
    { x: bx + bw/2, y: by        },
    { x: bx + bw,   y: by        },
    { x: bx + bw,   y: by + bh/2 },
    { x: bx + bw,   y: by + bh   },
    { x: bx + bw/2, y: by + bh   },
    { x: bx,        y: by + bh   },
    { x: bx,        y: by + bh/2 },
  ];
}

function _rotPt(px, py, { cx, cy, rad }) {
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = px - cx, dy = py - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

function _drawOriginCrosshair(ckCanvas, CK, op_css, dpr, accent) {
  const cx  = op_css.x * dpr;
  const cy  = op_css.y * dpr;
  const arm = ORIGIN_ARM * dpr;

  const paint = new CK.Paint();
  paint.setStyle(CK.PaintStyle.Stroke);
  paint.setColor(CK.parseColorString(accent));
  paint.setStrokeWidth(1.5 * dpr);
  paint.setAntiAlias(true);
  ckCanvas.drawLine(cx - arm, cy, cx + arm, cy, paint);
  ckCanvas.drawLine(cx, cy - arm, cx, cy + arm, paint);
  paint.delete();
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

function _css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
