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
    this._bboxSnap           = null;
    this._scaleHandle        = null;
    this._scaleRotDisplay    = null;
    this._scalingCollection  = false; // true when _scaleRotDisplay came from selectionRotation
    this._selRotSnap         = null;  // selectionRotation snapshot at move-drag start
    this._rotCenter          = null;
    this._rotStart           = null;
    this._initialAngle       = 0;
    this._rotInitialCenter   = null;
    this._lastClickId= null;
    this._lastClickT = 0;
    this._bandLayer  = null;
    this._bandStart  = null;
    this._bandEnd    = null;
    if (this._ctx) this._ctx.render();
  }

  deactivate() {
    if (isEditing()) return; // let textarea commit naturally
    if (this._ctx) this._ctx.state.selectionRotation = null;
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
      if (handle.part === 'origin') { this._enterMoveOrigin(); return; }
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
        // Switching to a different shape — new selection, discard session state.
        ctx.state.selectionOrigin   = null;
        ctx.state.selectionRotation = null;
        ctx.state.selection = new Set([hitId]);
      } else if (e.shiftKey) {
        // Modifying selection — discard session state.
        ctx.state.selectionOrigin   = null;
        ctx.state.selectionRotation = null;
        const sel = new Set(ctx.state.selection);
        if (sel.has(hitId)) sel.delete(hitId); else sel.add(hitId);
        ctx.state.selection = sel;
      }
      // else: clicking an already-selected shape to move — keep session state.
      this._mode = 'move';
      ctx.state.operation = 'move';
      this._snapshotMove();
      ctx.render();
    } else {
      // Clicking empty space — discard session state.
      ctx.state.selectionOrigin   = null;
      ctx.state.selectionRotation = null;
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
        if (snap._origin) shape._origin = { x: snap._origin.x + dx, y: snap._origin.y + dy };
      }
      if (this._selRotSnap) {
        const s = this._selRotSnap;
        ctx.state.selectionRotation = {
          bbox:   { x: s.bbox.x + dx, y: s.bbox.y + dy, width: s.bbox.width, height: s.bbox.height },
          center: { x: s.center.x + dx, y: s.center.y + dy },
          angle:  s.angle,
        };
      }
      ctx.render();
    } else if (this._mode === 'moveorigin') {
      this._doMoveOrigin(pos);
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
      if (this._mode === 'rotate' && ctx.state.activeRotation && ctx.state.selection.size > 1) {
        ctx.state.selectionRotation = { ...ctx.state.activeRotation };
      }
      this._commitTransform();
    } else if (this._mode === 'moveorigin') {
      if (this._moved) this._commitMoveOrigin();
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
      this._ctx.state.selection        = new Set();
      this._ctx.state.selectionOrigin  = null;
      this._ctx.state.selectionRotation = null;
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
    const sr = this._ctx.state.selectionRotation;
    this._selRotSnap = sr
      ? { bbox: { ...sr.bbox }, center: { ...sr.center }, angle: sr.angle }
      : null;
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
    // For multi-selection _uniformRotDisplay fails (different per-shape centers),
    // so fall back to the persisted collection rotation state.
    this._scaleRotDisplay   = _uniformRotDisplay(this._ctx.state.selection);
    this._scalingCollection = false;
    if (!this._scaleRotDisplay && this._ctx.state.selectionRotation && this._ctx.state.selection.size > 1) {
      this._scaleRotDisplay   = this._ctx.state.selectionRotation;
      this._scalingCollection = true;
    }
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
        // Update each shape's _rotDisplay from its OWN pre-rotation bbox.
        //
        // _rotDisplay invariant: bbox must be centered on center, and center
        // must be the world-space visual center. For multi-selection (collection
        // scaling) cx,cy is the collection center, not the shape center — so we
        // unrotate each shape's snapshot center from the collection frame, scale
        // it, then re-rotate to get the new world center. For single shapes
        // snap._rotDisplay.center == cx,cy so this reduces to the same formula.
        const shapeBB  = snap._rotDisplay?.bbox;
        const snapCtr  = snap._rotDisplay?.center ?? { x: cx, y: cy };
        if (shapeBB) {
          const scaledW  = shapeBB.width  * Math.abs(sx);
          const scaledH  = shapeBB.height * Math.abs(sy);
          const localC   = rotatePoint(snapCtr.x, snapCtr.y, cx, cy, -angle);
          const newLCx   = ox + (localC.x - ox) * sx;
          const newLCy   = oy + (localC.y - oy) * sy;
          const { x: visCx, y: visCy } = rotatePoint(newLCx, newLCy, cx, cy, angle);
          shape._rotDisplay = {
            bbox:   { x: visCx - scaledW / 2, y: visCy - scaledH / 2, width: scaledW, height: scaledH },
            center: { x: visCx, y: visCy },
            angle,
          };
        } else {
          delete shape._rotDisplay;
        }
      } else {
        const ot = ctx.getObjectType(shape.type);
        ot?.scale(shape, sx, sy, ox, oy);
        ot?.syncRotDisplay?.(shape);
      }

      // Keep _origin fixed in stage/canvas coordinates when scaling a rotated
      // shape — the origin is a stage-space reference point, so it must not move
      // visually even as the object geometry changes beneath it.
      const snapOrigin = snap._origin;
      if (snapOrigin) {
        if (rotDisp) {
          shape._origin = { x: snapOrigin.x, y: snapOrigin.y };
        } else {
          shape._origin = { x: ox + (snapOrigin.x - ox) * sx, y: oy + (snapOrigin.y - oy) * sy };
        }
      }
    }

    // Keep selectionRotation (collection overlay bbox) in sync during scale drags
    // so renderSelection can draw the correct rotated overlay each frame.
    if (this._scalingCollection) {
      const { center: { x: srCx, y: srCy }, angle: srAngle, bbox: srBB } = this._scaleRotDisplay;
      const scaledW  = srBB.width  * Math.abs(sx);
      const scaledH  = srBB.height * Math.abs(sy);
      const localCx  = ox + (srCx - ox) * sx;
      const localCy  = oy + (srCy - oy) * sy;
      const { x: visCx, y: visCy } = rotatePoint(localCx, localCy, srCx, srCy, srAngle);
      ctx.state.selectionRotation = {
        bbox:   { x: visCx - scaledW / 2, y: visCy - scaledH / 2, width: scaledW, height: scaledH },
        center: { x: visCx, y: visCy },
        angle:  srAngle,
      };
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
    const ctx = this._ctx;
    const selectedShapes = [...ctx.state.selection].map(id => findItem(id)).filter(Boolean);
    // Session origin (set by crosshair drag) takes priority; fall back to per-shape _origin.
    const customOrigin = ctx.state.selectionOrigin ?? _uniformOriginFromShapes(selectedShapes);
    // If the selection already has a rotation, start from that state so the
    // overlay doesn't snap back to the axis-aligned box on handle grab.
    // For multi-selection _uniformRotDisplay fails (each shape has its own center),
    // so fall back to the persisted collection rotation state.
    const rotDisp = _uniformRotDisplay(ctx.state.selection)
      ?? (ctx.state.selectionRotation && ctx.state.selection.size > 1 ? ctx.state.selectionRotation : null);
    if (rotDisp) {
      this._rotInitialCenter = rotDisp.center;
      this._rotCenter        = customOrigin ?? rotDisp.center;
      this._initialAngle     = rotDisp.angle;
      this._ctx.state.activeRotation = { bbox: rotDisp.bbox, center: rotDisp.center, angle: rotDisp.angle };
    } else {
      const bb = this._selectionBBox();
      if (bb) {
        const defaultCenter    = { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
        this._rotInitialCenter = defaultCenter;
        this._rotCenter        = customOrigin ?? defaultCenter;
        this._ctx.state.activeRotation = { bbox: bb, center: defaultCenter, angle: 0 };
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

    if (this._ctx.state.activeRotation) {
      const ar = this._ctx.state.activeRotation;
      const rc = this._rotCenter;
      const ic = this._rotInitialCenter;
      // When the pivot differs from the initial visual centre, the selection box
      // must orbit the pivot so it tracks the shape.
      if (ic && (rc.x !== ic.x || rc.y !== ic.y)) {
        const newCenter = rotatePoint(ic.x, ic.y, rc.x, rc.y, delta);
        this._ctx.state.activeRotation = {
          bbox:   { ...ar.bbox, x: newCenter.x - ar.bbox.width / 2, y: newCenter.y - ar.bbox.height / 2 },
          center: newCenter,
          angle:  this._initialAngle + delta,
        };
      } else {
        ar.angle = this._initialAngle + delta;
      }
    }

    for (const id of this._ctx.state.selection) {
      const shape = findItem(id);
      if (!shape) continue;
      const shapeSnap = this._snapshots.get(id);
      if (!shapeSnap) continue;
      _restoreShape(shape, shapeSnap);
      this._ctx.getObjectType(shape.type)?.bakeRotation(shape, delta, this._rotCenter.x, this._rotCenter.y);
      // Keep _origin attached to the shape as it rotates.
      if (shapeSnap._origin) {
        const { x, y } = rotatePoint(shapeSnap._origin.x, shapeSnap._origin.y, this._rotCenter.x, this._rotCenter.y, delta);
        shape._origin = { x, y };
      }
    }
  }

  // ── Move origin ─────────────────────────────────────────────────────────────

  _enterMoveOrigin() {
    this._mode = 'moveorigin';
    this._ctx.state.operation = 'moveorigin';
    this._snapshots.clear();
    for (const id of this._ctx.state.selection) {
      const shape = findItem(id);
      if (shape) this._snapshots.set(id, _cloneShape(shape));
    }
  }

  _doMoveOrigin(pos) {
    // Always update the session-level origin so the crosshair tracks the drag.
    this._ctx.state.selectionOrigin = { x: pos.x, y: pos.y };
    // Only write per-shape _origin for single-shape selections — multi-selection
    // origin moves must not persist onto individual shapes.
    if (this._ctx.state.selection.size === 1) {
      for (const id of this._ctx.state.selection) {
        const shape = findItem(id);
        if (shape) shape._origin = { x: pos.x, y: pos.y };
      }
    }
  }

  _commitMoveOrigin() {
    const ctx = this._ctx;
    // Multi-selection: selectionOrigin is already set; no per-shape history entry.
    if (ctx.state.selection.size !== 1) return;
    // Single selection: commit _origin change so undo restores it.
    const snapshots = new Map(this._snapshots);
    const postSnaps = new Map();
    for (const id of ctx.state.selection) {
      const shape = findItem(id);
      if (shape) postSnaps.set(id, _cloneShape(shape));
    }
    ctx.execute({
      do() {
        for (const [id, snap] of postSnaps) {
          const s = findItem(id);
          if (s) { _restoreShape(s, snap); ctx.state.selectionOrigin = s._origin ?? null; }
        }
        ctx.render();
      },
      undo() {
        for (const [id, snap] of snapshots) {
          const s = findItem(id);
          if (s) { _restoreShape(s, snap); ctx.state.selectionOrigin = s._origin ?? null; }
        }
        ctx.render();
      },
    });
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
    ctx.state.selection        = sel;
    ctx.state.selectionRotation = null;
  }

  // ── Commit transform ─────────────────────────────────────────────────────────

  _commitTransform() {
    const snapshots = new Map(this._snapshots);
    const ctx       = this._ctx;
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
          do()   { const s = findItem(shapeId); if (s) { s._text = text; ctx.getObjectType(s.type)?.syncRotDisplay?.(s); ctx.render(); } },
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
        ctx.state.items             = ctx.state.items.filter(i => !ids.includes(i.id));
        sanitizeItems(ctx.state.items);
        ctx.state.selection          = new Set();
        ctx.state.selectionRotation  = null;
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
    this._selRotSnap      = null;
    this._bboxSnap        = null;
    this._scaleHandle     = null;
    this._scaleRotDisplay = null;
    this._rotCenter          = null;
    this._rotStart           = null;
    this._initialAngle       = 0;
    this._rotInitialCenter   = null;
    if (this._ctx) {
      this._ctx.state.operation     = null;
      this._ctx.state.activeRotation = null;
    }
  }
}

// ── Module-level helpers ─────────────────────────────────────────────────────

// Returns a _rotDisplay for the selection if every shape shares the same angle
// and pivot. For multi-selection the bbox is the union of all individual
// pre-rotation bboxes (so the overlay covers the whole collection, not just the
// first shape).
function _uniformRotDisplay(selectionSet) {
  const ids = [...selectionSet];
  if (!ids.length) return null;
  const first = findItem(ids[0])?._rotDisplay;
  if (!first) return null;
  const bboxes = [first.bbox];
  for (const id of ids.slice(1)) {
    const rd = findItem(id)?._rotDisplay;
    if (!rd || rd.angle !== first.angle ||
        rd.center.x !== first.center.x || rd.center.y !== first.center.y) return null;
    bboxes.push(rd.bbox);
  }
  const union = unionBBoxes(bboxes);
  return union ? { bbox: union, center: first.center, angle: first.angle } : null;
}

function _uniformOriginFromShapes(shapes) {
  if (!shapes.length) return null;
  const first = shapes[0]?._origin;
  if (!first) return null;
  for (let i = 1; i < shapes.length; i++) {
    const o = shapes[i]?._origin;
    if (!o || o.x !== first.x || o.y !== first.y) return null;
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
                   '_scaleX','_scaleY','_rotation','_rotCx','_rotCy','_rotDisplay','_origin']) {
    if (k in snap) shape[k] = snap[k];
    else delete shape[k];
  }
}
