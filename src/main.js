import { state, findShape, getActiveLayer, allShapes } from './state.js';
import { render, renderSelection } from './render.js';
import { initViewport, fitToArtboard, screenToDoc, isPanning } from './viewport.js';
import { execute, undo, redo } from './history.js';
import { initIO, newDocument, openSVG, saveSVG, exportSVG } from './io.js';
import { initPanel } from './panel.js';

import * as selectTool  from './tools/select.js';
import * as nodeTool    from './tools/node.js';
import * as penTool     from './tools/pen.js';
import * as rectTool    from './tools/rect.js';
import * as ellipseTool from './tools/ellipse.js';
import * as typeTool     from './tools/type.js';
import * as typeareaTool from './tools/typearea.js';
import * as zoomTool     from './tools/zoom.js';
import * as handTool    from './tools/hand.js';

const tools = {
  select:  selectTool,
  node:    nodeTool,
  pen:     penTool,
  rect:    rectTool,
  ellipse: ellipseTool,
  type:     typeTool,
  typearea: typeareaTool,
  zoom:     zoomTool,
  hand:    handTool,
};

const toolNames = {
  select: 'Selection', node: 'Direct Select', pen: 'Pen',
  rect: 'Rectangle', ellipse: 'Ellipse', type: 'Type', typearea: 'Area Type',
  zoom: 'Zoom', hand: 'Hand',
};

// ── Tool switching ────────────────────────────────────────────

function setTool(name) {
  const current = tools[state.activeTool];
  if (current?.deactivate) current.deactivate();

  state.activeTool = name;
  document.querySelectorAll('.tool-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tool === name));
  document.getElementById('status-tool').textContent = toolNames[name] || name;

  const next = tools[name];
  if (next?.activate) next.activate();
}

// ── Canvas event routing ──────────────────────────────────────

function initCanvasEvents() {
  const canvas = document.getElementById('canvas');

  canvas.addEventListener('mousedown', (e) => {
    if (isPanning()) return;
    const tool = tools[state.activeTool];
    if (tool?.onMouseDown) tool.onMouseDown(e);
  });

  let _rafPending = false;
  let _lastMoveEvent = null;
  window.addEventListener('mousemove', (e) => {
    _lastMoveEvent = e;
    if (!_rafPending) {
      _rafPending = true;
      requestAnimationFrame(() => {
        _rafPending = false;
        if (_lastMoveEvent) updateStatusPos(_lastMoveEvent);
      });
    }
    const tool = tools[state.activeTool];
    if (tool?.onMouseMove) tool.onMouseMove(e);
  });

  window.addEventListener('mouseup', (e) => {
    const tool = tools[state.activeTool];
    if (tool?.onMouseUp) tool.onMouseUp(e);
  });

  canvas.addEventListener('dblclick', (e) => {
    const tool = tools[state.activeTool];
    if (tool?.onDblClick) tool.onDblClick(e);
  });
}

function updateStatusPos(e) {
  const wrap = document.getElementById('canvas-wrap');
  const r = wrap.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
  const pos = screenToDoc(e.clientX, e.clientY);
  document.getElementById('status-pos').textContent =
    `${Math.round(pos.x)}, ${Math.round(pos.y)}`;
}

// ── Keyboard shortcuts ────────────────────────────────────────

function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    // Don't intercept when typing in an input
    if (e.target.matches('input,textarea')) return;

    const cmd = e.metaKey || e.ctrlKey;

    // Tool shortcuts (no modifier)
    if (!cmd) {
      const toolKey = { v:'select', a:'node', p:'pen', m:'rect', e:'ellipse', t:'type', z:'zoom', h:'hand' };
      if (toolKey[e.key.toLowerCase()]) { setTool(toolKey[e.key.toLowerCase()]); return; }
    }

    // File
    if (cmd && e.key === 'n') { e.preventDefault(); newDocument(); return; }
    if (cmd && e.key === 'o') { e.preventDefault(); openSVG(); return; }
    if (cmd && e.key === 's') { e.preventDefault(); saveSVG(); return; }

    // Edit
    if (cmd && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); render(); return; }
    if (cmd && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); render(); return; }
    if (cmd && e.key === 'c') { e.preventDefault(); copySelection(); return; }
    if (cmd && e.key === 'v') { e.preventDefault(); pasteSelection(); return; }
    if (cmd && e.key === 'a') { e.preventDefault(); selectAll(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selection.size > 0 && state.activeTool !== 'node') { e.preventDefault(); deleteSelection(); return; }
    }

    // Object
    if (cmd && e.key === 'g' && !e.shiftKey) { e.preventDefault(); groupSelection(); return; }
    if (cmd && (e.key === 'G' || (e.key === 'g' && e.shiftKey))) { e.preventDefault(); ungroupSelection(); return; }
    if (cmd && e.key === ']') { e.preventDefault(); bringToFront(); return; }
    if (cmd && e.key === '[') { e.preventDefault(); sendToBack(); return; }

    // Forward to active tool
    const tool = tools[state.activeTool];
    if (tool?.onKeyDown) tool.onKeyDown(e);
  });
}

