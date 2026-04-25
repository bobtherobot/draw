/**
 * Aux — base class for optional per-type extra rendering.
 *
 * BaseObject subclasses override createAuxObject() to return a subclass instance.
 * One Aux is created per display item at item-creation time and lives as
 * long as the item exists in state.items[].
 */
export class Aux {
  /** Called in the doc-space CanvasKit pass, after BaseObject.draw(). */
  draw(ckCanvas, item, abstract, viewState, appState) {}

  /** Called in the Canvas 2D text pass, after BaseObject.drawCanvas2D(). */
  drawCanvas2D(ctx2d, item, abstract, viewState, appState) {}
}
