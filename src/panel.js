const PANEL_KEY = 'draw-panel-state';

const PANEL_DEFS = [
  { id: 'style',  label: 'Style'  },
  { id: 'object', label: 'Object' },
  { id: 'layers', label: 'Layers' },
];

const ps = {
  mainCollapsed: false,
  mainWidth: 180,
  // Main panel float state
  panelFloating: false,
  panelFloatX: 80,
  panelFloatY: 80,
  panelFloatW: 200,
  panelFloatH: 420,
  panels: null,
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const orderedPanels = () => [...ps.panels].sort((a, b) => a.order - b.order);

function defaultPanels() {
  return PANEL_DEFS.map((def, i) => ({
    id: def.id, visible: true, expanded: true, order: i,
    floating: false, floatX: 0, floatY: 0, floatW: 180,
  }));
}

function savePanelState() {
  try { localStorage.setItem(PANEL_KEY, JSON.stringify(ps)); } catch {}
}

function loadPanelState() {
  ps.panels = defaultPanels();
  try {
    const raw = localStorage.getItem(PANEL_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return;
    if (typeof saved.mainCollapsed  === 'boolean') ps.mainCollapsed  = saved.mainCollapsed;
    if (typeof saved.mainWidth      === 'number')  ps.mainWidth      = clamp(saved.mainWidth, 140, 600);
    if (typeof saved.panelFloating  === 'boolean') ps.panelFloating  = saved.panelFloating;
    if (typeof saved.panelFloatX    === 'number')  ps.panelFloatX    = saved.panelFloatX;
    if (typeof saved.panelFloatY    === 'number')  ps.panelFloatY    = saved.panelFloatY;
    if (typeof saved.panelFloatW    === 'number')  ps.panelFloatW    = clamp(saved.panelFloatW, 140, 800);
    if (typeof saved.panelFloatH    === 'number')  ps.panelFloatH    = clamp(saved.panelFloatH, 80,  900);
    if (Array.isArray(saved.panels)) {
      for (const sp of saved.panels) {
        const p = ps.panels.find(x => x.id === sp.id);
        if (!p) continue;
        if (typeof sp.visible  === 'boolean') p.visible  = sp.visible;
        if (typeof sp.expanded === 'boolean') p.expanded = sp.expanded;
        if (typeof sp.order    === 'number')  p.order    = sp.order;
        if (typeof sp.floating === 'boolean') p.floating = sp.floating;
        if (typeof sp.floatX   === 'number')  p.floatX   = sp.floatX;
        if (typeof sp.floatY   === 'number')  p.floatY   = sp.floatY;
        if (typeof sp.floatW   === 'number')  p.floatW   = sp.floatW;
      }
      ps.panels.sort((a, b) => a.order - b.order);
    }
  } catch {}
}

// ── DOM ──────────────────────────────────────────────────────────────────────

let panelEl, panelBody, panelConfigEl, workspaceEl;
const subPanelEls = {};

// ── Init ─────────────────────────────────────────────────────────────────────

export function initPanel() {
  loadPanelState();
  panelEl     = document.getElementById('panel');
  workspaceEl = document.getElementById('workspace');

  // Topbar
  const topbar = document.createElement('div');
  topbar.id = 'panel-topbar';
  topbar.innerHTML = `
    <button id="panel-collapse-btn" title="Collapse panel">
      <svg viewBox="0 0 8 8" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 2.5 L4 5.5 L7 2.5"/>
      </svg>
    </button>
    <span id="panel-label">Controls</span>
    <button id="panel-hamburger-btn" title="Configure panels">
      <svg viewBox="0 0 12 10" width="12" height="10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none">
        <line x1="0" y1="1" x2="12" y2="1"/>
        <line x1="0" y1="5" x2="12" y2="5"/>
        <line x1="0" y1="9" x2="12" y2="9"/>
      </svg>
    </button>
    <div id="panel-config"></div>
  `;
  panelEl.insertBefore(topbar, panelEl.firstChild);

  panelBody = document.createElement('div');
  panelBody.id = 'panel-body';
  panelEl.appendChild(panelBody);

  // Docked left-edge resize
  const resizeLeft = document.createElement('div');
  resizeLeft.id = 'panel-resize-handle';
  panelEl.appendChild(resizeLeft);

  // Floating resize handles
  const resizeRight  = document.createElement('div');  resizeRight.id  = 'panel-resize-right';
  const resizeBottom = document.createElement('div');  resizeBottom.id = 'panel-resize-bottom';
  const resizeSE     = document.createElement('div');  resizeSE.id     = 'panel-resize-se';
  resizeSE.innerHTML = `<svg viewBox="0 0 8 8" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1"><line x1="2" y1="7" x2="7" y2="2"/><line x1="5" y1="7" x2="7" y2="5"/></svg>`;
  panelEl.append(resizeRight, resizeBottom, resizeSE);

  panelConfigEl = document.getElementById('panel-config');

  for (const p of orderedPanels()) buildSubPanel(p);

  applyMainState();
  renderPanelBody();
  initCollapseToggle();
  initHamburger();
  initMainResize(resizeLeft);
  initTopbarDrag(topbar);
  initPanelFloatResize(resizeRight, resizeBottom, resizeSE);
}

// ── Sub-panel construction ────────────────────────────────────────────────────

function buildSubPanel(p) {
  const def = PANEL_DEFS.find(d => d.id === p.id);
  if (!def) return;

  const el = document.createElement('div');
  el.className = 'sub-panel';
  el.dataset.panelId = p.id;

  const header = document.createElement('div');
  header.className = 'sub-panel-header';
  header.innerHTML = `
    <span class="sub-panel-tri">
      <svg viewBox="0 0 6 6" width="6" height="6"><path d="M1 0.5 L5.5 3 L1 5.5 Z" fill="currentColor"/></svg>
    </span>
    <span class="sub-panel-title">${def.label}</span>
    <button class="sub-panel-close" title="Close">
      <svg viewBox="0 0 10 10" width="9" height="9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none">
        <line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/>
      </svg>
    </button>
  `;

  const content = document.createElement('div');
  content.className = 'sub-panel-content';
  const fragment = document.getElementById(`sub-content-${p.id}`);
  if (fragment) { fragment.style.display = ''; content.appendChild(fragment); }

  const resizeCorner = document.createElement('div');
  resizeCorner.className = 'sub-panel-resize-corner';

  el.append(header, content, resizeCorner);
  subPanelEls[p.id] = el;

  initSubPanelCollapse(p, el, header);
  initSubPanelClose(p, el, header.querySelector('.sub-panel-close'));
  initSubPanelDrag(p, el, header);
  initSubPanelResize(p, el, resizeCorner);
}

// ── State rendering ───────────────────────────────────────────────────────────

function applyMainState() {
  if (ps.panelFloating) {
    panelEl.classList.add('panel-floating');
    panelEl.style.right  = '';
    panelEl.style.bottom = '';
    panelEl.style.left   = ps.panelFloatX + 'px';
    panelEl.style.top    = ps.panelFloatY + 'px';
    panelEl.style.width  = ps.panelFloatW + 'px';
    panelEl.style.height = ps.mainCollapsed ? '' : (ps.panelFloatH + 'px');
  } else {
    panelEl.classList.remove('panel-floating');
    panelEl.style.left   = '';
    panelEl.style.right  = '0';
    panelEl.style.top    = '0';
    panelEl.style.bottom = '0';
    panelEl.style.height = '';
    panelEl.style.width  = ps.mainCollapsed ? '30px' : (ps.mainWidth + 'px');
  }

  panelEl.classList.toggle('collapsed', ps.mainCollapsed);
  const svg = document.querySelector('#panel-collapse-btn svg');
  if (svg) svg.style.transform = ps.mainCollapsed ? 'rotate(90deg)' : 'rotate(-90deg)';
}

function renderPanelBody() {
  const docked = orderedPanels().filter(p => p.visible && !p.floating);
  const currentIds = [...panelBody.querySelectorAll('.sub-panel')].map(e => e.dataset.panelId);
  const targetIds  = docked.map(p => p.id);

  if (currentIds.join() !== targetIds.join()) {
    panelBody.innerHTML = '';
    for (const p of docked) panelBody.appendChild(subPanelEls[p.id]);
  }

  for (const p of orderedPanels()) {
    const el = subPanelEls[p.id];
    if (!el) continue;
    if (!p.visible) { el.style.display = 'none'; continue; }
    el.style.display = '';
    el.classList.toggle('collapsed', !p.expanded);

    if (p.floating) {
      if (el.parentNode !== document.body) document.body.appendChild(el);
      el.classList.add('floating');
      el.style.left  = p.floatX + 'px';
      el.style.top   = p.floatY + 'px';
      el.style.width = p.floatW + 'px';
    } else {
      el.classList.remove('floating');
      el.style.left = el.style.top = el.style.width = '';
    }
  }
}

// ── Collapse toggle ───────────────────────────────────────────────────────────

function initCollapseToggle() {
  document.getElementById('panel-collapse-btn').addEventListener('click', () => {
    ps.mainCollapsed = !ps.mainCollapsed;
    applyMainState();
    savePanelState();
  });
}

// ── Topbar drag: move (floating) or detach (docked) ──────────────────────────

function initTopbarDrag(topbar) {
  let drag = null;

  topbar.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button')) return;
    e.preventDefault();
    const r = panelEl.getBoundingClientRect();
    drag = {
      startX: e.clientX, startY: e.clientY,
      origX: r.left, origY: r.top,
      origW: r.width, origH: r.height,
      moved: false,
    };
  });

  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && dx * dx + dy * dy < 25) return;
    drag.moved = true;

    if (!ps.panelFloating) {
      // Detach on first move past threshold
      ps.panelFloating = true;
      ps.panelFloatX = drag.origX;
      ps.panelFloatY = drag.origY;
      ps.panelFloatW = drag.origW;
      ps.panelFloatH = drag.origH;
      applyMainState();
    }

    ps.panelFloatX = drag.origX + dx;
    ps.panelFloatY = drag.origY + dy;
    panelEl.style.left = ps.panelFloatX + 'px';
    panelEl.style.top  = ps.panelFloatY + 'px';
  });

  window.addEventListener('mouseup', () => {
    if (drag?.moved && ps.panelFloating) savePanelState();
    drag = null;
  });
}

