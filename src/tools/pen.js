/**
 * Bezier pen tool.
 *
 * Anchor format: { x, y, hIn: {x,y}|null, hOut: {x,y}|null }
 *   click              → corner anchor
 *   mousedown+drag     → smooth anchor (drag direction sets hOut, mirrors hIn)
 *   click on first (≥2 pts) → close path
 *   click+drag on first    → close and set closing curve
 *   Enter / dblclick   → finish open path
 *   Escape             → cancel
 */
import { Tool } from './base.js';
import { buildPenPathD } from '../geometry/pen-path.js';

const CLOSE_RADIUS = 8; // screen px

export class PenTool extends Tool {
  get id()       { return 'pen'; }
  get label()    { return 'Pen'; }
  get shortcut() { return 'p'; }
  get icon()     { return 'pen'; }

  init(ctx) {
    super.init(ctx);
    this._layer = null;
  }

  activate() {
    this._active    = false;
    this._anchors   = [];
    this._mouseDown = false;
    this._closing   = false;
    this._cursor    = null;
    this._ensureLayer();
    this._redraw();
  }

  deactivate() {
    this._cancel();
    if (this._layer) {
      this._ctx?.overlay.releaseLayer('pen');
      this._layer = null;
    }
  }

  onMouseDown(e) {
    if (e.button !== 0) return;
    this._mouseDown = true;
    const pos = this._ctx.screenToDoc(e.clientX, e.clientY);

    if (!this._active) {
      this._active  = true;
      this._anchors = [{ x: pos.x, y: pos.y, hIn: null, hOut: null }];
    } else if (this._anchors.length >= 2 && this._nearFirst(e.clientX, e.clientY)) {
      this._closing = true;
    } else {
      this._anchors.push({ x: pos.x, y: pos.y, hIn: null, hOut: null });
    }
    this._redraw();
  }

  onMouseMove(e) {
    this._cursor = this._ctx.screenToDoc(e.clientX, e.clientY);

    if (this._mouseDown) {
      const z = this._ctx.state.viewport.zoom;
      if (this._closing) {
        const a0 = this._anchors[0];
        const dx = this._cursor.x - a0.x;
        const dy = this._cursor.y - a0.y;
        if (Math.hypot(dx, dy) > 2 / z) {
          a0.hOut = { x: a0.x + dx, y: a0.y + dy };
          a0.hIn  = { x: a0.x - dx, y: a0.y - dy };
        }
      } else if (this._anchors.length > 0) {
        const last = this._anchors[this._anchors.length - 1];
        const dx = this._cursor.x - last.x;
        const dy = this._cursor.y - last.y;
        if (Math.hypot(dx, dy) > 2 / z) {
          last.hOut = { x: last.x + dx, y: last.y + dy };
          last.hIn  = { x: last.x - dx, y: last.y - dy };
        }
      }
    }
    this._redraw();
  }

  onMouseUp(e) {
    if (this._closing) {
      this._closing   = false;
      this._mouseDown = false;
      this._finalize(true);
      return;
    }
    this._mouseDown = false;
  }

  onDblClick(_e) {
    if (!this._active) return;
    if (this._anchors.length > 1) this._anchors.pop(); // second click added an anchor
    this._finalize(false);
  }

