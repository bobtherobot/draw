import { Tool } from './base.js';
import { rectToPathD } from '../geometry/path-utils.js';

const NS = 'http://www.w3.org/2000/svg';

export class RectTool extends Tool {
  get id()       { return 'rect'; }
  get label()    { return 'Rectangle'; }
  get shortcut() { return 'm'; }
  get icon()     { return 'rect'; }

  activate()   { this._cancel(); }
  deactivate() { this._cancel(); }

  onMouseDown(e) {
    if (e.button !== 0) return;
    this._drawing  = true;
    this._start    = this._ctx.screenToDoc(e.clientX, e.clientY);
    this._layer    = this._ctx.overlay.acquireLayer('rect-preview');
    this._preview  = this._layer.borrow('path');
    const s = this._ctx.state.currentStyle;
    this._preview.setAttribute('fill',         s.fill        ?? 'none');
    this._preview.setAttribute('stroke',       s.stroke      ?? '#000');
    this._preview.setAttribute('stroke-width', s.strokeWidth ?? 1);
    this._preview.style.pointerEvents = 'none';
    this._preview.setAttribute('vector-effect', 'non-scaling-stroke');
  }

  onMouseMove(e) {
    if (!this._drawing) return;
    const { x, y, w, h } = this._getRect(e);
    this._preview.setAttribute('d', rectToPathD({ x, y, width: w, height: h }));
  }

  onMouseUp(e) {
    if (!this._drawing) return;
    const { x, y, w, h } = this._getRect(e);
    this._cancel();
    if (w < 1 || h < 1) return;

    const ctx   = this._ctx;
    const ot    = ctx.getObjectType('path');
    const shape = ot.createShape(
      { d: rectToPathD({ x, y, width: w, height: h }) },
      { ...ctx.state.currentStyle }
    );
    const layer = ctx.state.layers.find(l => l.id === ctx.state.activeLayerId) ?? ctx.state.layers[0];

    ctx.execute({
      do()   { layer.shapes.push(shape); ctx.state.selection = new Set([shape.id]); ctx.render(); },
      undo() { layer.shapes = layer.shapes.filter(s => s.id !== shape.id); ctx.state.selection.clear(); ctx.render(); },
    });
  }

  onKeyDown(e) { if (e.key === 'Escape') this._cancel(); }

  _getRect(e) {
    const pos  = this._ctx.screenToDoc(e.clientX, e.clientY);
    let   w    = Math.abs(pos.x - this._start.x);
    let   h    = Math.abs(pos.y - this._start.y);
    if (e.shiftKey) { const s = Math.min(w, h); w = s; h = s; }
    return { x: Math.min(this._start.x, pos.x), y: Math.min(this._start.y, pos.y), w, h };
  }

  _cancel() {
    this._drawing = false;
    this._start   = null;
    if (this._layer) { this._ctx?.overlay.releaseLayer('rect-preview'); this._layer = null; }
    this._preview = null;
  }
}