// ── Main panel float resize ───────────────────────────────────────────────────

function initPanelFloatResize(right, bottom, corner) {
  function makeResizer(onMove) {
    let drag = null;
    const start = (e) => {
      if (!ps.panelFloating || e.button !== 0) return;
      e.stopPropagation(); e.preventDefault();
      drag = {
        startX: e.clientX, startY: e.clientY,
        startW: panelEl.offsetWidth, startH: panelEl.offsetHeight,
      };
    };
    const move = (e) => { if (drag) onMove(e, drag); };
    const up   = () => { if (drag) { drag = null; savePanelState(); } };
    return { start, move, up };
  }

  const rRight  = makeResizer((e, d) => {
    ps.panelFloatW = clamp(d.startW + e.clientX - d.startX, 140, 800);
    panelEl.style.width = ps.panelFloatW + 'px';
  });
  const rBottom = makeResizer((e, d) => {
    ps.panelFloatH = clamp(d.startH + e.clientY - d.startY, 80, 900);
    panelEl.style.height = ps.panelFloatH + 'px';
  });
  const rSE = makeResizer((e, d) => {
    ps.panelFloatW = clamp(d.startW + e.clientX - d.startX, 140, 800);
    ps.panelFloatH = clamp(d.startH + e.clientY - d.startY, 80, 900);
    panelEl.style.width  = ps.panelFloatW + 'px';
    panelEl.style.height = ps.panelFloatH + 'px';
  });

  right.addEventListener('mousedown',  rRight.start);
  bottom.addEventListener('mousedown', rBottom.start);
  corner.addEventListener('mousedown', rSE.start);
  window.addEventListener('mousemove', (e) => { rRight.move(e, null); rBottom.move(e, null); rSE.move(e, null); });
  window.addEventListener('mouseup',   () => { rRight.up(); rBottom.up(); rSE.up(); });
}

