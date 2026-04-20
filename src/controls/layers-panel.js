/**
 * Layers panel — hierarchical layer/shape tree with drag-to-move.
 *
 * Panel selection (_panelSel) is independent of canvas selection (state.selection).
 * Shift-click adds/removes from _panelSel; footer bulk actions operate on _panelSel.
 * For shape rows, _panelSel and state.selection are kept in sync.
 */
import { state, effectiveVisible, effectiveLocked, nextId, sanitizeName } from '../core/state.js';
import { on, emit }    from '../core/events.js';
import { execute }     from '../core/history.js';
import { getIconSync } from '../core/icons.js';
import { render }      from '../render/renderer.js';

const INDENT_PX = 12; // px per depth level

let _panelBody   = null;
let _panelFooter = null;
let _version     = null;
let _panelSel    = new Set(); // 'layer:<id>' | 'shape:<id>'
let _anchor      = null;      // last non-shift click target key — range selection origin
let _drag        = null;      // active drag state
let _didDrag     = false;     // suppress click after completed drag
let _dropLineEl  = null;      // floating drop indicator element

// ── Init ──────────────────────────────────────────────────────────────────────

export function initLayersPanel(registerPanel) {
  registerPanel('layers', 'Layers', (contentEl) => {
    // Make content area a flex column so body scrolls and footer stays pinned
    contentEl.style.display        = 'flex';
    contentEl.style.flexDirection  = 'column';

    _panelBody   = _el('div', 'layers-panel');
    _panelFooter = _el('div', 'lp-footer');
    contentEl.appendChild(_panelBody);
    contentEl.appendChild(_panelFooter);
    _refresh();
  });

  on('render',           _refresh);
  on('selection-change', () => { _syncPanelSelFromCanvas(); _refresh(); });

  document.addEventListener('mousemove', _onDragMove);
  document.addEventListener('mouseup',   _onDragUp);
}

// ── Tree builder ──────────────────────────────────────────────────────────────

function _buildTree(layers) {
  const byId = {};
  for (const l of layers) byId[l.id] = { layer: l, children: [] };

  const roots = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    const l    = layers[i];
    const node = byId[l.id];
    const par  = l.parentId ? byId[l.parentId] : null;
    if (par) par.children.push(node);
    else     roots.push(node);
  }
  return roots;
}

// ── Refresh ───────────────────────────────────────────────────────────────────

function _versionKey() {
  return JSON.stringify([
    state.layers.map(l => [
      l.id, l.name, l.visible, l.locked, l.expanded, l.parentId ?? null,
      state.activeLayerId,
      l.shapes.map(s => [s.id, s.type, s._text?.slice(0, 20), s.name, state.selection.has(s.id), s.visible, s.locked]),
    ]),
    [..._panelSel].sort(),
  ]);
}

function _refresh() {
  const key = _versionKey();
  if (key === _version) return;
  _version = key;

  _panelBody.innerHTML = '';
  for (const node of _buildTree(state.layers)) {
    _panelBody.appendChild(_nodeEl(node, 0));
  }

  _rebuildFooter();
}

// ── Footer ────────────────────────────────────────────────────────────────────

function _rebuildFooter() {
  _panelFooter.innerHTML = '';

  const items     = _resolveSelected();
  const hasItems  = items.length > 0;

  // Vis state of selection: all visible → clicking hides; otherwise → clicking shows
  const allVis    = hasItems && items.every(it =>
    it.kind === 'layer' ? it.layer.visible !== false : it.shape.visible !== false);
  const visIcon   = allVis ? 'visible' : 'hidden';
  const visTitle  = allVis ? 'Hide selected' : 'Show selected';

  // Lock state: all locked → clicking unlocks; otherwise → clicking locks
  const allLocked = hasItems && items.every(it =>
    it.kind === 'layer' ? it.layer.locked : it.shape.locked);
  const lockIcon  = allLocked ? 'locked' : 'unlocked';
  const lockTitle = allLocked ? 'Unlock selected' : 'Lock selected';

  const addBtn   = _footerBtn('add',    'Add layer',       _addRootLayer);
  const trashBtn = _footerBtn('trash',  'Delete selected', _deleteSelected);
  const visBtn   = _footerBtn(visIcon,  visTitle,          _masterToggleVisible);
  const lockBtn  = _footerBtn(lockIcon, lockTitle,         _masterToggleLock);

  // data-drag-action allows mouseup during a drag to target these buttons
  trashBtn.dataset.dragAction = 'delete';
  // future: copyBtn.dataset.dragAction = 'copy';

  lockBtn.classList.add('lp-footer-btn--lock');
  if (allLocked) lockBtn.classList.add('lp-footer-btn--locked');

  trashBtn.disabled = !hasItems;
  visBtn.disabled   = !hasItems;
  lockBtn.disabled  = !hasItems;

  _panelFooter.append(addBtn, trashBtn, visBtn, lockBtn);
}

