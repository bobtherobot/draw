/**
 * IO serializer.
 *
 * Native format (save/load): JSON via serializeJSON / deserializeJSON.
 * SVG format (export/import): exportSVG / importSVG.
 *
 * The .draw JSON file format uses the key "items" (preserved for backward
 * compatibility). All in-memory code uses "shapes".
 *
 * ID reconstruction on load:
 * All IDs are always regenerated via nextId() when deserializing.
 * IDs from the file are never trusted — this guarantees uniqueness when
 * multiple documents are opened in the same session.
 */
import { getDisplayObject } from '../core/registry.js';
import { rectToPathD, ellipseToPathD } from '../utils/geometry/path-utils.js';
import { nextId, sanitizeShapes } from '../core/state.js';

// ── JSON (native .draw format) ────────────────────────────────────────────────

/**
 * Serialize shapes to a JSON string.
 * @param {object[]} shapes
 * @param {object}   doc   — { width, height, name }
 * @returns {string}
 */
export function serializeJSON(shapes, doc) {
  return JSON.stringify({ version: 1, doc, items: shapes }, null, 2);
}

/**
 * Parse a .draw JSON string back into shapes + doc.
 * Regenerates all IDs to avoid session collisions.
 * Upgrades old format (doc.width/height instead of artboard shape) transparently.
 * @param {string} text
 * @returns {{ shapes: object[], doc: object } | null}
 */
export function deserializeJSON(text) {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.items) || !parsed.doc) return null;

    const idMap     = new Map();
    const newShapes = parsed.items.map(shape => {
      const prefix = (shape.type === 'group' || shape.type === 'artboard') ? 'item' : shape.type;
      const newId  = nextId(prefix);
      idMap.set(shape.id, newId);
      return { ...shape, id: newId };
    });
    for (const shape of newShapes) {
      if (shape.parentId) shape.parentId = idMap.get(shape.parentId) ?? null;
    }

    // Upgrade: old files stored dimensions on doc instead of artboard shape
    if (!newShapes.some(s => s.type === 'artboard') && parsed.doc.width && parsed.doc.height) {
      const artboardId = nextId('item');
      const artboard = {
        id: artboardId, type: 'artboard', name: 'Artboard 1',
        parentId: null, visible: true, locked: false, expanded: true,
        attrs: { x: 0, y: 0, width: parsed.doc.width, height: parsed.doc.height },
      };
      for (const shape of newShapes) {
        if (shape.parentId === null) shape.parentId = artboardId;
      }
      newShapes.unshift(artboard);
    }

    sanitizeShapes(newShapes);
    const doc = { name: parsed.doc.name ?? 'Untitled' };
    return { shapes: newShapes, doc };
  } catch (_) {
    return null;
  }
}

// ── SVG export ────────────────────────────────────────────────────────────────

/**
 * Export shapes to a clean SVG string (no metadata attributes).
 * Uses the first artboard shape for dimensions; falls back to 800×600.
 * @param {object[]} shapes
 * @param {object}   _doc  (unused — dimensions come from artboard shapes)
 * @returns {string}
 */
export function exportSVG(shapes, _doc) {
  const artboard = shapes.find(s => s.type === 'artboard');
  const { x = 0, y = 0, width = 800, height = 600 } = artboard?.attrs ?? {};
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}">\n`;
  const exportShapes = shapes.filter(s => s.type !== 'artboard');
  for (const node of _buildExportTree(exportShapes)) {
    out += _renderExportNode(node, 1);
  }
  out += `</svg>`;
  return out;
}

// ── SVG import ────────────────────────────────────────────────────────────────

/**
 * Parse a foreign SVG string into a flat shapes array.
 * Top-level <g> elements become group shapes; their children become display shapes.
 * @param {string} svgText
 * @returns {{ shapes: object[], doc: object } | null}
 */
export function importSVG(svgText) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(svgText, 'image/svg+xml');
  const svgEl  = xmlDoc.querySelector('svg');
  if (!svgEl) return null;

  const width  = parseFloat(svgEl.getAttribute('width')  ?? '800') || 800;
  const height = parseFloat(svgEl.getAttribute('height') ?? '600') || 600;
  const doc    = { name: 'Untitled' };

  const artboardId = nextId('item');
  const shapes = [{
    id:       artboardId,
    type:     'artboard',
    name:     'Artboard 1',
    parentId: null,
    visible:  true,
    locked:   false,
    expanded: true,
    attrs:    { x: 0, y: 0, width, height },
  }];
  let lid = 1;

  for (const g of svgEl.querySelectorAll(':scope > g')) {
    const groupId = nextId('item');
    shapes.push({
      id:       groupId,
      type:     'group',
      name:     g.dataset.name || `Layer ${lid++}`,
      parentId: artboardId,
      visible:  g.dataset.visible !== 'false',
      locked:   g.dataset.locked  === 'true',
      expanded: true,
    });

    for (const child of g.children) {
      const shape = _elementToShape(child);
      if (shape) {
        shape.parentId = groupId;
        shapes.push(shape);
      }
    }
  }

  // If no top-level <g> layers, create a default layer and import loose children
  if (shapes.length === 1) {
    const layerId = nextId('item');
    shapes.push({ id: layerId, type: 'group', name: 'Layer 1', parentId: artboardId, visible: true, locked: false, expanded: true });
    for (const child of svgEl.children) {
      if (child.tagName === 'g') continue;
      const shape = _elementToShape(child);
      if (shape) { shape.parentId = layerId; shapes.push(shape); }
    }
  }

  sanitizeShapes(shapes);
  return { shapes, doc };
}

// ── SVG export helpers ────────────────────────────────────────────────────────

function _buildExportTree(shapes) {
  const byId = {};
  for (const shape of shapes) byId[shape.id] = { shape, children: [] };
  const roots = [];
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];
    const node  = byId[shape.id];
    if (shape.parentId && byId[shape.parentId]) {
      byId[shape.parentId].children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function _renderExportNode(node, indent) {
  const { shape, children } = node;
  const prefix = '  '.repeat(indent);
  const do_    = getDisplayObject(shape.type);

  if (shape.type === 'group' || children.length > 0) {
    let out = `${prefix}<g>\n`;
    if (shape.type !== 'group' && do_) {
      out += `${prefix}  ${do_.toSVGString(shape, false)}\n`;
    }
    for (const child of children) {
      out += _renderExportNode(child, indent + 1);
    }
    out += `${prefix}</g>\n`;
    return out;
  }
  return do_ ? `${prefix}${do_.toSVGString(shape, false)}\n` : '';
}

// ── SVG import helpers ────────────────────────────────────────────────────────

function _elementToShape(el) {
  const tag = el.tagName.toLowerCase();

  if (tag === 'rect')    return _legacyRect(el);
  if (tag === 'ellipse') return _legacyEllipse(el);

  for (const typeId of ['text-block', 'free-text', 'path', 'group']) {
    const do_   = getDisplayObject(typeId);
    if (!do_) continue;
    const shape = do_.fromSVGElement(el);
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
