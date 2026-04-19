/**
 * Keyboard shortcuts and modifier-key tracking.
 * Wires global keydown/keyup listeners that update modifier state
 * and dispatch to the active tool or registered keybindings.
 */
import { state }                from '../core/state.js';
import { emit }                 from '../core/events.js';
import { getTool, getAllTools, getAllKeybindings } from '../core/registry.js';
import { setModifier, registerModifierOverride } from '../core/modifiers.js';
import { render }               from '../render/renderer.js';
import { undo, redo, canUndo, canRedo } from '../core/history.js';
import { zoomAt, fitToArtboard } from '../viewport.js';
import { newDocument, openSVG, saveSVG } from '../io/io.js';

// Register built-in modifier overrides (Space → hand, Meta → select, Meta+Alt → zoom)
registerModifierOverride(['space'], 'hand',   10);
registerModifierOverride(['meta'],  'select', 9);

export function initKeyboard() {
  document.addEventListener('keydown', _onKeyDown);
  document.addEventListener('keyup',   _onKeyUp);
}

function _onKeyDown(e) {
  // Update modifier state
  if (e.key === 'Meta'  || e.key === 'Control') setModifier('meta',  true, getTool, render);
  if (e.key === 'Alt')                           setModifier('alt',   true, getTool, render);
  if (e.key === 'Shift')                         setModifier('shift', true, getTool, render);
  if (e.key === ' ')                             setModifier('space', true, getTool, render);

  // Don't process shortcuts when a text input has focus
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    // Still pass to active tool's onKeyDown
    const tool = getTool(state.intent.effectiveTool);
    tool?.onKeyDown(e);
    return;
  }

  // Undo / redo
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    if (canUndo()) { undo(); render(); }
    return;
  }
  if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault();
    if (canRedo()) { redo(); render(); }
    return;
  }

  // File shortcuts
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); newDocument(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key === 'o') { e.preventDefault(); openSVG(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveSVG(); return; }

  // Zoom shortcuts
  if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomAt(1.5); return; }
  if ((e.metaKey || e.ctrlKey) && e.key === '-')                     { e.preventDefault(); zoomAt(1/1.5); return; }
  if ((e.metaKey || e.ctrlKey) && e.key === '0')                     { e.preventDefault(); fitToArtboard(); return; }

  // Tool shortcuts (single key, no modifier) — registered per tool
  if (!e.metaKey && !e.ctrlKey && !e.altKey) {
    const key = e.key.toLowerCase();
    for (const tool of _getRegisteredTools()) {
      if (tool.shortcut === key) {
        e.preventDefault();
        _setActiveTool(tool.id);
        return;
      }
    }
  }

  // Plugin keybindings
  for (const kb of getAllKeybindings()) {
    if (_matchesBinding(e, kb)) {
      e.preventDefault();
      kb.action(e);
      return;
    }
  }

  // Delegate to active tool
  const tool = getTool(state.intent.effectiveTool);
  tool?.onKeyDown(e);
}

function _onKeyUp(e) {
  if (e.key === 'Meta'  || e.key === 'Control') setModifier('meta',  false, getTool, render);
  if (e.key === 'Alt')                           setModifier('alt',   false, getTool, render);
  if (e.key === 'Shift')                         setModifier('shift', false, getTool, render);
  if (e.key === ' ')                             setModifier('space', false, getTool, render);
}

export function setActiveTool(toolId) { _setActiveTool(toolId); }

function _setActiveTool(toolId) {
  const prev    = getTool(state.activeTool);
  const next    = getTool(toolId);
  if (!next || state.activeTool === toolId) return;
  prev?.deactivate();
  state.activeTool          = toolId;
  state.intent.tool         = toolId;
  state.intent.effectiveTool= toolId;
  next.activate();
  emit('tool-change', { tool: toolId });
  render();
}

function _matchesBinding(e, kb) {
  const parts = kb.key.toLowerCase().split('+');
  const key   = parts[parts.length - 1];
  const ctrl  = parts.includes('ctrl');
  const meta  = parts.includes('meta');
  const shift = parts.includes('shift');
  const alt   = parts.includes('alt');
  return e.key.toLowerCase() === key
    && !!e.ctrlKey  === ctrl
    && !!e.metaKey  === meta
    && !!e.shiftKey === shift
    && !!e.altKey   === alt;
}

function _getRegisteredTools() { return getAllTools(); }
