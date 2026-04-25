/**
 * AuxObject — base class for optional per-type extra rendering.
 *
 * ObjectType subclasses override createAuxObject() to return a subclass instance.
 * One AuxObject is created per display item at item-creation time and lives as
 * long as the item exists in state.items[].
 */
export class AuxObject {
  /** Called in the doc-space CanvasKit pass, after ObjectType.draw(). */
  draw(ckCanvas, item, abstract, viewState, appState) {}

  /** Called in the Canvas 2D text pass, after ObjectType.drawCanvas2D(). */
  drawCanvas2D(ctx2d, item, abstract, viewState, appState) {}
}