// ── Style panel ───────────────────────────────────────────────

// Snapshot captured when a color picker opens, used to create a single undo entry on close.
let _pickerSnapshot = null;
let _commitTimer    = null;

function captureStyleSnapshot() {
  const snap = new Map();
  for (const id of state.selection) {
    const found = findShape(id);
    if (found) snap.set(id, { ...found.shape.style });
  }
  return snap;
}

function initStylePanel() {
  const fillSwatch   = document.getElementById('fill-swatch');
  const strokeSwatch = document.getElementById('stroke-swatch');
  const fillPicker   = document.getElementById('fill-picker');
  const strokePicker = document.getElementById('stroke-picker');
  const fillNoneBtn  = document.getElementById('fill-none-btn');
  const strokeNoneBtn = document.getElementById('stroke-none-btn');
  const weightInput  = document.getElementById('stroke-weight');

  // Fill picker — live preview during drag, single undo entry on close
  fillSwatch.addEventListener('click', () => {
    _pickerSnapshot = captureStyleSnapshot();
    fillPicker.click();
  });
  fillPicker.addEventListener('input',  () => applyStyleLive('fill', fillPicker.value));
  fillPicker.addEventListener('change', () => {
    clearTimeout(_commitTimer);
    _commitTimer = setTimeout(() => {
      commitStyleChange('fill', fillPicker.value, _pickerSnapshot);
      _pickerSnapshot = null;
      _commitTimer = null;
    }, 400);
  });

  // Stroke picker — same pattern; switching from 'none' is part of the same undo entry
  strokeSwatch.addEventListener('click', () => {
    _pickerSnapshot = captureStyleSnapshot();
    if (state.currentStyle.stroke === 'none') {
      applyStyleLive('stroke', '#000000');
      strokePicker.value = '#000000';
    }
    strokePicker.click();
  });
  strokePicker.addEventListener('input',  () => applyStyleLive('stroke', strokePicker.value));
  strokePicker.addEventListener('change', () => {
    clearTimeout(_commitTimer);
    _commitTimer = setTimeout(() => {
      commitStyleChange('stroke', strokePicker.value, _pickerSnapshot);
      _pickerSnapshot = null;
      _commitTimer = null;
    }, 400);
  });

  // None buttons and weight are single discrete actions — go straight to undo stack
  fillNoneBtn.addEventListener('click',   () => applyStyle('fill', 'none'));
  strokeNoneBtn.addEventListener('click', () => applyStyle('stroke', 'none'));

  weightInput.addEventListener('change', () => {
    const v = Math.max(0, parseFloat(weightInput.value) || 0);
    weightInput.value = v;
    applyStyle('strokeWidth', v);
  });
}

