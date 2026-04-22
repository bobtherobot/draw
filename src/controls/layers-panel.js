/**
 * Layers panel — unified tree of all items (groups and display types).
 *
 * Panel selection (_panelSel) is independent of canvas selection (state.selection).
 * Shift-click adds/removes from _panelSel; footer bulk actions operate on _panelSel.
 * For display-item rows, _panelSel and state.selection are kept in sync.
 */
import { state, effectiveVisible, effectiveLocked, allDisplayItems, nextId, sanitizeName, findItem, sanitizeItems } from '../core/state.js';
import { on, emit }    from '../core/events.js';

import { registerZone, getZone } from '../core/focus.js';
import { execute }     from '../core/history.js';
import { getIconSync } from '../core/icons.js';
import { render }      from '../render/renderer.js';

const INDENT_PX = 12;

let _panelBody      = null;
let _panelFooter    = null;
let _version        = null;
let _panelSel       = new Set(); // 'item:<id>'
let _anchor         = null;
let _drag           = null;
let _didDrag        = false;
let _dropLineEl     = null;
let _hoverShapeId   = null;

// ── Init ──────────────────────────────────────────────────────────────────────

export function initLayersPanel(registerPanel) {
  registerPanel('layers', 'Layers', (contentEl) => {
    contentEl.style.display       = 'flex';
    contentEl.style.flexDirection = 'column';

    registerZone(contentEl, 'layers');

    _panelBody   = _el('div', 'layers-panel');
    _panelFooter = _el('div', 'lp-footer');
    contentEl.appendChild(_panelBody);
    contentEl.appendChild(_panelFooter);
    _refresh();
  });

  on('render',           _refresh);
  on('selection-change', () => { if (getZone() !== 'layers') _onCanvasSelChange(); _refresh(); });
  on('zone-change',      zone => { if (zone !== 'layers') { _onCanvasSelChange(); _refresh(); } });
  on('layers-delete',    _deleteSelected);
  on('layers-escape',    () => { _onCanvasSelChange(); _refresh(); });
  on('hover-change',     _updateHoverRow);

  document.addEventListener('mousemove', _onDragMove);
  document.addEventListener('mouseup',   _onDragUp);
}

// ── Tree builder ──────────────────────────────────────────────────────────────

