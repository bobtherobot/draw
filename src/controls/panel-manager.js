/**
 * Panel manager — fixed-position side panel with docking, floating,
 * collapsible sub-panels, drag-to-reorder, drag-to-float, and resize.
 * State persisted to localStorage.
 */
import { invalidateRect }             from '../core/Viewport.js';
import { loadSection, saveSection }   from '../core/settings.js';
import { getIconSync }                from '../core/icons.js';

const COLL_W     = 32;
const MIN_W = 160, MAX_W = 680;
const MIN_H =  80, MAX_H = 960;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── Persisted state ───────────────────────────────────────────────────────────

const _ps = {
  collapsed:   false,
  floating:    false,
  floatX:      80, floatY: 40, floatW: 240, floatH: 480,
  dockedWidth: 240,
  panels:      [],
};

function _save() {
  saveSection('panels', _ps);
}

function _load() {
  const s = loadSection('panels');
  if (!s) return;
  if (typeof s.collapsed   === 'boolean') _ps.collapsed   = s.collapsed;
  if (typeof s.floating    === 'boolean') _ps.floating    = s.floating;
  if (typeof s.floatX      === 'number')  _ps.floatX      = s.floatX;
  if (typeof s.floatY      === 'number')  _ps.floatY      = s.floatY;
  if (typeof s.floatW      === 'number')  _ps.floatW      = clamp(s.floatW, MIN_W, MAX_W);
  if (typeof s.floatH      === 'number')  _ps.floatH      = clamp(s.floatH, MIN_H, MAX_H);
  if (typeof s.dockedWidth === 'number')  _ps.dockedWidth = clamp(s.dockedWidth, MIN_W, MAX_W);
  if (Array.isArray(s.panels))            _ps.panels      = s.panels;
}

// ── Module state ──────────────────────────────────────────────────────────────

const _registry = [];   // { id, label }
const _subEls   = {};   // id → sub-panel element
let   _panelEl, _bodyEl, _configEl;

// ── Init ──────────────────────────────────────────────────────────────────────

export function initPanelManager() {
  _load();
  _buildShell();
}

// ── Register a sub-panel ──────────────────────────────────────────────────────