// Live preview: update shapes and panel without touching the undo stack.
function applyStyleLive(prop, value) {
  state.currentStyle[prop] = value;
  updateStylePanel();
  for (const id of state.selection) {
    const found = findShape(id);
    if (found) found.shape.style = { ...found.shape.style, [prop]: value };
  }
  render();
}

// Commit: push a single undo entry using the snapshot captured before the drag started.
function commitStyleChange(prop, value, beforeSnap) {
  state.currentStyle[prop] = value;
  if (!beforeSnap || state.selection.size === 0) return;

  // Shapes already carry the new value from live preview — capture that as "after".
  const after = new Map();
  for (const id of state.selection) {
    const found = findShape(id);
    if (found) after.set(id, { ...found.shape.style });
  }
  const before = beforeSnap;
  execute({
    do() {
      for (const [id, style] of after)  { const f = findShape(id); if (f) f.shape.style = { ...style }; }
      render();
    },
    undo() {
      for (const [id, style] of before) { const f = findShape(id); if (f) f.shape.style = { ...style }; }
      render();
    },
  });
}

// Single discrete style change (none buttons, stroke weight) — captures before/after inline.
function applyStyle(prop, value) {
  state.currentStyle[prop] = value;
  updateStylePanel();

  if (state.selection.size === 0) return;

  const before = new Map();
  const after  = new Map();
  for (const id of state.selection) {
    const found = findShape(id);
    if (!found) continue;
    before.set(id, { ...found.shape.style });
    after.set(id, { ...found.shape.style, [prop]: value });
  }

  execute({
    do() {
      for (const [id, style] of after)  { const f = findShape(id); if (f) f.shape.style = { ...style }; }
      render();
    },
    undo() {
      for (const [id, style] of before) { const f = findShape(id); if (f) f.shape.style = { ...style }; }
      render();
    },
  });
}

export function updateStylePanel() {
  // Reflect current style (or selected shape's style) in panel
  let style = state.currentStyle;
  if (state.selection.size === 1) {
    const id = [...state.selection][0];
    const found = findShape(id);
    if (found) style = found.shape.style;
  }

  const fillSwatch = document.getElementById('fill-swatch');
  const strokeSwatch = document.getElementById('stroke-swatch');
  const weightInput = document.getElementById('stroke-weight');

  if (style.fill === 'none') {
    fillSwatch.classList.add('none');
    fillSwatch.style.background = '';
  } else {
    fillSwatch.classList.remove('none');
    fillSwatch.style.background = style.fill;
    document.getElementById('fill-picker').value = style.fill;
  }

  if (style.stroke === 'none') {
    strokeSwatch.classList.add('none');
    strokeSwatch.style.background = '';
  } else {
    strokeSwatch.classList.remove('none');
    strokeSwatch.style.background = style.stroke;
    document.getElementById('stroke-picker').value = style.stroke;
  }

  weightInput.value = style.strokeWidth;
}

// ── Toolbar buttons ───────────────────────────────────────────

function initToolbar() {
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });
}

// ── Menu actions ──────────────────────────────────────────────

function initMenus() {
  document.querySelectorAll('.dropdown-item[data-action]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      dispatchAction(item.dataset.action);
    });
  });
}

function dispatchAction(action) {
  const map = {
    new:         newDocument,
    open:        openSVG,
    save:        saveSVG,
    export:      exportSVG,
    docSettings: openDocSettings,
    options:     openOptions,
    undo:        () => { undo(); render(); },
    redo:        () => { redo(); render(); },
    copy:        copySelection,
    paste:       pasteSelection,
    selectAll,
    delete:      deleteSelection,
    group:       groupSelection,
    ungroup:     ungroupSelection,
    bringToFront,
    sendToBack,
  };
  map[action]?.();
}

// ── Layers panel ──────────────────────────────────────────────