function _footerBtn(icon, title, handler) {
  const btn = _el('button', 'lp-footer-btn');
  btn.title = title;
  btn.appendChild(getIconSync('ui', icon));
  btn.addEventListener('click', handler);
  return btn;
}

// ── Render: layer node (recursive) ───────────────────────────────────────────

function _nodeEl(node, depth) {
  const { layer } = node;
  const wrap = _el('div', 'lp-node');
  wrap.dataset.layerId = layer.id;

  const header = _el('div', 'lp-layer');
  header.dataset.layerId = layer.id;
  header.style.paddingLeft = (depth * INDENT_PX + 4) + 'px';
  if (layer.id === state.activeLayerId)        header.classList.add('lp-layer--active');
  if (_panelSel.has('layer:' + layer.id))      header.classList.add('lp-layer--panel-selected');
  if (!effectiveVisible(layer))                header.classList.add('lp-layer--eff-hidden');
  if (effectiveLocked(layer) && !layer.locked) header.classList.add('lp-layer--eff-locked');

  const chevron = _el('button', 'lp-expand');
  chevron.appendChild(getIconSync('ui', 'chevron'));
  if (layer.expanded) chevron.classList.add('lp-expand--open');
  chevron.addEventListener('click', e => {
    e.stopPropagation();
    layer.expanded = !layer.expanded;
    _version = null;
    _refresh();
  });

  const nameEl = _el('span', 'lp-row__name');
  nameEl.textContent = layer.name;

  const actions = _el('span', 'lp-layer__actions');

  const addSubBtn = _el('button', 'lp-btn');
  addSubBtn.title = 'Add sub-layer';
  addSubBtn.appendChild(getIconSync('ui', 'add'));
  addSubBtn.addEventListener('click', e => { e.stopPropagation(); _addSubLayer(layer); });

  const visBtn = _el('button', 'lp-btn');
  visBtn.title = layer.visible ? 'Hide' : 'Show';
  visBtn.appendChild(getIconSync('ui', layer.visible ? 'visible' : 'hidden'));
  if (!layer.visible) visBtn.classList.add('lp-btn--is-hidden');
  visBtn.addEventListener('click', e => {
    e.stopPropagation();
    layer.visible = !layer.visible;
    _version = null;
    render();
  });

  const lockBtn = _el('button', 'lp-btn lp-btn--lock');
  lockBtn.title = layer.locked ? 'Unlock' : 'Lock';
  lockBtn.appendChild(getIconSync('ui', layer.locked ? 'locked' : 'unlocked'));
  if (layer.locked) lockBtn.classList.add('lp-btn--is-locked');
  lockBtn.addEventListener('click', e => {
    e.stopPropagation();
    layer.locked = !layer.locked;
    _version = null;
    _refresh();
  });

  actions.append(addSubBtn, visBtn, lockBtn);
  header.append(chevron, nameEl, actions);

  header.addEventListener('dblclick', e => {
    if (e.target.closest('button')) return;
    e.stopPropagation();
    _editLayerName(layer, nameEl);
  });

  header.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    const key = 'layer:' + layer.id;
    if (e.shiftKey) {
      _rangeSelect(key);
    } else if (e.metaKey || e.ctrlKey) {
      _toggleSel('layer', layer.id);
      _anchor = key;
    } else {
      _panelSel.clear();
      _panelSel.add(key);
      state.activeLayerId = layer.id;
      _anchor = key;
    }
    _refresh(); // versionKey diff drives rebuild — no forced invalidation
  });

  header.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest('button')) return;
    _startLayerDrag(e, layer, header, wrap);
  });

  wrap.appendChild(header);

  if (layer.expanded) {
    const body = _el('div', 'lp-body');

    for (let i = layer.shapes.length - 1; i >= 0; i--) {
      body.appendChild(_shapeEl(layer.shapes[i], layer, depth));
    }

    for (const child of node.children) {
      body.appendChild(_nodeEl(child, depth + 1));
    }

    if (layer.shapes.length === 0 && node.children.length === 0) {
      const empty = _el('div', 'lp-empty');
      empty.textContent = 'Empty layer';
      body.appendChild(empty);
    }

    wrap.appendChild(body);
  }

  return wrap;
}

