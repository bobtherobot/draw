// Point text tool — click to place a text cursor, type freely.
import { state, getActiveLayer } from '../state.js';
import { screenToDoc, isPanning } from '../viewport.js';
import { createShape } from '../shapes/index.js';
import { execute } from '../history.js';
import { render } from '../render.js';
import { initTextEditor, startEditing, commit, isEditing } from './_textedit.js';

export function activate() {
  document.getElementById('canvas').style.cursor = 'text';
  initTextEditor();
}

export function deactivate() { commit(); }

export function onMouseDown(e) {
  if (isPanning() || e.button !== 0) return;
  // If already editing, commit then fall through to start a new text at click pos
  if (isEditing()) commit();
  const pos = screenToDoc(e.clientX, e.clientY);
  placeText(pos);
}

export function onMouseMove() {}
export function onMouseUp()   {}
export function onKeyDown(e)  { if (e.key === 'Escape') commit(); }

function placeText(pos) {
  const layer = getActiveLayer();
  const fill  = state.currentStyle.fill;

  startEditing({
    docX: pos.x, docY: pos.y,
    fontSize: 16,
    fill,
    onCommit({ text, docX, docY, fontSize }) {
      if (!text.trim()) return;
      const shape = createShape('text',
        { x: docX, y: docY },
        { fill: fill === 'none' ? '#000000' : fill, stroke: 'none', strokeWidth: 0 },
      );
      shape._text     = text;
      shape._fontSize = fontSize;
      shape._isArea   = false;
      execute({
        do()   { layer.shapes.push(shape); state.selection = new Set([shape.id]); render(); },
        undo() { layer.shapes = layer.shapes.filter(s => s.id !== shape.id); state.selection.clear(); render(); },
      });
    },
  });
}
