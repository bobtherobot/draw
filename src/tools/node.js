/**
 * Node editing tool — direct selection of path anchors and bezier handles.
 */
import { Tool } from './base.js';
import { buildPenPathD, parsePenAnchors } from '../geometry/pen-path.js';

const HIT_R = 6; // screen-px hit radius

export class NodeTool extends Tool {
  get id()       { return 'node'; }
  get label()    { return 'Node'; }
  get shortcut() { return 'a'; }
  get icon()     { return 'node'; }

  init(ctx) {
    super.init(ctx);
    this._layer = null;
  }

  activate() {
    this._mode          = 'idle';  // 'idle' | 'drag-anchor' | 'drag-handle' | 'marquee'
    this._editingIds    = new Set();
    this._anchorsMap    = new Map(); // shapeId → anchors[]
    this._closedMap     = new Map(); // shapeId → boolean
    this._selMap        = new Map(); // shapeId → Set<anchorIdx>
    this._dragStart     = null;
    this._dragAnchor    = null;  // { shapeId, anchorIdx }
    this._dragHandle    = null;  // { shapeId, anchorIdx, side: 'in'|'out' }
    this._preDs         = new Map();
    this._marqueeStart  = null;

    this._ensureLayer();
    this._redraw();

    // Start editing selected path shapes
    for (const id of this._ctx.state.selection) {
      this._beginEditing(id);
    }
    this._redraw();
  }

  deactivate() {
    this._editingIds.clear();
    this._anchorsMap.clear();
    this._closedMap.clear();
    this._selMap.clear();
    if (this._layer) {
      this._ctx?.overlay.releaseLayer('node');
      this._layer = null;
    }
  }

  onMouseDown(e) {
    if (e.button !== 0) return;
    const ctx  = this._ctx;
    const pos  = ctx.screenToDoc(e.clientX, e.clientY);
    const z    = ctx.state.viewport.zoom;

    this._dragStart = pos;

    // Hit-test handle first, then anchor
    const hh = this._hitHandle(e.clientX, e.clientY);
    if (hh) {
      this._mode       = 'drag-handle';
      this._dragHandle = hh;
      this._preDs      = this._snapshotDs();
      return;
    }

    const ha = this._hitAnchor(e.clientX, e.clientY);
    if (ha) {
      const { shapeId, anchorIdx } = ha;
      if (!e.shiftKey) {
        // Deselect other anchors in other shapes
        for (const [id, sel] of this._selMap) {
          if (id !== shapeId) sel.clear();
        }
        if (!this._selMap.has(shapeId)) this._selMap.set(shapeId, new Set());
        if (!e.shiftKey && !this._selMap.get(shapeId).has(anchorIdx)) {
          this._selMap.get(shapeId).clear();
        }
        this._selMap.get(shapeId).add(anchorIdx);
      } else {
        if (!this._selMap.has(shapeId)) this._selMap.set(shapeId, new Set());
        this._selMap.get(shapeId).add(anchorIdx);
      }
      this._mode       = 'drag-anchor';
      this._dragAnchor = ha;
      this._preDs      = this._snapshotDs();
      this._redraw();
      return;
    }

    // Clicked empty space — start marquee or deselect
    if (!e.shiftKey) {
      for (const sel of this._selMap.values()) sel.clear();
    }
    this._mode         = 'marquee';
    this._marqueeStart = pos;
    this._redraw();
  }

