/**
 * Direct Select tool — activates individual shape anchors across multiple shapes
 * for per-node selection and dragging. No bounding-box overlay.
 *
 * Supported shape types: path, free-text, text-block.
 * Groups and artboards are bypassed (raw hit-test, no group promotion).
 */
import { BaseTool } from './BaseTool.js';
import { buildPenPathD, parsePenAnchors } from '../utils/geometry/pen-path.js';
import { findShape, effectiveLocked } from '../core/state.js';
import { hitTest } from '../core/hit-test.js';
import { applyTransform, getCanvasRect } from '../core/Viewport.js';
import { getCK } from '../render/renderer.js';
import { cloneShape, restoreShape } from '../utils/snapshots.js';
import { isEditing } from '../core/TextEdit.js';

const HIT_R         = 6;
const DRAG_THRESHOLD = 2;
const DISPLAY_TYPES  = new Set(['path', 'free-text', 'text-block']);

export class DirectSelect extends BaseTool {
  get id()       { return 'direct-select'; }
  get label()    { return 'Direct Select'; }
  get shortcut() { return 'v'; }
  get icon()     { return 'direct-select'; }

  init(ctx) {
    super.init(ctx);
    this._layer      = null;
    this._savedState = null;
  }

  activate() {
    if (!this._ctx) return;

    // Inherit NS selection as initial active shapes, then suppress NS overlay.
    const prevSel = new Set(this._ctx.state.selection);
    this._ctx.state.selection         = new Set();
    this._ctx.state.selectionOrigin   = null;
    this._ctx.state.selectionRotation = null;
    this._ctx.state.activeSelectTool  = 'direct-select';

    this._mode      = 'idle';
    this._activeIds = new Set();
    this._pathData  = new Map(); // shapeId → { anchors, closed }
    this._selMap    = new Map(); // shapeId → Set<nodeIdx>
    this._bandStart = null;
    this._bandEnd   = null;
    this._bandLayer = null;
    this._dragStart = null;
    this._moved     = false;
    this._preSnaps  = new Map();

    for (const id of prevSel) {
      this._activateShape(id);
    }

    this._ensureLayer();
    this._redraw();
  }

  deactivate() {
    // Always clean up — even if we were suspended. _savedState is discarded.
    this._savedState = null;
    this._activeIds  = new Set();
    this._pathData   = new Map();
    this._selMap     = new Map();
    this._mode       = 'idle';
    this._preSnaps   = new Map();
    this._cleanupBand();
    if (this._layer) {
      this._ctx?.overlay.releaseLayer('direct-select');
      this._layer = null;
    }
  }

  // Park state without tearing down. Called by modifier system on e.g. Space→Hand.
  suspendTo(_toolId) {
    this._savedState = {
      activeIds: new Set(this._activeIds),
      selMap:    new Map([...this._selMap].map(([k, v]) => [k, new Set(v)])),
      pathData:  new Map(this._pathData),
      mode:      'idle',
    };
    // Hide overlay during suspension — anchors shouldn't show while Hand is active.
    if (this._layer) this._layer.clear();
    this._cleanupBand();
    this._mode = 'idle';
    this._ctx?.render();
  }

  // Restore parked state, or fall back to a fresh activate.
  resume() {
    if (this._savedState) {
      const s          = this._savedState;
      this._savedState = null;
      this._activeIds  = s.activeIds;
      this._selMap     = s.selMap;
      this._pathData   = s.pathData;
      this._mode       = 'idle';
      this._ctx.state.activeSelectTool = 'direct-select';
      this._ensureLayer();
      this._redraw();
    } else {
      this.activate();
    }
  }

