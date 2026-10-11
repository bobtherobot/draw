const _dummyEl = new Proxy({}, {
  get(_, prop) {
    if (prop === 'tagName') return 'dummy';
    return () => _dummyEl;
  },
});

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
