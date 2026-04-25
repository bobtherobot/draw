import { BaseTool } from './BaseTool.js';
import { startEditing, isEditing } from '../core/TextEdit.js';
import { applyTransform } from '../core/Viewport.js';
import { getCK } from '../render/renderer.js';

export class TypeArea extends BaseTool {
  get id()       { return 'type-area'; }
  get label()    { return 'Area Text'; }
  get shortcut() { return null; }
  get icon()     { return 'type-area'; }

  activate()   { this._cancel(); }
  deactivate() { this._cancel(); }

  onMouseDown(e) {
    if (e.button !== 0 || isEditing()) return;
    this._clearSelection();
    this._drawing = true;
    this._start   = this._ctx.screenToDoc(e.clientX, e.clientY);
    this._geom    = null;
    this._layer   = this._ctx.overlay.acquireLayer('typearea-preview');
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
        const ot    = ctx.getBaseObject('text-block');
        const shape = ot.createShape(
          { x, y, _text: text, _fontSize: 14, _fontFamily: 'sans-serif', _boxWidth: w, _boxHeight: h },
          { fill: ctx.state.currentStyle.fill ?? '#000000', stroke: 'none', strokeWidth: 1 }
        );
        shape.parentId = ctx.state.activeItemId;
        ctx.execute({
          do()   { ctx.state.items.push(shape); ctx.state.selection = new Set([shape.id]); ctx.render(); },
          undo() { ctx.state.items = ctx.state.items.filter(i => i.id !== shape.id); ctx.state.selection.clear(); ctx.render(); },
        });
      },
    });
  }

  onKeyDown(e) { if (e.key === 'Escape') this._cancel(); }

  _drawPreview(ckCanvas) {
    const g = this._geom;
    if (!g || g.w < 1 || g.h < 1) return;
    const CK     = getCK();
    const z      = this._ctx.state.viewport.zoom;
    const accent = _css('--theme-accent') || '#4a9eff';
    ckCanvas.save();
    applyTransform(ckCanvas);
    const paint = new CK.Paint();
    paint.setStyle(CK.PaintStyle.Stroke);
    paint.setColor(CK.parseColorString(accent));
    paint.setStrokeWidth(1 / z);
    const dashEffect = CK.PathEffect.MakeDash([4 / z, 3 / z]);
    paint.setPathEffect(dashEffect);
    ckCanvas.drawRect(CK.XYWHRect(g.x, g.y, g.w, g.h), paint);
    dashEffect.delete();
    paint.delete();
    ckCanvas.restore();
  }

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
    this._geom    = null;
    if (this._layer) { this._ctx?.overlay.releaseLayer('typearea-preview'); this._layer = null; }
  }
}

function _css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
