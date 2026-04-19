/**
 * OverlayManager — named per-tool layers inside the SVG #overlay group.
 * Prevents tools from clobbering each other's overlay elements.
 */

const NS = 'http://www.w3.org/2000/svg';

export class OverlayManager {
  /** @param {SVGGElement} overlayGroup — the #overlay SVG group */
  constructor(overlayGroup) {
    this._root   = overlayGroup;
    this._layers = new Map(); // id → OverlayLayer
  }

  /**
   * Get (or create) a named overlay layer for a tool.
   * @param {string} id
   * @returns {OverlayLayer}
   */
  acquireLayer(id) {
    if (!this._layers.has(id)) {
      const g = document.createElementNS(NS, 'g');
      g.dataset.overlayLayer = id;
      this._root.appendChild(g);
      this._layers.set(id, new OverlayLayer(g));
    }
    return this._layers.get(id);
  }

  /**
   * Release a named layer — clears its DOM children and removes the group.
   * @param {string} id
   */
  releaseLayer(id) {
    const layer = this._layers.get(id);
    if (!layer) return;
    layer.clear();
    layer._el.remove();
    this._layers.delete(id);
  }
}

export class OverlayLayer {
  /** @param {SVGGElement} el */
  constructor(el) {
    this._el      = el;
    this._pool    = new Map(); // tagName → SVGElement[]
    this._active  = [];       // elements currently in DOM
  }

  /** Remove all children from DOM, return them to pool for reuse. */
  clear() {
    for (const el of this._active) {
      const tag = el.tagName;
      if (!this._pool.has(tag)) this._pool.set(tag, []);
      this._pool.get(tag).push(el);
      if (el.parentNode === this._el) this._el.removeChild(el);
    }
    this._active = [];
  }

  /**
   * Get a pooled (or new) element of the given SVG tag, appended to this layer.
   * @param {string} tag  e.g. 'line', 'rect', 'circle', 'path'
   * @returns {SVGElement}
   */
  borrow(tag) {
    const pool = this._pool.get(tag) ?? [];
    const el   = pool.length ? pool.pop() : document.createElementNS(NS, tag);
    this._el.appendChild(el);
    this._active.push(el);
    return el;
  }

  /**
   * Append an arbitrary element to this layer (not pooled).
   * @param {SVGElement} el
   */
  addElement(el) {
    this._el.appendChild(el);
    this._active.push(el);
  }
}