function initLayersPanel() {
  let layerCtr = 2;
  document.getElementById('layer-add-btn').addEventListener('click', () => {
    const id = `l${layerCtr++}`;
    state.layers.push({ id, name: `Layer ${layerCtr - 1}`, visible: true, locked: false, expanded: true, shapes: [] });
    state.activeLayerId = id;
    render();
  });

  document.getElementById('layer-del-btn').addEventListener('click', () => {
    if (state.layers.length <= 1) return;
    state.layers = state.layers.filter(l => l.id !== state.activeLayerId);
    state.activeLayerId = state.layers[state.layers.length - 1].id;
    state.selection.clear();
    render();
  });
}

// ── Edit operations ───────────────────────────────────────────

function deleteSelection() {
  if (state.selection.size === 0) return;
  const toDelete = [];
  for (const id of state.selection) {
    const found = findShape(id);
    if (found) toDelete.push({ shape: found.shape, layer: found.layer, idx: found.layer.shapes.indexOf(found.shape) });
  }
  execute({
    do() {
      for (const { shape, layer } of toDelete)
        layer.shapes = layer.shapes.filter(s => s.id !== shape.id);
      state.selection.clear();
      render();
    },
    undo() {
      for (const { shape, layer, idx } of toDelete)
        layer.shapes.splice(idx, 0, shape);
      render();
    },
  });
}

function copySelection() {
  if (state.selection.size === 0) return;
  state.clipboard = [];
  for (const id of state.selection) {
    const found = findShape(id);
    if (found) state.clipboard.push(JSON.parse(JSON.stringify(found.shape)));
  }
}

