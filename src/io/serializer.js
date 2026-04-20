/**
 * SVG serializer — delegates to ObjectType.toSVGString / fromSVGElement.
 * Handles legacy rect/ellipse elements on load by converting to path.
 *
 * NOTE — ID reconstruction on load:
 * All IDs (layer and shape) are always regenerated via nextId() when deserializing.
 * IDs from the file are never trusted. This guarantees uniqueness when multiple
 * documents are opened in the same session, and avoids stale cross-references.
 * When save/load is fully implemented, layer.name and shape.name carry the human
 * labels; IDs are purely session-local handles.
 */
import { getObjectType } from '../core/registry.js';
import { rectToPathD, ellipseToPathD } from '../geometry/path-utils.js';
import { nextId } from '../core/state.js';

/**
 * Serialize all layers to an SVG string.
 *
 * @param {object[]}  layers
 * @param {object}    doc          — { width, height, name }
 * @param {boolean}   metadata     — include data-id attributes for round-trip fidelity
 * @returns {string}
 */
export function serializeSVG(layers, doc, metadata) {
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">\n`;

  for (const layer of layers) {
    const layerAttrs = metadata
      ? ` id="layer-${layer.id}" data-name="${_esc(layer.name)}" data-visible="${layer.visible}" data-locked="${layer.locked}"`
      : ` id="layer-${layer.id}"`;
    out += `  <g${layerAttrs}>\n`;

    for (const shape of layer.shapes) {
      const ot = getObjectType(shape.type);
      if (ot) {
        out += `    ${ot.toSVGString(shape, metadata)}\n`;
      }
    }
    out += `  </g>\n`;
  }

  out += `</svg>`;
  return out;
}

/**
 * Parse an SVG string into layers + shapes using registered ObjectTypes.
 *
 * @param {string} svgText
 * @returns {{ layers: object[], doc: {width:number, height:number, name:string} } | null}
 */
export function deserializeSVG(svgText) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(svgText, 'image/svg+xml');
  const svgEl  = xmlDoc.querySelector('svg');
  if (!svgEl) return null;

  const width  = parseFloat(svgEl.getAttribute('width')  ?? '800') || 800;
  const height = parseFloat(svgEl.getAttribute('height') ?? '600') || 600;
  const doc    = { width, height, name: 'Untitled' };

  const layers = [];
  let   lid    = 1;

  for (const g of svgEl.querySelectorAll(':scope > g')) {
    const layer = {
      id:       nextId('layer'),
      name:     g.dataset.name || `Layer ${lid++}`,
      visible:  g.dataset.visible !== 'false',
      locked:   g.dataset.locked  === 'true',
      expanded: true,
      shapes:   [],
    };

    for (const child of g.children) {
      const shape = _elementToShape(child);
      if (shape) layer.shapes.push(shape);
    }
    layers.push(layer);
  }

  return layers.length ? { layers, doc } : null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _elementToShape(el) {
  const tag = el.tagName.toLowerCase();

  // Convert legacy rect/ellipse to path before dispatching to ObjectTypes
  if (tag === 'rect') {
    return _legacyRect(el);
  }
  if (tag === 'ellipse') {
    return _legacyEllipse(el);
  }

  // Try each registered ObjectType that handles this element
  // text-block must be tried before text-line (it checks data-type attr)
  for (const typeId of ['text-block', 'text-line', 'path', 'group']) {
    const ot    = getObjectType(typeId);
    if (!ot) continue;
    const shape = ot.fromSVGElement(el);
    if (shape) return shape;
  }
  return null;
}

function _legacyRect(el) {
  const x = parseFloat(el.getAttribute('x')      ?? '0');
  const y = parseFloat(el.getAttribute('y')      ?? '0');
  const w = parseFloat(el.getAttribute('width')  ?? '0');
  const h = parseFloat(el.getAttribute('height') ?? '0');
  return {
    id:    nextId('path'),
    type:  'path',
    attrs: { d: rectToPathD({ x, y, width: w, height: h }) },
    style: _parseStyle(el),
  };
}

function _legacyEllipse(el) {
  const cx = parseFloat(el.getAttribute('cx') ?? '0');
  const cy = parseFloat(el.getAttribute('cy') ?? '0');
  const rx = parseFloat(el.getAttribute('rx') ?? '0');
  const ry = parseFloat(el.getAttribute('ry') ?? '0');
  return {
    id:    nextId('path'),
    type:  'path',
    attrs: { d: ellipseToPathD({ cx, cy, rx, ry }) },
    style: _parseStyle(el),
  };
}

function _parseStyle(el) {
  return {
    fill:        el.getAttribute('fill')         ?? 'none',
    stroke:      el.getAttribute('stroke')       ?? 'none',
    strokeWidth: Number(el.getAttribute('stroke-width') ?? 1),
  };
}

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
