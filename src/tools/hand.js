import { state } from '../state.js';
import { screenToDoc, updateViewBox } from '../viewport.js';

let dragging = false;
let anchor = null;
let vpSnap = null;

export function activate()   { document.getElementById('canvas').style.cursor = 'grab'; }
export function deactivate() { dragging = false; document.getElementById('canvas').style.cursor = ''; }

export function onMouseDown(e) {
  dragging = true;
  anchor = { x: e.clientX, y: e.clientY };
  vpSnap = { ...state.viewport };
  document.getElementById('canvas').style.cursor = 'grabbing';
}

export function onMouseMove(e) {
  if (!dragging) return;
  const z = state.viewport.zoom;
  state.viewport.x = vpSnap.x - (e.clientX - anchor.x) / z;
  state.viewport.y = vpSnap.y - (e.clientY - anchor.y) / z;
  updateViewBox();
}

export function onMouseUp() {
  dragging = false;
  document.getElementById('canvas').style.cursor = 'grab';
}

export function onKeyDown() {}
