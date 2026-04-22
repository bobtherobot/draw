/**
 * IO serializer.
 *
 * Native format (save/load): JSON via serializeJSON / deserializeJSON.
 * SVG format (export/import): exportSVG / importSVG.
 *
 * ID reconstruction on load:
 * All IDs are always regenerated via nextId() when deserializing.
 * IDs from the file are never trusted — this guarantees uniqueness when
 * multiple documents are opened in the same session.
 */
import { getObjectType } from '../core/registry.js';
import { rectToPathD, ellipseToPathD } from '../geometry/path-utils.js';
import { nextId, sanitizeItems } from '../core/state.js';

// ── JSON (native .draw format) ────────────────────────────────────────────────

/**
 * Serialize items to a JSON string.
 * @param {object[]} items
 * @param {object}   doc   — { width, height, name }
 * @returns {string}
 */
export function serializeJSON(items, doc) {
  return JSON.stringify({ version: 1, doc, items }, null, 2);
}

/**
 * Parse a .draw JSON string back into items + doc.
 * Regenerates all IDs to avoid session collisions.
 * Upgrades old format (doc.width/height instead of artboard item) transparently.
 * @param {string} text
 * @returns {{ items: object[], doc: object } | null}
 */
export function deserializeJSON(text) {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.items) || !parsed.doc) return null;

    const idMap    = new Map();
    const newItems = parsed.items.map(item => {
      const prefix = (item.type === 'group' || item.type === 'artboard') ? 'item' : item.type;
      const newId  = nextId(prefix);
      idMap.set(item.id, newId);
      return { ...item, id: newId };
    });
    for (const item of newItems) {
      if (item.parentId) item.parentId = idMap.get(item.parentId) ?? null;
    }

    // Upgrade: old files stored dimensions on doc instead of artboard item
    if (!newItems.some(i => i.type === 'artboard') && parsed.doc.width && parsed.doc.height) {
      const artboardId = nextId('item');
      const artboard = {
        id: artboardId, type: 'artboard', name: 'Artboard 1',
        parentId: null, visible: true, locked: false, expanded: true,
        attrs: { x: 0, y: 0, width: parsed.doc.width, height: parsed.doc.height },
      };
      for (const item of newItems) {
        if (item.parentId === null) item.parentId = artboardId;
      }
      newItems.unshift(artboard);
    }

    sanitizeItems(newItems);
    const doc = { name: parsed.doc.name ?? 'Untitled' };
    return { items: newItems, doc };
  } catch (_) {
    return null;
  }
}

// ── SVG export ────────────────────────────────────────────────────────────────

/**
 * Export items to a clean SVG string (no metadata attributes).
 * Uses the first artboard item for dimensions; falls back to 800×600.
 * @param {object[]} items
 * @param {object}   _doc  (unused — dimensions come from artboard items)
 * @returns {string}
 */
export function exportSVG(items, _doc) {
  const artboard = items.find(i => i.type === 'artboard');
  const { x = 0, y = 0, width = 800, height = 600 } = artboard?.attrs ?? {};
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}">\n`;
  // Export only children of artboards (skip artboard container items themselves)
  const exportItems = items.filter(i => i.type !== 'artboard');
  for (const node of _buildExportTree(exportItems)) {
    out += _renderExportNode(node, 1);
  }
  out += `</svg>`;
  return out;
}

// ── SVG import ────────────────────────────────────────────────────────────────

/**
 * Parse a foreign SVG string into a flat items array.
 * Top-level <g> elements become group items; their children become display items.
 * @param {string} svgText
 * @returns {{ items: object[], doc: object } | null}
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
  const items = [{
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
    items.push({
      id:       groupId,
      type:     'group',
      name:     g.dataset.name || `Layer ${lid++}`,
      parentId: artboardId,
      visible:  g.dataset.visible !== 'false',
      locked:   g.dataset.locked  === 'true',
      expanded: true,
    });

    for (const child of g.children) {
      const shape = _elementToItem(child);
      if (shape) {
        shape.parentId = groupId;
        items.push(shape);
      }
    }
  }

  // If no top-level <g> layers, create a default layer and import loose children
  if (items.length === 1) {
    const layerId = nextId('item');
    items.push({ id: layerId, type: 'group', name: 'Layer 1', parentId: artboardId, visible: true, locked: false, expanded: true });
    for (const child of svgEl.children) {
      if (child.tagName === 'g') continue;
      const shape = _elementToItem(child);
      if (shape) { shape.parentId = layerId; items.push(shape); }
    }
  }

  sanitizeItems(items);
  return { items, doc };
}

// ── SVG export helpers ────────────────────────────────────────────────────────

function _buildExportTree(items) {
  const byId = {};
  for (const item of items) byId[item.id] = { item, children: [] };
  const roots = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    const node = byId[item.id];
    if (item.parentId && byId[item.parentId]) {
      byId[item.parentId].children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function _renderExportNode(node, indent) {
  const { item, children } = node;
  const prefix = '  '.repeat(indent);
  const ot     = getObjectType(item.type);

  if (item.type === 'group' || children.length > 0) {
    let out = `${prefix}<g>\n`;
    if (item.type !== 'group' && ot) {
      out += `${prefix}  ${ot.toSVGString(item, false)}\n`;
    }
    for (const child of children) {
      out += _renderExportNode(child, indent + 1);
    }
    out += `${prefix}</g>\n`;
    return out;
  }
  return ot ? `${prefix}${ot.toSVGString(item, false)}\n` : '';
}

// ── SVG import helpers ────────────────────────────────────────────────────────

function _elementToItem(el) {
  const tag = el.tagName.toLowerCase();

  if (tag === 'rect')    return _legacyRect(el);
  if (tag === 'ellipse') return _legacyEllipse(el);

  for (const typeId of ['text-block', 'free-text', 'path', 'group']) {
    const ot   = getObjectType(typeId);
    if (!ot) continue;
    const item = ot.fromSVGElement(el);
    if (item) return item;
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
