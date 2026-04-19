/**
 * Toolbar — builds the tool button strip from the registry.
 * Also wires all canvas mouse events → active tool + hit-test/dispatch.
 *
 * Canvas event routing (Phase 9):
 *   mousedown/move/up/dblclick → hitTest → computeIntent → dispatch → fallback tool.onEvent
 */
import { state }                        from '../core/state.js';
import { on, emit }                     from '../core/events.js';
import { getTool, getAllTools, getObjectType } from '../core/registry.js';
import { hitTest, computeIntent }       from '../core/hit-test.js';
import { dispatch }                     from '../core/intent.js';
import { getElement, render, getOverlay } from '../render/renderer.js';
import { getIconSync }                  from '../core/icons.js';
import { screenToDoc, zoomAt }          from '../viewport.js';
import { execute }                      from '../core/history.js';
import { modifiers }                    from '../core/modifiers.js';
import { setActiveTool }                from './keyboard.js';

let _toolbarEl = null;
let _appCtx    = null;

/** Wire up the toolbar DOM and the canvas event routing. */
export function initToolbar(toolbarEl, canvasWrap) {
  _toolbarEl = toolbarEl;
  _buildAppContext();
  _buildToolbar();
  _wireCanvasEvents(canvasWrap);
  _wireCanvasWheel(canvasWrap);

  // Init all tools with context, activate the initial tool
  for (const tool of getAllTools()) tool.init(_appCtx);
  getTool(state.activeTool)?.activate();

  // Reflect tool changes in toolbar UI
  on('tool-change', ({ tool }) => _refreshActive(tool));
}

function _buildAppContext() {
  _appCtx = {
    state,
    execute,
    render,
    screenToDoc,
    getElement,
    getObjectType,
    setActiveTool,
    emit,
    getModifiers: () => ({ ...modifiers }),
    overlay: getOverlay(),
  };
}

function _buildToolbar() {
  _toolbarEl.innerHTML = '';
  _toolbarEl.className = 'toolbar';

  // Tool order for toolbar display
  const ORDER = ['select','node','pen','rect','ellipse','type','type-area','zoom','hand'];
  const tools = getAllTools().sort((a, b) => {
    const ai = ORDER.indexOf(a.id);
    const bi = ORDER.indexOf(b.id);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  for (const tool of tools) {
    const btn = document.createElement('button');
    btn.className    = 'toolbar__btn';
    btn.dataset.tool = tool.id;
    btn.title        = `${tool.label}${tool.shortcut ? ` (${tool.shortcut.toUpperCase()})` : ''}`;

    const icon = getIconSync('tools', tool.icon ?? tool.id);
    btn.appendChild(icon);

    btn.addEventListener('click', () => setActiveTool(tool.id));
    _toolbarEl.appendChild(btn);
  }

  _refreshActive(state.activeTool);
}

function _refreshActive(toolId) {
  if (!_toolbarEl) return;
  for (const btn of _toolbarEl.querySelectorAll('.toolbar__btn')) {
    btn.classList.toggle('active', btn.dataset.tool === toolId);
  }
  // Update canvas-wrap cursor class
  const wrap = document.querySelector('.canvas-wrap');
  if (wrap) {
    for (const cls of [...wrap.classList]) {
      if (cls.startsWith('tool-')) wrap.classList.remove(cls);
    }
    wrap.classList.add(`tool-${toolId}`);
  }
}

// ── Canvas event wiring (Phase 9) ───────────────────────────────────────────

function _wireCanvasEvents(canvasWrap) {
  const svg = canvasWrap?.querySelector('#canvas') ?? canvasWrap;
  if (!svg) return;

  svg.addEventListener('mousedown', _onMouseDown);
  svg.addEventListener('mousemove', _onMouseMove);
  svg.addEventListener('mouseup',   _onMouseUp);
  svg.addEventListener('dblclick',  _onDblClick);
}

function _wireCanvasWheel(canvasWrap) {
  const svg = canvasWrap?.querySelector('#canvas') ?? canvasWrap;
  if (!svg) return;
  svg.addEventListener('wheel', _onWheel, { passive: false });
}

function _onMouseDown(e) {
  const hit    = hitTest(e.clientX, e.clientY, getObjectType, getElement);
  const intent = computeIntent(hit);
  state.intent  = intent;

  const handled = dispatch(intent, 'mousedown', _appCtx, e);
  if (!handled) {
    const tool = getTool(intent.effectiveTool);
    tool?.onMouseDown(e);
  }
}

function _onMouseMove(e) {
  const hit    = hitTest(e.clientX, e.clientY, getObjectType, getElement);
  const intent = computeIntent(hit);
  state.intent  = intent;

  const handled = dispatch(intent, 'mousemove', _appCtx, e);
  if (!handled) {
    const tool = getTool(intent.effectiveTool);
    tool?.onMouseMove(e);
  }
}

function _onMouseUp(e) {
  const intent = state.intent; // keep same intent as mousedown (don't re-hit-test on up)

  const handled = dispatch(intent, 'mouseup', _appCtx, e);
  if (!handled) {
    const tool = getTool(intent.effectiveTool);
    tool?.onMouseUp(e);
  }
}

function _onDblClick(e) {
  const hit    = hitTest(e.clientX, e.clientY, getObjectType, getElement);
  const intent = computeIntent(hit);

  const handled = dispatch(intent, 'dblclick', _appCtx, e);
  if (!handled) {
    const tool = getTool(intent.effectiveTool);
    tool?.onDblClick(e);
  }
}

function _onWheel(e) {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  zoomAt(factor, e.clientX, e.clientY);
}