function _buildTree(items) {
  const byId = {};
  for (const item of items) byId[item.id] = { item, children: [] };

  const roots = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    const node = byId[item.id];
    if (item.parentId && byId[item.parentId]) {
      byId[item.parentId].children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// ── Refresh ───────────────────────────────────────────────────────────────────

function _versionKey() {
  return JSON.stringify([
    state.items.map(i => [
      i.id, i.type, i.name, i.visible, i.locked, i.expanded, i.parentId ?? null,
      state.activeItemId, state.selection.has(i.id), (i._text ?? '').slice(0, 20),
    ]),
    [..._panelSel].sort(),
  ]);
}

function _refresh() {
  if (!_panelBody) return;
  const key = _versionKey();
  if (key === _version) return;
  _version = key;

  _panelBody.innerHTML = '';
  for (const node of _buildTree(state.items)) {
    _panelBody.appendChild(_itemEl(node, 0));
  }
  _rebuildFooter();
  _updateHoverRow(_hoverShapeId);
}

// ── Hover highlight (canvas → panel) ─────────────────────────────────────────

function _updateHoverRow(shapeId) {
  _hoverShapeId = shapeId ?? null;
  if (!_panelBody) return;
  for (const el of _panelBody.querySelectorAll('.lp-shape--hover'))
    el.classList.remove('lp-shape--hover');
  if (shapeId) {
    _panelBody.querySelector(`.lp-shape[data-item-id="${shapeId}"]`)
      ?.classList.add('lp-shape--hover');
  }
}

// ── Footer ────────────────────────────────────────────────────────────────────

function _rebuildFooter() {
  _panelFooter.innerHTML = '';

  const selected  = _resolveSelected();
  const hasItems  = selected.length > 0;

  const allVis    = hasItems && selected.every(it => it.visible !== false);
  const allLocked = hasItems && selected.every(it => it.locked);

  const addBtn   = _footerBtn('add',                       'Add layer',       _addRootItem);
  const copyBtn  = _footerBtn('copy',                      'Duplicate selected', _copySelected);
  const trashBtn = _footerBtn('trash',                     'Delete selected', _deleteSelected);
  const visBtn   = _footerBtn(allVis ? 'visible' : 'hidden', allVis ? 'Hide selected' : 'Show selected', _masterToggleVisible);
  const lockBtn  = _footerBtn(allLocked ? 'locked' : 'unlocked', allLocked ? 'Unlock selected' : 'Lock selected', _masterToggleLock);

  trashBtn.dataset.dragAction = 'delete';
  lockBtn.classList.add('lp-footer-btn--lock');
  if (allLocked) lockBtn.classList.add('lp-footer-btn--locked');

  copyBtn.disabled  = !hasItems;
  trashBtn.disabled = !hasItems;
  visBtn.disabled   = !hasItems;
  lockBtn.disabled  = !hasItems;

  _panelFooter.append(addBtn, copyBtn, trashBtn, visBtn, lockBtn);
}

function _footerBtn(icon, title, handler) {
  const btn = _el('button', 'lp-footer-btn');
  btn.title = title;
  btn.appendChild(getIconSync('ui', icon));
  btn.addEventListener('click', handler);
  return btn;
}

// ── Render: unified item row ──────────────────────────────────────────────────

function _itemEl(node, depth) {
  const { item, children } = node;
  const isArtboard  = item.type === 'artboard';
  const isGroup     = item.type === 'group' || isArtboard;
  const hasChildren = children.length > 0;

  const wrap = _el('div', 'lp-node');
  wrap.dataset.itemId = item.id;

  const row = _el('div', isGroup ? 'lp-layer' : 'lp-shape');
  row.dataset.itemId  = item.id;
  row.style.paddingLeft = (depth * INDENT_PX + (isGroup ? 4 : 20)) + 'px';

  if (isGroup && item.id === state.activeItemId)    row.classList.add('lp-layer--active');
  if (isArtboard)                                   row.classList.add('lp-layer--artboard');
  if (isGroup && _panelSel.has('item:' + item.id))  row.classList.add('lp-layer--panel-selected');
  if (isGroup && effectiveLocked(item) && !item.locked) row.classList.add('lp-layer--eff-locked');
  if (!isGroup && _panelSel.has('item:' + item.id)) row.classList.add('lp-shape--selected');

  // Expand chevron
  if (isGroup || hasChildren) {
    const chevron = _el('button', 'lp-expand');
    chevron.appendChild(getIconSync('ui', 'chevron'));
    if (item.expanded) chevron.classList.add('lp-expand--open');
    chevron.addEventListener('click', e => {
      e.stopPropagation();
      item.expanded = !item.expanded;
      _version = null;
      _refresh();
    });
    row.appendChild(chevron);
  }

  // Icon: artboard and display items get type icons; plain groups do not
  if (!isGroup || isArtboard) {
    const icon = _el('span', 'lp-shape__icon');
    icon.appendChild(getIconSync('objects', `object-${item.type}`));
    row.appendChild(icon);
  }

  // Name
  const nameEl = _el('span', 'lp-row__name');
  nameEl.textContent = _itemName(item);
  if (isGroup) nameEl.style.fontWeight = '500';
  row.appendChild(nameEl);

  // Actions
  const actions = _el('span', 'lp-layer__actions');

  if (item.type === 'group') {
    const addSubBtn = _el('button', 'lp-btn');
    addSubBtn.title = 'Add sub-layer';
    addSubBtn.appendChild(getIconSync('ui', 'add'));
    addSubBtn.addEventListener('click', e => { e.stopPropagation(); _addSubItem(item); });
    actions.appendChild(addSubBtn);
  }
  if (isArtboard) {
    const addLayerBtn = _el('button', 'lp-btn');
    addLayerBtn.title = 'Add layer';
    addLayerBtn.appendChild(getIconSync('ui', 'add'));
    addLayerBtn.addEventListener('click', e => { e.stopPropagation(); _addSubItem(item); });
    actions.appendChild(addLayerBtn);
  }

  const isHidden = item.visible === false;
  const visBtn = _el('button', 'lp-btn');
  visBtn.title = isHidden ? 'Show' : 'Hide';
  visBtn.appendChild(getIconSync('ui', isHidden ? 'hidden' : 'visible'));
  if (isHidden) visBtn.classList.add('lp-btn--is-hidden');
  visBtn.addEventListener('click', e => {
    e.stopPropagation();
    item.visible = item.visible === false; // false→true, true/undefined→false
    _version = null;
    render();
  });

  const lockBtn = _el('button', 'lp-btn lp-btn--lock');
  lockBtn.title = item.locked ? 'Unlock' : 'Lock';
  lockBtn.appendChild(getIconSync('ui', item.locked ? 'locked' : 'unlocked'));
  if (item.locked) lockBtn.classList.add('lp-btn--is-locked');
  lockBtn.addEventListener('click', e => {
    e.stopPropagation();
    item.locked = !item.locked;
    _deselectLocked();
    _version = null;
    render();
  });

  const dot = _el('button', 'lp-dot');
  dot.title = 'Select on canvas';
  dot.appendChild(getIconSync('ui', 'dot'));
  if (_hasSelectedDescendant(item)) dot.classList.add('lp-dot--active');
  dot.addEventListener('click', e => {
    e.stopPropagation();
    const ids = isGroup ? _displayDescendants(item) : [item.id];
    const sel = new Set(state.selection);
    const allSelected = ids.length > 0 && ids.every(id => sel.has(id));
    if (allSelected) {
      for (const id of ids) sel.delete(id);
    } else {
      for (const id of ids) sel.add(id);
    }
    state.selection = sel;
    emit('selection-change');
    render();
  });

  actions.append(visBtn, lockBtn, dot);
  row.appendChild(actions);

  row.addEventListener('dblclick', e => {
    if (e.target.closest('button')) return;
    e.stopPropagation();
    _editItemName(item, nameEl);
  });

  row.addEventListener('click', e => {
    if (_didDrag) return;
    if (e.target.closest('button')) return;
    const key = 'item:' + item.id;
    if (e.shiftKey) {
      _rangeSelect(key);
    } else if (e.metaKey || e.ctrlKey) {
      _toggleSel(item.id);
      _anchor = key;
    } else {
      _panelSel.clear();
      _panelSel.add(key);
      _anchor = key;
      if (isGroup) state.activeItemId = item.id;
    }
    render();
  });

  row.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest('button') || e.target.closest('input')) return;
    _startDrag(e, item, row, wrap);
  });

  wrap.appendChild(row);

  // Children
  if ((isGroup || hasChildren) && item.expanded !== false) {
    const body = _el('div', 'lp-body');

    for (const child of children) {
      body.appendChild(_itemEl(child, depth + 1));
    }

    if (children.length === 0 && isGroup) {
      const empty = _el('div', 'lp-empty');
      empty.textContent = 'Empty layer';
      body.appendChild(empty);
    }

    wrap.appendChild(body);
  }

  return wrap;
}

