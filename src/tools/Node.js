/**
 * Node editing tool — direct selection of path anchors and bezier handles.
 */
import { BaseTool } from './BaseTool.js';
import { buildPenPathD, parsePenAnchors } from '../utils/geometry/pen-path.js';
import { findShape } from '../core/state.js';
import { applyTransform, getCanvasRect } from '../core/Viewport.js';
import { getCK } from '../render/renderer.js';

const HIT_R = 6; // screen-px hit radius

export class Node extends BaseTool {
  get id()       { return 'node'; }
  get label()    { return 'Node'; }
  get shortcut() { return 'a'; }
  get icon()     { return 'node'; }

  init(ctx) {
    super.init(ctx);
    this._layer = null;
  }

  activate() {
    this._mode          = 'idle';
    this._editingIds    = new Set();
    this._anchorsMap    = new Map();
    this._closedMap     = new Map();
    this._selMap        = new Map();
    this._dragStart     = null;
    this._dragAnchor    = null;
    this._dragHandle    = null;
    this._preDs         = new Map();
    this._marqueeStart  = null;

    this._ensureLayer();
    this._redraw();

    for (const id of this._ctx.state.selection) {
      this._beginEditing(id);
    }
    this._redraw();
  }

  deactivate() {
    this._editingIds.clear();
    this._anchorsMap.clear();
    this._closedMap.clear();
    this._selMap.clear();
    if (this._layer) {
      this._ctx?.overlay.releaseLayer('node');
      this._layer = null;
    }
  }

  onMouseDown(e) {
    if (e.button !== 0) return;
    const ctx  = this._ctx;
    const pos  = ctx.screenToDoc(e.clientX, e.clientY);

    this._dragStart = pos;

    const hh = this._hitHandle(e.clientX, e.clientY);
    if (hh) {
      this._mode       = 'drag-handle';
      this._dragHandle = hh;
      this._preDs      = this._snapshotDs();
      return;
    }

    const ha = this._hitAnchor(e.clientX, e.clientY);
    if (ha) {
      const { shapeId, anchorIdx } = ha;
      if (!e.shiftKey) {
        for (const [id, sel] of this._selMap) {
          if (id !== shapeId) sel.clear();
        }
        if (!this._selMap.has(shapeId)) this._selMap.set(shapeId, new Set());
        if (!this._selMap.get(shapeId).has(anchorIdx)) {
          this._selMap.get(shapeId).clear();
        }
        this._selMap.get(shapeId).add(anchorIdx);
      } else {
        if (!this._selMap.has(shapeId)) this._selMap.set(shapeId, new Set());
        this._selMap.get(shapeId).add(anchorIdx);
      }
      this._mode       = 'drag-anchor';
      this._dragAnchor = ha;
      this._preDs      = this._snapshotDs();
      this._redraw();
      return;
    }

    if (!e.shiftKey) {
      for (const sel of this._selMap.values()) sel.clear();
    }
    this._mode         = 'marquee';
    this._marqueeStart = pos;
    this._redraw();
  }

  onMouseMove(e) {
    if (this._mode === 'idle') return;
    const ctx = this._ctx;
    const pos = ctx.screenToDoc(e.clientX, e.clientY);
    const dx  = pos.x - this._dragStart.x;
    const dy  = pos.y - this._dragStart.y;

    if (this._mode === 'drag-anchor') {
      const { shapeId } = this._dragAnchor;
      const anchors = this._anchorsMap.get(shapeId);
      if (!anchors) return;
      const sel = this._selMap.get(shapeId) ?? new Set();
      for (const i of sel) {
        const a = anchors[i];
        a.x += pos.x - this._dragStart.x;
        a.y += pos.y - this._dragStart.y;
        if (a.hIn)  { a.hIn.x  += dx; a.hIn.y  += dy; }
        if (a.hOut) { a.hOut.x += dx; a.hOut.y += dy; }
      }
      this._dragStart = pos;
      this._applyAnchors(shapeId);
      ctx.render();
    } else if (this._mode === 'drag-handle') {
      const { shapeId, anchorIdx, side } = this._dragHandle;
      const anchors = this._anchorsMap.get(shapeId);
      if (!anchors) return;
      const a = anchors[anchorIdx];
      if (side === 'out') {
        a.hOut = { x: pos.x, y: pos.y };
        if (a.hIn) a.hIn = { x: a.x - (pos.x - a.x), y: a.y - (pos.y - a.y) };
      } else {
        a.hIn = { x: pos.x, y: pos.y };
        if (a.hOut) a.hOut = { x: a.x - (pos.x - a.x), y: a.y - (pos.y - a.y) };
      }
      this._applyAnchors(shapeId);
      ctx.render();
    } else if (this._mode === 'marquee') {
      this._updateMarqueeSelection(this._marqueeStart, pos, e.shiftKey);
    }

    this._redraw();
  }

