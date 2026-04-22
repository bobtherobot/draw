/**
 * Bezier pen tool.
 *
 * Anchor format: { x, y, hIn: {x,y}|null, hOut: {x,y}|null }
 *   click              → corner anchor
 *   mousedown+drag     → smooth anchor (drag direction sets hOut, mirrors hIn)
 *   click on first (≥2 pts) → close path
 *   click+drag on first    → close and set closing curve
 *   Enter / dblclick   → finish open path
 *   Escape             → cancel
 */
import { Tool } from './base.js';
import { buildPenPathD } from '../geometry/pen-path.js';
import { applyTransform, getCanvasRect } from '../viewport.js';
import { getCK } from '../render/renderer.js';

const CLOSE_RADIUS = 8; // screen px

export class PenTool extends Tool {
  get id()       { return 'pen'; }
  get label()    { return 'Pen'; }
  get shortcut() { return 'p'; }
  get icon()     { return 'pen'; }

  init(ctx) {
    super.init(ctx);
    this._layer = null;
  }

  activate() {
    this._active    = false;
    this._anchors   = [];
    this._mouseDown = false;
    this._closing   = false;
    this._cursor    = null;
    this._ensureLayer();
    this._redraw();
  }

  deactivate() {
    this._cancel();
    if (this._layer) {
      this._ctx?.overlay.releaseLayer('pen');
      this._layer = null;
    }
  }

  onMouseDown(e) {
    if (e.button !== 0) return;
    this._mouseDown = true;
    const pos = this._ctx.screenToDoc(e.clientX, e.clientY);

    if (!this._active) {
      this._active  = true;
      this._anchors = [{ x: pos.x, y: pos.y, hIn: null, hOut: null }];
    } else if (this._anchors.length >= 2 && this._nearFirst(e.clientX, e.clientY)) {
      this._closing = true;
    } else {
      this._anchors.push({ x: pos.x, y: pos.y, hIn: null, hOut: null });
    }
    this._redraw();
  }

  onMouseMove(e) {
    this._cursor = this._ctx.screenToDoc(e.clientX, e.clientY);

    if (this._mouseDown) {
      const z = this._ctx.state.viewport.zoom;
      if (this._closing) {
        const a0 = this._anchors[0];
        const dx = this._cursor.x - a0.x;
        const dy = this._cursor.y - a0.y;
        if (Math.hypot(dx, dy) > 2 / z) {
          a0.hOut = { x: a0.x + dx, y: a0.y + dy };
          a0.hIn  = { x: a0.x - dx, y: a0.y - dy };
        }
      } else if (this._anchors.length > 0) {
        const last = this._anchors[this._anchors.length - 1];
        const dx = this._cursor.x - last.x;
        const dy = this._cursor.y - last.y;
        if (Math.hypot(dx, dy) > 2 / z) {
          last.hOut = { x: last.x + dx, y: last.y + dy };
          last.hIn  = { x: last.x - dx, y: last.y - dy };
        }
      }
    }
    this._redraw();
  }

  onMouseUp(e) {
    if (this._closing) {
      this._closing   = false;
      this._mouseDown = false;
      this._finalize(true);
      return;
    }
    this._mouseDown = false;
  }

  onDblClick(_e) {
    if (!this._active) return;
    if (this._anchors.length > 1) this._anchors.pop();
    this._finalize(false);
  }