  onMouseDown(e) {
    if (e.button !== 0) return;
    if (isEditing()) return;

    const ctx      = this._ctx;
    const pos      = ctx.screenToDoc(e.clientX, e.clientY);
    const nodeHit  = this._hitNode(e.clientX, e.clientY);
    const shapeHit = nodeHit ? null : this._shapeIdAt(e.clientX, e.clientY);

    if (nodeHit) {
      const { shapeId, nodeIdx } = nodeHit;

      if (e.metaKey && e.shiftKey) {
        // Deselect this node only
        this._selMap.get(shapeId)?.delete(nodeIdx);
        this._mode = 'idle';
      } else if (e.shiftKey) {
        // Toggle this node
        if (!this._selMap.has(shapeId)) this._selMap.set(shapeId, new Set());
        const s = this._selMap.get(shapeId);
        if (s.has(nodeIdx)) s.delete(nodeIdx); else s.add(nodeIdx);
        if (s.has(nodeIdx)) {
          this._armDrag(pos);
        } else {
          this._mode = 'idle';
        }
      } else if (this._anyNodesSelected()) {
        // Existing selection — drag without changing it
        this._armDrag(pos);
      } else {
        // Nothing selected yet — select this node and drag
        for (const s of this._selMap.values()) s.clear();
        if (!this._selMap.has(shapeId)) this._selMap.set(shapeId, new Set());
        this._selMap.get(shapeId).add(nodeIdx);
        this._armDrag(pos);
      }

    } else if (shapeHit) {
      if (e.altKey) {
        this._activateShape(shapeHit);
        if (!this._selMap.has(shapeHit)) this._selMap.set(shapeHit, new Set());
        const nodes = this._getNodePositions(shapeHit);
        const sel   = this._selMap.get(shapeHit);
        if (e.shiftKey) {
          // ALT+SHIFT: toggle whole-shape — deselect all if fully selected, otherwise add all
          if (this._shapeIsFullySelected(shapeHit)) {
            sel.clear();
          } else {
            for (let i = 0; i < nodes.length; i++) sel.add(i);
          }
        } else {
          // ALT only: select all nodes of this shape, clear all other selections
          for (const [id, s] of this._selMap) {
            if (id !== shapeHit) s.clear();
          }
          sel.clear();
          for (let i = 0; i < nodes.length; i++) sel.add(i);
        }
      } else if (e.metaKey && !e.shiftKey) {
        // CMD+click: activate this shape, select ALL its nodes, clear other shapes' node selections
        this._activateShape(shapeHit);
        for (const [id, s] of this._selMap) {
          if (id !== shapeHit) s.clear();
        }
        if (!this._selMap.has(shapeHit)) this._selMap.set(shapeHit, new Set());
        const allNodes = this._getNodePositions(shapeHit);
        const sel = this._selMap.get(shapeHit);
        sel.clear();
        for (let i = 0; i < allNodes.length; i++) sel.add(i);
      } else {
        // Plain click or shift+click: add this shape to the active set without clearing others.
        // Clicking an already-active shape is a no-op on selection state.
        this._activateShape(shapeHit);
      }

      // Arm a drag if the clicked shape is fully selected — dragging moves all fully-selected shapes.
      if (this._shapeIsFullySelected(shapeHit)) {
        this._armDrag(pos);
      } else {
        this._mode = 'idle';
      }

    } else {
      // Empty space
      if (!e.shiftKey) {
        this._activeIds.clear();
        this._pathData.clear();
        this._selMap.clear();
      }
      this._mode      = 'band';
      this._bandStart = pos;
      this._bandEnd   = pos;
      this._bandLayer = ctx.overlay.acquireLayer('direct-select-band');
    }

    this._redraw();
  }

