/**
 * Container — universal per-item controller and single render entry point.
 *
 * Every item on stage (Path, FreeText, Group, Artboard, etc.) gets one Container
 * instance in the ShapeRegistry. Concrete types extend this class and implement
 * _createDisplayObject() to declare their renderer.
 *
 * Tree structure:
 *   _parent    — direct pointer to parent Container, null for root items
 *   _children  — direct pointers to child Containers, always an array
 * These are runtime-only; the serialisable source of truth is shape.parentId.
 * ShapeRegistry.syncControllers() rebuilds the pointers each render cycle.
 *
 * Snapshot lifecycle (transform operations):
 *   beginOp()   — snapshot self + all descendants
 *   applyX(...) — restore from snapshot + apply per-item math (called every frame)
 *   commitOp()  — return [{id, pre, post}] for self + all descendants
 */
import { Overlay }                from './Overlay.js';
import { cloneShape, restoreShape } from '../utils/snapshots.js';
import { rotatePoint } from '../utils/geometry/transform.js';

export class Container {
  constructor(shape) {
    this._shape         = shape;
    this._parent        = null;
    this._children      = [];
    this._displayObject = this._createDisplayObject();
    this._overlay       = new Overlay(shape.id);
    this._aux           = this._createAux(shape) ?? null;
    this._prev          = null;  // snapshot captured by beginOp()
  }

  // ── Subclass extension points ─────────────────────────────────────────────

  /** Return the DisplayObject singleton for this type. Must be implemented. */
  _createDisplayObject() {
    throw new Error(`${this.constructor.name}: _createDisplayObject not implemented`);
  }

  /** Return an Aux instance for this item, or null if none needed. */
  _createAux(_shape) { return null; }

  // ── Type metadata (implemented by each concrete subclass) ────────────────

  get typeId() { throw new Error(`${this.constructor.name}: typeId not implemented`); }
  get label()  { throw new Error(`${this.constructor.name}: label not implemented`); }
  get icon()   { throw new Error(`${this.constructor.name}: icon not implemented`); }

  // ── Accessors ─────────────────────────────────────────────────────────────

  get shape()         { return this._shape; }
  get shapeId()       { return this._shape.id; }
  get displayObject() { return this._displayObject; }
  get overlay()       { return this._overlay; }
  get aux()           { return this._aux; }
  get parent()        { return this._parent; }
  get children()      { return this._children; }

  // ── Item identity and state ───────────────────────────────────────────────

  get name()    { return this._shape.name    ?? this.label; }
  get visible() { return this._shape.visible ?? true; }
  get locked()  { return this._shape.locked  ?? false; }

  // ── Geometry ──────────────────────────────────────────────────────────────

  get x()        { return this._shape.attrs?.x ?? 0; }
  get y()        { return this._shape.attrs?.y ?? 0; }
  get rotation() { return this._shape._rotation ?? (this._shape._rotDisplay?.angle ?? 0); }
  get origin()   { return this._shape._origin ?? null; }
  get scaleX()   { return this._shape._scaleX ?? 1; }
  get scaleY()   { return this._shape._scaleY ?? 1; }
  get width()    { const bb = this._displayObject?.getBBox?.(this._shape); return bb?.width  ?? 0; }
  get height()   { const bb = this._displayObject?.getBBox?.(this._shape); return bb?.height ?? 0; }

  // ── Style ─────────────────────────────────────────────────────────────────

  get fill()        { return this._shape.style?.fill        ?? null; }
  get stroke()      { return this._shape.style?.stroke      ?? null; }
  get strokeWidth() { return this._shape.style?.strokeWidth ?? 1; }

  // ── Render coordination ───────────────────────────────────────────────────

  render(ckCanvas, viewState, state, modeStyle = null) {
    const shape = modeStyle
      ? { ...this._shape, style: { ...this._shape.style, ...modeStyle } }
      : this._shape;
    this._displayObject.draw(ckCanvas, shape, viewState);
    if (this._aux) this._aux.draw(ckCanvas, shape, this, viewState, state);
  }

