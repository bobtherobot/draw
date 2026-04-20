/**
 * Text anchor squares and baseline lines rendered into #text-guides.
 * Exported so the select tool can call renderTextGuides() during drag.
 */
import { effectiveVisible } from '../core/state.js';

const NS   = 'http://www.w3.org/2000/svg';
const SQ   = 5;  // half-size of origin square (screen px — scaled by 1/zoom)

/**
 * Render or update text guide elements for all text shapes in all layers.
 *
 * @param {SVGGElement} textGuidesGroup  — #text-guides SVG group
 * @param {import('../core/state.js').state} state
 */
export function renderTextGuides(textGuidesGroup, state) {
  const { layers, viewport: { zoom } } = state;
  const szDoc = SQ / zoom; // square half-size in doc coords

  // Collect all text shapes across all layers
  const textShapes = [];
  for (const layer of layers) {
    if (!effectiveVisible(layer)) continue;
    for (const shape of layer.shapes) {
      if (shape.type === 'text-line' || shape.type === 'text-block') {
        textShapes.push(shape);
      }
    }
  }

  // Reconcile: key existing elements by data-shape-id
  const existing = new Map();
  for (const el of textGuidesGroup.children) {
    const id   = el.dataset.shapeId;
    const kind = el.dataset.kind;
    if (id) {
      const key = `${id}:${kind}`;
      existing.set(key, el);
    }
  }

  const keep = new Set();

  for (const shape of textShapes) {
    const x  = shape.attrs.x ?? 0;
    const y  = shape.attrs.y ?? 0;
    const fs = shape._fontSize ?? 14;

    // Origin square
    const sqKey = `${shape.id}:sq`;
    let sq = existing.get(sqKey);
    if (!sq) {
      sq = document.createElementNS(NS, 'rect');
      sq.dataset.shapeId = shape.id;
      sq.dataset.kind    = 'sq';
      sq.classList.add('text-guide-sq');
      textGuidesGroup.appendChild(sq);
    }
    sq.setAttribute('x',      x - szDoc);
    sq.setAttribute('y',      y - szDoc);
    sq.setAttribute('width',  szDoc * 2);
    sq.setAttribute('height', szDoc * 2);
    keep.add(sqKey);

    // Baseline line
    const lineKey = `${shape.id}:line`;
    let line = existing.get(lineKey);
    if (!line) {
      line = document.createElementNS(NS, 'line');
      line.dataset.shapeId = shape.id;
      line.dataset.kind    = 'line';
      line.classList.add('text-guide-line');
      textGuidesGroup.appendChild(line);
    }
    const baseY = y + fs;
    line.setAttribute('x1', x);
    line.setAttribute('y1', baseY);
    line.setAttribute('x2', x + Math.min(szDoc * 6, 20 / zoom));
    line.setAttribute('y2', baseY);
    keep.add(lineKey);
  }

  // Remove stale guide elements
  for (const [key, el] of existing) {
    if (!keep.has(key)) el.remove();
  }
}
