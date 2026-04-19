/**
 * Select tool — click-select, rubber-band, move, scale handles, rotate handle.
 * Text shapes: double-click to edit.
 */
import { Tool } from './base.js';
import { startEditing, isEditing } from '../textedit.js';
import { unionBBoxes } from '../geometry/bbox.js';

const SCALE_HANDLES = ['nw','n','ne','e','se','s','sw','w'];
const DBL_CLICK_MS  = 400;

export class SelectTool extends Tool {
  get id()       { return 'select'; }
  get label()    { return 'Select'; }
  get shortcut() { return 'v'; }
  get icon()     { return 'select'; }

  activate() {
    this._mode       = 'idle'; // 'idle'|'move'|'band'|'scale'|'rotate'
    this._dragStart  = null;
    this._moved      = false;
    this._snapshots  = new Map(); // shapeId → attrs clone
    this._bboxSnap   = null;     // selection bbox at drag start for scale
    this._scaleHandle= null;
    this._rotCenter  = null;
    this._rotStart   = null;
    this._lastClickId= null;
    this._lastClickT = 0;
    this._bandEl     = null;
    this._bandLayer  = null;
    if (this._ctx) this._ctx.render();
  }

  deactivate() {
    if (isEditing()) return; // let textarea commit naturally
    this._cleanup();
  }

  onMouseDown(e) {
    if (e.button !== 0) return;
    if (isEditing()) return;

    const ctx      = this._ctx;
    const pos      = ctx.screenToDoc(e.clientX, e.clientY);
    const handle   = e.target.dataset?.handle;
    const now      = Date.now();

    this._dragStart = pos;
    this._moved     = false;

    // Handle double-click on text shapes
    if (!handle) {
      const hitId = this._shapeIdAt(e.target);
      if (hitId && hitId === this._lastClickId && now - this._lastClickT < DBL_CLICK_MS) {
        const found = _findShape(hitId, ctx.state);
        if (found && (found.shape.type === 'text-line' || found.shape.type === 'text-block')) {
          this._lastClickId = null;
          this._openTextEditor(found.shape, hitId);
          return;
        }
      }
      this._lastClickId = hitId ?? null;
      this._lastClickT  = now;
    } else {
      this._lastClickId = null;
    }

    // Scale / rotate handles
    if (handle && ctx.state.selection.size > 0) {
      if (handle === 'rotate') { this._enterRotate(); return; }
      if (SCALE_HANDLES.includes(handle)) { this._enterScale(handle); return; }
    }

    // Hit-test shapes
    const hitId = this._shapeIdAt(e.target);
    if (hitId) {
      if (!e.shiftKey && !ctx.state.selection.has(hitId)) {
        ctx.state.selection = new Set([hitId]);
      } else if (e.shiftKey) {
        const sel = new Set(ctx.state.selection);
        if (sel.has(hitId)) sel.delete(hitId); else sel.add(hitId);
        ctx.state.selection = sel;
      }
      this._mode = 'move';
      this._snapshotMove();
      ctx.render();
    } else {
      if (!e.shiftKey) ctx.state.selection = new Set();
      this._mode      = 'band';
      this._bandLayer = ctx.overlay.acquireLayer('select-band');
      this._bandEl    = this._bandLayer.borrow('rect');
      this._bandEl.setAttribute('class', 'rubber-band');
      this._bandEl.setAttribute('vector-effect', 'non-scaling-stroke');
      ctx.render();
    }
  }

