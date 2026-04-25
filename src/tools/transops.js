/**
 * TransformController — scale, rotate, and move-origin operations.
 *
 * Owned by SelectTool; receives the AppContext at construction.
 *
 * Per-item snapshot lifecycle and geometry math are handled by each item's
 * AbstractObject (AbstractObject.beginOp / applyX / commitOp).
 * This controller is responsible only for shared/selection-level state:
 *   • computing sx/sy/ox/oy, delta, pivot from mouse position
 *   • maintaining selectionRotation / activeRotation on ctx.state
 *   • building the undo/redo command from the per-item { pre, post } pairs
 */
import { findItem }                             from '../core/state.js';
import { unionBBoxes }                          from '../geometry/bbox.js';
import { rotatePoint }                          from '../geometry/transform.js';
import { restoreShape }                         from './snapshots.js';
import { getCompanions }                        from '../core/item-registry.js';

const SCALE_HANDLES = ['nw','n','ne','e','se','s','sw','w'];

export class TransformController {
  constructor(ctx) {
    this._ctx = ctx;
    this._mode             = null;
    this._bboxSnap         = null;
    this._scaleHandle      = null;
    this._scaleRotDisplay  = null;
    this._scalingCollection = false;
    this._rotCenter        = null;
    this._rotStart         = null;
    this._initialAngle     = 0;
    this._rotInitialCenter = null;
    this._dragStart        = null;
  }

  get mode() { return this._mode; }

  /**
   * Enter a transop based on which handle was grabbed.
   * @param {string} handlePart  e.g. 'nw', 'rotate', 'origin'
   * @param {{x,y}} dragStart    doc-space mouse-down position
   * @returns {string|null}  mode entered ('scale'|'rotate'|'moveorigin'), or null
   */
  enter(handlePart, dragStart) {
    this._dragStart = dragStart;
    if (handlePart === 'rotate' || handlePart.startsWith('rotate-')) { this._enterRotate(); return this._mode; }
    if (handlePart === 'origin')             { this._enterMoveOrigin();       return this._mode; }
    if (SCALE_HANDLES.includes(handlePart)) { this._enterScale(handlePart);  return this._mode; }
    return null;
  }

  /** Update the live drag preview. */
  update(pos, shiftKey) {
    if      (this._mode === 'scale')      this._doScale(pos, shiftKey);
    else if (this._mode === 'rotate')     this._doRotate(pos, shiftKey);
    else if (this._mode === 'moveorigin') this._doMoveOrigin(pos);
  }

  /**
   * Commit the operation and push an undo/redo entry.
   * @param {boolean} moved  true if the mouse actually traveled
   */
  commit(moved) {
    const ctx = this._ctx;
    if (this._mode === 'scale' || this._mode === 'rotate') {
      if (this._mode === 'rotate' && ctx.state.activeRotation && ctx.state.selection.size > 1) {
        ctx.state.selectionRotation = { ...ctx.state.activeRotation };
      }
      this._commitTransform();
    } else if (this._mode === 'moveorigin') {
      if (moved) this._commitMoveOrigin();
    }
  }

  /** Reset all internal state. Also clears ctx.state.operation / activeRotation. */
  reset() {
    this._mode             = null;
    this._bboxSnap         = null;
    this._scaleHandle      = null;
    this._scaleRotDisplay  = null;
    this._scalingCollection = false;
    this._rotCenter        = null;
    this._rotStart         = null;
    this._initialAngle     = 0;
    this._rotInitialCenter = null;
    this._dragStart        = null;
    if (this._ctx) {
      this._ctx.state.operation      = null;
      this._ctx.state.activeRotation = null;
    }
  }

  // ── Scale ──────────────────────────────────────────────────────────────────

