/**
 * UI focus/context zone tracker.
 *
 * Tracks which named zone the user is currently working in based on mouseenter.
 * Zone sticks until the pointer enters a different registered zone.
 *
 * Built-in zones: 'canvas', 'layers', 'style', 'toolbar', 'menubar', 'commandbar'
 *
 * Usage:
 *   registerZone(el, 'layers')           — call once during panel/control init
 *   getZone()                            — returns current zone string (or null)
 *   on('zone-change', zone => { ... })   — subscribe to zone transitions
 */
import { emit, on } from './events.js';

export { on };

let _zone = null;

export function getZone() { return _zone; }

/**
 * Register a DOM element as a named zone.
 * Mouseenter on the element (or any descendant) sets it as the active zone.
 */
export function registerZone(el, name) {
  el.addEventListener('mouseenter', () => {
    if (_zone === name) return;
    _zone = name;
    emit('zone-change', name);
  });
}
