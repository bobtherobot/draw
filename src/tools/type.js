// Text-line tool — click to create, hover to edit existing text-line shapes.
import { state, findShape, getActiveLayer } from '../state.js';
import { screenToDoc, isPanning } from '../viewport.js';
import { createShape, measureTextWidth } from '../shapes/index.js';
import { execute } from '../history.js';
import { render, setOverlayHook, getElement } from '../render.js';
import { initTextEditor, startEditing, commit, isEditing } from './_textedit.js';

const NS = 'http://www.w3.org/2000/svg';

let hoverShape       = null; // text-line shape currently under cursor
let _baselineLines   = [];   // overlay line elements (one per text line)
let _nodeBox         = null; // overlay node box shown while creating/editing
let _editingDocX     = null;
let _editingDocY     = null;
let _editingFontSize = null;
let _editingShapeId  = null; // set when re-editing existing shape (not creating)

// ── Helpers ────────────────────────────────────────────────────────────────────

function getTextLineShapeAt(target) {
  let el = target;
  while (el && el.id !== 'canvas') {
    if (el.dataset?.shapeId) {
      const f = findShape(el.dataset.shapeId);
      if (f?.shape.type === 'text' && !f.shape._isArea) return f;
    }
    el = el.parentElement;
  }
  return null;
}

function ensureOverlayEls(lineCount = 1) {
  const ov = document.getElementById('overlay');
  while (_baselineLines.length < lineCount) {
    const bl = document.createElementNS(NS, 'line');
    bl.setAttribute('stroke', '#5577aa');
    bl.style.pointerEvents = 'none';
    _baselineLines.push(bl);
  }
  for (const bl of _baselineLines) ov.appendChild(bl);
  if (!_nodeBox) {
    _nodeBox = document.createElementNS(NS, 'rect');
    _nodeBox.setAttribute('fill',   'white');
    _nodeBox.setAttribute('stroke', '#5577aa');
    _nodeBox.style.pointerEvents = 'none';
  }
  ov.appendChild(_nodeBox);
}

function updateOverlayEls(text) {
  if (_editingDocX === null) return;
  const z        = state.viewport.zoom;
  const sw       = 1 / z;
  const hs       = 3.5 / z;
  const fontSize = _editingFontSize || 16;
  const lineH    = fontSize * 1.3;
  const lines    = (text || '').split('\n');

  ensureOverlayEls(lines.length);

  for (let i = lines.length; i < _baselineLines.length; i++)
    _baselineLines[i].style.display = 'none';

  for (let i = 0; i < lines.length; i++) {
    const baselineY = _editingDocY + fontSize + i * lineH;
    const textW     = Math.max(measureTextWidth(lines[i], fontSize), 20);
    const bl        = _baselineLines[i];
    bl.setAttribute('x1',           _editingDocX);
    bl.setAttribute('y1',           baselineY);
    bl.setAttribute('x2',           _editingDocX + textW);
    bl.setAttribute('y2',           baselineY);
    bl.setAttribute('stroke-width', sw);
    bl.style.display = '';
  }

  const firstBaselineY = _editingDocY + fontSize;
  _nodeBox.setAttribute('x',            _editingDocX - hs);
  _nodeBox.setAttribute('y',            firstBaselineY - hs);
  _nodeBox.setAttribute('width',        hs * 2);
  _nodeBox.setAttribute('height',       hs * 2);
  _nodeBox.setAttribute('stroke-width', sw);
}

function clearOverlayEls() {
  for (const bl of _baselineLines) bl.remove();
  _baselineLines = [];
  if (_nodeBox) { _nodeBox.remove(); _nodeBox = null; }
  setOverlayHook(null);
  if (_editingShapeId) {
    const el = getElement(_editingShapeId);
    if (el) el.style.display = '';
  }
  _editingDocX = _editingDocY = _editingFontSize = _editingShapeId = null;
}

// ── Activate / deactivate ──────────────────────────────────────────────────────

export function activate() {
  document.getElementById('canvas').style.cursor = 'default';
  hoverShape = null;
  initTextEditor();
}

export function deactivate() {
  clearOverlayEls();
  hoverShape = null;
  commit();
}

// ── Mouse handlers ─────────────────────────────────────────────────────────────

export function onMouseMove(e) {
  if (isPanning()) return;
  const found = getTextLineShapeAt(e.target);
  hoverShape = found || null;
  document.getElementById('canvas').style.cursor = found ? 'text' : 'default';
}

export function onMouseDown(e) {
  if (isPanning() || e.button !== 0) return;

  if (isEditing()) {
    // Clicking while textarea active — commit and decide what happens next
    const clickedFound = getTextLineShapeAt(e.target);
    commit();
    clearOverlayEls();
    render();
    if (clickedFound) {
      // Clicked a different text-line — open it
      openExistingText(clickedFound.shape);
    }
    return;
  }

  if (hoverShape) {
    openExistingText(hoverShape.shape);
  } else {
    const pos = screenToDoc(e.clientX, e.clientY);
    createNewText(pos);
  }
}

export function onMouseUp()  {}
export function onKeyDown(e) { if (e.key === 'Escape') { commit(); clearOverlayEls(); render(); } }

// ── Text operations ────────────────────────────────────────────────────────────

function createNewText(pos) {
  const layer = getActiveLayer();
  const fill  = state.currentStyle.fill;
  const fontSize = 16;

  _editingDocX     = pos.x;
  _editingDocY     = pos.y;
  _editingFontSize = fontSize;
  _editingShapeId  = null;

  let _currentText = '';
  setOverlayHook(() => updateOverlayEls(_currentText));
  updateOverlayEls('');

  startEditing({
    docX: pos.x, docY: pos.y,
    fontSize,
    fill,
    onInput(text) { _currentText = text; updateOverlayEls(text); },
    onCommit({ text, docX, docY, fontSize: fs }) {
      clearOverlayEls();
      if (!text.trim()) { render(); return; }
      const shape = createShape('text',
        { x: docX, y: docY },
        { fill: fill === 'none' ? '#000000' : fill, stroke: 'none', strokeWidth: 0 },
      );
      shape._text     = text;
      shape._fontSize = fs;
      shape._isArea   = false;
      execute({
        do()   { layer.shapes.push(shape); state.selection = new Set([shape.id]); render(); },
        undo() { layer.shapes = layer.shapes.filter(s => s.id !== shape.id); state.selection.clear(); render(); },
      });
    },
  });
}

function openExistingText(shape) {
  const oldText = shape._text;
  const shapeId = shape.id;

  _editingDocX     = shape.attrs.x;
  _editingDocY     = shape.attrs.y;
  _editingFontSize = shape._fontSize || 16;
  _editingShapeId  = shapeId;

  const svgEl = getElement(shapeId);
  if (svgEl) svgEl.style.display = 'none';

  let _liveText = shape._text || '';
  setOverlayHook(() => updateOverlayEls(_liveText));
  updateOverlayEls(_liveText);

  state.selection = new Set([shapeId]);
  render();

  startEditing({
    docX:        shape.attrs.x,
    docY:        shape.attrs.y,
    fontSize:    shape._fontSize || 16,
    fill:        shape.style.fill,
    initialText: shape._text || '',
    onInput(text) { _liveText = text; updateOverlayEls(text); },
    onCommit({ text }) {
      clearOverlayEls();
      if (text === oldText) { render(); return; }
      execute({
        do()   { const f = findShape(shapeId); if (f) { f.shape._text = text;    render(); } },
        undo() { const f = findShape(shapeId); if (f) { f.shape._text = oldText; render(); } },
      });
    },
  });
}