  onKeyDown(e) {
    if (!this._active) return;
    if (e.key === 'Enter')  { e.preventDefault(); this._finalize(false); }
    if (e.key === 'Escape') this._cancel();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _ensureLayer() {
    if (!this._layer) {
      this._layer = this._ctx.overlay.acquireLayer('pen');
    }
  }

  _redraw() {
    this._ensureLayer();
    this._layer.clear();
    if (this._active || this._anchors.length > 0) {
      this._layer.addCall(ctx => this._drawOverlay(ctx));
    }
    this._ctx.render();
  }

  _drawOverlay(ckCanvas) {
    const CK     = getCK();
    const z      = this._ctx.state.viewport.zoom;
    const sw     = 1 / z;
    const hs     = 4 / z;
    const hr     = 3 / z;
    const accent = _css('--theme-accent')    || '#4a9eff';
    const bg     = _css('--theme-bg-raised') || '#ffffff';
    const dim    = _css('--theme-fg-dim')    || '#888888';

    ckCanvas.save();
    applyTransform(ckCanvas);

    // Preview path (committed segments + rubber-band to cursor)
    let d = buildPenPathD(this._anchors, false);
    if (this._active && this._anchors.length > 0) {
      if (this._closing) {
        d += this._closingPreview();
      } else if (this._cursor) {
        d += this._rubberBand(this._anchors[this._anchors.length - 1], this._cursor);
      }
    }

    if (d) {
      const ckPath = CK.Path.MakeFromSVGString(d);
      if (ckPath) {
        const paint = new CK.Paint();
        paint.setStyle(CK.PaintStyle.Stroke);
        paint.setColor(CK.parseColorString(accent));
        paint.setStrokeWidth(sw);
        paint.setAntiAlias(true);
        ckCanvas.drawPath(ckPath, paint);
        ckPath.delete();
        paint.delete();
      }
    }

    // Handles and anchors
    const handleLinePaint = new CK.Paint();
    handleLinePaint.setStyle(CK.PaintStyle.Stroke);
    handleLinePaint.setColor(CK.parseColorString(dim));
    handleLinePaint.setStrokeWidth(sw);
    handleLinePaint.setAntiAlias(false);

    const dotPaint = new CK.Paint();
    dotPaint.setStyle(CK.PaintStyle.Fill);
    dotPaint.setColor(CK.parseColorString(accent));
    dotPaint.setAntiAlias(true);

    const anchorFillPaint   = new CK.Paint();
    const anchorStrokePaint = new CK.Paint();
    anchorStrokePaint.setStyle(CK.PaintStyle.Stroke);
    anchorStrokePaint.setColor(CK.parseColorString(accent));
    anchorStrokePaint.setStrokeWidth(1.5 / z);
    anchorStrokePaint.setAntiAlias(true);

    for (let i = 0; i < this._anchors.length; i++) {
      const a = this._anchors[i];

      for (const h of [a.hIn, a.hOut]) {
        if (!h) continue;
        const linePath = CK.Path.MakeFromSVGString(`M ${a.x} ${a.y} L ${h.x} ${h.y}`);
        if (linePath) { ckCanvas.drawPath(linePath, handleLinePaint); linePath.delete(); }
        ckCanvas.drawCircle(h.x, h.y, hr, dotPaint);
      }

      anchorFillPaint.setStyle(CK.PaintStyle.Fill);
      anchorFillPaint.setAntiAlias(false);
      anchorFillPaint.setColor(CK.parseColorString((i === 0 && this._closing) ? accent : bg));
      const r = CK.XYWHRect(a.x - hs, a.y - hs, hs * 2, hs * 2);
      ckCanvas.drawRect(r, anchorFillPaint);
      ckCanvas.drawRect(r, anchorStrokePaint);
    }

    handleLinePaint.delete();
    dotPaint.delete();
    anchorFillPaint.delete();
    anchorStrokePaint.delete();

    ckCanvas.restore();
  }

  _rubberBand(prev, cursor) {
    const h1 = prev.hOut || prev;
    const r  = n => Math.round(n * 100) / 100;
    return ` C ${r(h1.x)} ${r(h1.y)} ${r(cursor.x)} ${r(cursor.y)} ${r(cursor.x)} ${r(cursor.y)}`;
  }

  _closingPreview() {
    if (this._anchors.length < 2) return '';
    const last = this._anchors[this._anchors.length - 1];
    const a0   = this._anchors[0];
    const h1 = last.hOut;
    const h2 = a0.hIn;
    const r  = n => Math.round(n * 100) / 100;
    if (!h1 && !h2) return ` L ${r(a0.x)} ${r(a0.y)}`;
    return ` C ${r((h1 || last).x)} ${r((h1 || last).y)} ${r((h2 || a0).x)} ${r((h2 || a0).y)} ${r(a0.x)} ${r(a0.y)}`;
  }

  _finalize(closePath) {
    if (this._anchors.length < 2) { this._cancel(); return; }

    const d     = buildPenPathD(this._anchors, closePath);
    const ctx   = this._ctx;
    const ot    = ctx.getObjectType('path');
    const shape = ot.createShape({ d }, { ...ctx.state.currentStyle });
    shape.parentId = ctx.state.activeItemId;

    ctx.execute({
      do()   { ctx.state.items.push(shape); ctx.state.selection = new Set([shape.id]); ctx.render(); },
      undo() { ctx.state.items = ctx.state.items.filter(i => i.id !== shape.id); ctx.state.selection.clear(); ctx.render(); },
    });

    this._active    = false;
    this._anchors   = [];
    this._closing   = false;
    this._mouseDown = false;
    this._redraw();
  }

  _cancel() {
    this._active    = false;
    this._anchors   = [];
    this._closing   = false;
    this._mouseDown = false;
    this._redraw();
  }

  _nearFirst(screenX, screenY) {
    if (this._anchors.length === 0) return false;
    const a0   = this._anchors[0];
    const { x: vx, y: vy, zoom } = this._ctx.state.viewport;
    const { left, top } = getCanvasRect();
    const sx = (a0.x - vx) * zoom + left;
    const sy = (a0.y - vy) * zoom + top;
    return Math.hypot(screenX - sx, screenY - sy) < CLOSE_RADIUS;
  }
}

function _css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
