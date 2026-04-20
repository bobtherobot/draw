import { Tool } from './base.js';
import { ellipseToPathD } from '../geometry/path-utils.js';

const NS = 'http://www.w3.org/2000/svg';

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
    this._layer   = this._ctx.overlay.acquireLayer('ellipse-preview');
    this._preview = this._layer.borrow('path');
    const s = this._ctx.state.currentStyle;
    this._preview.setAttribute('fill',         s.fill        ?? 'none');
    this._preview.setAttribute('stroke',       s.stroke      ?? '#000');
    this._preview.setAttribute('stroke-width', s.strokeWidth ?? 1);
    this._preview.style.pointerEvents = 'none';
    this._preview.setAttribute('vector-effect', 'non-scaling-stroke');
  }

  onMouseMove(e) {
    if (!this._drawing) return;
    const { cx, cy, rx, ry } = this._getEllipse(e);
    this._preview.setAttribute('d', ellipseToPathD({ cx, cy, rx, ry }));
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
    const layer = ctx.state.layers.find(l => l.id === ctx.state.activeLayerId) ?? ctx.state.layers[0];

    ctx.execute({
      do()   { layer.shapes.push(shape); ctx.state.selection = new Set([shape.id]); ctx.render(); },
      undo() { layer.shapes = layer.shapes.filter(s => s.id !== shape.id); ctx.state.selection.clear(); ctx.render(); },
    });
  }

  onKeyDown(e) { if (e.key === 'Escape') this._cancel(); }

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
    if (this._layer) { this._ctx?.overlay.releaseLayer('ellipse-preview'); this._layer = null; }
    this._preview = null;
  }
}
