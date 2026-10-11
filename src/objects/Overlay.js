/**
 * Overlay — per-item visual handles rendered in screen-space.
 *
 * One Overlay is created per display item. It is responsible for
 * drawing the selection box, scale handles, rotate zones, and origin
 * crosshair for a single selected item, and for hit-testing those handles.
 *
 * draw() is called by renderSelection() in selection.js for single-item
 * selections.  hitAtPoint() is called by handleAtPoint() in selection.js.
 *
 * All coordinates in _localHandles are CSS pixels (canvas-relative), matching
 * the convention used by selection.js's _handles array.
 */
import {
  css, docToCSS,
  drawBox, drawHandleVisuals, drawOriginCrosshair,
  buildHandles, hitHandle,
  ORIGIN_HIT_R, HIT_PAD,
} from '../render/selection-draw.js';

export class Overlay {
  constructor(itemId) {
    this._itemId       = itemId;
    this.isVisible     = false;
    this.isHovered     = false;
    this._localHandles = [];
  }

  get itemId() { return this._itemId; }

  /**
   * Draw selection handles for a single selected item and populate _localHandles.
   * Called by renderSelection() when selection.size === 1 and !state.activeRotation.
   *
   * @param {object} ckCanvas
   * @param {object} CK          CanvasKit instance (passed in to avoid import cycle)
   * @param {import('./Container.js').Container} abstract
   * @param {{x:number, y:number, zoom:number}} viewport
   * @param {number} dpr         window.devicePixelRatio
   * @param {{x:number,y:number}|null} selectionOrigin  ctx.state.selectionOrigin
   */
  draw(ckCanvas, CK, abstract, viewport, dpr, selectionOrigin) {
    this._localHandles = [];
    const shape   = abstract.shape;
    const dc     = docToCSS(viewport);
    const accent = css('--theme-accent')    || '#4a9eff';
    const bg     = css('--theme-bg-raised') || '#ffffff';

    const rotData = shape._rotDisplay;

    if (rotData) {
      this._drawRotated(ckCanvas, CK, rotData, dc, dpr, accent, bg, shape, selectionOrigin);
    } else {
      const bb = abstract.displayObject?.getBBox(shape);
      if (!bb) return;

      const tl = dc(bb.x,            bb.y);
      const br = dc(bb.x + bb.width, bb.y + bb.height);
      const bx_css = tl.x, by_css = tl.y, bw_css = br.x - tl.x, bh_css = br.y - tl.y;
      const bx = bx_css * dpr, by = by_css * dpr;
      const bw = bw_css * dpr, bh = bh_css * dpr;

      ckCanvas.save();
      drawBox(ckCanvas, CK, bx, by, bw, bh, accent, dpr);
      drawHandleVisuals(ckCanvas, CK, bx, by, bw, bh, dpr, accent, bg);
      ckCanvas.restore();

      this._localHandles.push(...buildHandles(bx_css, by_css, bw_css, bh_css, null));

      const ox = shape._origin?.x ?? selectionOrigin?.x ?? (bb.x + bb.width  / 2);
      const oy = shape._origin?.y ?? selectionOrigin?.y ?? (bb.y + bb.height / 2);
      const op = dc(ox, oy);
      drawOriginCrosshair(ckCanvas, CK, op, dpr, accent);
      this._localHandles.push({ part: 'origin', x: op.x, y: op.y, r: ORIGIN_HIT_R + HIT_PAD });
    }
  }

  /**
   * Hit-test a canvas-relative CSS position against this item's handles.
   * @param {number} cssCx  clientX - canvasRect.left
   * @param {number} cssCy  clientY - canvasRect.top
   * @returns {{ part: string } | null}
   */
  hitAtPoint(cssCx, cssCy) {
    return hitHandle(cssCx, cssCy, this._localHandles);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _drawRotated(ckCanvas, CK, rotData, dc, dpr, accent, bg, shape, selectionOrigin) {
    const { bbox: bb, center, angle } = rotData;
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

    this._localHandles.push(...buildHandles(bx_css, by_css, bw_css, bh_css, { cx: cp_css.x, cy: cp_css.y, rad }));

    const ox = shape._origin?.x ?? selectionOrigin?.x ?? center.x;
    const oy = shape._origin?.y ?? selectionOrigin?.y ?? center.y;
    const op = dc(ox, oy);
    drawOriginCrosshair(ckCanvas, CK, op, dpr, accent);
    this._localHandles.push({ part: 'origin', x: op.x, y: op.y, r: ORIGIN_HIT_R + HIT_PAD });
  }
}