  onMouseMove(e) {
    if (this._mode === 'idle') return;
    const ctx = this._ctx;
    const pos = ctx.screenToDoc(e.clientX, e.clientY);
    const dx  = pos.x - this._dragStart.x;
    const dy  = pos.y - this._dragStart.y;

    if (this._mode === 'drag-anchor') {
      const { shapeId } = this._dragAnchor;
      const anchors = this._anchorsMap.get(shapeId);
      if (!anchors) return;
      const sel = this._selMap.get(shapeId) ?? new Set();
      for (const i of sel) {
        const a = anchors[i];
        a.x += pos.x - this._dragStart.x;
        a.y += pos.y - this._dragStart.y;
        if (a.hIn)  { a.hIn.x  += dx; a.hIn.y  += dy; }
        if (a.hOut) { a.hOut.x += dx; a.hOut.y += dy; }
      }
      this._dragStart = pos;
      this._applyAnchors(shapeId);
      ctx.render();
    } else if (this._mode === 'drag-handle') {
      const { shapeId, anchorIdx, side } = this._dragHandle;
      const anchors = this._anchorsMap.get(shapeId);
      if (!anchors) return;
      const a = anchors[anchorIdx];
      if (side === 'out') {
        a.hOut = { x: pos.x, y: pos.y };
        // Mirror for smooth: if hIn exists, mirror hOut → hIn
        if (a.hIn) a.hIn = { x: a.x - (pos.x - a.x), y: a.y - (pos.y - a.y) };
      } else {
        a.hIn = { x: pos.x, y: pos.y };
        if (a.hOut) a.hOut = { x: a.x - (pos.x - a.x), y: a.y - (pos.y - a.y) };
      }
      this._applyAnchors(shapeId);
      ctx.render();
    } else if (this._mode === 'marquee') {
      this._updateMarqueeSelection(this._marqueeStart, pos, e.shiftKey);
    }

    this._redraw();
  }

  onMouseUp(e) {
    if (this._mode === 'drag-anchor' || this._mode === 'drag-handle') {
      // Commit: record undo entry
      const preDs  = this._preDs;
      const postDs = this._snapshotDs();
      const ctx    = this._ctx;
      ctx.execute({
        do()   { for (const [id, d] of postDs) { const s = _findShape(id, ctx.state); if (s) s.attrs.d = d; const el = ctx.getElement(id); if (el) el.setAttribute('d', d); } ctx.render(); },
        undo() { for (const [id, d] of preDs)  { const s = _findShape(id, ctx.state); if (s) s.attrs.d = d; const el = ctx.getElement(id); if (el) el.setAttribute('d', d); } ctx.render(); },
      });
    }
    this._mode         = 'idle';
    this._dragAnchor   = null;
    this._dragHandle   = null;
    this._marqueeStart = null;
    this._preDs.clear();
    this._redraw();
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      for (const sel of this._selMap.values()) sel.clear();
      this._redraw();
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _ensureLayer() {
    if (!this._layer) this._layer = this._ctx.overlay.acquireLayer('node');
  }

  _beginEditing(shapeId) {
    const found = _findShape(shapeId, this._ctx.state);
    if (!found || found.shape.type !== 'path') return;
    const { anchors, closed } = parsePenAnchors(found.shape.attrs.d ?? '');
    this._editingIds.add(shapeId);
    this._anchorsMap.set(shapeId, anchors);
    this._closedMap.set(shapeId, closed);
    this._selMap.set(shapeId, new Set());
  }

  _applyAnchors(shapeId) {
    const anchors = this._anchorsMap.get(shapeId);
    const closed  = this._closedMap.get(shapeId) ?? false;
    const d       = buildPenPathD(anchors, closed);
    const found   = _findShape(shapeId, this._ctx.state);
    if (found) found.shape.attrs.d = d;
    const el = this._ctx.getElement(shapeId);
    if (el) el.setAttribute('d', d);
  }

  _snapshotDs() {
    const snap = new Map();
    for (const id of this._editingIds) {
      const found = _findShape(id, this._ctx.state);
      if (found) snap.set(id, found.shape.attrs.d ?? '');
    }
    return snap;
  }

  _hitAnchor(screenX, screenY) {
    const z    = this._ctx.state.viewport.zoom;
    const rect = document.getElementById('canvas').getBoundingClientRect();
    for (const [id, anchors] of this._anchorsMap) {
      for (let i = 0; i < anchors.length; i++) {
        const a  = anchors[i];
        const sx = (a.x - this._ctx.state.viewport.x) * z + rect.left;
        const sy = (a.y - this._ctx.state.viewport.y) * z + rect.top;
        if (Math.hypot(screenX - sx, screenY - sy) < HIT_R) {
          return { shapeId: id, anchorIdx: i };
        }
      }
    }
    return null;
  }

  _hitHandle(screenX, screenY) {
    const z    = this._ctx.state.viewport.zoom;
    const rect = document.getElementById('canvas').getBoundingClientRect();
    for (const [id, anchors] of this._anchorsMap) {
      const sel = this._selMap.get(id) ?? new Set();
      for (let i = 0; i < anchors.length; i++) {
        if (!sel.has(i)) continue;
        const a = anchors[i];
        for (const [h, side] of [[a.hIn, 'in'], [a.hOut, 'out']]) {
          if (!h) continue;
          const sx = (h.x - this._ctx.state.viewport.x) * z + rect.left;
          const sy = (h.y - this._ctx.state.viewport.y) * z + rect.top;
          if (Math.hypot(screenX - sx, screenY - sy) < HIT_R) {
            return { shapeId: id, anchorIdx: i, side };
          }
        }
      }
    }
    return null;
  }

  _updateMarqueeSelection(start, end, additive) {
    const x0 = Math.min(start.x, end.x);
    const y0 = Math.min(start.y, end.y);
    const x1 = Math.max(start.x, end.x);
    const y1 = Math.max(start.y, end.y);
    if (!additive) for (const sel of this._selMap.values()) sel.clear();
    for (const [id, anchors] of this._anchorsMap) {
      if (!this._selMap.has(id)) this._selMap.set(id, new Set());
      const sel = this._selMap.get(id);
      for (let i = 0; i < anchors.length; i++) {
        const { x, y } = anchors[i];
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) sel.add(i);
      }
    }
  }

