import { Tool } from './base.js';
import { startEditing, isEditing, commitEditing } from '../textedit.js';
import { findItem, state, allDisplayItems } from '../core/state.js';

export class TypeTool extends Tool {
  get id()       { return 'type'; }
  get label()    { return 'Text'; }
  get shortcut() { return 't'; }
  get icon()     { return 'type'; }

  activate() {
    this._layer = this._ctx.overlay.acquireLayer('type-hover');
  }

  deactivate() {
    this._layer?.clear();
    this._ctx.overlay.releaseLayer('type-hover');
    this._layer = null;
  }

  onMouseMove() {
    this._layer.clear();
    const shape = state.hover.shape;
    const isOverText = shape && (shape.type === 'free-text' || shape.type === 'text-block');
    if (!isOverText) return;

    const ot = this._ctx.getObjectType(shape.type);
    const el = this._ctx.getElement(shape.id);
    const bb = ot?.getBBox(shape, el);
    if (!bb) return;

    const r = this._layer.borrow('rect');
    r.setAttribute('x',      bb.x);
    r.setAttribute('y',      bb.y);
    r.setAttribute('width',  bb.width);
    r.setAttribute('height', bb.height);
    r.setAttribute('class',  'type-hover-outline');
  }

  onMouseDown(e) {
    if (e.button !== 0) return;
    if (isEditing()) commitEditing();

    const ctx  = this._ctx;
    const pos  = ctx.screenToDoc(e.clientX, e.clientY);
    const zoom = ctx.state.viewport.zoom;

    // If the click lands on any existing text shape, re-edit it (front to back).
    const textShapes = allDisplayItems().filter(s => s.type === 'free-text' || s.type === 'text-block');
    for (let i = textShapes.length - 1; i >= 0; i--) {
      const shape = textShapes[i];
      const ot    = ctx.getObjectType(shape.type);
      const el    = ctx.getElement(shape.id);
      if (ot.hitPart(shape, pos.x, pos.y, zoom, el)) {
        this._openTextEditor(shape);
        return;
      }
    }

    // Otherwise create a new text shape.
    ctx.state.selection = new Set();

    const fontSize   = 14;
    const fontFamily = ctx.state.currentStyle.fontFamily ?? 'sans-serif';
    const textAlign  = ctx.state.currentStyle.textAlign  ?? 'left';
    const fill       = ctx.state.currentStyle.fill ?? '#000000';

    startEditing({
      docX:        pos.x,
      docY:        pos.y,
      fontSize,
      fontFamily,
      textAlign,
      fill,
      zoom,
      initialText: '',
      onInput: () => ctx.render(),
      onCommit: (text) => {
        if (!text.trim()) return;
        const ot    = ctx.getObjectType('free-text');
        const shape = ot.createShape(
          { x: pos.x, y: pos.y, _text: text, _fontSize: fontSize, _fontFamily: fontFamily, _textAlign: textAlign },
          { fill: fill === 'none' ? '#000000' : fill, stroke: 'none', strokeWidth: 1 },
        );
        shape.parentId = ctx.state.activeItemId;
        ctx.execute({
          do()   { ctx.state.items.push(shape); ctx.state.selection = new Set([shape.id]); ctx.render(); },
          undo() { ctx.state.items = ctx.state.items.filter(i => i.id !== shape.id); ctx.state.selection = new Set(); ctx.render(); },
        });
      },
    });
    ctx.render(); // show pending guide immediately on click
  }

  _openTextEditor(shape) {
    this._layer?.clear();
    const ctx    = this._ctx;
    ctx.state.selection = new Set([shape.id]);
    ctx.render();
    const snap   = { _text: shape._text };
    const shapeId = shape.id;

    startEditing({
      docX:        shape.attrs.x,
      docY:        shape.attrs.y,
      fontSize:    shape._fontSize   ?? 14,
      fontFamily:  shape._fontFamily ?? 'sans-serif',
      textAlign:   shape._textAlign  ?? 'left',
      fill:        shape.style.fill  ?? '#000000',
      scaleX:      shape._scaleX     ?? 1,
      scaleY:      shape._scaleY     ?? 1,
      zoom:        ctx.state.viewport.zoom,
      shapeId,
      initialText: shape._text ?? '',
      onInput: (text) => {
        const s = findItem(shapeId);
        if (s) { s._text = text; ctx.render(); }
      },
      onCommit: (text) => {
        const s = findItem(shapeId);
        if (s) s._text = snap._text;
        ctx.execute({
          do()   { const s = findItem(shapeId); if (s) { s._text = text;       ctx.render(); } },
          undo() { const s = findItem(shapeId); if (s) { s._text = snap._text; ctx.render(); } },
        });
      },
      onCancel: () => {
        const s = findItem(shapeId);
        if (s) { s._text = snap._text; ctx.render(); }
      },
    });
    ctx.render(); // hide SVG shape immediately, show textarea
  }
}
