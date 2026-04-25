/**
 * Pure drawing helpers shared by selection.js (collection handles) and
 * OverlayObject (per-item handles).  No imports from renderer, state, or
 * item-registry — safe to import from any layer.
 */

export const HANDLE_SIZE     = 6;   // CSS px side length of scale handle squares
export const HIT_PAD         = 3;   // CSS px added to handle hit areas
export const ORIGIN_ARM      = 6;   // CSS px half-length of plus-sign arms
export const ORIGIN_HIT_R    = 9;   // CSS px hit radius for origin handle
export const ROTATE_BUFFER   = 5;   // CSS px gap between scale handle edge and rotate zone
export const ROTATE_ZONE_OUT = 20;  // CSS px outer reach of corner rotate zone from corner center
export const ROTATE_INNER    = HANDLE_SIZE / 2 + HIT_PAD + ROTATE_BUFFER; // 11 px

const _ROTATE_CORNER_NAMES = ['nw', 'ne', 'se', 'sw'];
const _ROTATE_CORNER_IDX   = [0, 2, 4, 6]; // indices into pts() output for the 4 corners

/** CSS variable helper. */
export function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Returns a converter from doc-space coords to CSS-pixel canvas coords.
 * @param {{x:number, y:number, zoom:number}} viewport
 * @returns {(dx:number, dy:number) => {x:number, y:number}}
 */
export function docToCSS(viewport) {
  const { x: vx, y: vy, zoom } = viewport;
  return (dx, dy) => ({ x: (dx - vx) * zoom, y: (dy - vy) * zoom });
}

/**
 * 8 handle positions around a bounding rect (in the caller's coordinate space).
 * Works for both physical-px (drawing) and CSS-px (registration) inputs.
 */
export function pts(bx, by, bw, bh) {
  return [
    { x: bx,        y: by        },  // nw
    { x: bx + bw/2, y: by        },  // n
    { x: bx + bw,   y: by        },  // ne
    { x: bx + bw,   y: by + bh/2 },  // e
    { x: bx + bw,   y: by + bh   },  // se
    { x: bx + bw/2, y: by + bh   },  // s
    { x: bx,        y: by + bh   },  // sw
    { x: bx,        y: by + bh/2 },  // w
  ];
}

/** Rotate a CSS-px point around a center. */
export function rotPt(px, py, { cx, cy, rad }) {
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = px - cx, dy = py - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** Draw the dashed selection box. bx/by/bw/bh in physical pixels. */
export function drawBox(ckCanvas, CK, bx, by, bw, bh, accent, dpr) {
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

/** Draw the 8 square scale handles. bx/by/bw/bh in physical pixels. */
export function drawHandleVisuals(ckCanvas, CK, bx, by, bw, bh, dpr, accent, bg) {
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

  for (const { x, y } of pts(bx, by, bw, bh)) {
    const r = CK.XYWHRect(x - hh, y - hh, hs, hs);
    ckCanvas.drawRect(r, fillPaint);
    ckCanvas.drawRect(r, strPaint);
  }

  fillPaint.delete();
  strPaint.delete();
}

/** Draw the plus-sign origin crosshair. op_css: CSS-px position. */
export function drawOriginCrosshair(ckCanvas, CK, op_css, dpr, accent) {
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

/**
 * Build the hit-area handle array for a bounding box.
 * All values in CSS pixels.
 * rot: null for axis-aligned, or { cx, cy, rad } for rotated.
 * Returns an array of handle objects suitable for pushing into a _handles list.
 */
export function buildHandles(bx, by, bw, bh, rot) {
  const handles = [];
  const hs  = HANDLE_SIZE;
  const pad = HIT_PAD;
  const hh  = hs / 2;

  const handlePts = pts(bx, by, bw, bh);
  const ids = ['nw','n','ne','e','se','s','sw','w'];
  for (let i = 0; i < handlePts.length; i++) {
    const p = rot ? rotPt(handlePts[i].x, handlePts[i].y, rot) : handlePts[i];
    handles.push({ part: ids[i], x: p.x - hh - pad, y: p.y - hh - pad, w: hs + pad * 2, h: hs + pad * 2 });
  }

  // Invisible rotate zones at the 4 corners.
  const rz = ROTATE_ZONE_OUT + pad;
  const selCx = rot ? rotPt(bx + bw / 2, by + bh / 2, rot).x : bx + bw / 2;
  const selCy = rot ? rotPt(bx + bw / 2, by + bh / 2, rot).y : by + bh / 2;
  for (let i = 0; i < 4; i++) {
    const p = rot ? rotPt(handlePts[_ROTATE_CORNER_IDX[i]].x, handlePts[_ROTATE_CORNER_IDX[i]].y, rot)
                  : handlePts[_ROTATE_CORNER_IDX[i]];
    handles.push({
      part: `rotate-${_ROTATE_CORNER_NAMES[i]}`,
      x: p.x - rz, y: p.y - rz, w: rz * 2, h: rz * 2,
      pcx: p.x, pcy: p.y,
      ix: Math.sign(selCx - p.x),
      iy: Math.sign(selCy - p.y),
    });
  }

  return handles;
}

/**
 * Hit-test a CSS-pixel canvas position against a handle list.
 * Shared by OverlayObject.hitAtPoint() and selection.handleAtPoint().
 * @param {number} cx  canvas-relative CSS x (clientX - canvasRect.left)
 * @param {number} cy  canvas-relative CSS y
 * @param {Array}  handles
 * @returns {{ part: string } | null}
 */
export function hitHandle(cx, cy, handles) {
  for (const h of handles) {
    if (h.r !== undefined) {
      if (Math.hypot(cx - h.x, cy - h.y) <= h.r) return { part: h.part };
    } else {
      if (cx >= h.x && cx <= h.x + h.w && cy >= h.y && cy <= h.y + h.h) {
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
