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

const HANDLE_SIZE = 6;   // CSS px side length of scale handle squares
const ROTATE_DIST = 20;  // CSS px above top-center handle
const ROTATE_SIZE = 5;   // CSS px radius of rotate dot
const HIT_PAD     = 3;   // CSS px added to handle hit areas

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
      if (cx >= h.x && cx <= h.x + h.w && cy >= h.y && cy <= h.y + h.h) return { part: h.part };
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

  const firstRot = selected[0]._rotDisplay;
  if (firstRot && selected.every(s => s._rotDisplay &&
      s._rotDisplay.angle    === firstRot.angle &&
      s._rotDisplay.center.x === firstRot.center.x &&
      s._rotDisplay.center.y === firstRot.center.y)) {
    _drawRotated(ckCanvas, CK, firstRot, dc, dpr, accent, bg);
    return;
  }

  const bboxes = selected
    .map(s => getObjectType(s.type)?.getBBox(s))
    .filter(Boolean);
  const bb = unionBBoxes(bboxes);
  if (!bb) return;

  // CSS pixel bbox (for hit registration)
  const tl = dc(bb.x,            bb.y);
  const br = dc(bb.x + bb.width, bb.y + bb.height);
  const bx_css = tl.x, by_css = tl.y, bw_css = br.x - tl.x, bh_css = br.y - tl.y;

  // Physical pixel bbox (for drawing)
  const bx = bx_css * dpr, by = by_css * dpr, bw = bw_css * dpr, bh = bh_css * dpr;

  ckCanvas.save();
  _drawBox(ckCanvas, CK, bx, by, bw, bh, accent, dpr);
  _drawHandleVisuals(ckCanvas, CK, bx, by, bw, bh, dpr, accent, bg);
  ckCanvas.restore();

  _registerHandles(bx_css, by_css, bw_css, bh_css, null);
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
  const rd = ROTATE_DIST * dpr;
  const rs = ROTATE_SIZE * dpr;
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

  // Rotate stem
  const stemX = bx + bw / 2;
  const stemPaint = new CK.Paint();
  stemPaint.setStyle(CK.PaintStyle.Stroke);
  stemPaint.setColor(CK.parseColorString(accent));
  stemPaint.setStrokeWidth(dpr);
  stemPaint.setAntiAlias(false);
  const stemPath = CK.Path.MakeFromSVGString(`M ${stemX} ${by} L ${stemX} ${by - rd}`);
  if (stemPath) { ckCanvas.drawPath(stemPath, stemPaint); stemPath.delete(); }
  stemPaint.delete();

  // Rotate dot
  const dotPaint = new CK.Paint();
  dotPaint.setStyle(CK.PaintStyle.Fill);
  dotPaint.setColor(CK.parseColorString(accent));
  dotPaint.setAntiAlias(true);
  ckCanvas.drawCircle(stemX, by - rd, rs, dotPaint);
  dotPaint.delete();

  fillPaint.delete();
  strPaint.delete();
}

function _registerHandles(bx, by, bw, bh, rot) {
  // All inputs and outputs in CSS pixels — compared against clientX/Y in handleAtPoint.
  const hs  = HANDLE_SIZE;
  const rd  = ROTATE_DIST;
  const rs  = ROTATE_SIZE;
  const pad = HIT_PAD;
  const hh  = hs / 2;

  const ids = ['nw','n','ne','e','se','s','sw','w'];
  const pts = _pts(bx, by, bw, bh);
  for (let i = 0; i < pts.length; i++) {
    const p = rot ? _rotPt(pts[i].x, pts[i].y, rot) : pts[i];
    _handles.push({ part: ids[i], x: p.x - hh - pad, y: p.y - hh - pad, w: hs + pad * 2, h: hs + pad * 2 });
  }
  const stemX   = bx + bw / 2;
  const stemEnd = rot ? _rotPt(stemX, by - rd, rot) : { x: stemX, y: by - rd };
  _handles.push({ part: 'rotate', x: stemEnd.x, y: stemEnd.y, r: rs + pad });
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

function _css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
