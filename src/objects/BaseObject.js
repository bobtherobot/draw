/**
 * ObjectType base class.
 *
 * Each shape type (path, free-text, text-block, group) is a stateless singleton
 * that extends this class. Shape data stays as plain POJOs for simple undo snapshotting.
 *
 * See .claude/docs/OBJECT-TYPE.md for full contract documentation.
 */
import { nextId } from '../core/state.js';

export class ObjectType {
  /** Unique type id matching shape.type. @type {string} */
  get id()    { throw new Error(`${this.constructor.name}: id not implemented`); }

  /** Display label (layers panel). @type {string} */
  get label() { return this.id; }

  /** Layers panel icon SVG name (in objects/ category). @type {string} */
  get icon()  { return 'object-path'; }

  /**
   * Create a fresh shape POJO.
   * @param {object} initAttrs
   * @param {object} initStyle
   * @returns {object}
   */
  createShape(initAttrs, initStyle) {
    return { id: nextId(this.id), type: this.id, attrs: { ...initAttrs }, style: { ...initStyle } };
  }

  /**
   * Draw this shape onto a CanvasKit canvas. Called every render frame.
   * @param {object} ckCanvas  CanvasKit canvas
   * @param {object} shape
   * @param {{mode:string, zoom:number}} viewState
   */
  draw(ckCanvas, shape, viewState) { throw new Error(`${this.constructor.name}: draw not implemented`); }

  /**
   * Return the axis-aligned bounding box in document coords.
   * @param {object} shape
   * @returns {{x:number, y:number, width:number, height:number} | null}
   */
  getBBox(shape) { return null; }

  /**
   * Hit-test a document-space point against this shape's parts.
   * @param {object} shape
   * @param {number} docX
   * @param {number} docY
   * @param {number} zoom
   * @returns {{part: string, detail?: *} | null}
   */
  hitPart(shape, docX, docY, zoom) { return null; }

  /**
   * List of interactive parts for overlay rendering.
   * @param {object} shape
   * @returns {Array<{id:string, cursor?:string, isVisible?:Function}>}
   */
  parts(shape) { return [{ id: 'body', cursor: 'move' }]; }

  // ── Geometry mutations (all mutate shape in-place) ──────────────────────────

  /** @param {object} shape @param {number} dx @param {number} dy */
  translate(shape, dx, dy) { throw new Error(`${this.constructor.name}: translate not implemented`); }

  /** @param {object} shape @param {number} sx @param {number} sy @param {number} ox @param {number} oy */
  scale(shape, sx, sy, ox, oy) { throw new Error(`${this.constructor.name}: scale not implemented`); }

  /** @param {object} shape @param {number} angleDeg @param {number} cx @param {number} cy */
  bakeRotation(shape, angleDeg, cx, cy) { throw new Error(`${this.constructor.name}: bakeRotation not implemented`); }

  // ── Serialization ───────────────────────────────────────────────────────────

  /**
   * Serialize shape to an SVG string for save/export.
   * @param {object}  shape
   * @param {boolean} includeMetadata
   * @returns {string}
   */
  toSVGString(shape, includeMetadata) { return ''; }

  /**
   * Deserialize a DOM element from a parsed SVG file into a shape POJO.
   * Return null if this element is not handled by this type.
   * IDs are always freshly generated — never read from the element.
   * @param {Element} el
   * @returns {object|null}
   */
  fromSVGElement(el) { return null; }

  // ── Wireframe ───────────────────────────────────────────────────────────────

  /**
   * Return anchor/node points for wireframe overlay.
   * @param {object} shape
   * @returns {{x:number, y:number}[]}
   */
  getWireframePoints(shape) { return []; }

  // ── Companion object factory ─────────────────────────────────────────────────

  /**
   * Create an optional AuxObject for per-type extra rendering.
   * Called once when the item is added to state.items[].
   * Return null (default) if this type needs no auxiliary rendering.
   * @param {object} item
   * @returns {import('./aux-object.js').AuxObject | null}
   */
  createAuxObject(item) { return null; }
}
