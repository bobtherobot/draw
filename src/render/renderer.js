/**
 * CanvasKit (Skia WASM) render pipeline.
 *
 * Pipeline:
 *   1. activeMode.beforeRender()
 *   2. ckCanvas.clear()
 *   3. save + applyTransform (doc-space viewport)
 *   4. _drawArtboards() — white fills + borders
 *   5. _drawTree()      — items depth-first, artboards clip children
 *   6. restore          → back to screen space
 *   7. renderSelection() → selection handles in screen space
 *   8. overlay flushAll → tool overlays
 *   9. surface.flush()  → submit GPU commands
 *  10. activeMode.afterRender()
 *  11. emit('render') → panel refreshes
 */
import { state, effectiveVisible, allDisplayItems } from '../core/state.js';
import { getBaseObject, getMode }  from '../core/registry.js';
import { emit }                    from '../core/events.js';
import { applyTransform }          from '../core/Viewport.js';
import { OverlayManager }          from './OverlayManager.js';
import { renderSelection }         from './selection.js';
import { getEditingShapeId }       from '../core/TextEdit.js';
import { syncCompanions, getCompanions } from '../core/item-registry.js';

let _CK             = null;  // CanvasKit instance
let _canvas         = null;  // HTMLCanvasElement
let _surface        = null;  // CanvasKit Surface
let _ckCanvas       = null;  // CanvasKit Canvas (drawing target)
let _overlayManager = null;
let _textCanvas     = null;  // Canvas 2D overlay for text (browser fonts)
let _textCtx        = null;

/** CanvasKit instance — available after initRenderer(). */
export function getCK() { return _CK; }

/**
 * Initialize the renderer with the <canvas> element and CanvasKit instance.
 * @param {HTMLCanvasElement} canvas
 * @param {object} CK  CanvasKit instance from CanvasKitInit()
 */
export function initRenderer(canvas, CK) {
  _CK             = CK;
  _canvas         = canvas;
  _overlayManager = new OverlayManager();

  // Canvas 2D text overlay — sits above the CanvasKit canvas, uses browser fonts
  _textCanvas = document.createElement('canvas');
  _textCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  canvas.parentElement?.appendChild(_textCanvas);
  _textCtx = _textCanvas.getContext('2d');

  _createSurface();
}

/** Return the OverlayManager (for tools to call acquireLayer). */
export function getOverlay() {
  return _overlayManager;
}

/**
 * Main render entry point.
 * Call after any state mutation.
 */
export function render() {
  if (!_CK || !_canvas) return;

  // Keep companion registry in sync with state.items (handles create/delete/undo/redo)
  syncCompanions(state.items);

  // Recreate surface if canvas dimensions changed (e.g. window resize)
  if (!_surface || _surface.width() !== _canvas.width || _surface.height() !== _canvas.height) {
    _surface?.delete();
    _createSurface();
  }
  if (!_ckCanvas) return;

  const activeMode = getMode(state.activeMode);
  if (activeMode) activeMode.beforeRender({ state, getBaseObject });

  // ── Doc-space pass ────────────────────────────────────────────────────────
  _ckCanvas.clear(_CK.TRANSPARENT);
  _ckCanvas.save();
  applyTransform(_ckCanvas);

  _drawArtboards();
  _drawTree(activeMode);
  _drawWireframeDots(activeMode);

  _ckCanvas.restore();

  // ── Screen-space pass ─────────────────────────────────────────────────────
  renderSelection(_ckCanvas, state, getBaseObject);
  _overlayManager.flushAll(_ckCanvas);

  // Submit GPU commands
  _surface.flush();

  // Text layer — draw text shapes using Canvas 2D (browser handles font lookup)
  _renderTextLayer();

  if (activeMode) activeMode.afterRender({ state, getBaseObject });
  emit('render', null);
}

// ── Private ──────────────────────────────────────────────────────────────────

function _createSurface() {
  _surface  = _CK.MakeWebGLCanvasSurface(_canvas) ?? _CK.MakeSWCanvasSurface(_canvas);
  _ckCanvas = _surface?.getCanvas() ?? null;
}

function _drawArtboards() {
  const fillPaint   = new _CK.Paint();
  const strokePaint = new _CK.Paint();
  fillPaint.setColor(_CK.parseColorString('#ffffff'));
  fillPaint.setStyle(_CK.PaintStyle.Fill);
  fillPaint.setAntiAlias(false);
  strokePaint.setColor(_CK.parseColorString('#cccccc'));
  strokePaint.setStyle(_CK.PaintStyle.Stroke);
  strokePaint.setStrokeWidth(1 / state.viewport.zoom);
  strokePaint.setAntiAlias(false);

  for (const ab of state.items.filter(i => i.type === 'artboard')) {
    const { x, y, width, height } = ab.attrs;
    const rect = _CK.XYWHRect(x, y, width, height);
    _ckCanvas.drawRect(rect, fillPaint);
    _ckCanvas.drawRect(rect, strokePaint);
  }

  fillPaint.delete();
  strokePaint.delete();
}

