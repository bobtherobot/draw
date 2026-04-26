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
import { state, effectiveVisible, allDisplayShapes } from '../core/state.js';
import { getDisplayObject, getMode } from '../core/registry.js';
import { emit }                      from '../core/events.js';
import { applyTransform }            from '../core/Viewport.js';
import { OverlayManager }            from './OverlayManager.js';
import { renderSelection }           from './selection.js';
import { getEditingShapeId }         from '../core/TextEdit.js';
import { syncControllers, getController } from '../core/shape-registry.js';

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

  // Keep controller registry in sync with state.shapes (handles create/delete/undo/redo)
  syncControllers(state.shapes);

  // Recreate surface if canvas dimensions changed (e.g. window resize)
  if (!_surface || _surface.width() !== _canvas.width || _surface.height() !== _canvas.height) {
    _surface?.delete();
    _createSurface();
  }
  if (!_ckCanvas) return;

  const activeMode = getMode(state.activeMode);
  if (activeMode) activeMode.beforeRender({ state, getDisplayObject });

  // ── Doc-space pass ────────────────────────────────────────────────────────
  _ckCanvas.clear(_CK.TRANSPARENT);
  _ckCanvas.save();
  applyTransform(_ckCanvas);

  _drawArtboards();
  _drawTree(activeMode);
  _drawWireframeDots(activeMode);

  _ckCanvas.restore();

  // ── Screen-space pass ─────────────────────────────────────────────────────
  renderSelection(_ckCanvas, state, getDisplayObject);
  _overlayManager.flushAll(_ckCanvas);

  // Submit GPU commands
  _surface.flush();

  // Text layer — draw text shapes using Canvas 2D (browser handles font lookup)
  _renderTextLayer();

  if (activeMode) activeMode.afterRender({ state, getDisplayObject });
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

  for (const ab of state.shapes.filter(i => i.type === 'artboard')) {
    const { x, y, width, height } = ab.attrs;
    const rect = _CK.XYWHRect(x, y, width, height);
    _ckCanvas.drawRect(rect, fillPaint);
    _ckCanvas.drawRect(rect, strokePaint);
  }

  fillPaint.delete();
  strokePaint.delete();
}

function _buildRenderTree(shapes) {
  const byId = {};
  for (const shape of shapes) byId[shape.id] = { shape, children: [] };
  const roots = [];
  for (const shape of shapes) {
    const node = byId[shape.id];
    if (shape.parentId && byId[shape.parentId]) {
      byId[shape.parentId].children.push(node);
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
  const roots     = _buildRenderTree(state.shapes);
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
  _drawTextNodes(ctx, _buildRenderTree(state.shapes), getEditingShapeId());
  ctx.restore();
}

function _drawTextNodes(ctx, nodes, editingId) {
  for (const { shape, children } of nodes) {
    if (!effectiveVisible(shape)) continue;
    if (shape.type === 'artboard') {
      ctx.save();
      ctx.beginPath();
      ctx.rect(shape.attrs.x, shape.attrs.y, shape.attrs.width, shape.attrs.height);
      ctx.clip();
      _drawTextNodes(ctx, children, editingId);
      ctx.restore();
    } else if (shape.type === 'group') {
      _drawTextNodes(ctx, children, editingId);
    } else {
      if (shape.id !== editingId) {
        const ctrl = getController(shape.id);
        ctrl?.renderCanvas2D(ctx, state);
      }
      if (children.length) _drawTextNodes(ctx, children, editingId);
    }
  }
}

function _drawNodes(nodes, activeMode, viewState, editingId) {
  for (const { shape, children } of nodes) {
    if (!effectiveVisible(shape)) continue;

    if (shape.type === 'artboard') {
      // Clip children to artboard bounds
      _ckCanvas.save();
      const rect = _CK.XYWHRect(shape.attrs.x, shape.attrs.y, shape.attrs.width, shape.attrs.height);
      _ckCanvas.clipRect(rect, _CK.ClipOp.Intersect, false);
      _drawNodes(children, activeMode, viewState, editingId);
      _ckCanvas.restore();

    } else if (shape.type === 'group') {
      const tx = shape.attrs?.tx ?? 0;
      const ty = shape.attrs?.ty ?? 0;
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
      if (shape.id !== editingId) {
        const ctrl = getController(shape.id);
        if (ctrl) {
          const modeStyle = activeMode?.resolveStyle(shape, state) ?? null;
          ctrl.render(_ckCanvas, viewState, state, modeStyle);
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
  for (const shape of allDisplayShapes()) {
    if (!effectiveVisible(shape)) continue;
    const do_ = getDisplayObject(shape.type);
    const pts = do_?.getWireframePoints?.(shape) ?? [];
    for (const { x, y } of pts) _ckCanvas.drawCircle(x, y, r, paint);
  }
  paint.delete();
}
