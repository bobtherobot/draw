/**
 * Style panel — fill, stroke, stroke-width controls.
 * Reflects state.currentStyle and applies to selection.
 */
import { state, findShape } from '../core/state.js';
import { on, emit }   from '../core/events.js';
import { execute }    from '../core/history.js';
import { render } from '../render/renderer.js';
import { createColorMemory, NONE } from '../utils/color-memory.js';

let _pickerSnapshot = null; // style snapshot at color-picker open

// Last real colour per property, so `none` is always recoverable.
const _colorMemory = createColorMemory({ fill: '#000000', stroke: '#000000' });

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
  noneBtn.title = `Toggle ${label} between none and the last colour`;

  input.addEventListener('focus', () => {
    _pickerSnapshot = _snapshotSelection();
  });
  input.addEventListener('input', (e) => {
    _applyLive(prop, e.target.value);
  });
  input.addEventListener('change', () => {
    _commitColor(prop, _pickerSnapshot);
    // Re-arm rather than clear: the input keeps focus after the picker closes,
    // so a second picker session fires `change` with no intervening `focus`.
    // The just-committed colour is the correct baseline for undoing it.
    _pickerSnapshot = _snapshotSelection();
  });
  // Toggle, not a one-way switch: this is the deterministic way back from
  // `none`, independent of whether the native picker emits a change event.
  noneBtn.addEventListener('click', () => {
    const snap = _snapshotSelection();
    _commitColor(prop, snap, _colorMemory.toggle(prop, _getDisplayStyle()[prop]));
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
  const stroke = s.stroke ?? NONE;
  const sw     = s.strokeWidth ?? 1;

  _colorMemory.remember('fill', fill);
  _colorMemory.remember('stroke', stroke);

  // Seed the picker with the last real colour rather than a hardcoded black:
  // re-picking the seeded value is a native no-op that emits no event, so the
  // seed must never be a colour the user is likely to want back.
  fillInput.value   = fill   === NONE ? _colorMemory.recall('fill')   : fill;
  strokeInput.value = stroke === NONE ? _colorMemory.recall('stroke') : stroke;
  weightInput.value = sw;

  fillSwatch.style.background   = fill   === NONE ? '' : fill;
  strokeSwatch.style.background = stroke === NONE ? '' : stroke;
  fillSwatch.classList.toggle('none',   fill   === NONE);
  strokeSwatch.classList.toggle('none', stroke === NONE);
  nFill.classList.toggle('active',   fill   === NONE);
  nStroke.classList.toggle('active', stroke === NONE);
}

function _getDisplayStyle() {
  for (const id of state.selection) {
    const shape = findShape(id);
    if (shape?.style) return shape.style;
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
  // A picker session should always have armed a snapshot; fall back to the
  // live style so an unexpected null degrades to a no-op undo, not a throw.
  const snap = snapshot ?? _snapshotSelection();
  execute({
    do()   { _applyStyle(prop, val); state.currentStyle[prop] = val; render(); },
    undo() { _restoreSnapshot(snap); state.currentStyle[prop] = snap.currentStyle[prop]; render(); },
  });
}

function _applyStyle(prop, value) {
  for (const id of state.selection) {
    const shape = findShape(id);
    if (!shape) continue;
    shape.style[prop] = value;
  }
}

function _snapshotSelection() {
  const shapes = {};
  for (const id of state.selection) {
    const shape = findShape(id);
    if (shape) shapes[id] = { ...shape.style };
  }
  return { shapes, currentStyle: { ...state.currentStyle } };
}

function _restoreSnapshot(snap) {
  if (!snap?.shapes) return;
  for (const [id, style] of Object.entries(snap.shapes)) {
    const shape = findShape(id);
    if (shape) {
      Object.assign(shape.style, style);
    }
  }
}

function _el(tag, cls) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  return el;
}