  onMouseMove(e) {
    if (this._mode === 'idle') return;
    const ctx = this._ctx;
    const pos = ctx.screenToDoc(e.clientX, e.clientY);
    const dx  = pos.x - this._dragStart.x;
    const dy  = pos.y - this._dragStart.y;
    if (Math.hypot(dx, dy) > 0.5) this._moved = true;

    if (this._mode === 'move') {
      for (const id of ctx.state.selection) {
        const found = _findShape(id, ctx.state);
        if (!found) continue;
        const snap = this._snapshots.get(id);
        if (!snap) continue;
        const ot = ctx.getObjectType(found.shape.type);
        if (!ot) continue;
        // Restore from snapshot then translate
        _restoreShape(found.shape, snap);
        ot.translate(found.shape, dx, dy);
        const el = ctx.getElement(id);
        if (el) ot.syncElement(el, found.shape, { mode: ctx.state.activeMode, zoom: ctx.state.viewport.zoom });
      }
      ctx.render();
    } else if (this._mode === 'band') {
      const s = this._dragStart;
      this._bandEl?.setAttribute('x',      Math.min(s.x, pos.x));
      this._bandEl?.setAttribute('y',      Math.min(s.y, pos.y));
      this._bandEl?.setAttribute('width',  Math.abs(pos.x - s.x));
      this._bandEl?.setAttribute('height', Math.abs(pos.y - s.y));
    } else if (this._mode === 'scale') {
      this._doScale(pos, e.shiftKey);
      ctx.render();
    } else if (this._mode === 'rotate') {
      this._doRotate(pos);
      ctx.render();
    }
  }

  onMouseUp(e) {
    if (this._mode === 'idle') return;
    const ctx  = this._ctx;
    const pos  = ctx.screenToDoc(e.clientX, e.clientY);

    if (this._mode === 'move' && this._moved) {
      const snapshots = new Map(this._snapshots);
      const postSnaps = new Map();
      for (const id of ctx.state.selection) {
        const found = _findShape(id, ctx.state);
        if (found) postSnaps.set(id, _cloneShape(found.shape));
      }
      ctx.execute({
        do() {
          for (const [id, snap] of postSnaps) {
            const found = _findShape(id, ctx.state);
            if (found) _restoreShape(found.shape, snap);
          }
          ctx.render();
        },
        undo() {
          for (const [id, snap] of snapshots) {
            const found = _findShape(id, ctx.state);
            if (found) _restoreShape(found.shape, snap);
          }
          ctx.render();
        },
      });
    } else if (this._mode === 'move' && !this._moved) {
      // Simple click — no move, selection already set on mousedown
    } else if (this._mode === 'band') {
      this._commitBand(pos, e.shiftKey);
    } else if (this._mode === 'scale' || this._mode === 'rotate') {
      this._commitTransform();
    }

    this._cleanup();
    this._mode = 'idle';
    ctx.render();
  }