function pasteSelection() {
  if (!state.clipboard?.length) return;
  const layer = getActiveLayer();
  const copies = state.clipboard.map(s => ({
    ...JSON.parse(JSON.stringify(s)),
    id: `s${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    attrs: { ...s.attrs },
  }));
  // Offset pasted copies slightly
  for (const c of copies) {
    if ('x' in c.attrs) c.attrs.x += 10;
    if ('y' in c.attrs) c.attrs.y += 10;
    if ('cx' in c.attrs) c.attrs.cx += 10;
    if ('cy' in c.attrs) c.attrs.cy += 10;
  }
  execute({
    do() {
      for (const c of copies) layer.shapes.push(c);
      state.selection = new Set(copies.map(c => c.id));
      render();
    },
    undo() {
      const ids = new Set(copies.map(c => c.id));
      layer.shapes = layer.shapes.filter(s => !ids.has(s.id));
      state.selection.clear();
      render();
    },
  });
}

function selectAll() {
  state.selection.clear();
  for (const layer of state.layers) {
    if (!layer.visible || layer.locked) continue;
    for (const shape of layer.shapes) state.selection.add(shape.id);
  }
  render();
}

function bringToFront() {
  for (const id of state.selection) {
    const found = findShape(id);
    if (!found) continue;
    const { shape, layer } = found;
    layer.shapes = layer.shapes.filter(s => s.id !== id);
    layer.shapes.push(shape);
  }
  render();
}

function sendToBack() {
  for (const id of state.selection) {
    const found = findShape(id);
    if (!found) continue;
    const { shape, layer } = found;
    layer.shapes = layer.shapes.filter(s => s.id !== id);
    layer.shapes.unshift(shape);
  }
  render();
}

function groupSelection() {
  // Phase 3 — placeholder
  console.info('Group: Phase 3');
}

function ungroupSelection() {
  // Phase 3 — placeholder
  console.info('Ungroup: Phase 3');
}

// ── Document Settings dialog ──────────────────────────────────

function openDocSettings() {
  const overlay = document.getElementById('doc-settings-overlay');
  document.getElementById('dlg-width').value  = state.doc.width;
  document.getElementById('dlg-height').value = state.doc.height;
  syncPresetSelect();
  overlay.classList.add('open');
  document.getElementById('dlg-width').focus();
}

function closeDocSettings() {
  document.getElementById('doc-settings-overlay').classList.remove('open');
}

function syncPresetSelect() {
  const w = state.doc.width, h = state.doc.height;
  const sel = document.getElementById('dlg-preset');
  const match = [...sel.options].find(o => o.value === `${w}x${h}`);
  sel.value = match ? match.value : '';
}

function initDocSettings() {
  const overlay  = document.getElementById('doc-settings-overlay');
  const preset   = document.getElementById('dlg-preset');
  const wInput   = document.getElementById('dlg-width');
  const hInput   = document.getElementById('dlg-height');

  preset.addEventListener('change', () => {
    if (!preset.value) return;
    const [w, h] = preset.value.split('x').map(Number);
    wInput.value = w;
    hInput.value = h;
  });

  // Changing width/height manually clears the preset
  wInput.addEventListener('input', () => { preset.value = ''; });
  hInput.addEventListener('input', () => { preset.value = ''; });

  document.getElementById('dlg-ok').addEventListener('click', () => {
    const w = Math.max(1, Math.min(10000, parseInt(wInput.value,  10) || state.doc.width));
    const h = Math.max(1, Math.min(10000, parseInt(hInput.value, 10) || state.doc.height));
    state.doc.width  = w;
    state.doc.height = h;
    closeDocSettings();
    render();
    fitToArtboard();
  });

  document.getElementById('dlg-cancel').addEventListener('click', closeDocSettings);

  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDocSettings();
  });

  // Keyboard: Enter = OK, Escape = Cancel
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); document.getElementById('dlg-ok').click(); }
    if (e.key === 'Escape') { e.preventDefault(); closeDocSettings(); }
  });
}

// ── Options panel ─────────────────────────────────────────────

const PASTEBOARD_DEFAULTS = { dark: '#4a4a4a', light: '#b8b8b8' };

function applyTheme(theme) {
  document.body.classList.toggle('theme-light', theme === 'light');
  document.querySelectorAll('#opt-theme-toggle .opt-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === theme);
  });
  applyPasteboardColor(state.options.pasteboardColor);
}

function applyPasteboardColor(color) {
  const wrap = document.getElementById('canvas-wrap');
  const swatch = document.getElementById('opt-pasteboard-swatch');
  const picker = document.getElementById('opt-pasteboard-picker');
  const resolved = color ?? PASTEBOARD_DEFAULTS[state.options.theme] ?? PASTEBOARD_DEFAULTS.dark;
  wrap.style.background = resolved;
  if (swatch) swatch.style.background = resolved;
  if (picker) picker.value = resolved.length === 7 ? resolved : PASTEBOARD_DEFAULTS[state.options.theme];
}

function openOptions() {
  const overlay = document.getElementById('options-overlay');
  const dialog  = document.getElementById('options-dialog');
  // Reset position so it opens centered each time
  dialog.style.position = '';
  dialog.style.left = '';
  dialog.style.top  = '';
  dialog.style.margin = '';
  // Sync controls to current state
  applyTheme(state.options.theme);
  applyPasteboardColor(state.options.pasteboardColor);
  document.getElementById('opt-units-select').value = state.options.units;
  overlay.classList.add('open');
}

function closeOptions() {
  document.getElementById('options-overlay').classList.remove('open');
}

const OPTIONS_KEY = 'draw-options';

function saveOptions() {
  try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(state.options)); } catch {}
}

function loadOptions() {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (typeof saved !== 'object' || saved === null) return;
    if (saved.theme           !== undefined) state.options.theme           = saved.theme;
    if (saved.units           !== undefined) state.options.units           = saved.units;
    if (saved.pasteboardColor !== undefined) state.options.pasteboardColor = saved.pasteboardColor;
  } catch {}
}

function initOptions() {
  loadOptions();
  const overlay = document.getElementById('options-overlay');

  // Left-rail navigation
  document.querySelectorAll('.options-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.options-nav-item').forEach(i => i.classList.remove('active'));
      document.querySelectorAll('.options-page').forEach(p => p.classList.remove('active'));
      item.classList.add('active');
      document.getElementById(`opt-page-${item.dataset.page}`).classList.add('active');
    });
  });

  // Theme toggle
  document.querySelectorAll('#opt-theme-toggle .opt-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.options.theme = btn.dataset.val;
      applyTheme(btn.dataset.val);
      saveOptions();
    });
  });

  // Pasteboard color
  const pasteboardPicker = document.getElementById('opt-pasteboard-picker');
  document.getElementById('opt-pasteboard-swatch').addEventListener('click', () => {
    pasteboardPicker.click();
  });
  pasteboardPicker.addEventListener('input', (e) => {
    state.options.pasteboardColor = e.target.value;
    applyPasteboardColor(e.target.value);
    saveOptions();
  });
  pasteboardPicker.addEventListener('change', (e) => {
    state.options.pasteboardColor = e.target.value;
    applyPasteboardColor(e.target.value);
    saveOptions();
  });
  document.getElementById('opt-pasteboard-reset').addEventListener('click', () => {
    state.options.pasteboardColor = null;
    applyPasteboardColor(null);
    saveOptions();
  });

  // Units select
  document.getElementById('opt-units-select').addEventListener('change', (e) => {
    state.options.units = e.target.value;
    saveOptions();
  });

  // Draggable title bar
  const dialog = document.getElementById('options-dialog');
  const titlebar = document.getElementById('options-titlebar');
  let dragState = null;
  titlebar.style.cursor = 'move';
  titlebar.addEventListener('mousedown', (e) => {
    const r = dialog.getBoundingClientRect();
    dragState = { startX: e.clientX, startY: e.clientY, origLeft: r.left, origTop: r.top };
    dialog.style.position = 'fixed';
    dialog.style.margin = '0';
    dialog.style.left = r.left + 'px';
    dialog.style.top  = r.top  + 'px';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragState) return;
    dialog.style.left = (dragState.origLeft + e.clientX - dragState.startX) + 'px';
    dialog.style.top  = (dragState.origTop  + e.clientY - dragState.startY) + 'px';
  });
  window.addEventListener('mouseup', () => { dragState = null; });

  document.getElementById('options-export').addEventListener('click', () => {
    const json = JSON.stringify(state.options, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = 'draw-options.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = '.json,application/json';
  importInput.addEventListener('change', () => {
    const file = importInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        if (typeof imported !== 'object' || imported === null) throw new Error();
        // Merge only known keys so stale/unknown fields don't corrupt state
        if (imported.theme           !== undefined) state.options.theme           = imported.theme;
        if (imported.units           !== undefined) state.options.units           = imported.units;
        if (imported.pasteboardColor !== undefined) state.options.pasteboardColor = imported.pasteboardColor;
        applyTheme(state.options.theme);
        applyPasteboardColor(state.options.pasteboardColor);
        document.getElementById('opt-units-select').value = state.options.units;
        saveOptions();
      } catch {
        alert('Invalid options file.');
      }
      importInput.value = '';
    };
    reader.readAsText(file);
  });
  document.getElementById('options-import').addEventListener('click', () => importInput.click());

  document.getElementById('options-close').addEventListener('click', closeOptions);

  // Backdrop click closes
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeOptions();
  });

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeOptions(); }
  });

  // Apply persisted theme on startup
  applyTheme(state.options.theme);
}

// ── Status bar ────────────────────────────────────────────────

function updateStatusSel() {
  const n = state.selection.size;
  document.getElementById('status-sel').textContent =
    n === 0 ? '' : n === 1 ? '1 object' : `${n} objects`;
}

// Patch render to also update selection status and style panel
const _origRender = render;

// ── Init ──────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  initViewport();
  initCanvasEvents();
  initKeyboard();
  initStylePanel();
  initToolbar();
  initMenus();
  initLayersPanel();
  initIO();
  initPanel();
  initDocSettings();
  initOptions();

  // Initial render
  render();
  updateStylePanel();

  // Override selection rendering to also refresh status/style
  const canvas = document.getElementById('canvas');
  canvas.addEventListener('mouseup', () => {
    updateStatusSel();
    if (state.selection.size > 0) updateStylePanel();
  });
});
