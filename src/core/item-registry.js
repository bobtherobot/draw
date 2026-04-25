/**
 * ItemRegistry — tracks companion objects for every display item.
 *
 * Each display item (type !== 'group' && type !== 'artboard') gets a companion
 * set created at item-birth time:
 *
 *   { abstract: AbstractObject, overlay: OverlayObject, aux: AuxObject | null }
 *
 * Groups and artboards never receive companions — they are structural containers.
 *
 * The registry is a module-level singleton (a plain Map).  It is never serialised
 * and never snapshot-cloned — it is purely runtime state.
 *
 * Key invariant: item POJOs in state.items[] are always mutated in-place, never
 * replaced.  AbstractObject holds a live reference to the POJO; replacing a POJO
 * object (state.items[i] = newObject) instead of mutating it will silently break
 * the companion. Add/remove items only via push/filter on the array.
 */
import { AbstractObject } from '../objects/abstract-object.js';
import { OverlayObject }  from '../objects/overlay-object.js';
import { getObjectType }  from './registry.js';

/** @type {Map<string, {abstract: AbstractObject, overlay: OverlayObject, aux: import('../objects/aux-object.js').AuxObject|null}>} */
const _map = new Map();

/** @param {object} item */
function _isDisplay(item) {
  return item.type !== 'group' && item.type !== 'artboard';
}

/**
 * Create companion objects for a display item.
 * No-op for groups, artboards, and items already in the registry.
 * @param {object} item
 */
export function createCompanions(item) {
  if (!_isDisplay(item) || _map.has(item.id)) return;
  const ot      = getObjectType(item.type);
  const abstract = new AbstractObject(item, ot);
  const overlay  = new OverlayObject(item.id);
  const aux      = ot?.createAuxObject?.(item) ?? null;
  _map.set(item.id, { abstract, overlay, aux });
}

/**
 * Destroy companion objects for an item id.
 * @param {string} id
 */
export function destroyCompanions(id) {
  _map.delete(id);
}

/**
 * Get companion objects for an item id.
 * Returns null for groups, artboards, and unknown ids.
 * @param {string} id
 * @returns {{abstract: AbstractObject, overlay: OverlayObject, aux: import('../objects/aux-object.js').AuxObject|null} | null}
 */
export function getCompanions(id) {
  return _map.get(id) ?? null;
}

/**
 * Destroy all companions and rebuild from a fresh items array.
 * Call after loading a document or importing SVG.
 * @param {object[]} items
 */
export function rebuildAll(items) {
  _map.clear();
  for (const item of items) createCompanions(item);
}

/**
 * Sync the registry against the current items array.
 * Creates companions for items not yet registered; destroys companions for
 * items no longer present.  Safe to call every render frame — O(n) in items.
 * @param {object[]} items  state.items[]
 */
export function syncCompanions(items) {
  const currentIds = new Set();
  for (const item of items) {
    if (!_isDisplay(item)) continue;
    currentIds.add(item.id);
    if (!_map.has(item.id)) createCompanions(item);
  }
  for (const id of _map.keys()) {
    if (!currentIds.has(id)) _map.delete(id);
  }
}