  onDblClick(e) {
    // Double-click handled via manual detection in onMouseDown
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      this._ctx.state.selection = new Set();
      this._cleanup();
      this._ctx.render();
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditing()) {
      this._deleteSelected();
    }
  }

  // ── Move ────────────────────────────────────────────────────────────────────

  _snapshotMove() {
    this._snapshots.clear();
    for (const id of this._ctx.state.selection) {
      const found = _findShape(id, this._ctx.state);
      if (found) this._snapshots.set(id, _cloneShape(found.shape));
    }
  }

  // ── Scale ───────────────────────────────────────────────────────────────────

  _enterScale(handle) {
    this._mode        = 'scale';
    this._scaleHandle = handle;
    this._snapshots.clear();
    for (const id of this._ctx.state.selection) {
      const found = _findShape(id, this._ctx.state);
      if (found) this._snapshots.set(id, _cloneShape(found.shape));
    }
    // Capture selection bbox at drag start
    this._bboxSnap = this._selectionBBox();
  }

  _doScale(pos, constrain) {
    const ctx  = this._ctx;
    const bb   = this._bboxSnap;
    if (!bb) return;
    const h    = this._scaleHandle;

    // Determine fixed origin (opposite corner/edge) and new extents
    const fixedX = h.includes('e') ? bb.x          : bb.x + bb.width;
    const fixedY = h.includes('s') ? bb.y          : bb.y + bb.height;
    const newW   = h.includes('e') ? pos.x - bb.x  : bb.x + bb.width  - pos.x;
    const newH   = h.includes('s') ? pos.y - bb.y  : bb.y + bb.height - pos.y;

    let sx = newW / bb.width  || 1;
    let sy = newH / bb.height || 1;
    if (constrain) { const s = Math.min(Math.abs(sx), Math.abs(sy)); sx = sx < 0 ? -s : s; sy = sy < 0 ? -s : s; }

    const ox = h.includes('w') ? bb.x + bb.width  : bb.x;
    const oy = h.includes('n') ? bb.y + bb.height : bb.y;

    for (const id of ctx.state.selection) {
      const found = _findShape(id, ctx.state);
      if (!found) continue;
      const snap = this._snapshots.get(id);
      if (!snap) continue;
      _restoreShape(found.shape, snap);
      ctx.getObjectType(found.shape.type)?.scale(found.shape, sx, sy, ox, oy);
    }
  }

  // ── Rotate ──────────────────────────────────────────────────────────────────

  _enterRotate() {
    this._mode    = 'rotate';
    this._snapshots.clear();
    for (const id of this._ctx.state.selection) {
      const found = _findShape(id, this._ctx.state);
      if (found) this._snapshots.set(id, _cloneShape(found.shape));
    }
    const bb = this._selectionBBox();
    if (bb) {
      this._rotCenter = { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
      this._rotStart  = Math.atan2(this._dragStart.y - this._rotCenter.y, this._dragStart.x - this._rotCenter.x) * 180 / Math.PI;
    }
  }

  _doRotate(pos) {
    if (!this._rotCenter) return;
    const angle = Math.atan2(pos.y - this._rotCenter.y, pos.x - this._rotCenter.x) * 180 / Math.PI;
    let   delta = angle - this._rotStart;
    for (const id of this._ctx.state.selection) {
      const found = _findShape(id, this._ctx.state);
      if (!found) continue;
      const snap = this._snapshots.get(id);
      if (!snap) continue;
      _restoreShape(found.shape, snap);
      this._ctx.getObjectType(found.shape.type)?.bakeRotation(found.shape, delta, this._rotCenter.x, this._rotCenter.y);
    }
  }

  // ── Rubber band ─────────────────────────────────────────────────────────────

  _commitBand(end, additive) {
    const s  = this._dragStart;
    const x0 = Math.min(s.x, end.x), y0 = Math.min(s.y, end.y);
    const x1 = Math.max(s.x, end.x), y1 = Math.max(s.y, end.y);
    if (Math.abs(x1-x0) < 2 && Math.abs(y1-y0) < 2) return; // too small

    const ctx = this._ctx;
    const sel = additive ? new Set(ctx.state.selection) : new Set();
    for (const layer of ctx.state.layers) {
      if (!layer.visible) continue;
      for (const shape of layer.shapes) {
        const ot = ctx.getObjectType(shape.type);
        const bb = ot?.getBBox(shape, ctx.getElement(shape.id));
        if (!bb) continue;
        if (bb.x >= x0 && bb.x + bb.width  <= x1 &&
            bb.y >= y0 && bb.y + bb.height <= y1) {
          sel.add(shape.id);
        }
      }
    }
    ctx.state.selection = sel;
  }

  // ── Commit transform ─────────────────────────────────────────────────────────

  _commitTransform() {
    const snapshots = new Map(this._snapshots);
    const ctx       = this._ctx;
    const postSnaps = new Map();
    for (const id of ctx.state.selection) {
      const found = _findShape(id, ctx.state);
      if (found) postSnaps.set(id, _cloneShape(found.shape));
    }
    ctx.execute({
      do() {
        for (const [id, snap] of postSnaps) {
          const found = _findShape(id, ctx.state);
          if (found) _restoreShape(found.shape, snap);
        }
        ctx.render();
      },
      undo() {
        for (const [id, snap] of snapshots) {
          const found = _findShape(id, ctx.state);
          if (found) _restoreShape(found.shape, snap);
        }
        ctx.render();
      },
    });
  }

  // ── Text editing ─────────────────────────────────────────────────────────────

  _openTextEditor(shape, shapeId) {
    const ctx  = this._ctx;
    const snap = _cloneShape(shape);
    startEditing({
      docX:        shape.attrs.x,
      docY:        shape.attrs.y,
      fontSize:    shape._fontSize ?? 14,
      fill:        shape.style.fill ?? '#000000',
      zoom:        ctx.state.viewport.zoom,
      boxWidth:    shape._isArea ? (shape._boxWidth ?? undefined)  : undefined,
      boxHeight:   shape._isArea ? (shape._boxHeight ?? undefined) : undefined,
      initialText: shape._text ?? '',
      onCommit: (text) => {
        const post = _cloneShape(shape);
        ctx.execute({
          do()   { const f = _findShape(shapeId, ctx.state); if (f) { f.shape._text = text; ctx.render(); } },
          undo() { const f = _findShape(shapeId, ctx.state); if (f) { _restoreShape(f.shape, snap); ctx.render(); } },
        });
      },
    });
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  _deleteSelected() {
    const ctx  = this._ctx;
    const ids  = [...ctx.state.selection];
    if (ids.length === 0) return;

    // Snapshot for undo: layer id + shape per deleted shape
    const deleted = ids.map(id => {
      for (const layer of ctx.state.layers) {
        const shape = layer.shapes.find(s => s.id === id);
        if (shape) return { layerId: layer.id, shape: _cloneShape(shape), idx: layer.shapes.indexOf(shape) };
      }
    }).filter(Boolean);

    ctx.execute({
      do() {
        for (const { layerId, shape } of deleted) {
          const layer = ctx.state.layers.find(l => l.id === layerId);
          if (layer) layer.shapes = layer.shapes.filter(s => s.id !== shape.id);
        }
        ctx.state.selection = new Set();
        ctx.render();
      },
      undo() {
        for (const { layerId, shape, idx } of deleted) {
          const layer = ctx.state.layers.find(l => l.id === layerId);
          if (layer) layer.shapes.splice(idx, 0, shape);
        }
        ctx.state.selection = new Set(deleted.map(d => d.shape.id));
        ctx.render();
      },
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  _shapeIdAt(target) {
    let el = target;
    while (el && el.id !== 'canvas') {
      if (el.dataset?.shapeId) return el.dataset.shapeId;
      el = el.parentElement;
    }
    return null;
  }

  _selectionBBox() {
    const ctx  = this._ctx;
    const bbs  = [];
    for (const id of ctx.state.selection) {
      const found = _findShape(id, ctx.state);
      if (!found) continue;
      const ot = ctx.getObjectType(found.shape.type);
      const bb = ot?.getBBox(found.shape, ctx.getElement(id));
      if (bb) bbs.push(bb);
    }
    return unionBBoxes(bbs);
  }

  _cleanup() {
    if (this._bandLayer) {
      this._ctx?.overlay.releaseLayer('select-band');
      this._bandLayer = null;
      this._bandEl    = null;
    }
    this._snapshots.clear();
    this._bboxSnap    = null;
    this._scaleHandle = null;
    this._rotCenter   = null;
    this._rotStart    = null;
  }
}

// ── Module-level helpers ─────────────────────────────────────────────────────

function _findShape(id, state) {
  for (const layer of state.layers) {
    const shape = layer.shapes.find(s => s.id === id);
    if (shape) return { shape, layer };
  }
  return null;
}

function _cloneShape(shape) {
  return {
    ...shape,
    attrs: { ...shape.attrs },
    style: { ...shape.style },
  };
}

function _restoreShape(shape, snap) {
  Object.assign(shape.attrs, snap.attrs);
  Object.assign(shape.style, snap.style);
  for (const k of ['_text','_fontSize','_fontFamily','_boxWidth','_boxHeight']) {
    if (k in snap) shape[k] = snap[k];
  }
}