  renderCanvas2D(ctx, state) {
    this._displayObject.drawCanvas2D?.(ctx, this._shape);
    if (this._aux) {
      this._aux.drawCanvas2D?.(ctx, this._shape, this, { zoom: state.viewport.zoom }, state);
    }
  }

  renderOverlay(ckCanvas, CK, viewport, dpr, selectionOrigin) {
    this._overlay.draw(ckCanvas, CK, this, viewport, dpr, selectionOrigin);
  }

  // ── Invalidation ──────────────────────────────────────────────────────────

  invalidate() {}

  // ── Snapshot lifecycle ────────────────────────────────────────────────────

  /** Capture state for self and all descendants so applyX() can restore-then-transform. */
  beginOp() {
    this._prev = cloneShape(this._shape);
    for (const child of this._children) child.beginOp();
  }

  /**
   * Restore to beginOp() snapshot, apply a move, propagate to children.
   * @param {number} dx
   * @param {number} dy
   */
  applyMove(dx, dy) {
    if (!this._prev) return;
    restoreShape(this._shape, this._prev);
    this._displayObject?.translate(this._shape, dx, dy);
    if (this._prev._origin) {
      this._shape._origin = {
        x: this._prev._origin.x + dx,
        y: this._prev._origin.y + dy,
      };
    }
    for (const child of this._children) child.applyMove(dx, dy);
  }

  /**
   * Restore + scale, propagate to children.
   * Subclasses may override to suppress child propagation (e.g. Artboard).
   * @param {number} sx
   * @param {number} sy
   * @param {number} ox  origin x
   * @param {number} oy  origin y
   * @param {{bbox, center, angle}|null} rotDisp
   */
  applyScale(sx, sy, ox, oy, rotDisp) {
    if (!this._prev) return;
    restoreShape(this._shape, this._prev);
    const shape = this._shape;

    if (rotDisp && this._displayObject?.applyScaleRotated(shape, sx, sy, ox, oy, rotDisp)) {
      // handled by the renderer (path, group, etc.)
    } else {
      this._displayObject?.scale(shape, sx, sy, ox, oy);
      this._displayObject?.syncRotDisplay?.(shape);
    }

    const snapOrigin = this._prev._origin;
    if (snapOrigin) {
      shape._origin = rotDisp
        ? { x: snapOrigin.x, y: snapOrigin.y }
        : { x: ox + (snapOrigin.x - ox) * sx, y: oy + (snapOrigin.y - oy) * sy };
    }

    for (const child of this._children) child.applyScale(sx, sy, ox, oy, rotDisp);
  }

  /**
   * Restore + rotate around a shared pivot, propagate to children.
   * @param {number} delta     rotation delta in degrees
   * @param {{x,y}} rotCenter  shared pivot point
   */
  applyRotate(delta, rotCenter) {
    if (!this._prev) return;
    restoreShape(this._shape, this._prev);
    this._displayObject?.bakeRotation(this._shape, delta, rotCenter.x, rotCenter.y);
    if (this._prev._origin) {
      const { x, y } = rotatePoint(
        this._prev._origin.x, this._prev._origin.y,
        rotCenter.x, rotCenter.y,
        delta,
      );
      this._shape._origin = { x, y };
    }
    for (const child of this._children) child.applyRotate(delta, rotCenter);
  }

  /**
   * Set the transform origin for this item.
   * @param {{x,y}} pos  doc-space position
   */
  applyMoveOrigin(pos) {
    this._shape._origin = { x: pos.x, y: pos.y };
  }

  /**
   * Finalise the operation and return snapshot pairs for self and all descendants.
   * Returns an empty array if beginOp() was not called.
   * @returns {{id:string, pre:object, post:object}[]}
   */
  commitOp() {
    if (!this._prev) return [];
    const pre  = this._prev;
    const post = cloneShape(this._shape);
    this._prev = null;
    const entries = [{ id: this._shape.id, pre, post }];
    for (const child of this._children) entries.push(...child.commitOp());
    return entries;
  }
}