  onMouseUp(e) {
    if (this._mode === 'drag-anchor' || this._mode === 'drag-handle') {
      const preDs  = this._preDs;
      const postDs = this._snapshotDs();
      const ctx    = this._ctx;
      ctx.execute({
        do()   { for (const [id, d] of postDs) { const s = findShape(id); if (s) s.attrs.d = d; } ctx.render(); },
        undo() { for (const [id, d] of preDs)  { const s = findShape(id); if (s) s.attrs.d = d; } ctx.render(); },
      });
    }
    this._mode         = 'idle';
    this._dragAnchor   = null;
    this._dragHandle   = null;
    this._marqueeStart = null;
    this._preDs.clear();
    this._redraw();
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      for (const sel of this._selMap.values()) sel.clear();
      this._redraw();
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _ensureLayer() {
    if (!this._layer) this._layer = this._ctx.overlay.acquireLayer('node');
  }

  _beginEditing(shapeId) {
    const found = findShape(shapeId);
    if (!found || found.type !== 'path') return;
    const { anchors, closed } = parsePenAnchors(found.attrs.d ?? '');
    this._editingIds.add(shapeId);
    this._anchorsMap.set(shapeId, anchors);
    this._closedMap.set(shapeId, closed);
    this._selMap.set(shapeId, new Set());
  }

  _applyAnchors(shapeId) {
    const anchors = this._anchorsMap.get(shapeId);
    const closed  = this._closedMap.get(shapeId) ?? false;
    const d       = buildPenPathD(anchors, closed);
    const found = findShape(shapeId);
    if (found) found.attrs.d = d;
  }

  _snapshotDs() {
    const snap = new Map();
    for (const id of this._editingIds) {
      const found = findShape(id);
      if (found) snap.set(id, found.attrs.d ?? '');
    }
    return snap;
  }

  _redraw() {
    this._ensureLayer();
    this._layer.clear();
    if (this._anchorsMap.size > 0 || (this._mode === 'marquee' && this._marqueeStart)) {
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

    const linePaint = new CK.Paint();
    linePaint.setStyle(CK.PaintStyle.Stroke);
    linePaint.setColor(CK.parseColorString(dim));
    linePaint.setStrokeWidth(sw);
    linePaint.setAntiAlias(false);

    const dotPaint = new CK.Paint();
    dotPaint.setStyle(CK.PaintStyle.Fill);
    dotPaint.setColor(CK.parseColorString(accent));
    dotPaint.setAntiAlias(true);

    const anchorFill   = new CK.Paint();
    anchorFill.setStyle(CK.PaintStyle.Fill);
    anchorFill.setAntiAlias(false);

    const anchorStroke = new CK.Paint();
    anchorStroke.setStyle(CK.PaintStyle.Stroke);
    anchorStroke.setColor(CK.parseColorString(accent));
    anchorStroke.setStrokeWidth(1.5 / z);
    anchorStroke.setAntiAlias(true);

    for (const [id, anchors] of this._anchorsMap) {
      const sel = this._selMap.get(id) ?? new Set();
      for (let i = 0; i < anchors.length; i++) {
        const a     = anchors[i];
        const isSel = sel.has(i);

        if (isSel) {
          for (const h of [a.hIn, a.hOut]) {
            if (!h) continue;
            const lp = CK.Path.MakeFromSVGString(`M ${a.x} ${a.y} L ${h.x} ${h.y}`);
            if (lp) { ckCanvas.drawPath(lp, linePaint); lp.delete(); }
            ckCanvas.drawCircle(h.x, h.y, hr, dotPaint);
          }
        }

        anchorFill.setColor(CK.parseColorString(isSel ? accent : bg));
        const r = CK.XYWHRect(a.x - hs, a.y - hs, hs * 2, hs * 2);
        ckCanvas.drawRect(r, anchorFill);
        ckCanvas.drawRect(r, anchorStroke);
      }
    }

    // Marquee rect
    if (this._mode === 'marquee' && this._marqueeStart && this._dragStart) {
      const s   = this._marqueeStart;
      const e   = this._dragStart;
      const x   = Math.min(s.x, e.x);
      const y   = Math.min(s.y, e.y);
      const w   = Math.abs(e.x - s.x);
      const h   = Math.abs(e.y - s.y);
      const sel = _css('--theme-selection') || 'rgba(74,158,255,0.22)';
      const rect = CK.XYWHRect(x, y, w, h);

      const fillPaint = new CK.Paint();
      fillPaint.setStyle(CK.PaintStyle.Fill);
      fillPaint.setColor(CK.parseColorString(sel));
      ckCanvas.drawRect(rect, fillPaint);
      fillPaint.delete();

      const dashPaint = new CK.Paint();
      dashPaint.setStyle(CK.PaintStyle.Stroke);
      dashPaint.setColor(CK.parseColorString(accent));
      dashPaint.setStrokeWidth(sw);
      const dashEffect = CK.PathEffect.MakeDash([4 / z, 3 / z]);
      dashPaint.setPathEffect(dashEffect);
      ckCanvas.drawRect(rect, dashPaint);
      dashEffect.delete();
      dashPaint.delete();
    }

    linePaint.delete();
    dotPaint.delete();
    anchorFill.delete();
    anchorStroke.delete();

    ckCanvas.restore();
  }

  _hitAnchor(screenX, screenY) {
    const z = this._ctx.state.viewport.zoom;
    const { left, top } = getCanvasRect();
    for (const [id, anchors] of this._anchorsMap) {
      for (let i = 0; i < anchors.length; i++) {
        const a  = anchors[i];
        const sx = (a.x - this._ctx.state.viewport.x) * z + left;
        const sy = (a.y - this._ctx.state.viewport.y) * z + top;
        if (Math.hypot(screenX - sx, screenY - sy) < HIT_R) {
          return { shapeId: id, anchorIdx: i };
        }
      }
    }
    return null;
  }

  _hitHandle(screenX, screenY) {
    const z = this._ctx.state.viewport.zoom;
    const { left, top } = getCanvasRect();
    for (const [id, anchors] of this._anchorsMap) {
      const sel = this._selMap.get(id) ?? new Set();
      for (let i = 0; i < anchors.length; i++) {
        if (!sel.has(i)) continue;
        const a = anchors[i];
        for (const [h, side] of [[a.hIn, 'in'], [a.hOut, 'out']]) {
          if (!h) continue;
          const sx = (h.x - this._ctx.state.viewport.x) * z + left;
          const sy = (h.y - this._ctx.state.viewport.y) * z + top;
          if (Math.hypot(screenX - sx, screenY - sy) < HIT_R) {
            return { shapeId: id, anchorIdx: i, side };
          }
        }
      }
    }
    return null;
  }

  _updateMarqueeSelection(start, end, additive) {
    const x0 = Math.min(start.x, end.x);
    const y0 = Math.min(start.y, end.y);
    const x1 = Math.max(start.x, end.x);
    const y1 = Math.max(start.y, end.y);
    if (!additive) for (const sel of this._selMap.values()) sel.clear();
    for (const [id, anchors] of this._anchorsMap) {
      if (!this._selMap.has(id)) this._selMap.set(id, new Set());
      const sel = this._selMap.get(id);
      for (let i = 0; i < anchors.length; i++) {
        const { x, y } = anchors[i];
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) sel.add(i);
      }
    }
  }
}

function _css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
