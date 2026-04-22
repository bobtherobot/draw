/**
 * OverlayManager — named per-tool layers for canvas overlay drawing.
 * Tools acquire a named layer, add draw-call functions via addCall(), and
 * the renderer flushes all layers at the end of each frame.
 *
 * Backwards-compat: borrow() returns a no-op proxy so old tool code
 * doesn't crash during migration. Migrate callers to addCall() in Phase 6.
 */

const _dummyEl = new Proxy({}, {
  get(_, prop) {
    if (prop === 'tagName') return 'dummy';
    return () => _dummyEl;
  },
});

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

export class OverlayLayer {
  constructor() {
    this._calls = [];
  }

  clear() {
    this._calls = [];
  }

  /** Backwards-compat shim — returns a dummy that absorbs setAttribute calls. */
  borrow(_tag) {
    return _dummyEl;
  }

  /** Add a canvas draw call: fn receives the 2d context. */
  addCall(fn) {
    this._calls.push(fn);
  }

  flush(ctx) {
    for (const fn of this._calls) fn(ctx);
  }
}
