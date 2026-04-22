import { Tool } from './base.js';
import { ellipseToPathD } from '../geometry/path-utils.js';
import { applyTransform } from '../viewport.js';
import { getCK } from '../render/renderer.js';

export class EllipseTool extends Tool {
  get id()       { return 'ellipse'; }
  get label()    { return 'Ellipse'; }
  get shortcut() { return 'e'; }
  get icon()     { return 'ellipse'; }

  activate()   { this._cancel(); }
  deactivate() { this._cancel(); }

  onMouseDown(e) {
    if (e.button !== 0) return;
    this._drawing = true;
    this._start   = this._ctx.screenToDoc(e.clientX, e.clientY);
    this._geom    = null;
    this._style   = { ...this._ctx.state.currentStyle };
    this._layer   = this._ctx.overlay.acquireLayer('ellipse-preview');
    this._layer.addCall(ctx => this._drawPreview(ctx));
  }

  onMouseMove(e) {
    if (!this._drawing) return;
    this._geom = this._getEllipse(e);
    this._ctx.render();
  }

  onMouseUp(e) {
    if (!this._drawing) return;
    const { cx, cy, rx, ry } = this._getEllipse(e);
    this._cancel();
    if (rx < 0.5 || ry < 0.5) return;

    const ctx   = this._ctx;
    const ot    = ctx.getObjectType('path');
    const shape = ot.createShape(
      { d: ellipseToPathD({ cx, cy, rx, ry }) },
      { ...ctx.state.currentStyle }
    );
    shape.parentId = ctx.state.activeItemId;

    ctx.execute({
      do()   { ctx.state.items.push(shape); ctx.state.selection = new Set([shape.id]); ctx.render(); },
      undo() { ctx.state.items = ctx.state.items.filter(i => i.id !== shape.id); ctx.state.selection.clear(); ctx.render(); },
    });
  }

  onKeyDown(e) { if (e.key === 'Escape') this._cancel(); }

  _drawPreview(ckCanvas) {
    const g = this._geom;
    if (!g || g.rx < 0.5 || g.ry < 0.5) return;
    const CK = getCK();
    const s  = this._style;
    const z  = this._ctx.state.viewport.zoom;
    const { cx, cy, rx, ry } = g;
    const k  = 0.5522847498;
    ckCanvas.save();
    applyTransform(ckCanvas);
    const d = `M ${cx-rx} ${cy} `
            + `C ${cx-rx} ${cy-ry*k} ${cx-rx*k} ${cy-ry} ${cx} ${cy-ry} `
            + `C ${cx+rx*k} ${cy-ry} ${cx+rx} ${cy-ry*k} ${cx+rx} ${cy} `
            + `C ${cx+rx} ${cy+ry*k} ${cx+rx*k} ${cy+ry} ${cx} ${cy+ry} `
            + `C ${cx-rx*k} ${cy+ry} ${cx-rx} ${cy+ry*k} ${cx-rx} ${cy} Z`;
    const path = CK.Path.MakeFromSVGString(d);
    if (!path) { ckCanvas.restore(); return; }
    if (s.fill && s.fill !== 'none') {
      const p = new CK.Paint();
      p.setStyle(CK.PaintStyle.Fill);
      p.setColor(CK.parseColorString(s.fill));
      p.setAntiAlias(true);
      ckCanvas.drawPath(path, p);
      p.delete();
    }
    if (s.stroke && s.stroke !== 'none') {
      const p = new CK.Paint();
      p.setStyle(CK.PaintStyle.Stroke);
      p.setColor(CK.parseColorString(s.stroke));
      p.setStrokeWidth((s.strokeWidth ?? 1) / z);
      p.setAntiAlias(true);
      ckCanvas.drawPath(path, p);
      p.delete();
    }
    path.delete();
    ckCanvas.restore();
  }

  _getEllipse(e) {
    const pos = this._ctx.screenToDoc(e.clientX, e.clientY);
    let   rx  = Math.abs(pos.x - this._start.x) / 2;
    let   ry  = Math.abs(pos.y - this._start.y) / 2;
    if (e.shiftKey) { const r = Math.min(rx, ry); rx = r; ry = r; }
    return {
      cx: Math.min(this._start.x, pos.x) + rx,
      cy: Math.min(this._start.y, pos.y) + ry,
      rx, ry,
    };
  }

  _cancel() {
    this._drawing = false;
    this._start   = null;
    this._geom    = null;
    this._style   = null;
    if (this._layer) { this._ctx?.overlay.releaseLayer('ellipse-preview'); this._layer = null; }
  }
}
