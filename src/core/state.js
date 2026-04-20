/**
 * Global application state — single mutable object.
 * Mutate directly; call emit('render') or emit('selection-change') after.
 */

let _idCounter = 0;

/**
 * Generate a unique ID. prefix should be a short lowercase string (no spaces).
 * Format: `${prefix}${integer}` — e.g. "layer1", "path3", "text-line7".
 * IDs are session-local; they must be reconstructed on file load (never trusted
 * from serialized data) to avoid collisions between documents.
 */
export const nextId = (prefix = 'obj') => `${prefix}${++_idCounter}`;

/**
 * Sanitize a human-readable label: strip control characters (including newlines),
 * trim whitespace, cap at 100 characters. Allows all printable unicode including
 * double-byte characters and emoji.
 */
export function sanitizeName(str) {
  return String(str ?? '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .slice(0, 100);
}

const _defaultLayerId = nextId('layer'); // 'layer1'

export const state = {
  activeTool:  'select',
  activeMode:  'normal',

  layers: [{
    id:       _defaultLayerId,
    name:     'Layer 1',
    visible:  true,
    locked:   false,
    expanded: true,
    parentId: null,
    shapes:   [],
  }],
  activeLayerId: _defaultLayerId,

  /** @type {Set<string>} shape ids */
  selection: new Set(),

  viewport: { x: 0, y: 0, zoom: 1 },

  currentStyle: { fill: '#000000', stroke: 'none', strokeWidth: 1 },

  clipboard: null,

  nodeEditingActive: false,

  doc: { width: 800, height: 600, name: 'Untitled' },

  options: { theme: 'dark', units: 'px', pasteboardColor: null },

  /**
   * @typedef {Object} Intent
   * @property {string}      tool
   * @property {string}      effectiveTool
   * @property {string}      mode
   * @property {string|null} objectType
   * @property {string|null} part
   * @property {object|null} shape
   * @property {{meta:boolean,ctrl:boolean,alt:boolean,shift:boolean,space:boolean}} modifiers
   */
  intent: {
    tool:          'select',
    effectiveTool: 'select',
    mode:          'normal',
    objectType:    null,
    part:          null,
    shape:         null,
    modifiers:     { meta: false, ctrl: false, alt: false, shift: false, space: false },
  },
};

/** Return the active layer object. */
export function getActiveLayer() {
  return state.layers.find(l => l.id === state.activeLayerId) ?? state.layers[0];
}

/**
 * Effective visibility — false if the layer itself OR any ancestor is hidden.
 * Never mutates child state; parent toggling does not change child.visible.
 */
export function effectiveVisible(layer) {
  let cur = layer;
  while (cur) {
    if (!cur.visible) return false;
    cur = cur.parentId ? state.layers.find(l => l.id === cur.parentId) : null;
  }
  return true;
}

/**
 * Effective lock — true if the layer itself OR any ancestor is locked.
 */
export function effectiveLocked(layer) {
  let cur = layer;
  while (cur) {
    if (cur.locked) return true;
    cur = cur.parentId ? state.layers.find(l => l.id === cur.parentId) : null;
  }
  return false;
}

/**
 * Find a shape by id across all layers.
 * @param {string} id
 * @returns {{ shape: object, layer: object } | null}
 */
export function findShape(id) {
  for (const layer of state.layers) {
    const shape = layer.shapes.find(s => s.id === id);
    if (shape) return { shape, layer };
  }
  return null;
}

/** Flatten all shapes from all layers into a single array (front-to-back order). */
export function allShapes() {
  return state.layers.flatMap(l => l.shapes);
}
