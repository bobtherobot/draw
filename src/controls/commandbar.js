/**
 * Command bar — float/dock view mode buttons.
 */
import { state }    from '../core/state.js';
import { on, emit } from '../core/events.js';
import { getAllModes } from '../core/registry.js';
import { render }   from '../render/renderer.js';

let _barEl  = null;
let _isDocked = false;

export function initCommandbar(commandbarEl) {
  _barEl = commandbarEl;
  _build();
}

function _build() {
  _barEl.className = 'commandbar';

  // Drag handle
  const handle = _el('div', 'commandbar__handle');
  handle.innerHTML = '⠿';
  _makeDraggable(handle, _barEl);
  _barEl.appendChild(handle);

  // Separator
  const sep1 = _el('div', 'commandbar__separator');
  _barEl.appendChild(sep1);

  // Mode buttons
  const modes = getAllModes();
  for (const mode of modes) {
    const btn = _el('button', 'commandbar__btn');
    btn.dataset.mode  = mode.id;
    btn.textContent   = mode.label;
    btn.title         = mode.label;
    btn.classList.toggle('active', state.activeMode === mode.id);
    btn.addEventListener('click', () => {
      state.activeMode = mode.id;
      _refreshModes();
      emit('mode-change', { mode: mode.id });
      render();
    });
    _barEl.appendChild(btn);
  }

  // Dock toggle button
  const sep2 = _el('div', 'commandbar__separator');
  _barEl.appendChild(sep2);

  const dockBtn = _el('button', 'commandbar__btn');
  dockBtn.id       = 'dock-btn';
  dockBtn.textContent = 'Dock';
  dockBtn.addEventListener('click', () => {
    _isDocked = !_isDocked;
    _barEl.classList.toggle('docked', _isDocked);
    dockBtn.textContent = _isDocked ? 'Float' : 'Dock';
    if (_isDocked) { _barEl.style.left = ''; _barEl.style.top = ''; _barEl.style.transform = ''; }
  });
  _barEl.appendChild(dockBtn);
}

function _refreshModes() {
  for (const btn of _barEl.querySelectorAll('.commandbar__btn[data-mode]')) {
    btn.classList.toggle('active', btn.dataset.mode === state.activeMode);
  }
}

// ── Drag to float ─────────────────────────────────────────────────────────────

function _makeDraggable(handle, target) {
  let sx, sy, ox, oy;
  handle.addEventListener('mousedown', (e) => {
    if (_isDocked) return;
    e.preventDefault();
    const rect = target.getBoundingClientRect();
    ox = rect.left; oy = rect.top;
    sx = e.clientX; sy = e.clientY;
    target.style.transform = 'none';

    const onMove = (ev) => {
      target.style.left = `${ox + ev.clientX - sx}px`;
      target.style.top  = `${oy + ev.clientY - sy}px`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}

function _el(tag, cls) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  return el;
}