export function registerPanel(id, label, buildFn, opts = {}) {
  _registry.push({ id, label });

  if (!_ps.panels.find(p => p.id === id)) {
    _ps.panels.push({
      id, visible: true, expanded: true,
      order: _ps.panels.length,
      floating: false, floatX: 120, floatY: 60, floatW: 220,
    });
  }

  _buildSubPanel(id, label, buildFn, opts.actionEls || []);
  _renderBody();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function _pstate(id) { return _ps.panels.find(p => p.id === id); }
function _ordered()  { return [..._ps.panels].sort((a, b) => a.order - b.order); }

// ── Build shell ───────────────────────────────────────────────────────────────

function _buildShell() {
  _panelEl     = _el('div', 'pm');
  const topbar = _el('div', 'pm__topbar');

  const collapseBtn = _el('button', 'pm__icon-btn');
  collapseBtn.id    = 'pm-collapse-btn';
  collapseBtn.title = 'Toggle panel';
  collapseBtn.appendChild(getIconSync('ui', 'chevron'));
  collapseBtn.addEventListener('click', () => {
    _ps.collapsed = !_ps.collapsed;
    _applyShell();
    _save();
  });

  const titleEl = _el('span', 'pm__title');
  titleEl.textContent = 'Controls';

  const hamburgerBtn = _el('button', 'pm__icon-btn');
  hamburgerBtn.id    = 'pm-hamburger-btn';
  hamburgerBtn.title = 'Panel options';
  hamburgerBtn.appendChild(getIconSync('ui', 'menu'));
  // Config dropdown — lives on body so it escapes panel's overflow:hidden
  _configEl = _el('div', 'pm__config');
  Object.assign(_configEl.style, {
    position:  'fixed',
    zIndex:    '360',
    display:   'none',
    minWidth:  '160px',
  });
  document.body.appendChild(_configEl);

  hamburgerBtn.addEventListener('click', e => {
    e.stopPropagation();
    const open = _configEl.style.display !== 'none';
    if (!open) {
      _buildConfigMenu();
      const r = hamburgerBtn.getBoundingClientRect();
      _configEl.style.top   = (r.bottom + 2) + 'px';
      _configEl.style.right = (window.innerWidth - r.right) + 'px';
      _configEl.style.left  = '';
    }
    _configEl.style.display = open ? 'none' : 'block';
  });
  document.addEventListener('click', () => { _configEl.style.display = 'none'; });

  topbar.append(collapseBtn, titleEl, hamburgerBtn);

  _bodyEl = _el('div', 'pm__body');

  // Resize handles
  const rLeft   = _el('div', 'pm__resize pm__resize--left');
  const rRight  = _el('div', 'pm__resize pm__resize--right');
  const rBottom = _el('div', 'pm__resize pm__resize--bottom');
  const rSE     = _el('div', 'pm__resize pm__resize--se');
  rSE.appendChild(getIconSync('ui', 'resize-grip'));

  // Critical layout — must be inline so the panel is visible before CSS compiles
  Object.assign(_panelEl.style, {
    position:      'fixed',
    zIndex:        '350',
    display:       'flex',
    flexDirection: 'column',
    overflow:      'hidden',
    background:    'var(--theme-bg)',
    borderLeft:    '1px solid var(--theme-border)',
  });
  Object.assign(_bodyEl.style, {
    flex:      '1 1 auto',
    overflowY: 'auto',
    minHeight: '0',
  });

  _panelEl.append(topbar, _bodyEl, rLeft, rRight, rBottom, rSE);
  document.body.appendChild(_panelEl);

  _initTopbarDrag(topbar);
  _initDockedResize(rLeft);
  _initFloatResize(rRight, rBottom, rSE);
  _applyShell();
  _onWindowResize();

  window.addEventListener('resize', _onWindowResize);
}

function _onWindowResize() {
  if (!_ps.floating) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const topbarH = _panelEl.querySelector('.pm__topbar')?.offsetHeight ?? 30;

  // Keep the entire panel inside the viewport
  _ps.floatX = clamp(_ps.floatX, 0, Math.max(0, vw - _ps.floatW));
  _ps.floatY = clamp(_ps.floatY, 0, Math.max(0, vh - _ps.floatH - 20));

  // Shrink height if the bottom edge now extends below the viewport
  const maxH = vh - _ps.floatY - 20;
  if (_ps.floatH > maxH) _ps.floatH = Math.max(MIN_H, maxH);

  _applyShell();
  _save();
}

// ── Apply main panel state ────────────────────────────────────────────────────

function _applyShell() {
  const p = _panelEl;

  if (_ps.floating) {
    p.classList.add('pm--floating');
    Object.assign(p.style, {
      right: 'auto', bottom: 'auto',
      left:   _ps.floatX + 'px',
      top:    _ps.floatY + 'px',
      width:  _ps.floatW + 'px',
      height: _ps.collapsed ? 'auto' : _ps.floatH + 'px',
    });
  } else {
    p.classList.remove('pm--floating');
    Object.assign(p.style, {
      left: '', top: '0', right: '0', bottom: '0', height: '',
      width: (_ps.collapsed ? COLL_W : _ps.dockedWidth) + 'px',
    });
  }

  p.classList.toggle('pm--collapsed', _ps.collapsed);

  // Topbar visibility — inline styles beat CSS so we set explicit values in all cases
  const titleEl     = p.querySelector('.pm__title');
  const hamburgerEl = p.querySelector('#pm-hamburger-btn');
  const topbarEl    = p.querySelector('.pm__topbar');
  if (_ps.floating && _ps.collapsed) {
    // Roll-up: keep the full title bar visible, just hide the body
    if (titleEl)     titleEl.style.display     = 'block';
    if (hamburgerEl) hamburgerEl.style.display  = 'flex';
    if (topbarEl)    Object.assign(topbarEl.style, { padding: '0 4px', justifyContent: 'flex-start' });
  } else if (!_ps.floating && _ps.collapsed) {
    // Docked narrow strip: only the collapse button, centered
    if (titleEl)     titleEl.style.display     = 'none';
    if (hamburgerEl) hamburgerEl.style.display  = 'none';
    if (topbarEl)    Object.assign(topbarEl.style, { padding: '0', justifyContent: 'center' });
  } else {
    // Expanded (either mode): restore defaults
    if (titleEl)     titleEl.style.display     = '';
    if (hamburgerEl) hamburgerEl.style.display  = '';
    if (topbarEl)    Object.assign(topbarEl.style, { padding: '', justifyContent: '' });
  }

  invalidateRect();
}

// ── Render body ───────────────────────────────────────────────────────────────

function _renderBody() {
  const docked = _ordered().filter(p => p.visible && !p.floating);
  const curIds = [..._bodyEl.querySelectorAll('.pm-sp')].map(e => e.dataset.pid);
  const tgtIds = docked.map(p => p.id);

  if (curIds.join() !== tgtIds.join()) {
    _bodyEl.innerHTML = '';
    for (const p of docked) { const el = _subEls[p.id]; if (el) _bodyEl.appendChild(el); }
  }

  for (const p of _ordered()) {
    const el = _subEls[p.id];
    if (!el) continue;
    if (!p.visible) { el.style.display = 'none'; continue; }
    el.style.display = '';
    el.classList.toggle('pm-sp--collapsed', !p.expanded);

    if (p.floating) {
      if (el.parentNode !== document.body) document.body.appendChild(el);
      el.classList.add('pm-sp--floating');
      Object.assign(el.style, { left: p.floatX + 'px', top: p.floatY + 'px', width: p.floatW + 'px' });
    } else {
      el.classList.remove('pm-sp--floating');
      el.style.left = el.style.top = el.style.width = '';
    }
  }
}

// ── Build sub-panel ───────────────────────────────────────────────────────────

function _buildSubPanel(id, label, buildFn, actionEls) {
  const p  = _pstate(id);
  const el = _el('div', 'pm-sp');
  el.dataset.pid = id;

  const header = _el('div', 'pm-sp__header');
  Object.assign(header.style, {
    display: 'flex', flexDirection: 'row', alignItems: 'center',
    gap: '4px', padding: '0 4px 0 8px', height: '28px',
    flexShrink: '0', cursor: 'default', userSelect: 'none',
  });

  const arrow = _el('span', 'pm-sp__arrow');
  arrow.appendChild(getIconSync('ui', 'chevron'));

  const titleEl = _el('span', 'pm-sp__title');
  titleEl.textContent = label.toUpperCase();
  Object.assign(titleEl.style, {
    flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis',
    whiteSpace: 'nowrap', minWidth: '0',
  });

  const actionsEl = _el('span', 'pm-sp__actions');
  Object.assign(actionsEl.style, { display: 'flex', alignItems: 'center', flexShrink: '0' });
  for (const btn of actionEls) actionsEl.appendChild(btn);

  const closeBtn = _el('button', 'pm-sp__close');
  closeBtn.title = 'Close';
  Object.assign(closeBtn.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: '0', width: '20px', height: '20px',
    padding: '0', cursor: 'pointer',
  });
  closeBtn.appendChild(getIconSync('ui', 'close'));

  header.append(arrow, titleEl, actionsEl, closeBtn);

  const contentEl = _el('div', 'pm-sp__content');
  buildFn(contentEl);

  const resizeCorner = _el('div', 'pm-sp__resize');
  resizeCorner.appendChild(getIconSync('ui', 'resize-grip'));

  el.append(header, contentEl, resizeCorner);
  _subEls[id] = el;

  // Collapse / expand
  header.addEventListener('click', e => {
    if (e.target.closest('.pm-sp__close, .pm-sp__actions')) return;
    p.expanded = !p.expanded;
    el.classList.toggle('pm-sp--collapsed', !p.expanded);
    _save();
  });

  // Close
  closeBtn.addEventListener('click', e => {
    e.stopPropagation();
    p.visible  = false;
    p.floating = false;
    el.parentNode?.removeChild(el);
    _save();
    if (_configEl.style.display !== 'none') _buildConfigMenu();
  });

  _initSubDrag(p, el, header);
  _initSubResize(p, el, resizeCorner);
}

