import { Tool } from './base.js';
import { startEditing, isEditing } from '../textedit.js';
import { rectToPathD } from '../geometry/path-utils.js';

export class TypeAreaTool extends Tool {
  get id()       { return 'type-area'; }
  get label()    { return 'Area Text'; }
  get shortcut() { return null; }
  get icon()     { return 'type-area'; }

  activate()   { this._cancel(); }
  deactivate() { this._cancel(); }

  onMouseDown(e) {
    if (e.button !== 0 || isEditing()) return;
    this._drawing = true;
    this._start   = this._ctx.screenToDoc(e.clientX, e.clientY);
    this._layer   = this._ctx.overlay.acquireLayer('typearea-preview');
    this._preview = this._layer.borrow('path');
    this._preview.setAttribute('fill',         'none');
    this._preview.setAttribute('stroke',       'var(--theme-accent, #4a9eff)');
    this._preview.setAttribute('stroke-width', 1);
    this._preview.setAttribute('vector-effect', 'non-scaling-stroke');
    this._preview.style.pointerEvents = 'none';
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
    if (w < 4 || h < 4) return;

    const ctx = this._ctx;

    startEditing({
      docX:      x,
      docY:      y,
      fontSize:  14,
      fill:      ctx.state.currentStyle.fill ?? '#000000',
      zoom:      ctx.state.viewport.zoom,
      boxWidth:  w,
      boxHeight: h,
      onCommit: (text) => {
        if (!text.trim()) return;
        const ot    = ctx.getObjectType('text-block');
        const shape = ot.createShape(
          { x, y, _text: text, _fontSize: 14, _fontFamily: 'sans-serif', _boxWidth: w, _boxHeight: h },
          { fill: ctx.state.currentStyle.fill ?? '#000000', stroke: 'none', strokeWidth: 1 }
        );
        const layer = ctx.state.layers.find(l => l.id === ctx.state.activeLayerId) ?? ctx.state.layers[0];
        ctx.execute({
          do()   { layer.shapes.push(shape); ctx.state.selection = new Set([shape.id]); ctx.render(); },
          undo() { layer.shapes = layer.shapes.filter(s => s.id !== shape.id); ctx.state.selection.clear(); ctx.render(); },
        });
      },
    });
  }

  onKeyDown(e) { if (e.key === 'Escape') this._cancel(); }

  _getRect(e) {
    const pos = this._ctx.screenToDoc(e.clientX, e.clientY);
    return {
      x: Math.min(this._start.x, pos.x),
      y: Math.min(this._start.y, pos.y),
      w: Math.abs(pos.x - this._start.x),
      h: Math.abs(pos.y - this._start.y),
    };
  }

  _cancel() {
    this._drawing = false;
    this._start   = null;
    if (this._layer) { this._ctx?.overlay.releaseLayer('typearea-preview'); this._layer = null; }
    this._preview = null;
  }
}
