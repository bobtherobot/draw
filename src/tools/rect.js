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

  previewEl = document.createElementNS(NS, 'rect');
  previewEl.setAttribute('fill', state.currentStyle.fill);
  previewEl.setAttribute('stroke', state.currentStyle.stroke);
  previewEl.setAttribute('stroke-width', state.currentStyle.strokeWidth);
  previewEl.style.pointerEvents = 'none';
  document.getElementById('overlay').appendChild(previewEl);
}

export function onMouseMove(e) {
  if (!drawing) return;
  const pos = screenToDoc(e.clientX, e.clientY);
  let x = Math.min(startPos.x, pos.x);
  let y = Math.min(startPos.y, pos.y);
  let w = Math.abs(pos.x - startPos.x);
  let h = Math.abs(pos.y - startPos.y);
  if (e.shiftKey) { const s = Math.min(w, h); w = s; h = s; }

  previewEl.setAttribute('x', x);
  previewEl.setAttribute('y', y);
  previewEl.setAttribute('width',  w);
  previewEl.setAttribute('height', h);
}

export function onMouseUp(e) {
  if (!drawing) return;
  const start = startPos;
  const pos = screenToDoc(e.clientX, e.clientY);
  let w = Math.abs(pos.x - start.x);
  let h = Math.abs(pos.y - start.y);
  if (e.shiftKey) { const s = Math.min(w, h); w = s; h = s; }
  cancel();

  if (w < 1 || h < 1) return;

  const x = Math.min(start.x, pos.x);
  const y = Math.min(start.y, pos.y);
  const shape = createShape('rect', { x, y, width: w, height: h }, { ...state.currentStyle });
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