// ── Sub-panel drag (reorder / detach) ─────────────────────────────────────────

let _dropIndicator = null;

function _initSubDrag(p, el, header) {
  let drag = null;

  header.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest('.pm-sp__close, .pm-sp__actions')) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    drag = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false };
  });

  document.addEventListener('mousemove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && dx * dx + dy * dy < 16) return;
    drag.moved = true;

    if (p.floating) {
      el.style.left = (drag.ox + dx) + 'px';
      el.style.top  = (drag.oy + dy) + 'px';
    } else {
      const pr = _panelEl.getBoundingClientRect();
      if (e.clientX < pr.left - 40) {
        _removeDropIndicator();
        p.floating = true;
        p.floatX   = e.clientX - 20;
        p.floatY   = e.clientY - 12;
        p.floatW   = _ps.floating ? _panelEl.offsetWidth : _ps.dockedWidth;
        document.body.appendChild(el);
        el.classList.add('pm-sp--floating');
        Object.assign(el.style, { left: p.floatX + 'px', top: p.floatY + 'px', width: p.floatW + 'px' });
        drag.ox = p.floatX; drag.oy = p.floatY;
        drag.sx = e.clientX; drag.sy = e.clientY;
        _renderBody(); _save();
        return;
      }
      _showDropIndicator(e.clientY, p.id);
    }
  });

  document.addEventListener('mouseup', e => {
    if (!drag) return;
    if (p.floating) {
      p.floatX = parseInt(el.style.left) || p.floatX;
      p.floatY = parseInt(el.style.top)  || p.floatY;
      _save();
    } else if (drag.moved) {
      _removeDropIndicator();
      _commitReorder(e.clientY, p);
    }
    drag = null;
  });
}