  onKeyDown(e) {
    if (!this._active) return;
    if (e.key === 'Enter')  { e.preventDefault(); this._finalize(false); }
    if (e.key === 'Escape') this._cancel();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _ensureLayer() {
    if (!this._layer) {
      this._layer = this._ctx.overlay.acquireLayer('pen');
    }
  }

  _redraw() {
    this._ensureLayer();
    const layer = this._layer;
    layer.clear();

    if (!this._active && this._anchors.length === 0) return;

    const z  = this._ctx.state.viewport.zoom;
    const sw = 1 / z;
    const hs = 4 / z;
    const hr = 3 / z;

    // Preview path (committed segments + rubber-band to cursor)
    let d = buildPenPathD(this._anchors, false);
    if (this._active && this._anchors.length > 0) {
      if (this._closing) {
        d += this._closingPreview();
      } else if (this._cursor) {
        d += this._rubberBand(this._anchors[this._anchors.length - 1], this._cursor);
      }
    }
    const preview = layer.borrow('path');
    preview.setAttribute('d',            d || 'M0 0');
    preview.setAttribute('fill',         'none');
    preview.setAttribute('stroke',       'var(--theme-accent, #4a9eff)');
    preview.setAttribute('stroke-width', sw);
    preview.setAttribute('vector-effect','non-scaling-stroke');
    preview.style.pointerEvents = 'none';

    // Handles and anchors
    for (let i = 0; i < this._anchors.length; i++) {
      const a      = this._anchors[i];
      const isLast = i === this._anchors.length - 1;

      for (const h of [a.hIn, a.hOut]) {
        if (!h) continue;
        const line = layer.borrow('line');
        line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
        line.setAttribute('x2', h.x); line.setAttribute('y2', h.y);
        line.setAttribute('class', 'pen-handle-line');
        line.setAttribute('stroke-width', sw);
        const dot = layer.borrow('circle');
        dot.setAttribute('cx', h.x); dot.setAttribute('cy', h.y);
        dot.setAttribute('r', hr);
        dot.setAttribute('class', 'pen-handle-dot');
        dot.setAttribute('stroke-width', sw);
      }

      const anchor = layer.borrow('rect');
      anchor.setAttribute('x',      a.x - hs);
      anchor.setAttribute('y',      a.y - hs);
      anchor.setAttribute('width',  hs * 2);
      anchor.setAttribute('height', hs * 2);
      anchor.setAttribute('class',  'pen-anchor');
      anchor.setAttribute('stroke-width', sw);
      if (i === 0 && this._closing) anchor.setAttribute('fill', 'var(--theme-accent, #4a9eff)');
    }
  }

  _rubberBand(prev, cursor) {
    const h1 = prev.hOut || prev;
    const r  = (n) => Math.round(n * 100) / 100;
    return ` C ${r(h1.x)} ${r(h1.y)} ${r(cursor.x)} ${r(cursor.y)} ${r(cursor.x)} ${r(cursor.y)}`;
  }

  _closingPreview() {
    if (this._anchors.length < 2) return '';
    const last = this._anchors[this._anchors.length - 1];
    const a0   = this._anchors[0];
    const h1 = last.hOut;
    const h2 = a0.hIn;
    const r  = (n) => Math.round(n * 100) / 100;
    if (!h1 && !h2) return ` L ${r(a0.x)} ${r(a0.y)}`;
    return ` C ${r((h1 || last).x)} ${r((h1 || last).y)} ${r((h2 || a0).x)} ${r((h2 || a0).y)} ${r(a0.x)} ${r(a0.y)}`;
  }

  _finalize(closePath) {
    if (this._anchors.length < 2) { this._cancel(); return; }

    const d     = buildPenPathD(this._anchors, closePath);
    const ctx   = this._ctx;
    const ot    = ctx.getObjectType('path');
    const shape = ot.createShape({ d }, { ...ctx.state.currentStyle });
    const layer = ctx.state.layers.find(l => l.id === ctx.state.activeLayerId) ?? ctx.state.layers[0];

    ctx.execute({
      do()   { layer.shapes.push(shape); ctx.state.selection = new Set([shape.id]); ctx.render(); },
      undo() { layer.shapes = layer.shapes.filter(s => s.id !== shape.id); ctx.state.selection.clear(); ctx.render(); },
    });

    this._active    = false;
    this._anchors   = [];
    this._closing   = false;
    this._mouseDown = false;
    this._redraw();
  }

  _cancel() {
    this._active    = false;
    this._anchors   = [];
    this._closing   = false;
    this._mouseDown = false;
    this._redraw();
  }

  _nearFirst(screenX, screenY) {
    if (this._anchors.length === 0) return false;
    const a0   = this._anchors[0];
    const { x: vx, y: vy, zoom } = this._ctx.state.viewport;
    const rect = document.getElementById('canvas').getBoundingClientRect();
    const sx   = (a0.x - vx) * zoom + rect.left;
    const sy   = (a0.y - vy) * zoom + rect.top;
    return Math.hypot(screenX - sx, screenY - sy) < CLOSE_RADIUS;
  }
}
