import { state, getActiveLayer } from '../state.js';
import { screenToDoc, isPanning } from '../viewport.js';
import { createShape } from '../shapes/index.js';
import { execute } from '../history.js';
import { render } from '../render.js';

const NS = 'http://www.w3.org/2000/svg';

let drawing = false;
let startPos = null;
let previewEl = null;

export function activate() {
  document.getElementById('canvas').style.cursor = 'crosshair';
}
export function deactivate() { cancel(); }

export function onMouseDown(e) {
  if (isPanning() || e.button !== 0) return;
  drawing = true;
  startPos = screenToDoc(e.clientX, e.clientY);

  previewEl = document.createElementNS(NS, 'ellipse');
  previewEl.setAttribute('fill', state.currentStyle.fill);
  previewEl.setAttribute('stroke', state.currentStyle.stroke);
  previewEl.setAttribute('stroke-width', state.currentStyle.strokeWidth);
  previewEl.style.pointerEvents = 'none';
  document.getElementById('overlay').appendChild(previewEl);
}

export function onMouseMove(e) {
  if (!drawing) return;
  const pos = screenToDoc(e.clientX, e.clientY);
  let rx = Math.abs(pos.x - startPos.x) / 2;
  let ry = Math.abs(pos.y - startPos.y) / 2;
  if (e.shiftKey) { const r = Math.min(rx, ry); rx = r; ry = r; }
  const cx = (startPos.x + pos.x) / 2;
  const cy = (startPos.y + pos.y) / 2;

  previewEl.setAttribute('cx', cx);
  previewEl.setAttribute('cy', cy);
  previewEl.setAttribute('rx', rx);
  previewEl.setAttribute('ry', ry);
}

export function onMouseUp(e) {
  if (!drawing) return;
  const start = startPos;
  const pos = screenToDoc(e.clientX, e.clientY);
  let rx = Math.abs(pos.x - start.x) / 2;
  let ry = Math.abs(pos.y - start.y) / 2;
  if (e.shiftKey) { const s = Math.min(rx, ry); rx = s; ry = s; }
  cancel();

  if (rx < 1 || ry < 1) return;

  const cx = (start.x + pos.x) / 2;
  const cy = (start.y + pos.y) / 2;
  const shape = createShape('ellipse', { cx, cy, rx, ry }, { ...state.currentStyle });
  const layer = getActiveLayer();

  execute({
    do()   { layer.shapes.push(shape); state.selection = new Set([shape.id]); render(); },
    undo() { layer.shapes = layer.shapes.filter(s => s.id !== shape.id); state.selection.clear(); render(); },
  });
}

export function onKeyDown(e) {
  if (e.key === 'Escape') cancel();
}

function cancel() {
  drawing = false;
  startPos = null;
  if (previewEl) { previewEl.remove(); previewEl = null; }
}