function _showDropIndicator(clientY, excludeId) {
  _removeDropIndicator();
  _dropIndicator = _el('div', 'pm__drop-indicator');
  const panels = _ordered().filter(p => p.visible && !p.floating && p.id !== excludeId);
  let before = null;
  for (const p of panels) {
    const r = _subEls[p.id]?.getBoundingClientRect();
    if (r && clientY < r.top + r.height / 2) { before = _subEls[p.id]; break; }
  }
  before ? _bodyEl.insertBefore(_dropIndicator, before) : _bodyEl.appendChild(_dropIndicator);
}

function _removeDropIndicator() {
  _dropIndicator?.parentNode?.removeChild(_dropIndicator);
  _dropIndicator = null;
}

function _commitReorder(clientY, moved) {
  const rest = _ordered().filter(p => p.visible && !p.floating && p.id !== moved.id);
  let idx = rest.length;
  for (let i = 0; i < rest.length; i++) {
    const r = _subEls[rest[i].id]?.getBoundingClientRect();
    if (r && clientY < r.top + r.height / 2) { idx = i; break; }
  }
  rest.splice(idx, 0, moved);
  rest.forEach((p, i) => { p.order = i; });
  _ordered().filter(p => !rest.includes(p)).forEach((p, i) => { p.order = rest.length + i; });
  _renderBody(); _save();
}

// ── Sub-panel resize corner ───────────────────────────────────────────────────

function _initSubResize(p, el, corner) {
  let drag = null;
  corner.addEventListener('mousedown', e => {
    if (!p.floating) return;
    e.stopPropagation(); e.preventDefault();
    drag = { sx: e.clientX, sw: el.offsetWidth };
  });
  document.addEventListener('mousemove', e => {
    if (!drag || !p.floating) return;
    p.floatW = clamp(drag.sw + e.clientX - drag.sx, MIN_W, MAX_W);
    el.style.width = p.floatW + 'px';
  });
  document.addEventListener('mouseup', () => { if (drag) { drag = null; _save(); } });
}

// ── Main panel: topbar drag ───────────────────────────────────────────────────

function _initTopbarDrag(topbar) {
  let drag = null;
  topbar.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    const r = _panelEl.getBoundingClientRect();
    drag = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, ow: r.width, oh: r.height, moved: false };
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && dx * dx + dy * dy < 25) return;
    drag.moved = true;
    if (!_ps.floating) {
      const topbarH = _panelEl.querySelector('.pm__topbar')?.offsetHeight ?? 30;
      const subH = _ordered()
        .filter(p => p.visible && !p.floating)
        .reduce((sum, p) => sum + (_subEls[p.id]?.offsetHeight ?? 0), 0);
      const idealH = topbarH + subH;

      _ps.floating = true;
      _ps.floatX = drag.ox;
      _ps.floatY = drag.oy;
      _ps.floatW = drag.ow;
      _ps.floatH = idealH + 30 > window.innerHeight
        ? window.innerHeight - 30
        : Math.max(MIN_H, idealH);
      _applyShell();
    }
    _ps.floatX = drag.ox + dx; _ps.floatY = drag.oy + dy;
    _panelEl.style.left = _ps.floatX + 'px';
    _panelEl.style.top  = _ps.floatY + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (drag?.moved && _ps.floating) _save();
    drag = null;
  });
}

