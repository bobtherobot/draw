import { BaseTool } from './BaseTool.js';
import { rectToPathD } from '../utils/geometry/path-utils.js';
import { applyTransform } from '../core/Viewport.js';
import { getCK } from '../render/renderer.js';

export class Rect extends BaseTool {
  get id()       { return 'rect'; }
  get label()    { return 'Rectangle'; }
  get shortcut() { return 'm'; }
  get icon()     { return 'rect'; }

  activate()   { this._cancel(); }
  deactivate() { this._cancel(); }

  onMouseDown(e) {
    if (e.button !== 0) return;
    this._clearSelection();
    this._drawing = true;
    this._start   = this._ctx.screenToDoc(e.clientX, e.clientY);
    this._geom    = null;
    this._style   = { ...this._ctx.state.currentStyle };
    this._layer   = this._ctx.overlay.acquireLayer('rect-preview');
    this._layer.addCall(ctx => this._drawPreview(ctx));
  }

  onMouseMove(e) {
    if (!this._drawing) return;
    this._geom = this._getRect(e);
    this._ctx.render();
  }

  onMouseUp(e) {
    if (!this._drawing) return;
    const { x, y, w, h } = this._getRect(e);
    this._cancel();
    if (w < 1 || h < 1) return;

    const ctx   = this._ctx;
    const ot    = ctx.getDisplayObject('path');
    const shape = ot.createShape(
      { d: rectToPathD({ x, y, width: w, height: h }) },
      { ...ctx.state.currentStyle }
    );
    shape.parentId = ctx.state.activeContainerId;

    ctx.execute({
      do()   { ctx.state.shapes.push(shape); ctx.state.selection = new Set([shape.id]); ctx.render(); },
      undo() { ctx.state.shapes = ctx.state.shapes.filter(i => i.id !== shape.id); ctx.state.selection.clear(); ctx.render(); },
    });
  }

  onKeyDown(e) { if (e.key === 'Escape') this._cancel(); }

  _drawPreview(ckCanvas) {
    const g = this._geom;
    if (!g || g.w < 1 || g.h < 1) return;
    const CK = getCK();
    const s  = this._style;
    const z  = this._ctx.state.viewport.zoom;
    ckCanvas.save();
    applyTransform(ckCanvas);
    const rect = CK.XYWHRect(g.x, g.y, g.w, g.h);
    if (s.fill && s.fill !== 'none') {
      const p = new CK.Paint();
      p.setStyle(CK.PaintStyle.Fill);
      p.setColor(CK.parseColorString(s.fill));
      p.setAntiAlias(true);
      ckCanvas.drawRect(rect, p);
      p.delete();
    }
    if (s.stroke && s.stroke !== 'none') {
      const p = new CK.Paint();
      p.setStyle(CK.PaintStyle.Stroke);
      p.setColor(CK.parseColorString(s.stroke));
      p.setStrokeWidth((s.strokeWidth ?? 1) / z);
      p.setAntiAlias(true);
      ckCanvas.drawRect(rect, p);
      p.delete();
    }
    ckCanvas.restore();
  }

  _getRect(e) {
    const pos = this._ctx.screenToDoc(e.clientX, e.clientY);
    let   w   = Math.abs(pos.x - this._start.x);
    let   h   = Math.abs(pos.y - this._start.y);
    if (e.shiftKey) { const s = Math.min(w, h); w = s; h = s; }
    return { x: Math.min(this._start.x, pos.x), y: Math.min(this._start.y, pos.y), w, h };
  }

  _cancel() {
    this._drawing = false;
    this._start   = null;
    this._geom    = null;
    this._style   = null;
    if (this._layer) { this._ctx?.overlay.releaseLayer('rect-preview'); this._layer = null; }
  }
}