// ── Main panel docked resize (left edge) ─────────────────────────────────────

function initMainResize(handle) {
  let drag = null;
  handle.addEventListener('mousedown', (e) => {
    if (ps.panelFloating) return;
    e.preventDefault();
    drag = { startX: e.clientX, startW: ps.mainWidth };
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    ps.mainWidth = clamp(drag.startW - (e.clientX - drag.startX), 140, 600);
    panelEl.style.width = ps.mainWidth + 'px';
  });
  window.addEventListener('mouseup', () => { if (drag) { drag = null; savePanelState(); } });
}

// ── Hamburger ─────────────────────────────────────────────────────────────────

function buildConfigMenu() {
  panelConfigEl.innerHTML = '';

  // Dock / Detach action
  const dockItem = document.createElement('div');
  dockItem.className = 'panel-config-action';
  dockItem.textContent = ps.panelFloating ? 'Dock panel' : 'Detach panel';
  dockItem.addEventListener('click', (e) => {
    e.stopPropagation();
    panelConfigEl.classList.remove('open');
    if (ps.panelFloating) {
      ps.panelFloating = false;
    } else {
      const r = panelEl.getBoundingClientRect();
      // Natural height = topbar + visible sub-panel rows
      const topbarH = document.getElementById('panel-topbar').offsetHeight;
      const bodyH   = [...panelBody.children]
        .filter(el => el.style.display !== 'none' && !el.classList.contains('panel-drop-indicator'))
        .reduce((sum, el) => sum + el.offsetHeight, 0);
      ps.panelFloatX = r.left - 20;
      ps.panelFloatY = r.top  + 20;
      ps.panelFloatW = r.width;
      ps.panelFloatH = Math.max(80, topbarH + bodyH + 2);
      ps.panelFloating = true;
    }
    applyMainState();
    savePanelState();
  });
  panelConfigEl.appendChild(dockItem);

  const sep = document.createElement('div');
  sep.className = 'panel-config-sep';
  panelConfigEl.appendChild(sep);

  for (const p of orderedPanels()) {
    const def = PANEL_DEFS.find(d => d.id === p.id);
    const label = document.createElement('label');
    label.className = 'panel-config-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = p.visible;
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      p.visible = cb.checked;
      if (!p.visible && p.floating) {
        subPanelEls[p.id]?.parentNode?.removeChild(subPanelEls[p.id]);
        p.floating = false;
      }
      renderPanelBody();
      savePanelState();
    });
    label.append(cb, ' ' + def.label);
    panelConfigEl.appendChild(label);
  }
}

