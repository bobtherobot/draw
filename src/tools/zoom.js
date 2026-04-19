import { state } from '../state.js';
import { screenToDoc, updateViewBox } from '../viewport.js';

export function activate()   { document.getElementById('canvas').style.cursor = 'zoom-in'; }
export function deactivate() { document.getElementById('canvas').style.cursor = ''; }

export function onMouseDown(e) {
  if (e.button !== 0) return;
  const factor = e.altKey ? 1 / 1.5 : 1.5;
  const before = screenToDoc(e.clientX, e.clientY);
  state.viewport.zoom = Math.max(0.05, Math.min(64, state.viewport.zoom * factor));
  const after = screenToDoc(e.clientX, e.clientY);
  state.viewport.x -= after.x - before.x;
  state.viewport.y -= after.y - before.y;
  updateViewBox();
  document.getElementById('canvas').style.cursor = e.altKey ? 'zoom-out' : 'zoom-in';
}

export function onMouseMove(e) {
  document.getElementById('canvas').style.cursor = e.altKey ? 'zoom-out' : 'zoom-in';
}
export function onMouseUp()  {}
export function onKeyDown()  {}