  _redraw() {
    this._ensureLayer();
    const layer = this._layer;
    layer.clear();

    const z  = this._ctx.state.viewport.zoom;
    const sw = 1 / z;
    const hs = 4 / z;
    const hr = 3 / z;

    for (const [id, anchors] of this._anchorsMap) {
      const sel = this._selMap.get(id) ?? new Set();
      for (let i = 0; i < anchors.length; i++) {
        const a     = anchors[i];
        const isSel = sel.has(i);

        if (isSel) {
          for (const [h] of [[a.hIn], [a.hOut]]) {
            if (!h) continue;
            const line = layer.borrow('line');
            line.setAttribute('class', 'pen-handle-line');
            line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
            line.setAttribute('x2', h.x); line.setAttribute('y2', h.y);
            line.setAttribute('stroke-width', sw);
            const dot = layer.borrow('circle');
            dot.setAttribute('class', 'pen-handle-dot');
            dot.setAttribute('cx', h.x); dot.setAttribute('cy', h.y);
            dot.setAttribute('r', hr);
          }
        }

        const rect = layer.borrow('rect');
        rect.setAttribute('class', 'pen-anchor');
        rect.setAttribute('x',      a.x - hs);
        rect.setAttribute('y',      a.y - hs);
        rect.setAttribute('width',  hs * 2);
        rect.setAttribute('height', hs * 2);
        rect.setAttribute('stroke-width', sw);
        if (isSel) rect.setAttribute('fill', 'var(--theme-accent, #4a9eff)');
        else       rect.setAttribute('fill', 'var(--theme-bg-raised, #fff)');
      }
    }

    // Marquee rect
    if (this._mode === 'marquee' && this._marqueeStart && this._dragStart) {
      const s = this._marqueeStart;
      const e = this._dragStart;
      const m = layer.borrow('rect');
      m.setAttribute('class', 'rubber-band');
      m.setAttribute('x',      Math.min(s.x, e.x));
      m.setAttribute('y',      Math.min(s.y, e.y));
      m.setAttribute('width',  Math.abs(e.x - s.x));
      m.setAttribute('height', Math.abs(e.y - s.y));
      m.setAttribute('vector-effect', 'non-scaling-stroke');
    }
  }
}

function _findShape(id, state) {
  for (const layer of state.layers) {
    const shape = layer.shapes.find(s => s.id === id);
    if (shape) return { shape, layer };
  }
  return null;
}
