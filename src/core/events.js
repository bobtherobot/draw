/**
 * Internal publish/subscribe event bus.
 *
 * Built-in events:
 *   'render'           — request a full render pass
 *   'selection-change' — selection Set mutated
 *   'tool-change'      — { prev, next } tool id
 *   'tool-suspend'     — { tool, overrideTool }
 *   'tool-resume'      — { tool }
 *   'subfeature-change'— { tool, subFeature }
 *   'mode-change'      — { prev, next } mode id
 *   'intent-change'    — new Intent object
 *   'history-change'   — undo/redo stack mutated
 *   'modifier-change'  — modifiers snapshot
 *   'theme-change'     — { theme } string
 */

/** @type {Map<string, Set<Function>>} */
const _subs = new Map();

/**
 * Subscribe to an event.
 * @param {string}   event
 * @param {Function} handler
 * @returns {Function} unsubscribe
 */
export function on(event, handler) {
  let s = _subs.get(event);
  if (!s) { s = new Set(); _subs.set(event, s); }
  s.add(handler);
  return () => s.delete(handler);
}

/**
 * Emit an event to all subscribers.
 * @param {string} event
 * @param {*}      [data]
 */
export function emit(event, data) {
  const s = _subs.get(event);
  if (s) for (const h of s) h(data);
}
