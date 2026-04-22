/**
 * Canvas 2D render pipeline (v3).
 *
 * Pipeline:
 *   1. activeMode.beforeRender()
 *   2. clearRect
 *   3. applyTransform (doc-space viewport)
 *   4. _drawArtboards() — white fills + borders
 *   5. _drawTree()      — items depth-first, artboards clip children
 *   6. ctx.restore()    → back to screen space
 *   7. renderSelection() → canvas selection handles (Phase 4)
 *   8. overlay flushAll → tool overlays in screen space (Phase 6)
 *   9. activeMode.afterRender()
 *  10. emit('render') → panel refreshes
 */
import { state, effectiveVisible } from '../core/state.js';
import { getObjectType, getMode }  from '../core/registry.js';
import { emit }                    from '../core/events.js';
import { applyTransform }          from '../viewport.js';
import { OverlayManager }          from './overlay.js';
import { renderSelection }         from './selection.js';
import { getEditingShapeId }       from '../textedit.js';

// ── Module-level refs set once by initRenderer() ─────────────────────────────
let _canvas         = null;
let _ctx            = null;
let _overlayManager = null;
let _selectionLayer = null;

/**
 * Initialize the renderer with the <canvas> element.
 * @param {HTMLCanvasElement} canvas
 */
export function initRenderer(canvas) {
  _canvas         = canvas;
  _ctx            = canvas.getContext('2d');
  _overlayManager = new OverlayManager();
  _selectionLayer = _overlayManager.acquireLayer('selection');
}

/** Canvas has no per-item DOM elements; returns null for all ids. */
export function getElement(_itemId) {
  return null;
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
  if (!_ctx) return;

  const activeMode = getMode(state.activeMode);
  if (activeMode) activeMode.beforeRender({ state, getObjectType, getElement });

  // ── Doc-space pass ────────────────────────────────────────────────────────
  _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
  _ctx.save();
  applyTransform(_ctx);

  _drawArtboards();
  _drawTree(activeMode);

  _ctx.restore();

  // ── Screen-space pass ─────────────────────────────────────────────────────
  renderSelection(_selectionLayer, state, getObjectType, getElement);
  _overlayManager.flushAll(_ctx);

  if (activeMode) activeMode.afterRender({ state, getObjectType, getElement });
  emit('render', null);
}

// ── Private ──────────────────────────────────────────────────────────────────

function _drawArtboards() {
  for (const ab of state.items.filter(i => i.type === 'artboard')) {
    const { x, y, width, height } = ab.attrs;
    _ctx.fillStyle = '#ffffff';
    _ctx.fillRect(x, y, width, height);
    _ctx.strokeStyle = '#cccccc';
    _ctx.lineWidth = 1 / state.viewport.zoom;
    _ctx.strokeRect(x, y, width, height);
  }
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

function _drawNodes(nodes, activeMode, viewState, editingId) {
  for (const { item, children } of nodes) {
    if (!effectiveVisible(item)) continue;

    if (item.type === 'artboard') {
      // Clip children to artboard bounds
      _ctx.save();
      _ctx.beginPath();
      _ctx.rect(item.attrs.x, item.attrs.y, item.attrs.width, item.attrs.height);
      _ctx.clip();
      _drawNodes(children, activeMode, viewState, editingId);
      _ctx.restore();

    } else if (item.type === 'group') {
      const tx = item.attrs.tx ?? 0;
      const ty = item.attrs.ty ?? 0;
      if (tx || ty) {
        _ctx.save();
        _ctx.translate(tx, ty);
        _drawNodes(children, activeMode, viewState, editingId);
        _ctx.restore();
      } else {
        _drawNodes(children, activeMode, viewState, editingId);
      }

    } else {
      // Display item — skip if currently being text-edited
      if (item.id !== editingId) {
        const ot = getObjectType(item.type);
        if (ot) {
          const modeStyle  = activeMode?.resolveStyle(item, state) ?? null;
          const renderItem = modeStyle
            ? { ...item, style: { ...item.style, ...modeStyle } }
            : item;
          ot.draw(_ctx, renderItem, viewState);
        }
      }
      if (children.length) _drawNodes(children, activeMode, viewState, editingId);
    }
  }
}