  onMouseMove(e) {
    if (this._mode === 'drag') {
      const pos = this._ctx.screenToDoc(e.clientX, e.clientY);
      const dx  = pos.x - this._dragStart.x;
      const dy  = pos.y - this._dragStart.y;

      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) this._moved = true;

      for (const shapeId of this._activeIds) {
        const sel = this._selMap.get(shapeId);
        if (!sel || sel.size === 0) continue;
        const shape = findShape(shapeId);
        if (!shape) continue;

        if (shape.type === 'path') {
          const pd = this._pathData.get(shapeId);
          if (!pd) continue;
          for (const i of sel) {
            const a = pd.anchors[i];
            if (!a) continue;
            a.x += dx;
            a.y += dy;
            if (a.hIn)  { a.hIn.x  += dx; a.hIn.y  += dy; }
            if (a.hOut) { a.hOut.x += dx; a.hOut.y += dy; }
          }
          shape.attrs.d = buildPenPathD(pd.anchors, pd.closed);
        } else {
          // free-text or text-block — single origin node at (attrs.x, attrs.y)
          if (sel.has(0)) {
            shape.attrs.x = (shape.attrs.x ?? 0) + dx;
            shape.attrs.y = (shape.attrs.y ?? 0) + dy;
            // Keep rotation pivot co-located with the moved origin
            if (shape._rotCx != null) shape._rotCx += dx;
            if (shape._rotCy != null) shape._rotCy += dy;
            if (shape._origin) { shape._origin.x += dx; shape._origin.y += dy; }
            if (shape._rotDisplay) {
              shape._rotDisplay = {
                ...shape._rotDisplay,
                bbox:   { ...shape._rotDisplay.bbox, x: shape._rotDisplay.bbox.x + dx, y: shape._rotDisplay.bbox.y + dy },
                center: { x: shape._rotDisplay.center.x + dx, y: shape._rotDisplay.center.y + dy },
              };
            }
          }
        }
      }

      this._dragStart = pos;
      this._redraw();

    } else if (this._mode === 'band') {
      this._bandEnd = this._ctx.screenToDoc(e.clientX, e.clientY);
      this._redraw();
    }
  }

  onMouseUp(e) {
    if (this._mode === 'drag') {
      if (this._moved) {
        // After node edits, clear stale _rotDisplay on path shapes so NS shows correct overlay.
        for (const shapeId of this._preSnaps.keys()) {
          const shape = findShape(shapeId);
          if (shape?.type === 'path') {
            delete shape._rotDisplay;
            shape._transform = null;
          }
        }

        const postSnaps = new Map();
        for (const shapeId of this._preSnaps.keys()) {
          const shape = findShape(shapeId);
          if (shape) postSnaps.set(shapeId, cloneShape(shape));
        }
        const preSnaps = new Map(this._preSnaps);
        const ctx      = this._ctx;
        ctx.execute({
          do() {
            for (const [id, snap] of postSnaps) {
              const s = findShape(id);
              if (s) restoreShape(s, snap);
            }
            ctx.render();
          },
          undo() {
            for (const [id, snap] of preSnaps) {
              const s = findShape(id);
              if (s) restoreShape(s, snap);
            }
            ctx.render();
          },
        });
      }
      this._preSnaps.clear();

    } else if (this._mode === 'band') {
      const pos = this._ctx.screenToDoc(e.clientX, e.clientY);
      this._commitBand(pos, e.shiftKey);
      this._cleanupBand();
    }

    this._mode = 'idle';
    this._redraw();
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      for (const s of this._selMap.values()) s.clear();
      this._redraw();
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _activateShape(shapeId) {
    const shape = findShape(shapeId);
    if (!shape) return;
    if (!DISPLAY_TYPES.has(shape.type)) return;
    if (effectiveLocked(shape)) return;
    this._activeIds.add(shapeId);
    if (!this._selMap.has(shapeId)) this._selMap.set(shapeId, new Set());
    if (shape.type === 'path') {
      const { anchors, closed } = parsePenAnchors(shape.attrs?.d ?? '');
      this._pathData.set(shapeId, { anchors, closed });
    }
  }

  // Returns current {x,y}[] for the shape's nodes. Live anchors for paths (do not mutate).
  _getNodePositions(shapeId) {
    const pd = this._pathData.get(shapeId);
    if (pd) return pd.anchors;
    const shape = findShape(shapeId);
    if (!shape) return [];
    return [{ x: shape.attrs.x ?? 0, y: shape.attrs.y ?? 0 }];
  }

  _hitNode(screenX, screenY) {
    const { zoom, x: vx, y: vy } = this._ctx.state.viewport;
    const { left, top } = getCanvasRect();
    for (const shapeId of this._activeIds) {
      const nodes = this._getNodePositions(shapeId);
      for (let i = 0; i < nodes.length; i++) {
        const n  = nodes[i];
        const sx = (n.x - vx) * zoom + left;
        const sy = (n.y - vy) * zoom + top;
        if (Math.hypot(screenX - sx, screenY - sy) < HIT_R) {
          return { shapeId, nodeIdx: i };
        }
      }
    }
    return null;
  }

  _shapeIdAt(screenX, screenY) {
    const ctx = this._ctx;
    const hit = hitTest(screenX, screenY, ctx.getDisplayObject);
    if (!hit || hit.isHandle || !hit.shape) return null;
    const shape = hit.shape;
    if (!DISPLAY_TYPES.has(shape.type)) return null;
    if (effectiveLocked(shape)) return null;
    return shape.id;
  }

  // Re-sync _pathData from current attrs.d before starting a drag.
  // This ensures undo/redo or any external mutation doesn't leave stale anchors.
  _armDrag(pos) {
    for (const shapeId of this._activeIds) {
      const shape = findShape(shapeId);
      if (shape?.type === 'path') {
        const { anchors, closed } = parsePenAnchors(shape.attrs?.d ?? '');
        this._pathData.set(shapeId, { anchors, closed });
      }
    }
    this._mode      = 'drag';
    this._dragStart = pos;
    this._moved     = false;
    this._preSnaps.clear();
    for (const shapeId of this._activeIds) {
      const sel = this._selMap.get(shapeId);
      if (!sel || sel.size === 0) continue;
      const shape = findShape(shapeId);
      if (shape) this._preSnaps.set(shapeId, cloneShape(shape));
    }
  }

  _anyNodesSelected() {
    for (const s of this._selMap.values()) {
      if (s.size > 0) return true;
    }
    return false;
  }

  // True when ALL nodes of the shape are selected (enables body-drag to move whole shape).
  _shapeIsFullySelected(shapeId) {
    const sel = this._selMap.get(shapeId);
    if (!sel || sel.size === 0) return false;
    const pd = this._pathData.get(shapeId);
    if (pd) return sel.size === pd.anchors.length && pd.anchors.length > 0;
    return sel.has(0); // text shapes have a single node
  }

  _commitBand(end, additive) {
    const s  = this._bandStart;
    const x0 = Math.min(s.x, end.x);
    const y0 = Math.min(s.y, end.y);
    const x1 = Math.max(s.x, end.x);
    const y1 = Math.max(s.y, end.y);
    if (Math.abs(x1 - x0) < 2 && Math.abs(y1 - y0) < 2) return;

    if (!additive) {
      for (const sel of this._selMap.values()) sel.clear();
    }

    for (const shapeId of this._activeIds) {
      if (!this._selMap.has(shapeId)) this._selMap.set(shapeId, new Set());
      const sel   = this._selMap.get(shapeId);
      const nodes = this._getNodePositions(shapeId);
      for (let i = 0; i < nodes.length; i++) {
        const { x, y } = nodes[i];
        const inside = x >= x0 && x <= x1 && y >= y0 && y <= y1;
        if (inside) {
          if (additive && sel.has(i)) sel.delete(i); else sel.add(i);
        }
      }
    }
  }

  _cleanupBand() {
    if (this._bandLayer) {
      this._ctx?.overlay.releaseLayer('direct-select-band');
      this._bandLayer = null;
      this._bandStart = null;
      this._bandEnd   = null;
    }
  }

  _ensureLayer() {
    if (!this._layer) this._layer = this._ctx.overlay.acquireLayer('direct-select');
  }

  _redraw() {
    this._ensureLayer();
    this._layer.clear();
    if (this._activeIds.size > 0) {
      this._layer.addCall(ck => this._drawOverlay(ck));
    }
    if (this._bandLayer) {
      this._bandLayer.clear();
      if (this._bandStart && this._bandEnd) {
        this._bandLayer.addCall(ck => this._drawBand(ck));
      }
    }
    this._ctx.render();
  }

  _drawOverlay(ckCanvas) {
    const CK     = getCK();
    const z      = this._ctx.state.viewport.zoom;
    const sw     = 1 / z;
    const hs     = 4 / z;
    const hr     = 3 / z;
    const accent = _css('--theme-accent')    || '#4a9eff';
    const bg     = _css('--theme-bg-raised') || '#ffffff';
    const dim    = _css('--theme-fg-dim')    || '#888888';

    ckCanvas.save();
    applyTransform(ckCanvas);

    const linePaint = new CK.Paint();
    linePaint.setStyle(CK.PaintStyle.Stroke);
    linePaint.setColor(CK.parseColorString(dim));
    linePaint.setStrokeWidth(sw);
    linePaint.setAntiAlias(false);

    const dotPaint = new CK.Paint();
    dotPaint.setStyle(CK.PaintStyle.Fill);
    dotPaint.setColor(CK.parseColorString(accent));
    dotPaint.setAntiAlias(true);

    const anchorFill   = new CK.Paint();
    anchorFill.setStyle(CK.PaintStyle.Fill);
    anchorFill.setAntiAlias(false);

    const anchorStroke = new CK.Paint();
    anchorStroke.setStyle(CK.PaintStyle.Stroke);
    anchorStroke.setColor(CK.parseColorString(accent));
    anchorStroke.setStrokeWidth(1.5 / z);
    anchorStroke.setAntiAlias(true);

    for (const shapeId of this._activeIds) {
      const sel = this._selMap.get(shapeId) ?? new Set();
      const pd  = this._pathData.get(shapeId);

      if (pd) {
        // Path shape — draw all anchors + handle lines for selected anchors (visual ref only)
        const { anchors } = pd;
        for (let i = 0; i < anchors.length; i++) {
          const a     = anchors[i];
          const isSel = sel.has(i);

          if (isSel) {
            for (const h of [a.hIn, a.hOut]) {
              if (!h) continue;
              const lp = CK.Path.MakeFromSVGString(`M ${a.x} ${a.y} L ${h.x} ${h.y}`);
              if (lp) { ckCanvas.drawPath(lp, linePaint); lp.delete(); }
              ckCanvas.drawCircle(h.x, h.y, hr, dotPaint);
            }
          }

          anchorFill.setColor(CK.parseColorString(isSel ? accent : bg));
          const r = CK.XYWHRect(a.x - hs, a.y - hs, hs * 2, hs * 2);
          ckCanvas.drawRect(r, anchorFill);
          ckCanvas.drawRect(r, anchorStroke);
        }
      } else {
        // Text shape — single origin node
        const shape = findShape(shapeId);
        if (!shape) continue;
        const nx    = shape.attrs.x ?? 0;
        const ny    = shape.attrs.y ?? 0;
        const isSel = sel.has(0);
        anchorFill.setColor(CK.parseColorString(isSel ? accent : bg));
        const r = CK.XYWHRect(nx - hs, ny - hs, hs * 2, hs * 2);
        ckCanvas.drawRect(r, anchorFill);
        ckCanvas.drawRect(r, anchorStroke);
      }
    }

    linePaint.delete();
    dotPaint.delete();
    anchorFill.delete();
    anchorStroke.delete();

    ckCanvas.restore();
  }

  _drawBand(ckCanvas) {
    if (!this._bandStart || !this._bandEnd) return;
    const CK     = getCK();
    const s      = this._bandStart;
    const e      = this._bandEnd;
    const x      = Math.min(s.x, e.x);
    const y      = Math.min(s.y, e.y);
    const w      = Math.abs(e.x - s.x);
    const h      = Math.abs(e.y - s.y);
    const z      = this._ctx.state.viewport.zoom;
    const accent = _css('--theme-accent')    || '#4a9eff';
    const sel    = _css('--theme-selection') || 'rgba(74,158,255,0.22)';

    ckCanvas.save();
    applyTransform(ckCanvas);
    const rect = CK.XYWHRect(x, y, w, h);

    const fillPaint = new CK.Paint();
    fillPaint.setStyle(CK.PaintStyle.Fill);
    fillPaint.setColor(CK.parseColorString(sel));
    ckCanvas.drawRect(rect, fillPaint);
    fillPaint.delete();

    const dashPaint = new CK.Paint();
    dashPaint.setStyle(CK.PaintStyle.Stroke);
    dashPaint.setColor(CK.parseColorString(accent));
    dashPaint.setStrokeWidth(1 / z);
    const dashEffect = CK.PathEffect.MakeDash([4 / z, 3 / z]);
    dashPaint.setPathEffect(dashEffect);
    ckCanvas.drawRect(rect, dashPaint);
    dashEffect.delete();
    dashPaint.delete();

    ckCanvas.restore();
  }
}

function _css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