function _itemName(item) {
  if (item.name) return item.name;
  if (item.type === 'free-text' || item.type === 'text-block') {
    if (item._text?.trim()) return item._text.slice(0, 28);
    return item.type === 'free-text' ? 'Free Text' : 'Text Block';
  }
  return { path: 'Path', group: 'Group', artboard: 'Artboard' }[item.type] ?? item.type;
}

function _hasSelectedDescendant(item) {
  if (state.selection.has(item.id)) return true;
  for (const child of state.items) {
    if (child.parentId === item.id && _hasSelectedDescendant(child)) return true;
  }
  return false;
}

// ── Panel selection helpers ───────────────────────────────────────────────────

function _toggleSel(id) {
  const k = 'item:' + id;
  _panelSel.has(k) ? _panelSel.delete(k) : _panelSel.add(k);
}

function _rowKeys() {
  return [..._panelBody.querySelectorAll('.lp-layer[data-item-id], .lp-shape[data-item-id]')]
    .map(el => 'item:' + el.dataset.itemId);
}

function _rangeSelect(targetKey) {
  const keys      = _rowKeys();
  const anchorIdx = _anchor ? keys.indexOf(_anchor) : -1;
  const targetIdx = keys.indexOf(targetKey);

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

function _panelDisplaySelection() {
  const ids = new Set();
  for (const k of _panelSel) {
    if (k.startsWith('item:')) {
      const id   = k.slice(5);
      const item = findItem(id);
      if (item && item.type !== 'group' && item.type !== 'artboard') ids.add(id);
    }
  }
  return ids;
}

function _resolveSelected() {
  const result = [];
  for (const k of _panelSel) {
    if (k.startsWith('item:')) {
      const item = findItem(k.slice(5));
      if (item) result.push(item);
    }
  }
  return result;
}

function _onCanvasSelChange() {
  _panelSel.clear();
  if (state.activeItemId) _panelSel.add('item:' + state.activeItemId);
  _version = null;
}

function _displayDescendants(item) {
  const result = [];
  for (const child of state.items) {
    if (child.parentId !== item.id) continue;
    if (child.type !== 'group' && child.type !== 'artboard') result.push(child.id);
    else result.push(..._displayDescendants(child));
  }
  return result;
}

// ── Footer bulk actions ───────────────────────────────────────────────────────

function _deleteSelected() {
  const items = _resolveSelected().filter(i => i.type !== 'artboard');
  if (!items.length) return;

  const toDelete = new Set(items.map(i => i.id));
  const addDesc  = id => {
    for (const item of state.items) {
      if (item.parentId === id && !toDelete.has(item.id)) {
        toDelete.add(item.id);
        addDesc(item.id);
      }
    }
  };
  for (const id of [...toDelete]) addDesc(id);

  const oldItems  = [...state.items];
  const oldActive = state.activeItemId;

  execute({
    do() {
      state.items = state.items.filter(i => !toDelete.has(i.id));
      sanitizeItems(state.items);
      if (toDelete.has(state.activeItemId)) {
        state.activeItemId = state.items.find(i => i.parentId === null && i.type === 'group')?.id
          ?? state.items[0]?.id;
      }
      _panelSel.clear();
      _version = null;
      render();
    },
    undo() {
      state.items        = oldItems;
      state.activeItemId = oldActive;
      _version = null;
      render();
    },
  });
}

function _masterToggleVisible() {
  const items = _resolveSelected();
  if (!items.length) return;

  const allVis = items.every(it => it.visible !== false);
  const target = !allVis;
  const snaps  = items.map(it => ({ it, was: it.visible }));

  execute({
    do()   { for (const { it } of snaps) it.visible = target;   _version = null; render(); },
    undo() { for (const { it, was } of snaps) it.visible = was; _version = null; render(); },
  });
}

function _deselectLocked() {
  const sel = new Set(state.selection);
  for (const shape of allDisplayItems()) {
    if (sel.has(shape.id) && effectiveLocked(shape)) sel.delete(shape.id);
  }
  state.selection = sel;
}

function _masterToggleLock() {
  const items = _resolveSelected();
  if (!items.length) return;

  const allLocked = items.every(it => it.locked);
  const target    = !allLocked;
  const snaps     = items.map(it => ({ it, was: it.locked }));

  execute({
    do()   { for (const { it } of snaps) it.locked = target;   _deselectLocked(); _version = null; render(); },
    undo() { for (const { it, was } of snaps) it.locked = was; _deselectLocked(); _version = null; render(); },
  });
}

function _copySelected() {
  const items = _resolveSelected();
  if (!items.length) return;

  // Exclude items whose ancestor is also selected — they'll be cloned as part of that ancestor
  const selectedIds = new Set(items.map(i => i.id));
  const roots = items.filter(i => !i.parentId || !selectedIds.has(i.parentId));

  const newItems = [];
  const idMap    = {};

  const cloneSubtree = (item, newParentId, isRoot) => {
    const newId    = nextId(item.type);
    idMap[item.id] = newId;
    const copy     = {
      ...item,
      id:       newId,
      parentId: newParentId,
      name:     isRoot ? _copyName(item, newItems) : item.name,
      attrs:    item.attrs ? { ...item.attrs } : undefined,
      style:    item.style ? { ...item.style } : undefined,
    };
    newItems.push(copy);
    for (const child of state.items.filter(i => i.parentId === item.id)) {
      cloneSubtree(child, newId, false);
    }
  };

  for (const root of roots) cloneSubtree(root, root.parentId, true);

  const insertAfterId = items[items.length - 1].id;
  const newItemIds    = new Set(newItems.map(i => i.id));
  const oldSel        = new Set(_panelSel);

  execute({
    do() {
      const pos  = state.items.findIndex(i => i.id === insertAfterId);
      const at   = pos >= 0 ? pos + 1 : state.items.length;
      state.items = [
        ...state.items.slice(0, at),
        ...newItems,
        ...state.items.slice(at),
      ];
      _panelSel = new Set(
        newItems.filter(i => !idMap[i.parentId]).map(i => 'item:' + i.id),
      );
      state.selection = _panelDisplaySelection();
      _version = null; render();
    },
    undo() {
      state.items     = state.items.filter(i => !newItemIds.has(i.id));
      _panelSel       = oldSel;
      state.selection = _panelDisplaySelection();
      _version = null; render();
    },
  });
}

function _copyName(item, pendingItems = []) {
  const base     = item.name ?? _itemName(item);
  const stripped = base.replace(/ copy \d+$/, '');
  const allItems = [...state.items, ...pendingItems];
  let n = 1;
  while (allItems.some(i => i.id !== item.id && (i.name ?? _itemName(i)) === `${stripped} copy ${n}`)) n++;
  return `${stripped} copy ${n}`;
}

// ── Item operations ───────────────────────────────────────────────────────────

function _addRootItem() {
  // Add a layer inside the first artboard; root-level groups have no artboard parent
  const artboard  = state.items.find(i => i.type === 'artboard');
  const parentId  = artboard?.id ?? null;
  const item      = _makeGroup(`Layer ${state.items.filter(i => i.type === 'group').length + 1}`, parentId);
  const oldActive = state.activeItemId;
  const wasExpanded = artboard?.expanded;
  execute({
    do() {
      state.items.push(item);
      state.activeItemId = item.id;
      if (artboard) artboard.expanded = true;
      render();
    },
    undo() {
      state.items = state.items.filter(i => i.id !== item.id);
      state.activeItemId = oldActive;
      if (artboard) artboard.expanded = wasExpanded;
      render();
    },
  });
}

function _addSubItem(parent) {
  const item        = _makeGroup(`Layer ${state.items.filter(i => i.type === 'group').length + 1}`, parent.id);
  const wasExpanded = parent.expanded;
  const oldActive   = state.activeItemId;
  execute({
    do() {
      state.items.push(item);
      state.activeItemId = item.id;
      parent.expanded    = true;
      render();
    },
    undo() {
      state.items        = state.items.filter(i => i.id !== item.id);
      state.activeItemId = oldActive;
      parent.expanded    = wasExpanded;
      render();
    },
  });
}

function _makeGroup(name, parentId) {
  return { id: nextId('item'), type: 'group', name, visible: true, locked: false, expanded: true, parentId: parentId ?? null };
}

function _editItemName(item, nameEl) {
  const input = _el('input', 'lp-row__name lp-name-input');
  input.value = item.name ?? _itemName(item);
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let cancelled = false;
  const commit  = () => {
    if (cancelled) return;
    const val = sanitizeName(input.value);
    if (item.type === 'group') {
      if (val) item.name = val;
    } else {
      item.name = val || undefined;
    }
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

// ── Drag constants ────────────────────────────────────────────────────────────

const _SCROLL_BUMPER = 25;
const _SCROLL_SPEED  = 5;

// ── Drag start ────────────────────────────────────────────────────────────────

function _startDrag(e, item, rowEl, nodeEl) {
  if (state.operation !== null) return; // canvas operation in progress
  e.preventDefault();
  _drag = {
    item, rowEl, hideEl: nodeEl,
    startX: e.clientX, startY: e.clientY,
    grabOffsetY: 0, itemHeight: 0, ghost: null,
    moved: false, _lastE: null,
    autoScrollDir: 0, autoScrollRaf: null,
  };
}

// ── Drag move / up ────────────────────────────────────────────────────────────

function _onDragMove(e) {
  if (!_drag) return;
  const dx = e.clientX - _drag.startX;
  const dy = e.clientY - _drag.startY;

  if (!_drag.moved) {
    if (dx * dx + dy * dy < 25) return;
    _drag.moved = true;
    _didDrag    = true;
    _activateDrag(e);
  }

  _drag._lastE = e;
  _updateGhostPosition(e);
  _updateDropIndicator(e);
  _updateAutoScroll(e);
}

function _onDragUp(e) {
  if (!_drag) return;
  const moved = _drag.moved;

  if (moved) {
    const footerEl = e.target.closest('[data-drag-action]');
    if (footerEl?.dataset.dragAction === 'delete') {
      _deleteDraggedItem();
    } else {
      _commitDrop(e);
    }
  }

  _cleanupDrag();
  if (moved) setTimeout(() => { _didDrag = false; }, 0);
  else       _didDrag = false;
}

// ── Ghost ─────────────────────────────────────────────────────────────────────

function _activateDrag(e) {
  const r           = _drag.rowEl.getBoundingClientRect();
  _drag.grabOffsetY = e.clientY - r.top;
  _drag.itemHeight  = r.height;

  const ghost         = _drag.rowEl.cloneNode(true);
  ghost.classList.add('lp-drag-ghost');
  ghost.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;pointer-events:none;z-index:9999;`;
  document.body.appendChild(ghost);
  _drag.ghost = ghost;

  _drag.hideEl.style.display = 'none';
}

function _updateGhostPosition(e) {
  if (_drag.ghost) _drag.ghost.style.top = (e.clientY - _drag.grabOffsetY) + 'px';
}

function _cleanupDrag() {
  if (!_drag) return;
  _drag.ghost?.remove();
  if (_drag.hideEl) _drag.hideEl.style.display = '';
  if (_drag.autoScrollRaf) cancelAnimationFrame(_drag.autoScrollRaf);
  _drag = null;
  _clearDrop();
}

// ── Needle / insertion point ──────────────────────────────────────────────────

function _calcNeedleY(e) {
  return e.clientY - _drag.grabOffsetY + _drag.itemHeight / 2;
}

function _calcInsertionPoint(e) {
  const needleY = _calcNeedleY(e);
  const rows    = [..._panelBody.querySelectorAll('.lp-layer[data-item-id], .lp-shape[data-item-id]')]
    .filter(el => !_drag.hideEl.contains(el) && el.style.display !== 'none');

  if (!rows.length) return null;

  for (const row of rows) {
    const r       = row.getBoundingClientRect();
    const isGroup = row.classList.contains('lp-layer');

    if (isGroup) {
      if (needleY < r.top + r.height * 0.25)
        return { position: 'before', refEl: row, targetItemId: row.dataset.itemId };
      if (needleY < r.top + r.height * 0.75)
        return { position: 'into',   refEl: row, targetItemId: row.dataset.itemId };
    } else {
      if (needleY < r.top + r.height / 2)
        return { position: 'before', refEl: row, targetItemId: row.dataset.itemId };
    }
  }
  const last = rows[rows.length - 1];
  return { position: 'after', refEl: last, targetItemId: last.dataset.itemId };
}

// ── Drop indicator ────────────────────────────────────────────────────────────

function _updateDropIndicator(e) {
  _clearDrop();
  if (!_drag.ghost) return;
  const target = _calcInsertionPoint(e);
  if (!target?.refEl) return;

  if (target.position === 'into') {
    target.refEl.classList.add('lp-layer--drop');
  } else {
    _dropLineEl = _el('div', 'lp-drop-line');
    target.refEl.insertAdjacentElement(
      target.position === 'before' ? 'beforebegin' : 'afterend',
      _dropLineEl,
    );
  }
}

// ── Auto-scroll ───────────────────────────────────────────────────────────────

function _updateAutoScroll(e) {
  const pr  = _panelBody.getBoundingClientRect();
  let   dir = 0;
  if (e.clientY < pr.top + _SCROLL_BUMPER)         dir = -1;
  else if (e.clientY > pr.bottom - _SCROLL_BUMPER) dir =  1;

  if (dir !== _drag.autoScrollDir) {
    _drag.autoScrollDir = dir;
    if (dir !== 0 && _drag.autoScrollRaf === null) _runAutoScroll();
  }
}

function _runAutoScroll() {
  if (!_drag || _drag.autoScrollDir === 0) { if (_drag) _drag.autoScrollRaf = null; return; }
  _panelBody.scrollTop += _drag.autoScrollDir * _SCROLL_SPEED;
  if (_drag._lastE) _updateDropIndicator(_drag._lastE);
  _drag.autoScrollRaf = requestAnimationFrame(_runAutoScroll);
}

// ── Drop commit ───────────────────────────────────────────────────────────────

function _commitDrop(e) {
  const target = _calcInsertionPoint(e);
  if (!target?.targetItemId) return;

  const { item }   = _drag;
  const targetItem = findItem(target.targetItemId);
  if (!targetItem || targetItem.id === item.id) return;

  if (target.position === 'into' && _isDescendant(targetItem, item)) return;

  const oldItems    = [...state.items];
  const oldParentId = item.parentId;
  const oldExpanded = targetItem.expanded;

  const subtree  = _collectSubtree(item);
  const newItems = state.items.filter(i => !subtree.includes(i));

  let newParentId, insertAt;
  if (target.position === 'into') {
    newParentId = targetItem.id;
    insertAt    = newItems.indexOf(targetItem) + 1;
  } else {
    newParentId = targetItem.parentId ?? null;
    const tIdx  = newItems.indexOf(targetItem);
    insertAt    = target.position === 'before' ? tIdx + 1 : tIdx;
  }
  newItems.splice(insertAt, 0, ...subtree);

  if (_arraysEqual(state.items, newItems) && item.parentId === newParentId) return;

  execute({
    do() {
      state.items   = newItems;
      item.parentId = newParentId;
      if (target.position === 'into') targetItem.expanded = true;
      _version = null; render();
    },
    undo() {
      state.items   = oldItems;
      item.parentId = oldParentId;
      if (target.position === 'into') targetItem.expanded = oldExpanded;
      _version = null; render();
    },
  });
}

function _collectSubtree(item) {
  const result = [item];
  for (const i of state.items) {
    if (i.parentId === item.id) result.push(..._collectSubtree(i));
  }
  return result;
}

function _isDescendant(item, potentialAncestor) {
  let cur = item;
  while (cur?.parentId) {
    if (cur.parentId === potentialAncestor.id) return true;
    cur = state.items.find(i => i.id === cur.parentId);
  }
  return false;
}

// ── Delete dragged item ───────────────────────────────────────────────────────

function _deleteDraggedItem() {
  const { item }  = _drag;
  const subtree   = _collectSubtree(item);
  const toDelete  = new Set(subtree.map(i => i.id));
  const oldItems  = [...state.items];
  const oldActive = state.activeItemId;

  execute({
    do() {
      state.items = state.items.filter(i => !toDelete.has(i.id));
      sanitizeItems(state.items);
      if (toDelete.has(state.activeItemId)) {
        state.activeItemId = state.items.find(i => i.parentId === null && i.type === 'group')?.id
          ?? state.items[0]?.id;
      }
      _panelSel.clear(); _version = null; render();
    },
    undo() {
      state.items        = oldItems;
      state.activeItemId = oldActive;
      _version = null; render();
    },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _clearDrop() {
  _dropLineEl?.remove();
  _dropLineEl = null;
  _panelBody?.querySelectorAll('.lp-layer--drop').forEach(el => el.classList.remove('lp-layer--drop'));
}

function _arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function _el(tag, cls) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  return el;
}