function initHamburger() {
  const btn = document.getElementById('panel-hamburger-btn');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = panelConfigEl.classList.contains('open');
    if (!open) buildConfigMenu();
    panelConfigEl.classList.toggle('open', !open);
  });
  document.addEventListener('click', () => panelConfigEl.classList.remove('open'));
}

// ── Sub-panel collapse ────────────────────────────────────────────────────────

function initSubPanelCollapse(p, el, header) {
  header.addEventListener('click', (e) => {
    if (e.target.closest('.sub-panel-close')) return;
    p.expanded = !p.expanded;
    el.classList.toggle('collapsed', !p.expanded);
    savePanelState();
  });
}

// ── Sub-panel close ───────────────────────────────────────────────────────────

function initSubPanelClose(p, el, btn) {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    p.visible = false;
    p.floating = false;
    el.parentNode?.removeChild(el);
    savePanelState();
    if (panelConfigEl.classList.contains('open')) buildConfigMenu();
  });
}

// ── Sub-panel drag (reorder / detach) ────────────────────────────────────────

let dropIndicatorEl = null;

function initSubPanelDrag(p, el, header) {
  let drag = null;

  header.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.sub-panel-close')) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    drag = { startX: e.clientX, startY: e.clientY, origLeft: r.left, origTop: r.top, moved: false };
  });

  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && dx * dx + dy * dy < 16) return;
    drag.moved = true;

    if (p.floating) {
      el.style.left = (drag.origLeft + dx) + 'px';
      el.style.top  = (drag.origTop  + dy) + 'px';
    } else {
      const panelRect = panelEl.getBoundingClientRect();
      if (e.clientX < panelRect.left - 30) {
        removeDropIndicator();
        p.floating = true;
        p.floatX = e.clientX - 20;
        p.floatY = e.clientY - 12;
        p.floatW = ps.panelFloating ? panelEl.offsetWidth : ps.mainWidth;
        document.body.appendChild(el);
        el.classList.add('floating');
        el.style.left  = p.floatX + 'px';
        el.style.top   = p.floatY + 'px';
        el.style.width = p.floatW + 'px';
        drag.origLeft = p.floatX;
        drag.origTop  = p.floatY;
        drag.startX   = e.clientX;
        drag.startY   = e.clientY;
        renderPanelBody();
        savePanelState();
        return;
      }
      showDropIndicator(e.clientY, p.id);
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (!drag) return;
    if (p.floating) {
      p.floatX = parseInt(el.style.left) || p.floatX;
      p.floatY = parseInt(el.style.top)  || p.floatY;
      savePanelState();
    } else if (drag.moved) {
      removeDropIndicator();
      commitReorder(e.clientY, p);
    }
    drag = null;
  });
}