// ── Render: shape row ─────────────────────────────────────────────────────────

function _shapeEl(shape, layer, layerDepth) {
  const row = _el('div', 'lp-shape');
  row.dataset.shapeId = shape.id;
  row.dataset.layerId = layer.id;
  row.style.paddingLeft = ((layerDepth + 1) * INDENT_PX + 20) + 'px';

  const panelSelected = _panelSel.has('shape:' + shape.id);
  if (panelSelected || state.selection.has(shape.id)) row.classList.add('lp-shape--selected');
  if (shape.visible === false)                         row.classList.add('lp-shape--hidden');

  const icon = _el('span', 'lp-shape__icon');
  icon.appendChild(getIconSync('objects', `object-${shape.type}`));

  const name = _el('span', 'lp-row__name');
  name.textContent = _shapeName(shape);

  const actions = _el('span', 'lp-layer__actions');

  const visBtn = _el('button', 'lp-btn');
  visBtn.title = shape.visible === false ? 'Show' : 'Hide';
  visBtn.appendChild(getIconSync('ui', shape.visible === false ? 'hidden' : 'visible'));
  if (shape.visible === false) visBtn.classList.add('lp-btn--is-hidden');
  visBtn.addEventListener('click', e => {
    e.stopPropagation();
    shape.visible = shape.visible === false ? true : false;
    _version = null;
    render();
  });

  const lockBtn = _el('button', 'lp-btn lp-btn--lock');
  lockBtn.title = shape.locked ? 'Unlock' : 'Lock';
  lockBtn.appendChild(getIconSync('ui', shape.locked ? 'locked' : 'unlocked'));
  if (shape.locked) lockBtn.classList.add('lp-btn--is-locked');
  lockBtn.addEventListener('click', e => {
    e.stopPropagation();
    shape.locked = !shape.locked;
    _version = null;
    _refresh();
  });

  actions.append(visBtn, lockBtn);
  row.append(icon, name, actions);

  row.addEventListener('dblclick', e => {
    if (e.target.closest('button')) return;
    e.stopPropagation();
    _editShapeName(shape, name);
  });

  row.addEventListener('click', e => {
    if (_didDrag) return;
    if (e.target.closest('button')) return;
    const key = 'shape:' + shape.id;
    if (e.shiftKey) {
      _rangeSelect(key);
      state.selection = _panelShapeSelection();
    } else if (e.metaKey || e.ctrlKey) {
      _toggleSel('shape', shape.id);
      _anchor = key;
      const sel = new Set(state.selection);
      sel.has(shape.id) ? sel.delete(shape.id) : sel.add(shape.id);
      state.selection = sel;
    } else {
      _panelSel.clear();
      _panelSel.add(key);
      _anchor = key;
      state.selection = new Set([shape.id]);
    }
    emit('selection-change');
    render();
  });

  row.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    _startShapeDrag(e, shape, layer, row);
  });

  return row;
}

function _shapeName(shape) {
  if (shape.name) return shape.name;
  if (shape.type === 'text-line' || shape.type === 'text-block') {
    if (shape._text?.trim()) return shape._text.slice(0, 28);
    return shape.type === 'text-line' ? 'Text' : 'Text Block';
  }
  const labels = { path: 'Path', rect: 'Rect', ellipse: 'Ellipse', group: 'Group' };
  return labels[shape.type] ?? shape.type;
}

