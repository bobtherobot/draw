/**
 * Menubar — File / Edit / Object top-level menus.
 */
import { newDocument, openSVG, saveSVG, exportSVG } from '../io/io.js';
import { undo, redo, canUndo, canRedo }              from '../core/history.js';
import { allDisplayItems }                            from '../core/state.js';
import { state }                                      from '../core/state.js';
import { render }                                     from '../render/renderer.js';
import { getTool }                                    from '../core/registry.js';
import { showDocumentSettings, showOptions }          from './dialogs.js';

const MENUS = [
  {
    label: 'File',
    items: [
      { action: 'new',         label: 'New',                  shortcut: '⌘N' },
      { action: 'open',        label: 'Open…',                shortcut: '⌘O', sep: true },
      { action: 'save',        label: 'Save…',                shortcut: '⌘S' },
      { action: 'export',      label: 'Export SVG…' },
      { action: 'docSettings', label: 'Document Settings…',   sep: true },
    ],
  },
  {
    label: 'Edit',
    items: [
      { action: 'undo',      label: 'Undo',       shortcut: '⌘Z' },
      { action: 'redo',      label: 'Redo',       shortcut: '⌘⇧Z' },
      { action: 'copy',      label: 'Copy',       shortcut: '⌘C',  sep: true },
      { action: 'paste',     label: 'Paste',      shortcut: '⌘V' },
      { action: 'selectAll', label: 'Select All', shortcut: '⌘A',  sep: true },
      { action: 'delete',    label: 'Delete',     shortcut: '⌦' },
      { action: 'options',   label: 'Options…',                    sep: true },
    ],
  },
  {
    label: 'Object',
    items: [
      { action: 'group',        label: 'Group',          shortcut: '⌘G' },
      { action: 'ungroup',      label: 'Ungroup',        shortcut: '⌘⇧G' },
      { action: 'bringToFront', label: 'Bring to Front', shortcut: '⌘]', sep: true },
      { action: 'sendToBack',   label: 'Send to Back',   shortcut: '⌘[' },
    ],
  },
];

export function initMenubar(el) {
  el.innerHTML = _buildHTML();
  el.addEventListener('mousedown', _onMouseDown);
  document.addEventListener('mousedown', _onOutsideClick);
}

function _buildHTML() {
  return MENUS.map(menu => `
    <div class="menubar__item">
      <span class="menubar__label">${menu.label}</span>
      <div class="menubar__dropdown">
        ${menu.items.map(item => `
          <div class="menubar__row${item.sep ? ' menubar__row--sep' : ''}" data-action="${item.action}">
            <span>${item.label}</span>
            ${item.shortcut ? `<span class="menubar__shortcut">${item.shortcut}</span>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function _onMouseDown(e) {
  const label = e.target.closest('.menubar__label');
  const row   = e.target.closest('[data-action]');

  if (label) {
    e.preventDefault();
    const item   = label.closest('.menubar__item');
    const isOpen = item.classList.contains('menubar__item--open');
    _closeAll();
    if (!isOpen) item.classList.add('menubar__item--open');
    return;
  }

  if (row) {
    e.preventDefault();
    _closeAll();
    _execute(row.dataset.action);
  }
}

function _onOutsideClick(e) {
  if (!e.target.closest('.menubar__item')) _closeAll();
}

function _closeAll() {
  document.querySelectorAll('.menubar__item--open')
    .forEach(el => el.classList.remove('menubar__item--open'));
}

function _execute(action) {
  switch (action) {
    case 'new':       newDocument();                         break;
    case 'open':      openSVG();                            break;
    case 'save':      saveSVG();                            break;
    case 'export':      exportSVG();                          break;
    case 'docSettings': showDocumentSettings();              break;
    case 'options':     showOptions();                       break;
    case 'undo':        if (canUndo()) { undo(); render(); } break;
    case 'redo':      if (canRedo()) { redo(); render(); }  break;
    case 'selectAll': _selectAll();                         break;
    case 'delete':    _delete();                            break;
    // copy, paste, group, ungroup, bringToFront, sendToBack — not yet implemented
  }
}

function _selectAll() {
  const shapes = allDisplayItems();
  if (shapes.length === 0) return;
  state.selection = new Set(shapes.map(s => s.id));
  render();
}

function _delete() {
  const tool = getTool('select');
  if (tool?.deleteSelected) tool.deleteSelected();
}
