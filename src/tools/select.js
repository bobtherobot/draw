/**
 * Select tool — click-select, rubber-band, move, scale handles, rotate handle.
 * Text shapes: double-click to edit.
 */
import { Tool } from './base.js';
import { startEditing, isEditing } from '../textedit.js';
import { unionBBoxes } from '../geometry/bbox.js';
import { rotatePathD, scalePathD, rotatePoint } from '../geometry/transform.js';
import { effectiveVisible, effectiveLocked, allDisplayItems, findItem, sanitizeItems } from '../core/state.js';
import { hitTest } from '../core/hit-test.js';
import { handleAtPoint } from '../render/selection.js';
import { applyTransform } from '../viewport.js';
import { getCK } from '../render/renderer.js';

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
    this._bboxSnap        = null;  // selection bbox at drag start for scale
    this._scaleHandle     = null;
    this._scaleRotDisplay = null;  // _rotDisplay captured at scale-drag start
    this._rotCenter       = null;
    this._rotStart        = null;
    this._initialAngle    = 0;     // accumulated rotation before current drag
    this._lastClickId= null;
    this._lastClickT = 0;
    this._bandLayer  = null;
    this._bandStart  = null;
    this._bandEnd    = null;
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
    const handle   = handleAtPoint(e.clientX, e.clientY);
    const now      = Date.now();

    this._dragStart = pos;
    this._moved     = false;

    // Scale / rotate handles
    if (handle && ctx.state.selection.size > 0) {
      this._lastClickId = null;
      if (handle.part === 'rotate') { this._enterRotate(); return; }
      if (SCALE_HANDLES.includes(handle.part)) { this._enterScale(handle.part); return; }
    }

    // Hit-test shapes
    const hitId = this._shapeIdAt(e.clientX, e.clientY);

    // Handle double-click on text shapes
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
      this._bandStart = pos;
      this._bandEnd   = pos;
      this._bandLayer.addCall(canvasCtx => this._drawBand(canvasCtx));
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
      }
      ctx.render();
    } else if (this._mode === 'band') {
      this._bandEnd = pos;
      ctx.render();
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
    // If the selection has a uniform rotation, scale in the shape's local frame.
    this._scaleRotDisplay = _uniformRotDisplay(this._ctx.state.selection);
    this._bboxSnap = this._scaleRotDisplay?.bbox ?? this._selectionBBox();
  }

  _doScale(pos, constrain) {
    const ctx     = this._ctx;
    const h       = this._scaleHandle;
    const rotDisp = this._scaleRotDisplay;
    const bb      = this._bboxSnap;
    if (!bb) return;

    // When scaling a rotated shape, work in the shape's local (unrotated) frame.
    const localPos = rotDisp
      ? rotatePoint(pos.x, pos.y, rotDisp.center.x, rotDisp.center.y, -rotDisp.angle)
      : pos;

    const newW = h.includes('e') ? localPos.x - bb.x  : bb.x + bb.width  - localPos.x;
    const newH = h.includes('s') ? localPos.y - bb.y  : bb.y + bb.height - localPos.y;

    let sx = newW / bb.width  || 1;
    let sy = newH / bb.height || 1;
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

      if (rotDisp && snap.attrs?.d != null) {
        // Scale in local (rotated) frame: unrotate → scale → re-rotate.
        const { center: { x: cx, y: cy }, angle } = rotDisp;
        let d = snap.attrs.d ?? '';
        d = rotatePathD(d, -angle, cx, cy);
        d = scalePathD(d, sx, sy, ox, oy);
        d = rotatePathD(d, angle, cx, cy);
        shape.attrs.d = d;
        // Update _rotDisplay: same rotation angle and pivot, new scaled bbox.
        const nx = ox + (bb.x - ox) * sx;
        const ny = oy + (bb.y - oy) * sy;
        shape._rotDisplay = {
          bbox:   { x: nx, y: ny, width: bb.width * Math.abs(sx), height: bb.height * Math.abs(sy) },
          center: { x: cx, y: cy },
          angle,
        };
      } else {
        ctx.getObjectType(shape.type)?.scale(shape, sx, sy, ox, oy);
      }
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
    // If the selection already has a rotation, start from that state so the
    // overlay doesn't snap back to the axis-aligned box on handle grab.
    const rotDisp = _uniformRotDisplay(this._ctx.state.selection);
    if (rotDisp) {
      this._rotCenter    = rotDisp.center;
      this._initialAngle = rotDisp.angle;
      this._ctx.state.activeRotation = { bbox: rotDisp.bbox, center: rotDisp.center, angle: rotDisp.angle };
    } else {
      const bb = this._selectionBBox();
      if (bb) {
        this._rotCenter = { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
        this._ctx.state.activeRotation = { bbox: bb, center: this._rotCenter, angle: 0 };
      }
      this._initialAngle = 0;
    }
    if (this._rotCenter) {
      this._rotStart = Math.atan2(this._dragStart.y - this._rotCenter.y, this._dragStart.x - this._rotCenter.x) * 180 / Math.PI;
    }
  }

  _doRotate(pos, doSnap) {
    if (!this._rotCenter) return;
    const angle = Math.atan2(pos.y - this._rotCenter.y, pos.x - this._rotCenter.x) * 180 / Math.PI;
    let   delta = angle - this._rotStart;
    if (doSnap) delta = Math.round(delta / 15) * 15;
    // activeRotation.angle is the TOTAL accumulated angle, not just this drag's delta.
    if (this._ctx.state.activeRotation) this._ctx.state.activeRotation.angle = this._initialAngle + delta;
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
      const bb = ot?.getBBox(shape);
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
    const hit  = hitTest(screenX, screenY, ctx.getObjectType);
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
      const bb = ot?.getBBox(shape);
      if (bb) bbs.push(bb);
    }
    return unionBBoxes(bbs);
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

  _cleanup() {
    if (this._bandLayer) {
      this._ctx?.overlay.releaseLayer('select-band');
      this._bandLayer = null;
      this._bandStart = null;
      this._bandEnd   = null;
    }
    this._snapshots.clear();
    this._bboxSnap        = null;
    this._scaleHandle     = null;
    this._scaleRotDisplay = null;
    this._rotCenter       = null;
    this._rotStart        = null;
    this._initialAngle    = 0;
    if (this._ctx) {
      this._ctx.state.operation     = null;
      this._ctx.state.activeRotation = null;
    }
  }
}

// ── Module-level helpers ─────────────────────────────────────────────────────

// Returns the shared _rotDisplay if every shape in the selection has the same
// rotation (same angle, same pivot), otherwise null.
function _uniformRotDisplay(selectionSet) {
  const ids = [...selectionSet];
  if (!ids.length) return null;
  const first = findItem(ids[0])?._rotDisplay;
  if (!first) return null;
  for (const id of ids.slice(1)) {
    const rd = findItem(id)?._rotDisplay;
    if (!rd || rd.angle !== first.angle ||
        rd.center.x !== first.center.x || rd.center.y !== first.center.y) return null;
  }
  return first;
}

function _css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
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
  for (const k of ['_text','_fontSize','_fontFamily','_textAlign','_boxWidth','_boxHeight',
                   '_scaleX','_scaleY','_rotation','_rotCx','_rotCy','_rotDisplay']) {
    if (k in snap) shape[k] = snap[k];
    else delete shape[k];
  }
}