// ── Panel selection helpers ───────────────────────────────────────────────────

function _toggleSel(kind, id) {
  const k = kind + ':' + id;
  _panelSel.has(k) ? _panelSel.delete(k) : _panelSel.add(k);
}

// Walk visible rows in DOM order and return their selection keys.
function _rowKeys() {
  const rows = _panelBody.querySelectorAll('.lp-layer[data-layer-id], .lp-shape[data-shape-id]');
  return [...rows].map(el =>
    el.classList.contains('lp-shape')
      ? 'shape:' + el.dataset.shapeId
      : 'layer:' + el.dataset.layerId
  );
}

// Select all rows between _anchor and targetKey (inclusive), replacing selection.
function _rangeSelect(targetKey) {
  const keys       = _rowKeys();
  const anchorIdx  = _anchor ? keys.indexOf(_anchor) : -1;
  const targetIdx  = keys.indexOf(targetKey);

  if (anchorIdx < 0 || targetIdx < 0) {
    _panelSel.clear();
    _panelSel.add(targetKey);
    return;
  }

  const from = Math.min(anchorIdx, targetIdx);
  const to   = Math.max(anchorIdx, targetIdx);
  _panelSel.clear();
  for (let i = from; i <= to; i++) _panelSel.add(keys[i]);
}

// Derive canvas selection from shape keys currently in _panelSel.
function _panelShapeSelection() {
  const ids = new Set();
  for (const k of _panelSel) {
    if (k.startsWith('shape:')) ids.add(k.slice(6));
  }
  return ids;
}

function _resolveSelected() {
  const items = [];
  for (const key of _panelSel) {
    const i    = key.indexOf(':');
    const kind = key.slice(0, i);
    const id   = key.slice(i + 1);
    if (kind === 'layer') {
      const layer = state.layers.find(l => l.id === id);
      if (layer) items.push({ kind: 'layer', layer });
    } else {
      for (const layer of state.layers) {
        const shape = layer.shapes.find(s => s.id === id);
        if (shape) { items.push({ kind: 'shape', shape, layer }); break; }
      }
    }
  }
  return items;
}

// When canvas selection changes externally, mirror it into _panelSel so footer
// actions operate on the same set the user sees highlighted in the panel.
function _syncPanelSelFromCanvas() {
  // Drop any stale shape keys, keep layer keys (they have no canvas equivalent).
  for (const k of _panelSel) {
    if (k.startsWith('shape:')) _panelSel.delete(k);
  }
  for (const id of state.selection) {
    _panelSel.add('shape:' + id);
  }
}

// ── Footer bulk actions ───────────────────────────────────────────────────────

function _deleteSelected() {
  const items = _resolveSelected();
  if (!items.length) return;

  // Collect layer IDs to delete, expanding to include all descendants
  const layerIds = new Set(
    items.filter(it => it.kind === 'layer').map(it => it.layer.id)
  );
  const addDescendants = id => {
    for (const l of state.layers) {
      if (l.parentId === id && !layerIds.has(l.id)) {
        layerIds.add(l.id);
        addDescendants(l.id);
      }
    }
  };
  for (const id of [...layerIds]) addDescendants(id);

  // Shapes to delete — only those not already in layers being deleted
  const shapeRemovals = items
    .filter(it => it.kind === 'shape' && !layerIds.has(it.layer.id))
    .map(it => ({ shape: it.shape, layer: it.layer }));

  // Snapshots for undo
  const oldLayers = [...state.layers];
  const oldShapes = new Map(state.layers.map(l => [l.id, [...l.shapes]]));
  const oldActive = state.activeLayerId;

  execute({
    do() {
      for (const { shape, layer } of shapeRemovals) {
        layer.shapes = layer.shapes.filter(s => s !== shape);
      }
      state.layers = state.layers.filter(l => !layerIds.has(l.id));
      if (layerIds.has(state.activeLayerId)) {
        state.activeLayerId = state.layers[state.layers.length - 1]?.id ?? null;
      }
      _panelSel.clear();
      _version = null;
      render();
    },
    undo() {
      state.layers = oldLayers;
      for (const [id, shapes] of oldShapes) {
        const l = state.layers.find(l => l.id === id);
        if (l) l.shapes = shapes;
      }
      state.activeLayerId = oldActive;
      _version = null;
      render();
    },
  });
}