// ── Main panel: docked left-edge resize ───────────────────────────────────────

function _initDockedResize(handle) {
  let drag = null;
  handle.addEventListener('mousedown', e => {
    if (_ps.floating) return;
    e.preventDefault();
    drag = { sx: e.clientX, sw: _ps.dockedWidth };
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    _ps.dockedWidth = clamp(drag.sw - (e.clientX - drag.sx), MIN_W, MAX_W);
    _panelEl.style.width = _ps.dockedWidth + 'px';
    invalidateRect();
  });
  document.addEventListener('mouseup', () => {
    if (drag) { drag = null; _panelEl.classList.remove('pm--resizing'); _save(); }
  });
}

// ── Main panel: float resize ──────────────────────────────────────────────────

function _initFloatResize(right, bottom, corner) {
  const make = (onMove) => {
    let drag = null;
    return {
      down: e => {
        if (!_ps.floating || e.button) return;
        e.stopPropagation(); e.preventDefault();
        drag = { sx: e.clientX, sy: e.clientY, sw: _panelEl.offsetWidth, sh: _panelEl.offsetHeight };
        _panelEl.classList.add('pm--resizing');
      },
      move: e => { if (drag) onMove(e, drag); },
      up:   () => { if (drag) { drag = null; _panelEl.classList.remove('pm--resizing'); _save(); } },
    };
  };
  const rR  = make((e, d) => { _ps.floatW = clamp(d.sw + e.clientX - d.sx, MIN_W, MAX_W); _panelEl.style.width  = _ps.floatW + 'px'; });
  const rB  = make((e, d) => { _ps.floatH = clamp(d.sh + e.clientY - d.sy, MIN_H, MAX_H); _panelEl.style.height = _ps.floatH + 'px'; });
  const rSE = make((e, d) => {
    _ps.floatW = clamp(d.sw + e.clientX - d.sx, MIN_W, MAX_W);
    _ps.floatH = clamp(d.sh + e.clientY - d.sy, MIN_H, MAX_H);
    _panelEl.style.width  = _ps.floatW + 'px';
    _panelEl.style.height = _ps.floatH + 'px';
  });
  right.addEventListener('mousedown',  rR.down);
  bottom.addEventListener('mousedown', rB.down);
  corner.addEventListener('mousedown', rSE.down);
  document.addEventListener('mousemove', e => { rR.move(e); rB.move(e); rSE.move(e); });
  document.addEventListener('mouseup',   () => { rR.up(); rB.up(); rSE.up(); });
}

// ── Hamburger config menu ─────────────────────────────────────────────────────

function _closeConfig() { _configEl.style.display = 'none'; }

