import { state } from './state.js';
import { render } from './render.js';

const BAR_KEY = 'draw-commandbar-state';
const SNAP_THRESHOLD = 44; // px from top of viewport to auto-dock

export function initCommandBar() {
  const bar    = document.getElementById('command-bar');
  const handle = document.getElementById('command-bar-handle');

  // Restore persisted floating position
  try {
    const saved = JSON.parse(localStorage.getItem(BAR_KEY) || '{}');
    if (saved.floating) setFloating(bar, saved.x ?? 120, saved.y ?? 60);
  } catch {}

  handle.addEventListener('mousedown', e => onHandleMousedown(e, bar));

  // Wire up view mode buttons
  bar.querySelectorAll('.cb-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.viewMode = btn.dataset.view;
      syncButtons(bar);
      render();
    });
  });
}

export function syncCommandBarButtons() {
  const bar = document.getElementById('command-bar');
  if (bar) syncButtons(bar);
}

function syncButtons(bar) {
  bar.querySelectorAll('.cb-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.view === state.viewMode));
}

function setFloating(bar, x, y) {
  bar.classList.add('floating');
  bar.style.left = x + 'px';
  bar.style.top  = y + 'px';
}

function setDocked(bar) {
  bar.classList.remove('floating');
  bar.style.left = '';
  bar.style.top  = '';
}

function persist(bar) {
  const floating = bar.classList.contains('floating');
  const data = floating
    ? { floating: true, x: parseInt(bar.style.left) || 0, y: parseInt(bar.style.top) || 0 }
    : { floating: false };
  localStorage.setItem(BAR_KEY, JSON.stringify(data));
}

function onHandleMousedown(e, bar) {
  if (e.button !== 0) return;
  e.preventDefault();

  const wasDocked = !bar.classList.contains('floating');
  const startMouseX = e.clientX;
  const startMouseY = e.clientY;

  // If docked, we only detach once the user actually moves the mouse
  let detached = !wasDocked;
  let startBarX = 0, startBarY = 0;

  if (!wasDocked) {
    startBarX = parseInt(bar.style.left) || 0;
    startBarY = parseInt(bar.style.top)  || 0;
  }

  function onMove(ev) {
    const dx = ev.clientX - startMouseX;
    const dy = ev.clientY - startMouseY;

    if (!detached) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      // Detach: place floating bar at current mouse position
      const rect = bar.getBoundingClientRect();
      startBarX = rect.left;
      startBarY = rect.top;
      setFloating(bar, startBarX, startBarY);
      detached = true;
    }

    const newY = startBarY + dy;
    const newX = startBarX + dx;

    if (newY < SNAP_THRESHOLD) {
      setDocked(bar);
      detached = false;
      startBarX = 0;
      startBarY = 0;
    } else {
      setFloating(bar, newX, newY);
    }
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    persist(bar);
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