function _masterToggleVisible() {
  const items = _resolveSelected();
  if (!items.length) return;

  const allVisible = items.every(it =>
    it.kind === 'layer' ? it.layer.visible !== false : it.shape.visible !== false);
  const target = !allVisible;

  const snaps = items.map(it => ({
    ...it, was: it.kind === 'layer' ? it.layer.visible : it.shape.visible,
  }));

  execute({
    do() {
      for (const it of items) {
        if (it.kind === 'layer') it.layer.visible = target;
        else it.shape.visible = target;
      }
      _version = null; render();
    },
    undo() {
      for (const s of snaps) {
        if (s.kind === 'layer') s.layer.visible = s.was;
        else s.shape.visible = s.was;
      }
      _version = null; render();
    },
  });
}

function _masterToggleLock() {
  const items = _resolveSelected();
  if (!items.length) return;

  const allLocked = items.every(it =>
    it.kind === 'layer' ? it.layer.locked : it.shape.locked);
  const target = !allLocked;

  const snaps = items.map(it => ({
    ...it, was: it.kind === 'layer' ? it.layer.locked : it.shape.locked,
  }));

  execute({
    do() {
      for (const it of items) {
        if (it.kind === 'layer') it.layer.locked = target;
        else it.shape.locked = target;
      }
      _version = null; render();
    },
    undo() {
      for (const s of snaps) {
        if (s.kind === 'layer') s.layer.locked = s.was;
        else s.shape.locked = s.was;
      }
      _version = null; render();
    },
  });
}

// ── Layer operations ──────────────────────────────────────────────────────────

function _addRootLayer() {
  const layer   = _makeLayer(`Layer ${state.layers.length + 1}`, null);
  const oldActive = state.activeLayerId;
  execute({
    do()   { state.layers.push(layer); state.activeLayerId = layer.id; render(); },
    undo() { state.layers = state.layers.filter(l => l.id !== layer.id); state.activeLayerId = oldActive; render(); },
  });
}

function _addSubLayer(parent) {
  const layer     = _makeLayer(`Layer ${state.layers.length + 1}`, parent.id);
  const wasExpanded = parent.expanded;
  const oldActive   = state.activeLayerId;
  execute({
    do() {
      state.layers.push(layer);
      state.activeLayerId = layer.id;
      parent.expanded = true;
      render();
    },
    undo() {
      state.layers = state.layers.filter(l => l.id !== layer.id);
      state.activeLayerId = oldActive;
      parent.expanded = wasExpanded;
      render();
    },
  });
}

function _makeLayer(name, parentId) {
  return { id: nextId('layer'), name, visible: true, locked: false, expanded: true, parentId: parentId ?? null, shapes: [] };
}

function _editLayerName(layer, nameEl) {
  const input = _el('input', 'lp-row__name lp-name-input');
  input.value = layer.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let cancelled = false;
  const commit = () => {
    if (cancelled) return;
    const val = sanitizeName(input.value);
    if (val) layer.name = val;
    _version = null;
    _refresh();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { cancelled = true; _version = null; _refresh(); }
    e.stopPropagation();
  });
}

function _editShapeName(shape, nameEl) {
  const input = _el('input', 'lp-row__name lp-name-input');
  input.value = shape.name ?? _shapeName(shape);
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let cancelled = false;
  const commit = () => {
    if (cancelled) return;
    const val = sanitizeName(input.value);
    // Clear name if the user empties it — fall back to auto-name
    shape.name = val || undefined;
    _version = null;
    _refresh();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { cancelled = true; _version = null; _refresh(); }
    e.stopPropagation();
  });
}

// ── Shape drag-and-drop ───────────────────────────────────────────────────────

