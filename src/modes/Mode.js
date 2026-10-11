/**
 * Mode base class.
 *
 * A Mode affects how shapes are rendered and can influence hit-testing.
 * The renderer queries the active mode during each render pass.
 */
export class Mode {
  /** Unique mode id. @type {string} */
  get id()    { throw new Error(`${this.constructor.name}: id not implemented`); }

  /** Display label for UI (command bar buttons). @type {string} */
  get label() { return this.id; }

  /**
   * Return the effective visual style for a shape in this mode,
   * or null to use shape.style as-is.
   * @param {object} shape
   * @param {object} state
   * @returns {{fill:string, stroke:string, strokeWidth:string} | null}
   */
  resolveStyle(shape, state) { return null; }

  /**
   * Called before the main render loop.
   * Use to inject mode-specific overlay elements.
   * @param {{docRoot:Element, overlay:Element, state:object, zoom:number}} renderCtx
   */
  beforeRender(renderCtx) {}

  /**
   * Called after the main render loop.
   * Use to render node overlays, outlines, etc.
   * @param {{docRoot:Element, overlay:Element, state:object, zoom:number}} renderCtx
   */
  afterRender(renderCtx) {}
}
