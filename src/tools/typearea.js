// Area text tool — drag to define a bounding box, then type inside it.
// Text wraps to fit the box width.
import { state, getActiveLayer } from '../state.js';
import { screenToDoc, isPanning } from '../viewport.js';
import { createShape } from '../shapes/index.js';
import { execute } from '../history.js';
import { render } from '../render.js';
import { initTextEditor, startEditing, commit, isEditing } from './_textedit.js';

const NS = 'http://www.w3.org/2000/svg';
let drawing  = false;
let startPos = null;
let preview  = null;

export function activate() {
  document.getElementById('canvas').style.cursor = 'crosshair';
  initTextEditor();
}

export function deactivate() {
  cancelDraw();
  commit();
}

export function onMouseDown(e) {
  if (isPanning() || e.button !== 0) return;
  if (isEditing()) { commit(); return; }
  drawing  = true;
  startPos = screenToDoc(e.clientX, e.clientY);

  preview = document.createElementNS(NS, 'rect');
  preview.setAttribute('fill', 'rgba(0,100,255,0.04)');
  preview.setAttribute('stroke', '#0066ff');
  preview.setAttribute('stroke-width', 1 / state.viewport.zoom);
  preview.setAttribute('stroke-dasharray', `${4 / state.viewport.zoom}`);
  preview.style.pointerEvents = 'none';
  document.getElementById('overlay').appendChild(preview);
}

export function onMouseMove(e) {
  if (!drawing || !preview) return;
  const pos = screenToDoc(e.clientX, e.clientY);
  preview.setAttribute('x',      Math.min(startPos.x, pos.x));
  preview.setAttribute('y',      Math.min(startPos.y, pos.y));
  preview.setAttribute('width',  Math.abs(pos.x - startPos.x));
  preview.setAttribute('height', Math.abs(pos.y - startPos.y));
}

export function onMouseUp(e) {
  if (!drawing) return;
  const start = startPos;
  const pos   = screenToDoc(e.clientX, e.clientY);
  cancelDraw();

  const w = Math.abs(pos.x - start.x);
  const h = Math.abs(pos.y - start.y);
  if (w < 10 || h < 10) return; // too small — ignore

  const x = Math.min(start.x, pos.x);
  const y = Math.min(start.y, pos.y);

  const layer = getActiveLayer();
  const fill  = state.currentStyle.fill;

  startEditing({
    docX: x, docY: y,
    boxWidth: w, boxHeight: h,
    fontSize: 16,
    fill,
    onCommit({ text, docX, docY, fontSize, boxWidth, boxHeight }) {
      if (!text.trim()) return;
      const shape = createShape('text',
        { x: docX, y: docY },
        { fill: fill === 'none' ? '#000000' : fill, stroke: 'none', strokeWidth: 0 },
      );
      shape._text      = text;
      shape._fontSize  = fontSize;
      shape._isArea    = true;
      shape._boxWidth  = boxWidth;
      shape._boxHeight = boxHeight;
      execute({
        do()   { layer.shapes.push(shape); state.selection = new Set([shape.id]); render(); },
        undo() { layer.shapes = layer.shapes.filter(s => s.id !== shape.id); state.selection.clear(); render(); },
      });
    },
  });
}

export function onKeyDown(e) {
  if (e.key === 'Escape') { cancelDraw(); commit(); }
}

function cancelDraw() {
  drawing  = false;
  startPos = null;
  if (preview) { preview.remove(); preview = null; }
}