function _startShapeDrag(e, shape, layer) {
  e.preventDefault();
  _drag = { type: 'shape', shape, fromLayer: layer, startX: e.clientX, startY: e.clientY, moved: false };
}

function _startLayerDrag(e, layer) {
  e.preventDefault();
  _drag = { type: 'layer', layer, startX: e.clientX, startY: e.clientY, moved: false };
}

function _onDragMove(e) {
  if (!_drag) return;
  const dx = e.clientX - _drag.startX;
  const dy = e.clientY - _drag.startY;
  if (!_drag.moved && dx * dx + dy * dy < 25) return;
  _drag.moved = true;
  _didDrag    = true;

  if (_drag.type === 'shape') _updateShapeDrop(e);
  else                        _updateLayerDrop(e);
}

function _onDragUp(e) {
  if (!_drag) return;
  const moved = _drag.moved;
  if (moved) {
    if (_drag.type === 'shape') _commitShapeDrop(e);
    else                        _commitLayerDrop(e);
  }
  _drag = null;
  _clearDrop();
  if (moved) setTimeout(() => { _didDrag = false; }, 0);
  else       _didDrag = false;
}

// ── Shape drop ────────────────────────────────────────────────────────────────

function _updateShapeDrop(e) {
  _clearDrop();
  const target = _findShapeDropTarget(e);
  if (!target) return;

  if (target.position === 'into') {
    target.headerEl.classList.add('lp-layer--drop');
  } else {
    _dropLineEl = _el('div', 'lp-drop-line');
    target.refEl.insertAdjacentElement(
      target.position === 'before' ? 'beforebegin' : 'afterend',
      _dropLineEl,
    );
  }
}

function _findShapeDropTarget(e) {
  const dragId    = _drag.shape.id;
  const panelRect = _panelBody.getBoundingClientRect();
  if (e.clientY < panelRect.top || e.clientY > panelRect.bottom) return null;

  const shapeRows    = [..._panelBody.querySelectorAll('.lp-shape')];
  const layerHeaders = [..._panelBody.querySelectorAll('.lp-layer')];

  // Direct hit: shape row
  for (const row of shapeRows) {
    if (row.dataset.shapeId === dragId) continue;
    const r = row.getBoundingClientRect();
    if (e.clientY >= r.top && e.clientY <= r.bottom) {
      return { position: e.clientY < r.top + r.height / 2 ? 'before' : 'after',
               refEl: row, targetLayerId: row.dataset.layerId, targetShapeId: row.dataset.shapeId };
    }
  }

  // Direct hit: layer header → drop into layer
  for (const header of layerHeaders) {
    const r = header.getBoundingClientRect();
    if (e.clientY >= r.top && e.clientY <= r.bottom) {
      return { position: 'into', headerEl: header,
               targetLayerId: header.closest('.lp-node')?.dataset.layerId };
    }
  }

  // Gap between rows: find the nearest shape row by proximity and snap to its edge.
  let best = null;
  let bestDist = Infinity;
  for (const row of shapeRows) {
    if (row.dataset.shapeId === dragId) continue;
    const r = row.getBoundingClientRect();
    if (r.bottom <= e.clientY) {
      const dist = e.clientY - r.bottom;
      if (dist < bestDist) {
        bestDist = dist;
        best = { position: 'after', refEl: row,
                 targetLayerId: row.dataset.layerId, targetShapeId: row.dataset.shapeId };
      }
    } else if (r.top >= e.clientY) {
      const dist = r.top - e.clientY;
      if (dist < bestDist) {
        bestDist = dist;
        best = { position: 'before', refEl: row,
                 targetLayerId: row.dataset.layerId, targetShapeId: row.dataset.shapeId };
      }
    }
  }
  return best;
}

