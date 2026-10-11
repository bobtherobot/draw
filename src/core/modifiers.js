/**
 * Modifier-key tracking and effective-tool resolution.
 *
 * BaseTool-switching overrides (registered, higher priority wins):
 *   Meta (Cmd)   → state.activeSelectTool (dynamic: 'select' or 'direct-select')
 *   Space        → 'hand'
 *   Meta + Alt   → 'zoom'
 *
 * Within-tool modifiers are NOT registered here — they are handled
 * inside individual dispatch entries (shift = constrain, alt = convert anchor, etc.)
 */
import { emit } from './events.js';
import { state } from './state.js';

export const modifiers = {
  meta:  false,
  ctrl:  false,
  alt:   false,
  shift: false,
  space: false,
};

/** @type {Array<{keys: string[], toolId: string|(()=>string), priority: number, subset: boolean}>} */
const _overrides = [];

/**
 * Register a modifier combo that temporarily switches the active tool.
 * @param {string[]}              keys     - subset of ['meta','ctrl','alt','shift','space']
 * @param {string|(() => string)} toolId
 * @param {number}                [priority=0]
 * @param {boolean}               [subset=false] - when true, matches whenever all keys are
 *   present in the active set (not just an exact match). Use for primary modifiers like
 *   meta so that meta+shift, meta+alt, etc. still resolve to the same tool.
 */
export function registerModifierOverride(keys, toolId, priority = 0, subset = false) {
  _overrides.push({ keys: [...keys].sort(), toolId, priority, subset });
  _overrides.sort((a, b) => b.priority - a.priority);
}

/**
 * Resolve the effective tool given current modifier state.
 * Returns activeTool when no override matches.
 * @param {string} activeTool
 * @returns {string}
 */
export function resolveEffectiveTool(activeTool) {
  const active = Object.entries(modifiers)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .sort();

  for (const { keys, toolId, subset } of _overrides) {
    const matches = subset
      ? keys.every(k => active.includes(k))
      : keys.length === active.length && keys.every((k, i) => k === active[i]);
    if (matches) {
      return typeof toolId === 'function' ? toolId() : toolId;
    }
  }
  return activeTool;
}

/**
 * Update a modifier key's state and re-resolve effectiveTool.
 * Called by controls/keyboard.js on keydown/keyup.
 * @param {'meta'|'ctrl'|'alt'|'shift'|'space'} key
 * @param {boolean} down
 * @param {import('../core/registry.js').getTool} getTool
 * @param {Function} render
 */
export function setModifier(key, down, getTool, render) {
  if (modifiers[key] === down) return;
  modifiers[key] = down;

  const prev = state.intent.effectiveTool;
  const next = resolveEffectiveTool(state.activeTool);

  if (prev !== next) {
    const prevTool = getTool(prev);
    const nextTool = getTool(next);
    if (prevTool?.suspendTo) prevTool.suspendTo(next);
    // Deactivate the override tool when returning to the base tool so it
    // can clean up any inline styles or other state it set during activation.
    if (prev !== state.activeTool && prevTool?.deactivate) prevTool.deactivate();
    if (nextTool?.activate)  nextTool.activate();
    state.intent.effectiveTool = next;
    emit('tool-suspend', { tool: prev, overrideTool: next });
  }

  state.intent.modifiers = { ...modifiers };
  emit('modifier-change', { ...modifiers });
  render();
}