  _enterScale(handle) {
    this._mode = 'scale';
    this._ctx.state.operation = `scale:${handle}`;
    this._scaleHandle = handle;
    for (const id of this._ctx.state.selection) {
      getCompanions(id)?.abstract.beginOp();
    }
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

    // Work in the shape's local (unrotated) frame when scaling a rotated selection.
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
      getCompanions(id)?.abstract.applyScale(sx, sy, ox, oy, rotDisp);
    }

    // Keep the collection overlay bbox in sync with the live scale.
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

  // ── Rotate ─────────────────────────────────────────────────────────────────

  _enterRotate() {
    this._mode = 'rotate';
    this._ctx.state.operation = 'rotate';
    for (const id of this._ctx.state.selection) {
      getCompanions(id)?.abstract.beginOp();
    }
    const ctx = this._ctx;
    const selectedShapes = [...ctx.state.selection].map(id => findItem(id)).filter(Boolean);
    const customOrigin = ctx.state.selectionOrigin ?? _uniformOriginFromShapes(selectedShapes);
    const rotDisp = _uniformRotDisplay(ctx.state.selection)
      ?? (ctx.state.selectionRotation && ctx.state.selection.size > 1 ? ctx.state.selectionRotation : null);
    if (rotDisp) {
      this._rotInitialCenter = rotDisp.center;
      this._rotCenter        = customOrigin ?? rotDisp.center;
      this._initialAngle     = rotDisp.angle;
      ctx.state.activeRotation = { bbox: rotDisp.bbox, center: rotDisp.center, angle: rotDisp.angle };
    } else {
      const bb = this._selectionBBox();
      if (bb) {
        const defaultCenter    = { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
        this._rotInitialCenter = defaultCenter;
        this._rotCenter        = customOrigin ?? defaultCenter;
        ctx.state.activeRotation = { bbox: bb, center: defaultCenter, angle: 0 };
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
      getCompanions(id)?.abstract.applyRotate(delta, this._rotCenter);
    }
  }

  // ── Move origin ────────────────────────────────────────────────────────────

  _enterMoveOrigin() {
    this._mode = 'moveorigin';
    this._ctx.state.operation = 'moveorigin';
    for (const id of this._ctx.state.selection) {
      getCompanions(id)?.abstract.beginOp();
    }
  }

  _doMoveOrigin(pos) {
    this._ctx.state.selectionOrigin = { x: pos.x, y: pos.y };
    if (this._ctx.state.selection.size === 1) {
      for (const id of this._ctx.state.selection) {
        getCompanions(id)?.abstract.applyMoveOrigin(pos);
      }
    }
  }

  _commitMoveOrigin() {
    const ctx = this._ctx;
    if (ctx.state.selection.size !== 1) return;
    const entries = [];
    for (const id of ctx.state.selection) {
      const result = getCompanions(id)?.abstract.commitOp();
      if (result) entries.push(result);
    }
    ctx.execute({
      do() {
        for (const { id, post } of entries) {
          const s = findItem(id);
          if (s) { restoreShape(s, post); ctx.state.selectionOrigin = s._origin ?? null; }
        }
        ctx.render();
      },
      undo() {
        for (const { id, pre } of entries) {
          const s = findItem(id);
          if (s) { restoreShape(s, pre); ctx.state.selectionOrigin = s._origin ?? null; }
        }
        ctx.render();
      },
    });
  }

  // ── Commit transform ───────────────────────────────────────────────────────

  _commitTransform() {
    const ctx     = this._ctx;
    const entries = [];
    for (const id of ctx.state.selection) {
      const result = getCompanions(id)?.abstract.commitOp();
      if (result) entries.push(result);
    }
    ctx.execute({
      do() {
        for (const { id, post } of entries) {
          const shape = findItem(id);
          if (shape) restoreShape(shape, post);
        }
        ctx.render();
      },
      undo() {
        for (const { id, pre } of entries) {
          const shape = findItem(id);
          if (shape) restoreShape(shape, pre);
        }
        ctx.render();
      },
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

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
}

// ── Module-level helpers ───────────────────────────────────────────────────

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
