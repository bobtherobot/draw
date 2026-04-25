import { Tool } from './base.js';
import { startEditing, isEditing, commitEditing, charIndexAtPoint, setTextareaSelection } from '../textedit.js';
import { findItem, state, allDisplayItems } from '../core/state.js';
import { rotatePoint } from '../geometry/path-utils.js';
import { applyTransform } from '../viewport.js';
import { getCK } from '../render/renderer.js';

export class TypeTool extends Tool {
  get id()       { return 'type'; }
  get label()    { return 'Text'; }
  get shortcut() { return 't'; }
  get icon()     { return 'type'; }

  activate() {
    this._layer = this._ctx.overlay.acquireLayer('type-hover');
    this._dragAnchorIdx = null;
  }

  deactivate() {
    this._layer?.clear();
    this._ctx.overlay.releaseLayer('type-hover');
    this._layer = null;
    this._dragAnchorIdx = null;
  }

  onMouseMove(e) {
    // While the user drags from the click that opened the editor, extend the
    // textarea selection using font-measurement hit-testing.
    if (this._dragAnchorIdx !== null && isEditing() && (e.buttons & 1)) {
      setTextareaSelection(this._dragAnchorIdx, charIndexAtPoint(e.clientX, e.clientY));
      return;
    }

    // Hover highlight: draw a thin blue outline around any text shape under the cursor.
    this._layer.clear();
    const shape = state.hover.shape;
    const isOverText = shape && (shape.type === 'free-text' || shape.type === 'text-block');
    if (!isOverText) return;

    const ot       = this._ctx.getObjectType(shape.type);
    const rotation = shape._rotation ?? 0;
    // For rotated shapes get the unrotated local bbox — we apply rotation via concat.
    const bb = rotation !== 0
      ? ot?.getBBox({ ...shape, _rotation: 0 })
      : ot?.getBBox(shape);
    if (!bb) return;

    this._layer.addCall(ckCanvas => {
      const CK = getCK();
      const z  = this._ctx.state.viewport.zoom;
      ckCanvas.save();
      applyTransform(ckCanvas);
      if (rotation !== 0) {
        const fs  = shape._fontSize ?? 14;
        const rcx = shape._rotCx ?? shape.attrs.x;
        const rcy = shape._rotCy ?? (shape.attrs.y + fs);
        const rad = rotation * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        ckCanvas.concat([
          cos, -sin, rcx * (1 - cos) + rcy * sin,
          sin,  cos, rcy * (1 - cos) - rcx * sin,
          0, 0, 1,
        ]);
      }
      const paint = new CK.Paint();
      paint.setStyle(CK.PaintStyle.Stroke);
      paint.setColor(CK.parseColorString('#55aaff'));
      paint.setStrokeWidth(1 / z);
      paint.setAntiAlias(rotation !== 0);
      ckCanvas.drawRect(CK.XYWHRect(bb.x, bb.y, bb.width, bb.height), paint);
      paint.delete();
      ckCanvas.restore();
    });
    this._ctx.render();
  }

  onMouseUp() {
    this._dragAnchorIdx = null;
  }

  onMouseDown(e) {
    if (e.button !== 0) return;
    if (isEditing()) commitEditing();
    this._dragAnchorIdx = null;
    this._clearSelection();

    const ctx  = this._ctx;
    const pos  = ctx.screenToDoc(e.clientX, e.clientY);
    const zoom = ctx.state.viewport.zoom;

    // If the click lands on any existing text shape, re-edit it (front to back).
    const textShapes = allDisplayItems().filter(s => s.type === 'free-text' || s.type === 'text-block');
    for (let i = textShapes.length - 1; i >= 0; i--) {
      const shape = textShapes[i];
      const ot    = ctx.getObjectType(shape.type);
      if (ot.hitPart(shape, pos.x, pos.y, zoom)) {
        this._openTextEditor(shape, e.clientX, e.clientY);
        // Store the anchor index for drag-to-select (charIndexAtPoint uses
        // params written by startEditing, so this must come after _openTextEditor).
        this._dragAnchorIdx = charIndexAtPoint(e.clientX, e.clientY);
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
    ctx.render();
  }

  _openTextEditor(shape, clickX, clickY) {
    this._layer?.clear();
    const ctx    = this._ctx;
    ctx.state.selection = new Set([shape.id]);
    ctx.render();
    const snap   = { _text: shape._text };
    const shapeId = shape.id;

    const rotation = shape._rotation ?? 0;
    const visualAnchor = rotation !== 0
      ? rotatePoint(shape.attrs.x, shape.attrs.y, shape._rotCx, shape._rotCy, rotation)
      : { x: shape.attrs.x, y: shape.attrs.y };
    startEditing({
      docX:        visualAnchor.x,
      docY:        visualAnchor.y,
      fontSize:    shape._fontSize   ?? 14,
      fontFamily:  shape._fontFamily ?? 'sans-serif',
      textAlign:   shape._textAlign  ?? 'left',
      fill:        shape.style.fill  ?? '#000000',
      scaleX:      shape._scaleX     ?? 1,
      scaleY:      shape._scaleY     ?? 1,
      rotation,
      zoom:        ctx.state.viewport.zoom,
      shapeId,
      initialText: shape._text ?? '',
      clickX, clickY,
      onInput: (text) => {
        const s = findItem(shapeId);
        if (s) { s._text = text; ctx.render(); }
      },
      onCommit: (text) => {
        const s = findItem(shapeId);
        if (s) s._text = snap._text;
        this._dragAnchorIdx = null;
        // Clear selection before execute so do()'s render doesn't flash the overlay.
        ctx.state.selection = new Set();
        ctx.execute({
          do()   { const s = findItem(shapeId); if (s) { s._text = text; ctx.getObjectType(s.type)?.syncRotDisplay?.(s); ctx.render(); } },
          undo() { const s = findItem(shapeId); if (s) { s._text = snap._text; ctx.render(); } },
        });
      },
      onCancel: () => {
        const s = findItem(shapeId);
        if (s) s._text = snap._text;
        this._dragAnchorIdx = null;
        ctx.state.selection = new Set();
        ctx.render();
      },
    });
    ctx.render();
  }
}
