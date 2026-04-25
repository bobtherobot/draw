/**
 * OverlayManager — named per-tool layers for canvas overlay drawing.
 * Tools acquire a named layer, add draw-call functions via addCall(), and
 * the renderer flushes all layers at the end of each frame.
 *
 * Backwards-compat: borrow() returns a no-op proxy so old tool code
 * doesn't crash during migration. Migrate callers to addCall() in Phase 6.
 */
import { OverlayLayer } from './OverlayLayer.js';

export class OverlayManager {
  constructor() {
    this._layers = new Map(); // id → OverlayLayer
  }

  acquireLayer(id) {
    if (!this._layers.has(id)) this._layers.set(id, new OverlayLayer());
    return this._layers.get(id);
  }

  releaseLayer(id) {
    this._layers.delete(id);
  }

  flushAll(ctx) {
    for (const layer of this._layers.values()) layer.flush(ctx);
  }
}