function showDropIndicator(clientY, excludeId) {
  removeDropIndicator();
  dropIndicatorEl = document.createElement('div');
  dropIndicatorEl.className = 'panel-drop-indicator';
  const panels = orderedPanels().filter(p => p.visible && !p.floating && p.id !== excludeId);
  let insertBefore = null;
  for (const p of panels) {
    const r = subPanelEls[p.id]?.getBoundingClientRect();
    if (r && clientY < r.top + r.height / 2) { insertBefore = subPanelEls[p.id]; break; }
  }
  insertBefore ? panelBody.insertBefore(dropIndicatorEl, insertBefore) : panelBody.appendChild(dropIndicatorEl);
}

function removeDropIndicator() {
  dropIndicatorEl?.parentNode?.removeChild(dropIndicatorEl);
  dropIndicatorEl = null;
}

function commitReorder(clientY, movedPanel) {
  const panels = orderedPanels().filter(p => p.visible && !p.floating && p.id !== movedPanel.id);
  let insertIdx = panels.length;
  for (let i = 0; i < panels.length; i++) {
    const r = subPanelEls[panels[i].id]?.getBoundingClientRect();
    if (r && clientY < r.top + r.height / 2) { insertIdx = i; break; }
  }
  panels.splice(insertIdx, 0, movedPanel);
  panels.forEach((p, i) => { p.order = i; });
  orderedPanels().filter(p => !panels.includes(p)).forEach((p, i) => { p.order = panels.length + i; });
  renderPanelBody();
  savePanelState();
}

// ── Sub-panel resize corner ───────────────────────────────────────────────────

function initSubPanelResize(p, el, corner) {
  let drag = null;
  corner.addEventListener('mousedown', (e) => {
    if (!p.floating) return;
    e.stopPropagation(); e.preventDefault();
    drag = { startX: e.clientX, startW: el.offsetWidth };
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag || !p.floating) return;
    p.floatW = clamp(drag.startW + e.clientX - drag.startX, 140, 600);
    el.style.width = p.floatW + 'px';
  });
  window.addEventListener('mouseup', () => { if (drag) { drag = null; savePanelState(); } });
}
