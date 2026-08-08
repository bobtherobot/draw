/**
 * Global application state — single mutable object.
 * Mutate directly; call emit('render') or emit('selection-change') after.
 *
 * Data model: flat `state.shapes` array, each shape identified by a session-local
 * id and linked to its parent via `parentId` (null = root level). Any shape can
 * hold children; the tree is reconstructed on demand.
 *
 * Shape structure:
 *   { id, type, name?, parentId, visible, locked, expanded,
 *     attrs?, style?, _text?, _fontSize?, _fontFamily?,
 *     _boxWidth?, _boxHeight? }
 *
 * type 'group'      — pure container, no geometry
 * type 'artboard'   — pure container, owns dimensions
 * type 'path'       — display shape
 * type 'free-text'  — display shape
 * type 'text-block' — display shape
 */

let _idCounter = 0;

/**
 * Generate a unique ID. prefix should be a short lowercase string (no spaces).
 * Format: `${prefix}${integer}` — e.g. "item1", "path3", "free-text7".
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

const _artboardId       = nextId('item'); // 'item1'
const _defaultLayerId   = nextId('item'); // 'item2'

export const state = {
  activeTool:       'select',
  activeMode:       'normal',
  activeSelectTool: 'select',

  /** @type {object[]} flat ordered shape array — tree structure encoded via parentId */
  shapes: [
    {
      id:       _artboardId,
      type:     'artboard',
      name:     'Artboard 1',
      parentId: null,
      visible:  true,
      locked:   false,
      expanded: true,
      attrs:    { x: 0, y: 0, width: 800, height: 600 },
    },
    {
      id:       _defaultLayerId,
      type:     'group',
      name:     'Layer 1',
      parentId: _artboardId,
      visible:  true,
      locked:   false,
      expanded: true,
    },
  ],

  /** ID of the active container (group or artboard) — where new shapes are placed. */
  activeContainerId: _defaultLayerId,

  /** @type {Set<string>} selected shape ids */
  selection: new Set(),

  viewport: { x: 0, y: 0, zoom: 1 },

  currentStyle: { fill: '#000000', stroke: 'none', strokeWidth: 1 },

  clipboard: null,

  nodeEditingActive: false,

  doc: { name: 'Untitled' },

  options: { theme: 'dark', units: 'px', pasteboardColor: null, selectByIntersect: false },

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

  /**
   * Live hover context — what's under the cursor right now.
   * Updated on every mousemove. Read-only outside of toolbar.js.
   * @type {{ objectType: string|null, part: string|null, shape: object|null }}
   */
  hover: { objectType: null, part: null, shape: null },

  /**
   * The operation currently in progress. null when idle.
   * @type {string|null}
   */
  operation: null,

  /**
   * Set during a rotation drag; null otherwise.
   * @type {{ bbox: {x,y,width,height}, center: {x,y}, angle: number } | null}
   */
  activeRotation: null,

  /**
   * Persistent collection-level rotation state for multi-selection.
   * @type {{ bbox: {x,y,width,height}, center: {x,y}, angle: number } | null}
   */
  selectionRotation: null,

  /**
   * Transform origin for the current selection session.
   * @type {{ x: number, y: number } | null}
   */
  selectionOrigin: null,
};

/** Return the active container (group or artboard) where new shapes will be placed. */
export function getActiveContainer() {
  return state.shapes.find(s => s.id === state.activeContainerId)
    ?? state.shapes.find(s => s.parentId === null && s.type === 'group')
    ?? state.shapes[0];
}

/** Return the first artboard shape. */
export function getActiveArtboard() {
  return state.shapes.find(s => s.type === 'artboard') ?? null;
}

/**
 * Return all direct children of the given parentId, in array order.
 * Pass null to get root-level shapes.
 */
export function childrenOf(parentId) {
  return state.shapes.filter(s => s.parentId === parentId);
}

/**
 * Promote orphaned shapes to root level.
 * Call after any delete operation and on deserialize.
 * Mutates shapes in place.
 */
export function sanitizeShapes(shapes) {
  const ids = new Set(shapes.map(s => s.id));
  for (const shape of shapes) {
    if (shape.parentId && !ids.has(shape.parentId)) shape.parentId = null;
  }
}

/**
 * Effective visibility — false if the shape itself OR any ancestor is hidden.
 */
export function effectiveVisible(shape) {
  let cur = shape;
  while (cur) {
    if (cur.visible === false) return false;
    cur = cur.parentId ? state.shapes.find(s => s.id === cur.parentId) : null;
  }
  return true;
}

/**
 * Effective lock — true if the shape itself OR any ancestor is locked.
 */
export function effectiveLocked(shape) {
  let cur = shape;
  while (cur) {
    if (cur.locked) return true;
    cur = cur.parentId ? state.shapes.find(s => s.id === cur.parentId) : null;
  }
  return false;
}

/**
 * Find any shape by id.
 * @param {string} id
 * @returns {object | null}
 */
export function findShape(id) {
  return state.shapes.find(s => s.id === id) ?? null;
}

/** Return all display shapes (non-group, non-artboard) in array order. */
export function allDisplayShapes() {
  return state.shapes.filter(s => s.type !== 'group' && s.type !== 'artboard');
}