function _commitShapeDrop(e) {
  const target = _findShapeDropTarget(e);
  if (!target?.targetLayerId) return;

  const { shape, fromLayer } = _drag;
  const toLayer = state.layers.find(l => l.id === target.targetLayerId);
  if (!toLayer) return;

  const fromSnap = [...fromLayer.shapes];
  const toSnap   = fromLayer === toLayer ? null : [...toLayer.shapes];

  const newFrom = fromLayer.shapes.filter(s => s !== shape);
  let   newTo;

  if (target.position === 'into') {
    newTo = fromLayer === toLayer
      ? [...newFrom, shape]
      : [...toLayer.shapes, shape];
  } else {
    const base        = fromLayer === toLayer ? newFrom : [...toLayer.shapes];
    const targetShape = base.find(s => s.id === target.targetShapeId);
    const idx         = base.indexOf(targetShape);
    if (idx < 0) return;
    const insertAt    = target.position === 'before' ? idx + 1 : idx;
    newTo             = [...base];
    newTo.splice(insertAt, 0, shape);
  }

  if (fromLayer === toLayer && arraysEqual(fromLayer.shapes, newTo)) return;

  execute({
    do() {
      fromLayer.shapes = fromLayer === toLayer ? newTo : newFrom;
      if (toSnap !== null) toLayer.shapes = newTo;
      _version = null;
      render();
    },
    undo() {
      fromLayer.shapes = fromSnap;
      if (toSnap !== null) toLayer.shapes = toSnap;
      _version = null;
      render();
    },
  });
}

// ── Layer drag-to-reorder ─────────────────────────────────────────────────────

function _updateLayerDrop(e) {
  _clearDrop();
  const target = _findLayerDropTarget(e);
  if (!target) return;
  _dropLineEl = _el('div', 'lp-drop-line');
  target.refEl.insertAdjacentElement(
    target.position === 'before' ? 'beforebegin' : 'afterend',
    _dropLineEl,
  );
}

function _findLayerDropTarget(e) {
  const dragId    = _drag.layer.id;
  const panelRect = _panelBody.getBoundingClientRect();
  if (e.clientY < panelRect.top || e.clientY > panelRect.bottom) return null;

  const headers = [..._panelBody.querySelectorAll('.lp-layer')];

  // Direct hit
  for (const header of headers) {
    const node = header.closest('.lp-node');
    if (!node || node.dataset.layerId === dragId) continue;
    const r = header.getBoundingClientRect();
    if (e.clientY >= r.top && e.clientY <= r.bottom) {
      return { position: e.clientY < r.top + r.height / 2 ? 'before' : 'after',
               refEl: header, targetLayerId: node.dataset.layerId };
    }
  }

  // Gap fallback: snap to nearest layer header edge
  let best = null;
  let bestDist = Infinity;
  for (const header of headers) {
    const node = header.closest('.lp-node');
    if (!node || node.dataset.layerId === dragId) continue;
    const r = header.getBoundingClientRect();
    if (r.bottom <= e.clientY) {
      const dist = e.clientY - r.bottom;
      if (dist < bestDist) {
        bestDist = dist;
        best = { position: 'after', refEl: header, targetLayerId: node.dataset.layerId };
      }
    } else if (r.top >= e.clientY) {
      const dist = r.top - e.clientY;
      if (dist < bestDist) {
        bestDist = dist;
        best = { position: 'before', refEl: header, targetLayerId: node.dataset.layerId };
      }
    }
  }
  return best;
}

function _commitLayerDrop(e) {
  const target = _findLayerDropTarget(e);
  if (!target?.targetLayerId) return;

  const { layer } = _drag;
  const targetLayer = state.layers.find(l => l.id === target.targetLayerId);
  if (!targetLayer || targetLayer === layer) return;

  const oldLayers = [...state.layers];

  const newLayers = state.layers.filter(l => l !== layer);
  const tIdx      = newLayers.indexOf(targetLayer);
  const insertAt  = target.position === 'before' ? tIdx + 1 : tIdx;
  newLayers.splice(insertAt, 0, layer);

  if (arraysEqual(state.layers, newLayers)) return;

  execute({
    do()   { state.layers = newLayers; _version = null; render(); },
    undo() { state.layers = oldLayers; _version = null; render(); },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _clearDrop() {
  _dropLineEl?.remove();
  _dropLineEl = null;
  _panelBody?.querySelectorAll('.lp-layer--drop').forEach(el => el.classList.remove('lp-layer--drop'));
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function _el(tag, cls) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  return el;
}
