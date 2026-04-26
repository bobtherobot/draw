/**
 * ShapeRegistry — maps shape ids to their Container controller instances.
 *
 * Every shape (including groups and artboards) gets a Container controller.
 * The controller owns and creates its own Overlay and Aux companions internally.
 * After each sync, _parent and _children pointers are wired from parentId so
 * transform propagation can traverse the tree without id lookups.
 *
 * Key invariant: shape POJOs in state.shapes[] are always mutated in-place, never
 * replaced. Container holds a live reference to the POJO; replacing a POJO
 * (state.shapes[i] = newObject) instead of mutating it will silently break the
 * controller. Add/remove shapes only via push/filter on the array.
 */
import { getControllerClass } from './registry.js';

/** @type {Map<string, import('../objects/Container.js').Container>} */
const _map = new Map();

/**
 * Create a Container controller for a shape.
 * No-op for shapes already in the registry or with no registered type.
 * @param {object} shape
 */
export function createController(shape) {
  if (_map.has(shape.id)) return;
  const ControllerClass = getControllerClass(shape.type);
  if (!ControllerClass) return;
  _map.set(shape.id, new ControllerClass(shape));
}

/**
 * Destroy the controller for a shape id.
 * @param {string} id
 */
export function destroyController(id) {
  _map.delete(id);
}

/**
 * Get the Container controller for a shape id.
 * Returns null for unknown ids.
 * @param {string} id
 * @returns {import('../objects/Container.js').Container | null}
 */
export function getController(id) {
  return _map.get(id) ?? null;
}

/**
 * Destroy all controllers and rebuild from a fresh shapes array.
 * Call after loading a document or importing SVG.
 * @param {object[]} shapes
 */
export function rebuildAll(shapes) {
  _map.clear();
  for (const shape of shapes) createController(shape);
  _wireLinks(shapes);
}

/**
 * Sync the registry against the current shapes array.
 * Creates controllers for shapes not yet registered; destroys controllers for
 * shapes no longer present. Safe to call every render frame — O(n) in shapes.
 * @param {object[]} shapes  state.shapes[]
 */
export function syncControllers(shapes) {
  const currentIds = new Set();
  for (const shape of shapes) {
    currentIds.add(shape.id);
    if (!_map.has(shape.id)) createController(shape);
  }
  for (const id of _map.keys()) {
    if (!currentIds.has(id)) _map.delete(id);
  }
  _wireLinks(shapes);
}

/**
 * Build _parent and _children pointers on every controller from parentId.
 * Called after every sync so the tree is always current.
 * @param {object[]} shapes
 */
function _wireLinks(shapes) {
  // Clear existing links
  for (const ctrl of _map.values()) {
    ctrl._parent   = null;
    ctrl._children = [];
  }
  // Wire from parentId
  for (const shape of shapes) {
    if (!shape.parentId) continue;
    const child  = _map.get(shape.id);
    const parent = _map.get(shape.parentId);
    if (!child || !parent) continue;
    child._parent = parent;
    parent._children.push(child);
  }
}