function _buildConfigMenu() {
  _configEl.innerHTML = '';

  // Inline styles so the menu renders before CSS compiles
  Object.assign(_configEl.style, {
    background:   'var(--theme-bg-raised)',
    border:       '1px solid var(--theme-border)',
    borderRadius: '3px',
    boxShadow:    '3px 4px 16px var(--theme-shadow)',
    padding:      '3px 0',
    fontSize:     '11px',
  });

  const dockBtn = _el('div', 'pm__config-action');
  Object.assign(dockBtn.style, { padding: '4px 12px', cursor: 'default', color: 'var(--theme-fg-dim)', whiteSpace: 'nowrap' });
  dockBtn.textContent = _ps.floating ? 'Dock panel' : 'Detach panel';
  dockBtn.addEventListener('mouseenter', () => { dockBtn.style.background = 'var(--theme-bg-active)'; dockBtn.style.color = 'var(--theme-fg)'; });
  dockBtn.addEventListener('mouseleave', () => { dockBtn.style.background = ''; dockBtn.style.color = 'var(--theme-fg-dim)'; });
  dockBtn.addEventListener('click', e => {
    e.stopPropagation();
    _closeConfig();
    if (_ps.floating) {
      _ps.floating = false;
    } else {
      const r       = _panelEl.getBoundingClientRect();
      const topbarH = _panelEl.querySelector('.pm__topbar')?.offsetHeight ?? 30;

      // Sum each sub-panel's offsetHeight directly from _subEls —
      // avoids the scrollHeight == clientHeight trap when body fills the viewport.
      const subH = _ordered()
        .filter(p => p.visible && !p.floating)
        .reduce((sum, p) => sum + (_subEls[p.id]?.offsetHeight ?? 0), 0);

      const idealH = topbarH + subH;

      _ps.floatX = r.left - 20;
      _ps.floatY = Math.max(10, r.top + 20);
      _ps.floatW = clamp(r.width, MIN_W, MAX_W);
      _ps.floatH = idealH + 30 > window.innerHeight
        ? window.innerHeight - 30
        : Math.max(MIN_H, idealH);
      _ps.floating = true;
    }
    _applyShell(); _save();
  });
  _configEl.appendChild(dockBtn);

  const sep = _el('div', 'pm__config-sep');
  sep.style.cssText = 'height:1px;background:var(--theme-bg-active);margin:3px 0;';
  _configEl.appendChild(sep);

  for (const p of _ordered()) {
    const reg = _registry.find(r => r.id === p.id);
    if (!reg) continue;
    const lbl = _el('label', 'pm__config-item');
    Object.assign(lbl.style, {
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '4px 12px', cursor: 'default',
      color: 'var(--theme-fg-dim)', userSelect: 'none', whiteSpace: 'nowrap',
    });
    lbl.addEventListener('mouseenter', () => { lbl.style.background = 'var(--theme-bg-active)'; lbl.style.color = 'var(--theme-fg)'; });
    lbl.addEventListener('mouseleave', () => { lbl.style.background = ''; lbl.style.color = 'var(--theme-fg-dim)'; });

    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = p.visible;
    Object.assign(cb.style, { appearance: 'auto', accentColor: 'var(--theme-accent)', flexShrink: '0' });
    cb.addEventListener('change', e => {
      e.stopPropagation();
      p.visible = cb.checked;
      if (!p.visible && p.floating) {
        _subEls[p.id]?.parentNode?.removeChild(_subEls[p.id]);
        p.floating = false;
      }
      _renderBody(); _save();
    });
    lbl.append(cb, reg.label);
    _configEl.appendChild(lbl);
  }

  const sep2 = _el('div');
  sep2.style.cssText = 'height:1px;background:var(--theme-bg-active);margin:3px 0;';
  _configEl.appendChild(sep2);

  const layoutsBtn = _el('div', 'pm__config-action');
  Object.assign(layoutsBtn.style, { padding: '4px 12px', cursor: 'default', color: 'var(--theme-fg-dim)', whiteSpace: 'nowrap' });
  layoutsBtn.textContent = 'Manage layouts…';
  layoutsBtn.addEventListener('mouseenter', () => { layoutsBtn.style.background = 'var(--theme-bg-active)'; layoutsBtn.style.color = 'var(--theme-fg)'; });
  layoutsBtn.addEventListener('mouseleave', () => { layoutsBtn.style.background = ''; layoutsBtn.style.color = 'var(--theme-fg-dim)'; });
  layoutsBtn.addEventListener('click', e => {
    e.stopPropagation();
    _closeConfig();
    _showLayoutsDialog();
  });
  _configEl.appendChild(layoutsBtn);
}

// ── Panel layouts ─────────────────────────────────────────────────────────────

function _loadLayouts() {
  const raw = loadSection('layouts');
  return Array.isArray(raw) ? raw : [];
}

function _saveLayouts(layouts) {
  saveSection('layouts', layouts);
}

function _captureLayoutState() {
  return JSON.parse(JSON.stringify(_ps));
}

function _applyLayoutState(saved) {
  const s = JSON.parse(JSON.stringify(saved));
  if (typeof s.collapsed   === 'boolean') _ps.collapsed   = s.collapsed;
  if (typeof s.floating    === 'boolean') _ps.floating    = s.floating;
  if (typeof s.floatX      === 'number')  _ps.floatX      = s.floatX;
  if (typeof s.floatY      === 'number')  _ps.floatY      = s.floatY;
  if (typeof s.floatW      === 'number')  _ps.floatW      = s.floatW;
  if (typeof s.floatH      === 'number')  _ps.floatH      = s.floatH;
  if (typeof s.dockedWidth === 'number')  _ps.dockedWidth = s.dockedWidth;
  if (Array.isArray(s.panels)) {
    for (const sp of s.panels) {
      const cur = _ps.panels.find(p => p.id === sp.id);
      if (cur) Object.assign(cur, sp);
    }
  }
  _applyShell();
  _renderBody();
  _save();
}

