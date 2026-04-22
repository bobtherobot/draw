/**
 * Global application state — single mutable object.
 * Mutate directly; call emit('render') or emit('selection-change') after.
 *
 * Data model: flat `state.items` array, each item identified by a session-local
 * id and linked to its parent via `parentId` (null = root level). Any item can
 * hold children; the tree is reconstructed on demand.
 *
 * Item shape:
 *   { id, type, name?, parentId, visible, locked, expanded,
 *     attrs?, style?, _text?, _fontSize?, _fontFamily?,
 *     _boxWidth?, _boxHeight? }
 *
 * type 'group'      — pure container, no geometry
 * type 'path'       — display item, may have children
 * type 'free-text'  — display item, may have children
 * type 'text-block' — display item, may have children
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

const _artboardId    = nextId('item'); // 'item1'
const _defaultItemId = nextId('item'); // 'item2'

export const state = {
  activeTool:  'select',
  activeMode:  'normal',

  /** @type {object[]} flat ordered item array — tree structure encoded via parentId */
  items: [
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
      id:       _defaultItemId,
      type:     'group',
      name:     'Layer 1',
      parentId: _artboardId,
      visible:  true,
      locked:   false,
      expanded: true,
    },
  ],
  activeItemId: _defaultItemId,

  /** @type {Set<string>} selected item ids */
  selection: new Set(),

  viewport: { x: 0, y: 0, zoom: 1 },

  currentStyle: { fill: '#000000', stroke: 'none', strokeWidth: 1 },

  clipboard: null,

  nodeEditingActive: false,

  doc: { name: 'Untitled' },

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

  /**
   * Live hover context — what's under the cursor right now.
   * Updated on every mousemove. Read-only outside of toolbar.js.
   * @type {{ objectType: string|null, part: string|null, shape: object|null }}
   */
  hover: { objectType: null, part: null, shape: null },

  /**
   * The operation currently in progress. null when idle.
   * Written by tools on mousedown, cleared on mouseup/commit.
   *
   * Defined values:
   *   'move'          — dragging selected shapes
   *   'scale:<handle>'— scaling via a handle, e.g. 'scale:nw', 'scale:se'
   *   'rotate'        — rotating selected shapes
   *   'band'          — rubber-band selection
   *   'text-edit'     — text editor active (new or existing shape)
   *
   * Tools may define additional values for future operations.
   * @type {string|null}
   */
  operation: null,
};

/** Return the active container item, falling back to the first root group. */
export function getActiveItem() {
  return state.items.find(i => i.id === state.activeItemId)
    ?? state.items.find(i => i.parentId === null && i.type === 'group')
    ?? state.items[0];
}

/** Return the first artboard item (single-artboard enforcement). */
export function getActiveArtboard() {
  return state.items.find(i => i.type === 'artboard') ?? null;
}

/**
 * Return all direct children of the given parentId, in array order.
 * Pass null to get root-level items.
 */
export function childrenOf(parentId) {
  return state.items.filter(i => i.parentId === parentId);
}

/**
 * Promote orphaned items to root level.
 * Call after any delete operation and on deserialize.
 * Mutates items in place.
 */
export function sanitizeItems(items) {
  const ids = new Set(items.map(i => i.id));
  for (const item of items) {
    if (item.parentId && !ids.has(item.parentId)) item.parentId = null;
  }
}

/**
 * Effective visibility — false if the item itself OR any ancestor is hidden.
 * Never mutates child state.
 */
export function effectiveVisible(item) {
  let cur = item;
  while (cur) {
    if (cur.visible === false) return false;
    cur = cur.parentId ? state.items.find(i => i.id === cur.parentId) : null;
  }
  return true;
}

/**
 * Effective lock — true if the item itself OR any ancestor is locked.
 */
export function effectiveLocked(item) {
  let cur = item;
  while (cur) {
    if (cur.locked) return true;
    cur = cur.parentId ? state.items.find(i => i.id === cur.parentId) : null;
  }
  return false;
}

/**
 * Find a display item (non-group) by id.
 * @param {string} id
 * @returns {object | null}
 */
export function findItem(id) {
  return state.items.find(i => i.id === id) ?? null;
}

/** Return all display items (non-group, non-artboard) in array order. */
export function allDisplayItems() {
  return state.items.filter(i => i.type !== 'group' && i.type !== 'artboard');
}

// ── Legacy aliases — removed callers should migrate to the new names ──────────
// These are kept temporarily so the app doesn't break on first boot while the
// migration of downstream files is in progress.

/** @deprecated use getActiveItem() */
export function getActiveLayer() { return getActiveItem(); }

/** @deprecated use findItem(id) */
export function findShape(id) {
  const item = findItem(id);
  return item ? { shape: item, layer: item } : null;
}

/** @deprecated use allDisplayItems() */
export function allShapes() { return allDisplayItems(); }
