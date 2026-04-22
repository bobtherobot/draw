/**
 * Select tool — click-select, rubber-band, move, scale handles, rotate handle.
 * Text shapes: double-click to edit.
 */
import { Tool } from './base.js';
import { startEditing, isEditing } from '../textedit.js';
import { unionBBoxes } from '../geometry/bbox.js';
import { effectiveVisible, effectiveLocked, allDisplayItems, findItem, sanitizeItems } from '../core/state.js';
import { hitTest } from '../core/hit-test.js';

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
      const hitId = this._shapeIdAt(e.clientX, e.clientY);
      if (hitId && hitId === this._lastClickId && now - this._lastClickT < DBL_CLICK_MS) {
        const shape = findItem(hitId);
        if (shape && (shape.type === 'free-text' || shape.type === 'text-block')) {
          this._lastClickId = null;
          this._openTextEditor(shape, hitId);
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
    const hitId = this._shapeIdAt(e.clientX, e.clientY);
    if (hitId) {
      if (!e.shiftKey && !ctx.state.selection.has(hitId)) {
        ctx.state.selection = new Set([hitId]);
      } else if (e.shiftKey) {
        const sel = new Set(ctx.state.selection);
        if (sel.has(hitId)) sel.delete(hitId); else sel.add(hitId);
        ctx.state.selection = sel;
      }
      this._mode = 'move';
      ctx.state.operation = 'move';
      this._snapshotMove();
      ctx.render();
    } else {
      if (!e.shiftKey) ctx.state.selection = new Set();
      this._mode      = 'band';
      ctx.state.operation = 'band';
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
        const shape = findItem(id);
        if (!shape) continue;
        const snap = this._snapshots.get(id);
        if (!snap) continue;
        const ot = ctx.getObjectType(shape.type);
        if (!ot) continue;
        _restoreShape(shape, snap);
        ot.translate(shape, dx, dy);
        const el = ctx.getElement(id);
        if (el) ot.syncElement(el, shape, { mode: ctx.state.activeMode, zoom: ctx.state.viewport.zoom });
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
      this._doRotate(pos, e.shiftKey);
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
        const shape = findItem(id);
        if (shape) postSnaps.set(id, _cloneShape(shape));
      }
      ctx.execute({
        do() {
          for (const [id, snap] of postSnaps) {
            const shape = findItem(id);
            if (shape) _restoreShape(shape, snap);
          }
          ctx.render();
        },
        undo() {
          for (const [id, snap] of snapshots) {
            const shape = findItem(id);
            if (shape) _restoreShape(shape, snap);
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
      const shape = findItem(id);
      if (shape) this._snapshots.set(id, _cloneShape(shape));
    }
  }

  // ── Scale ───────────────────────────────────────────────────────────────────

  _enterScale(handle) {
    this._mode        = 'scale';
    this._ctx.state.operation = `scale:${handle}`;
    this._scaleHandle = handle;
    this._snapshots.clear();
    for (const id of this._ctx.state.selection) {
      const shape = findItem(id);
      if (shape) this._snapshots.set(id, _cloneShape(shape));
    }
    // Capture selection bbox at drag start
    this._bboxSnap = this._selectionBBox();
  }

  _doScale(pos, constrain) {
    const ctx  = this._ctx;
    const bb   = this._bboxSnap;
    if (!bb) return;
    const h    = this._scaleHandle;

    const newW = h.includes('e') ? pos.x - bb.x  : bb.x + bb.width  - pos.x;
    const newH = h.includes('s') ? pos.y - bb.y  : bb.y + bb.height - pos.y;

    let sx = newW / bb.width  || 1;
    let sy = newH / bb.height || 1;
    // Edge-only handles constrain one axis
    if (h === 'n' || h === 's') sx = 1;
    if (h === 'e' || h === 'w') sy = 1;
    const isCorner = h.length === 2;
    if (constrain && isCorner) { const s = Math.min(Math.abs(sx), Math.abs(sy)); sx = sx < 0 ? -s : s; sy = sy < 0 ? -s : s; }

    const ox = h.includes('w') ? bb.x + bb.width  : bb.x;
    const oy = h.includes('n') ? bb.y + bb.height : bb.y;

    for (const id of ctx.state.selection) {
      const shape = findItem(id);
      if (!shape) continue;
      const snap = this._snapshots.get(id);
      if (!snap) continue;
      _restoreShape(shape, snap);
      ctx.getObjectType(shape.type)?.scale(shape, sx, sy, ox, oy);
    }
  }

  // ── Rotate ──────────────────────────────────────────────────────────────────

  _enterRotate() {
    this._mode    = 'rotate';
    this._ctx.state.operation = 'rotate';
    this._snapshots.clear();
    for (const id of this._ctx.state.selection) {
      const shape = findItem(id);
      if (shape) this._snapshots.set(id, _cloneShape(shape));
    }
    const bb = this._selectionBBox();
    if (bb) {
      this._rotCenter = { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
      this._rotStart  = Math.atan2(this._dragStart.y - this._rotCenter.y, this._dragStart.x - this._rotCenter.x) * 180 / Math.PI;
      this._ctx.state.activeRotation = { bbox: bb, center: this._rotCenter, angle: 0 };
    }
  }

  _doRotate(pos, doSnap) {
    if (!this._rotCenter) return;
    const angle = Math.atan2(pos.y - this._rotCenter.y, pos.x - this._rotCenter.x) * 180 / Math.PI;
    let   delta = angle - this._rotStart;
    if (doSnap) delta = Math.round(delta / 15) * 15;
    if (this._ctx.state.activeRotation) this._ctx.state.activeRotation.angle = delta;
    for (const id of this._ctx.state.selection) {
      const shape = findItem(id);
      if (!shape) continue;
      const shapeSnap = this._snapshots.get(id);
      if (!shapeSnap) continue;
      _restoreShape(shape, shapeSnap);
      this._ctx.getObjectType(shape.type)?.bakeRotation(shape, delta, this._rotCenter.x, this._rotCenter.y);
    }
  }

  // ── Rubber band ─────────────────────────────────────────────────────────────

  _commitBand(end, additive) {
    const s  = this._dragStart;
    const x0 = Math.min(s.x, end.x), y0 = Math.min(s.y, end.y);
    const x1 = Math.max(s.x, end.x), y1 = Math.max(s.y, end.y);
    if (Math.abs(x1-x0) < 2 && Math.abs(y1-y0) < 2) return;

    const ctx = this._ctx;
    const sel = additive ? new Set(ctx.state.selection) : new Set();
    for (const shape of allDisplayItems()) {
      if (!effectiveVisible(shape)) continue;
      if (effectiveLocked(shape)) continue;
      const ot = ctx.getObjectType(shape.type);
      const bb = ot?.getBBox(shape, ctx.getElement(shape.id));
      if (!bb) continue;
      if (bb.x >= x0 && bb.x + bb.width  <= x1 &&
          bb.y >= y0 && bb.y + bb.height <= y1) {
        sel.add(shape.id);
      }
    }
    ctx.state.selection = sel;
  }

  // ── Commit transform ─────────────────────────────────────────────────────────

  _commitTransform() {
    const snapshots = new Map(this._snapshots);
    const ctx       = this._ctx;
    const activeRot = ctx.state.activeRotation ? { ...ctx.state.activeRotation } : null;
    const postSnaps = new Map();
    for (const id of ctx.state.selection) {
      const shape = findItem(id);
      if (shape) {
        const snap = _cloneShape(shape);
        if (activeRot) snap._rotDisplay = activeRot;
        postSnaps.set(id, snap);
      }
    }
    ctx.execute({
      do() {
        for (const [id, snap] of postSnaps) {
          const shape = findItem(id);
          if (shape) _restoreShape(shape, snap);
        }
        ctx.render();
      },
      undo() {
        for (const [id, snap] of snapshots) {
          const shape = findItem(id);
          if (shape) _restoreShape(shape, snap);
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
      fontSize:    shape._fontSize   ?? 14,
      fontFamily:  shape._fontFamily ?? 'sans-serif',
      textAlign:   shape._textAlign  ?? 'left',
      fill:        shape.style.fill  ?? '#000000',
      scaleX:      shape._scaleX     ?? 1,
      scaleY:      shape._scaleY     ?? 1,
      zoom:        ctx.state.viewport.zoom,
      shapeId,
      boxWidth:    shape.type === 'text-block' ? shape._boxWidth  : undefined,
      boxHeight:   shape.type === 'text-block' ? shape._boxHeight : undefined,
      initialText: shape._text ?? '',
      onInput: (text) => {
        // Live-update the shape so text guides reflect current content while typing.
        // The SVG element is hidden by the renderer while shapeId === getEditingShapeId().
        const s = findItem(shapeId);
        if (s) { s._text = text; ctx.render(); }
      },
      onCommit: (text) => {
        // Restore snap text first so execute's do() starts from a clean state
        const s = findItem(shapeId);
        if (s) s._text = snap._text;
        ctx.execute({
          do()   { const s = findItem(shapeId); if (s) { s._text = text; ctx.render(); } },
          undo() { const s = findItem(shapeId); if (s) { _restoreShape(s, snap); ctx.render(); } },
        });
      },
      onCancel: () => {
        const s = findItem(shapeId);
        if (s) { _restoreShape(s, snap); ctx.render(); }
      },
    });
    ctx.render(); // hide SVG shape immediately, show textarea
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  deleteSelected() { this._deleteSelected(); }

  _deleteSelected() {
    const ctx = this._ctx;
    const ids = [...ctx.state.selection];
    if (ids.length === 0) return;

    const oldItems = [...ctx.state.items];
    const oldSel   = new Set(ctx.state.selection);

    ctx.execute({
      do() {
        ctx.state.items = ctx.state.items.filter(i => !ids.includes(i.id));
        sanitizeItems(ctx.state.items);
        ctx.state.selection = new Set();
        ctx.render();
      },
      undo() {
        ctx.state.items     = oldItems;
        ctx.state.selection = oldSel;
        ctx.render();
      },
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  _shapeIdAt(screenX, screenY) {
    const ctx  = this._ctx;
    const hit  = hitTest(screenX, screenY, ctx.getObjectType, ctx.getElement);
    if (!hit || hit.isHandle || !hit.shape) return null;
    if (effectiveLocked(hit.shape)) return null;
    return hit.shape.id;
  }

  _selectionBBox() {
    const ctx = this._ctx;
    const bbs = [];
    for (const id of ctx.state.selection) {
      const shape = findItem(id);
      if (!shape) continue;
      const ot = ctx.getObjectType(shape.type);
      const bb = ot?.getBBox(shape, ctx.getElement(id));
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
    if (this._ctx) {
      this._ctx.state.operation     = null;
      this._ctx.state.activeRotation = null;
    }
  }
}

// ── Module-level helpers ─────────────────────────────────────────────────────

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
  for (const k of ['_text','_fontSize','_fontFamily','_textAlign','_boxWidth','_boxHeight',
                   '_scaleX','_scaleY','_rotation','_rotCx','_rotCy','_rotDisplay']) {
    if (k in snap) shape[k] = snap[k];
    else delete shape[k];
  }
}