function _applyDefaultLayout() {
  _ps.collapsed   = false;
  _ps.floating    = false;
  _ps.dockedWidth = 240;
  _ps.panels.forEach((p, i) => {
    p.visible  = true;
    p.expanded = true;
    p.floating = false;
    p.order    = i;
  });
  _applyShell();
  _renderBody();
  _save();
}

function _showLayoutsDialog() {
  let layouts = _loadLayouts();

  // ── Outer overlay ──
  const overlay = _el('div', 'pm-layouts');
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '9000',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.5)',
  });

  // ── Dialog shell ──
  const dialog = _el('div', 'pm-layouts__dialog');
  Object.assign(dialog.style, {
    position: 'relative', width: '340px',
    background: 'var(--theme-bg)',
    border: '1px solid var(--theme-border)',
    borderRadius: '4px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
    display: 'flex', flexDirection: 'column',
    maxHeight: '80vh', overflow: 'hidden',
  });

  // ── Header ──
  const hdr = _el('div', 'pm-layouts__header');
  Object.assign(hdr.style, {
    display: 'flex', alignItems: 'center',
    padding: '0 10px 0 14px', height: '38px', flexShrink: '0',
    borderBottom: '1px solid var(--theme-border)',
    userSelect: 'none', cursor: 'move',
  });

  const titleEl = _el('span');
  titleEl.textContent = 'PANEL LAYOUTS';
  Object.assign(titleEl.style, {
    flex: '1 1 auto', fontSize: '10px', fontWeight: '600',
    letterSpacing: '0.1em', color: 'var(--theme-fg-dim)',
    fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", monospace',
  });

  const closeBtn = _iconBtn(getIconSync('ui', 'close'), 'Close');
  hdr.append(titleEl, closeBtn);

  // ── Body ──
  const body = _el('div');
  Object.assign(body.style, {
    flex: '1 1 auto', overflowY: 'auto', minHeight: '0',
    padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px',
  });

  // Save current state button
  const saveBtn = _el('button');
  saveBtn.textContent = '+ Save current state as new layout';
  Object.assign(saveBtn.style, {
    width: '100%', padding: '7px 10px', textAlign: 'left',
    fontSize: '11px', color: 'var(--theme-accent)',
    border: '1px dashed var(--theme-accent)',
    borderRadius: '3px', cursor: 'pointer', background: 'transparent',
    fontFamily: 'inherit',
  });
  saveBtn.addEventListener('mouseenter', () => saveBtn.style.background = 'var(--theme-bg-active)');
  saveBtn.addEventListener('mouseleave', () => saveBtn.style.background = 'transparent');

  // Layout list
  const list = _el('div');
  Object.assign(list.style, {
    display: 'flex', flexDirection: 'column',
    border: '1px solid var(--theme-border)',
    borderRadius: '3px', overflow: 'hidden',
  });

  function buildList() {
    list.innerHTML = '';
    _buildLayoutRow({ id: 'default', name: 'Default' }, true);
    for (const layout of layouts) _buildLayoutRow(layout, false);
  }

  function _buildLayoutRow(layout, isDefault) {
    const row = _el('div');
    row.dataset.lid = layout.id;
    Object.assign(row.style, {
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '0 6px 0 12px', height: '34px', flexShrink: '0',
      borderBottom: '1px solid var(--theme-border)',
      transition: 'background 80ms',
    });
    row.addEventListener('mouseenter', () => row.style.background = 'var(--theme-bg-hover,var(--theme-bg-active))');
    row.addEventListener('mouseleave', () => row.style.background = '');

    // Icon: filled diamond for default, outline for user layouts
    const iconEl = _el('span');
    Object.assign(iconEl.style, { flexShrink: '0', display: 'flex', alignItems: 'center', opacity: '0.45' });
    const iconSvg = getIconSync('ui', isDefault ? 'layout-default' : 'layout-custom');
    iconSvg.style.width = '7px';
    iconSvg.style.height = '7px';
    iconEl.appendChild(iconSvg);

    // Name span (swapped for input during rename)
    const nameSpan = _el('span');
    nameSpan.textContent = layout.name;
    Object.assign(nameSpan.style, {
      flex: '1 1 auto', minWidth: '0', fontSize: '12px',
      fontFamily: 'ui-monospace, "SF Mono", monospace',
      color: 'var(--theme-fg)',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    });

    // Action buttons
    const actions = _el('div');
    Object.assign(actions.style, { display: 'flex', alignItems: 'center', gap: '1px', flexShrink: '0' });

    const restoreBtn = _iconBtn(getIconSync('ui', 'restore'), 'Restore');
    restoreBtn.addEventListener('click', () => {
      isDefault ? _applyDefaultLayout() : _applyLayoutState(layout.state);
      close();
    });
    actions.appendChild(restoreBtn);

    if (!isDefault) {
      const renameBtn = _iconBtn(getIconSync('ui', 'edit'), 'Rename');
      renameBtn.dataset.action = 'rename';
      renameBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.value = layout.name;
        Object.assign(input.style, {
          flex: '1 1 auto', minWidth: '0', fontSize: '12px',
          fontFamily: 'ui-monospace, "SF Mono", monospace',
          color: 'var(--theme-fg)', background: 'var(--theme-bg-active)',
          border: '1px solid var(--theme-accent)', borderRadius: '2px',
          padding: '1px 4px', outline: 'none', appearance: 'none',
        });
        nameSpan.replaceWith(input);
        input.focus(); input.select();
        const commit = () => {
          const val = input.value.trim();
          if (val) layout.name = val;
          _saveLayouts(layouts);
          buildList();
        };
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') buildList();
          e.stopPropagation();
        });
        input.addEventListener('blur', commit);
      });

      const deleteBtn = _iconBtn(getIconSync('ui', 'close'), 'Delete');
      deleteBtn.addEventListener('mouseenter', () => deleteBtn.style.color = '#e05555');
      deleteBtn.addEventListener('mouseleave', () => deleteBtn.style.color = 'var(--theme-fg-dim)');
      deleteBtn.addEventListener('click', () => {
        layouts = layouts.filter(l => l.id !== layout.id);
        _saveLayouts(layouts);
        buildList();
      });

      actions.append(renameBtn, deleteBtn);
    }

    row.append(iconEl, nameSpan, actions);
    list.appendChild(row);
  }

  saveBtn.addEventListener('click', () => {
    const id   = 'layout-' + Date.now();
    const name = `Layout ${layouts.length + 1}`;
    layouts.push({ id, name, state: _captureLayoutState() });
    _saveLayouts(layouts);
    buildList();
    // Auto-trigger rename on the new row
    const newRow = list.querySelector(`[data-lid="${id}"]`);
    newRow?.querySelector('[data-action="rename"]')?.click();
  });

  buildList();
  body.append(saveBtn, list);
  dialog.append(hdr, body);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // Header drag
  let _drag = null;
  hdr.addEventListener('mousedown', e => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const r = dialog.getBoundingClientRect();
    _drag = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top };
  });
  document.addEventListener('mousemove', e => {
    if (!_drag) return;
    Object.assign(dialog.style, {
      position: 'absolute',
      margin: '0',
      left: (_drag.ox + e.clientX - _drag.sx) + 'px',
      top:  (_drag.oy + e.clientY - _drag.sy) + 'px',
    });
  });
  document.addEventListener('mouseup', () => { _drag = null; });

  const close = () => overlay.parentNode?.removeChild(overlay);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

// Small helper — styled icon button for use inside layouts dialog
function _iconBtn(iconEl, title) {
  const btn = _el('button');
  btn.title = title;
  btn.appendChild(iconEl);
  Object.assign(btn.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '24px', height: '24px', padding: '0', flexShrink: '0',
    color: 'var(--theme-fg-dim)', cursor: 'pointer', borderRadius: '2px',
  });
  btn.addEventListener('mouseenter', () => { btn.style.color = 'var(--theme-fg)'; btn.style.background = 'var(--theme-bg-active)'; });
  btn.addEventListener('mouseleave', () => { btn.style.color = 'var(--theme-fg-dim)'; btn.style.background = ''; });
  return btn;
}
