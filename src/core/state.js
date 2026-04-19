/**
 * Global application state — single mutable object.
 * Mutate directly; call emit('render') or emit('selection-change') after.
 */

let _idCounter = 0;
export const nextId = () => `s${++_idCounter}`;

export const state = {
  activeTool:  'select',
  activeMode:  'normal',

  layers: [{
    id:       'l1',
    name:     'Layer 1',
    visible:  true,
    locked:   false,
    expanded: true,
    shapes:   [],
  }],
  activeLayerId: 'l1',

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
