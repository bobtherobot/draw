/**
 * Aux — base class for optional per-type extra rendering.
 *
 * Container subclasses override createAuxObject() to return a subclass instance.
 * One Aux is created per display item at item-creation time and lives as
 * long as the item exists in state.shapes[].
 */
export class Aux {
  /** Called in the doc-space CanvasKit pass, after Container.draw(). */
  draw(ckCanvas, shape, abstract, viewState, appState) {}

  /** Called in the Canvas 2D text pass, after Container.drawCanvas2D(). */
  drawCanvas2D(ctx2d, shape, abstract, viewState, appState) {}
}
