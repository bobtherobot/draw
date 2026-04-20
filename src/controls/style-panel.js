/**
 * Style panel — fill, stroke, stroke-width controls.
 * Reflects state.currentStyle and applies to selection.
 */
import { state, findItem } from '../core/state.js';
import { on, emit }   from '../core/events.js';
import { execute }    from '../core/history.js';
import { getObjectType } from '../core/registry.js';
import { getElement, render } from '../render/renderer.js';

let _pickerSnapshot = null; // style snapshot at color-picker open

export function initStylePanel(registerPanel) {
  registerPanel('style', 'Style', (contentEl) => {
    const sp = _el('div', 'style-panel');
    sp.appendChild(_colorRow('fill', 'Fill'));
    sp.appendChild(_colorRow('stroke', 'Stroke'));
    sp.appendChild(_weightRow());
    contentEl.appendChild(sp);
  });

  on('selection-change', () => _refresh());
  on('render',           () => _refresh());
}

function _colorRow(prop, label) {
  const row    = _el('div', 'style-panel__row');
  const lbl    = _el('label', 'style-panel__label');
  lbl.textContent = label;

  const swatch = _el('div', 'style-panel__swatch');
  swatch.id    = `swatch-${prop}`;

  const input  = document.createElement('input');
  input.type   = 'color';
  input.id     = `color-${prop}`;
  swatch.appendChild(input);

  const noneBtn = _el('button', 'style-panel__none-btn');
  noneBtn.id    = `none-${prop}`;
  noneBtn.textContent = '∅';
  noneBtn.title = `Set ${label} to none`;

  input.addEventListener('focus', () => {
    _pickerSnapshot = _snapshotSelection();
  });
  input.addEventListener('input', (e) => {
    _applyLive(prop, e.target.value);
  });
  input.addEventListener('change', () => {
    _commitColor(prop, _pickerSnapshot);
    _pickerSnapshot = null;
  });
  noneBtn.addEventListener('click', () => {
    const snap = _snapshotSelection();
    const val  = 'none';
    _commitColor(prop, snap, val);
  });

  row.append(lbl, swatch, noneBtn);
  return row;
}

function _weightRow() {
  const row   = _el('div', 'style-panel__row');
  const lbl   = _el('label', 'style-panel__label');
  lbl.textContent = 'Width';

  const input = document.createElement('input');
  input.type  = 'number';
  input.id    = 'stroke-weight';
  input.className = 'style-panel__weight';
  input.min   = '0';
  input.step  = '0.5';

  const unit  = _el('span', 'style-panel__unit');
  unit.textContent = 'px';

  input.addEventListener('change', () => {
    const val  = Math.max(0, parseFloat(input.value) || 0);
    const snap = _snapshotSelection();
    execute({
      do()   { _applyStyle('strokeWidth', val); state.currentStyle.strokeWidth = val; render(); },
      undo() { _restoreSnapshot(snap); state.currentStyle.strokeWidth = snap.currentStyle.strokeWidth; render(); },
    });
  });

  row.append(lbl, input, unit);
  return row;
}

// ── Update ───────────────────────────────────────────────────────────────────

function _refresh() {
  _syncToCurrentStyle();
}

function _syncToCurrentStyle() {
  const s = _getDisplayStyle();

  const fillInput   = document.getElementById('color-fill');
  const strokeInput = document.getElementById('color-stroke');
  const weightInput = document.getElementById('stroke-weight');
  const fillSwatch  = document.getElementById('swatch-fill');
  const strokeSwatch= document.getElementById('swatch-stroke');
  const nFill       = document.getElementById('none-fill');
  const nStroke     = document.getElementById('none-stroke');

  if (!fillInput) return;

  const fill   = s.fill   ?? '#000000';
  const stroke = s.stroke ?? 'none';
  const sw     = s.strokeWidth ?? 1;

  fillInput.value   = fill === 'none' ? '#000000' : fill;
  strokeInput.value = stroke === 'none' ? '#000000' : stroke;
  weightInput.value = sw;

  fillSwatch.style.background   = fill   === 'none' ? '' : fill;
  strokeSwatch.style.background = stroke === 'none' ? '' : stroke;
  fillSwatch.classList.toggle('none',   fill   === 'none');
  strokeSwatch.classList.toggle('none', stroke === 'none');
  nFill.classList.toggle('active',   fill   === 'none');
  nStroke.classList.toggle('active', stroke === 'none');
}

function _getDisplayStyle() {
  for (const id of state.selection) {
    const shape = findItem(id);
    if (shape) return shape.style;
  }
  return state.currentStyle;
}

// ── Apply ────────────────────────────────────────────────────────────────────

function _applyLive(prop, value) {
  _applyStyle(prop, value);
  state.currentStyle[prop] = value;
  render();
}

function _commitColor(prop, snapshot, value) {
  const val = value ?? state.currentStyle[prop];
  execute({
    do()   { _applyStyle(prop, val); state.currentStyle[prop] = val; render(); },
    undo() { _restoreSnapshot(snapshot); state.currentStyle[prop] = snapshot.currentStyle[prop]; render(); },
  });
}

function _applyStyle(prop, value) {
  for (const id of state.selection) {
    const shape = findItem(id);
    if (!shape) continue;
    shape.style[prop] = value;
    const ot = getObjectType(shape.type);
    const el = getElement(id);
    if (ot && el) ot.syncElement(el, shape, { mode: state.activeMode, zoom: state.viewport.zoom });
  }
}

function _snapshotSelection() {
  const shapes = {};
  for (const id of state.selection) {
    const shape = findItem(id);
    if (shape) shapes[id] = { ...shape.style };
  }
  return { shapes, currentStyle: { ...state.currentStyle } };
}

function _restoreSnapshot(snap) {
  for (const [id, style] of Object.entries(snap.shapes)) {
    const shape = findItem(id);
    if (shape) {
      Object.assign(shape.style, style);
      const ot = getObjectType(shape.type);
      const el = getElement(id);
      if (ot && el) ot.syncElement(el, shape, { mode: state.activeMode, zoom: state.viewport.zoom });
    }
  }
}

function _el(tag, cls) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  return el;
}
