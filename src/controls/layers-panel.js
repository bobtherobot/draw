/**
 * Layers panel — shows layers and shapes, allows visibility/lock toggle.
 */
import { state }    from '../core/state.js';
import { on, emit } from '../core/events.js';
import { execute }  from '../core/history.js';
import { getIconSync } from '../core/icons.js';
import { render }   from '../render/renderer.js';
import { nextId }   from '../core/state.js';

let _panelBody = null;
let _version   = null;

export function initLayersPanel(panelsEl) {
  const panel = _build(panelsEl);
  on('render',           () => _refresh());
  on('selection-change', () => _refresh());
}

function _build(panelsEl) {
  const panel = _el('div', 'panel');

  const header = _el('div', 'panel__header');
  const title  = _el('span', 'panel__title');
  title.textContent = 'Layers';

  const addBtn = _el('button', 'panel__action-btn');
  addBtn.title = 'Add layer';
  addBtn.appendChild(getIconSync('ui', 'add'));
  addBtn.addEventListener('click', () => {
    const layer = { id: nextId(), name: `Layer ${state.layers.length + 1}`, visible: true, locked: false, expanded: true, shapes: [] };
    execute({
      do()   { state.layers.push(layer); emit('render'); },
      undo() { state.layers = state.layers.filter(l => l.id !== layer.id); emit('render'); },
    });
  });

  header.append(title, addBtn);
  panel.appendChild(header);

  _panelBody = _el('div', 'panel__body');
  panel.appendChild(_panelBody);
  panelsEl.appendChild(panel);

  _refresh();
  return panel;
}

function _refresh() {
  const vKey = JSON.stringify(state.layers.map(l => [l.id, l.name, l.visible, l.locked, l.expanded, l.shapes.map(s => [s.id, s.type, state.selection.has(s.id)])]));
  if (vKey === _version) return;
  _version = vKey;

  _panelBody.innerHTML = '';

  for (let li = state.layers.length - 1; li >= 0; li--) {
    const layer = state.layers[li];
    _panelBody.appendChild(_layerEl(layer));
  }
}

function _layerEl(layer) {
  const wrap = _el('div', 'layers-panel__layer');

  const expand = _el('button', 'layers-panel__expand-btn');
  const expandIcon = getIconSync('ui', layer.expanded ? 'collapse' : 'expand');
  expand.appendChild(expandIcon);
  expand.addEventListener('click', () => { layer.expanded = !layer.expanded; _version = null; _refresh(); });

  const name = _el('span', 'layers-panel__layer-name');
  name.textContent = layer.name;
  name.addEventListener('dblclick', () => {
    const input = document.createElement('input');
    input.value = layer.name;
    input.className = 'layers-panel__layer-name';
    name.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => { layer.name = input.value || layer.name; _version = null; _refresh(); };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { commit(); e.preventDefault(); } });
  });

  const vis = _el('button', 'layers-panel__visibility-btn');
  vis.appendChild(getIconSync('ui', layer.visible ? 'visible' : 'hidden'));
  vis.classList.toggle('active', !layer.visible);
  vis.addEventListener('click', () => { layer.visible = !layer.visible; _version = null; render(); _refresh(); });

  const lock = _el('button', 'layers-panel__lock-btn');
  lock.appendChild(getIconSync('ui', layer.locked ? 'locked' : 'unlocked'));
  lock.classList.toggle('active', layer.locked);
  lock.addEventListener('click', () => { layer.locked = !layer.locked; _version = null; _refresh(); });

  wrap.append(expand, name, vis, lock);

  if (layer.expanded && layer.shapes.length > 0) {
    const shapeList = _el('div', 'layers-panel__shapes');
    for (let si = layer.shapes.length - 1; si >= 0; si--) {
      shapeList.appendChild(_shapeEl(layer.shapes[si]));
    }
    wrap.appendChild(shapeList);
  } else if (layer.expanded) {
    const empty = _el('div', 'layers-panel__empty');
    empty.textContent = 'Empty layer';
    wrap.appendChild(empty);
  }

  return wrap;
}

function _shapeEl(shape) {
  const row  = _el('div', 'layers-panel__shape');
  row.classList.toggle('selected', state.selection.has(shape.id));

  const icon = _el('span', 'layers-panel__shape-icon');
  icon.appendChild(getIconSync('objects', `object-${shape.type}`));

  const name = _el('span', 'layers-panel__shape-name');
  name.textContent = shape.type === 'text-line' || shape.type === 'text-block'
    ? (shape._text ? shape._text.slice(0, 20) : 'Text')
    : shape.type;

  row.append(icon, name);
  row.addEventListener('click', (e) => {
    if (e.shiftKey) {
      const sel = new Set(state.selection);
      if (sel.has(shape.id)) sel.delete(shape.id); else sel.add(shape.id);
      state.selection = sel;
    } else {
      state.selection = new Set([shape.id]);
    }
    render();
  });

  return row;
}

function _el(tag, cls) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  return el;
}