function _buildRenderTree(items) {
  const byId = {};
  for (const item of items) byId[item.id] = { item, children: [] };
  const roots = [];
  for (const item of items) {
    const node = byId[item.id];
    if (item.parentId && byId[item.parentId]) {
      byId[item.parentId].children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function _drawTree(activeMode) {
  const zoom      = state.viewport.zoom;
  const viewState = { mode: state.activeMode, zoom };
  const editingId = getEditingShapeId();
  const roots     = _buildRenderTree(state.items);
  _drawNodes(roots, activeMode, viewState, editingId);
}

function _renderTextLayer() {
  if (!_textCanvas || !_textCtx) return;
  // _canvas.width/height are already physical pixels (CSS size × devicePixelRatio).
  // Match the text canvas to that buffer size.
  const dpr = window.devicePixelRatio || 1;
  const w = _canvas.width, h = _canvas.height;
  if (_textCanvas.width !== w || _textCanvas.height !== h) {
    _textCanvas.width  = w;
    _textCanvas.height = h;
  }
  const ctx = _textCtx;
  ctx.clearRect(0, 0, w, h);
  const { x: vx, y: vy, zoom } = state.viewport;
  ctx.save();
  const s = zoom * dpr;
  ctx.setTransform(s, 0, 0, s, -vx * s, -vy * s);
  _drawTextNodes(ctx, _buildRenderTree(state.items), getEditingShapeId());
  ctx.restore();
}

function _drawTextNodes(ctx, nodes, editingId) {
  for (const { item, children } of nodes) {
    if (!effectiveVisible(item)) continue;
    if (item.type === 'artboard') {
      ctx.save();
      ctx.beginPath();
      ctx.rect(item.attrs.x, item.attrs.y, item.attrs.width, item.attrs.height);
      ctx.clip();
      _drawTextNodes(ctx, children, editingId);
      ctx.restore();
    } else if (item.type === 'group') {
      _drawTextNodes(ctx, children, editingId);
    } else {
      if (item.id !== editingId) {
        const ot = getBaseObject(item.type);
        ot?.drawCanvas2D?.(ctx, item);
        const comps = getCompanions(item.id);
        if (comps?.aux) {
          const viewState = { mode: state.activeMode, zoom: state.viewport.zoom };
          comps.aux.drawCanvas2D(ctx, item, comps.abstract, viewState, state);
        }
      }
      if (children.length) _drawTextNodes(ctx, children, editingId);
    }
  }
}

function _drawNodes(nodes, activeMode, viewState, editingId) {
  for (const { item, children } of nodes) {
    if (!effectiveVisible(item)) continue;

    if (item.type === 'artboard') {
      // Clip children to artboard bounds
      _ckCanvas.save();
      const rect = _CK.XYWHRect(item.attrs.x, item.attrs.y, item.attrs.width, item.attrs.height);
      _ckCanvas.clipRect(rect, _CK.ClipOp.Intersect, false);
      _drawNodes(children, activeMode, viewState, editingId);
      _ckCanvas.restore();

    } else if (item.type === 'group') {
      const tx = item.attrs?.tx ?? 0;
      const ty = item.attrs?.ty ?? 0;
      if (tx || ty) {
        _ckCanvas.save();
        _ckCanvas.translate(tx, ty);
        _drawNodes(children, activeMode, viewState, editingId);
        _ckCanvas.restore();
      } else {
        _drawNodes(children, activeMode, viewState, editingId);
      }

    } else {
      // Display item — skip if currently being text-edited
      if (item.id !== editingId) {
        const ot = getBaseObject(item.type);
        if (ot) {
          const modeStyle  = activeMode?.resolveStyle(item, state) ?? null;
          const renderItem = modeStyle
            ? { ...item, style: { ...item.style, ...modeStyle } }
            : item;
          ot.draw(_ckCanvas, renderItem, viewState);
          const comps = getCompanions(item.id);
          if (comps?.aux) comps.aux.draw(_ckCanvas, renderItem, comps.abstract, viewState, state);
        }
      }
      if (children.length) _drawNodes(children, activeMode, viewState, editingId);
    }
  }
}

function _drawWireframeDots(activeMode) {
  if (activeMode?.id !== 'wireframe') return;
  const paint = new _CK.Paint();
  paint.setStyle(_CK.PaintStyle.Fill);
  paint.setColor(_CK.parseColorString('#4a9eff'));
  paint.setAntiAlias(true);
  const r = 3 / state.viewport.zoom;
  for (const shape of allDisplayItems()) {
    if (!effectiveVisible(shape)) continue;
    const ot = getBaseObject(shape.type);
    const pts = ot?.getWireframePoints?.(shape) ?? [];
    for (const { x, y } of pts) _ckCanvas.drawCircle(x, y, r, paint);
  }
  paint.delete();
}
