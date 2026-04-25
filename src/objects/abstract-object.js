/**
 * AbstractObject — pure-math companion for a display item. Never rendered.
 *
 * Holds a live reference to the item POJO in state.items[]. Item POJOs are
 * always mutated in-place (never replaced), so this reference stays valid
 * across undo/redo operations.
 *
 * Snapshot lifecycle
 *   beginOp()   — snapshot current item state
 *   applyX(...) — restore from snapshot + apply per-item math (called every frame during drag)
 *   commitOp()  — return { id, pre, post } POJO pair ready for ctx.execute()
 *
 * TransformController (transops.js) and SelectTool (select.js) call these
 * methods instead of doing their own snapshot/restore/math loops.
 */
import { cloneShape, restoreShape } from '../tools/snapshots.js';
import { rotatePathD, scalePathD, rotatePoint } from '../geometry/transform.js';

export class AbstractObject {
  constructor(item, objectType) {
    this._item = item;
    this._ot   = objectType;
    this._prev = null;  // snapshot captured by beginOp()
  }

  get item()       { return this._item; }
  get itemId()     { return this._item.id; }
  get objectType() { return this._ot; }

  // ── Derived state ────────────────────────────────────────────────────────────

  get x()        { return this._item.attrs?.x ?? 0; }
  get y()        { return this._item.attrs?.y ?? 0; }
  get rotation() { return this._item._rotation ?? (this._item._rotDisplay?.angle ?? 0); }
  get origin()   { return this._item._origin ?? null; }
  get scaleX()   { return this._item._scaleX ?? 1; }
  get scaleY()   { return this._item._scaleY ?? 1; }
  get width()    { const bb = this._ot?.getBBox?.(this._item); return bb?.width  ?? 0; }
  get height()   { const bb = this._ot?.getBBox?.(this._item); return bb?.height ?? 0; }

  // ── Invalidation ─────────────────────────────────────────────────────────────

  /** Call after externally mutating the item POJO (e.g. after undo/redo restore). */
  invalidate() {}

  // ── Snapshot lifecycle ────────────────────────────────────────────────────────

  /** Capture the current item state so applyX() can restore-then-transform each frame. */
  beginOp() {
    this._prev = cloneShape(this._item);
  }

  /**
   * Restore item to the beginOp() snapshot, apply a move, update _origin.
   * @param {number} dx
   * @param {number} dy
   */
  applyMove(dx, dy) {
    if (!this._prev) return;
    restoreShape(this._item, this._prev);
    this._ot?.translate(this._item, dx, dy);
    if (this._prev._origin) {
      this._item._origin = {
        x: this._prev._origin.x + dx,
        y: this._prev._origin.y + dy,
      };
    }
  }

  /**
   * Restore + scale the item in local frame if rotated, update _rotDisplay and _origin.
   * sx/sy/ox/oy are computed by TransformController from the shared selection bbox.
   * rotDisp is the shared rotation display (per-shape _rotDisplay or selectionRotation).
   * @param {number} sx
   * @param {number} sy
   * @param {number} ox  origin x
   * @param {number} oy  origin y
   * @param {{bbox, center, angle}|null} rotDisp
   */
  applyScale(sx, sy, ox, oy, rotDisp) {
    if (!this._prev) return;
    restoreShape(this._item, this._prev);
    const shape = this._item;

    if (rotDisp && shape.attrs?.d != null) {
      // Path shape in rotated frame: unrotate → scale → re-rotate
      const { center: { x: cx, y: cy }, angle } = rotDisp;
      let d = shape.attrs.d;
      d = rotatePathD(d, -angle, cx, cy);
      d = scalePathD(d, sx, sy, ox, oy);
      d = rotatePathD(d, angle, cx, cy);
      shape.attrs.d = d;

      // Update _rotDisplay: scale the per-shape pre-rotation bbox, then re-place center
      const shapeBB = this._prev._rotDisplay?.bbox;
      const snapCtr = this._prev._rotDisplay?.center ?? { x: cx, y: cy };
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
      // Unrotated or non-path shape: delegate to ObjectType
      this._ot?.scale(shape, sx, sy, ox, oy);
      this._ot?.syncRotDisplay?.(shape);
    }

    // Keep _origin fixed in stage coords when scaling a rotated shape.
    // For unrotated shapes, scale the origin point with the geometry.
    const snapOrigin = this._prev._origin;
    if (snapOrigin) {
      shape._origin = rotDisp
        ? { x: snapOrigin.x, y: snapOrigin.y }
        : { x: ox + (snapOrigin.x - ox) * sx, y: oy + (snapOrigin.y - oy) * sy };
    }
  }

  /**
   * Restore + rotate the item around a shared pivot, update _origin.
   * @param {number} delta     rotation delta in degrees
   * @param {{x,y}} rotCenter  shared pivot point
   */
  applyRotate(delta, rotCenter) {
    if (!this._prev) return;
    restoreShape(this._item, this._prev);
    this._ot?.bakeRotation(this._item, delta, rotCenter.x, rotCenter.y);
    if (this._prev._origin) {
      const { x, y } = rotatePoint(
        this._prev._origin.x, this._prev._origin.y,
        rotCenter.x, rotCenter.y,
        delta,
      );
      this._item._origin = { x, y };
    }
  }

  /**
   * Set the transform origin for this item (called from move-origin drag).
   * @param {{x,y}} pos  doc-space position
   */
  applyMoveOrigin(pos) {
    this._item._origin = { x: pos.x, y: pos.y };
  }

  /**
   * Finalise the operation and return a { id, pre, post } snapshot pair.
   * Pass `pre` and `post` to ctx.execute() for undo/redo.
   * Returns null if beginOp() was not called.
   * @returns {{id:string, pre:object, post:object}|null}
   */
  commitOp() {
    if (!this._prev) return null;
    const pre  = this._prev;
    const post = cloneShape(this._item);
    this._prev = null;
    return { id: this._item.id, pre, post };
  }
}
