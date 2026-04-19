import { state, findShape } from '../state.js';
import { render, getElement, setOverlayHook } from '../render.js';
import { execute } from '../history.js';
import { screenToDoc, isPanning } from '../viewport.js';
import { buildPathD } from './pen.js';

const NS = 'http://www.w3.org/2000/svg';
const HIT_R = 6; // screen-px hit radius for anchors and handles

// Hollow white arrow cursor used for node / direct-selection editing.
const _arrowSvg = "<svg xmlns='http://www.w3.org/2000/svg' width='12' height='16'>"
  + "<path d='M1 1L1 13L4 10L6 15L8 14L6 9L10 9Z' fill='white' stroke='%23333' stroke-width='1.2' stroke-linejoin='round'/>"
  + "</svg>";
export const HOLLOW_ARROW_CURSOR = `url("data:image/svg+xml,${_arrowSvg}") 1 1, default`;

// ── Tool mode ──────────────────────────────────────────────────
let mode = 'idle'; // 'idle' | 'drag-anchor' | 'drag-handle'

// ── Edited path state ──────────────────────────────────────────
let editingShapeId = null;
let anchors = [];
let closePath = false;

// ── Anchor selection ───────────────────────────────────────────
let selectedAnchorIndices = new Set();

// ── Drag state ─────────────────────────────────────────────────
let dragStartDoc   = null;   // doc coords at mousedown
let dragAnchorIdx  = -1;
let dragHandleSide = null;   // 'in' | 'out'
let dragSmooth     = false;  // whether dragged anchor had collinear handles at mousedown
let preDragD       = null;   // shape.attrs.d snapshot before drag
let dragged        = false;
let marqueeStart   = null;   // doc coords where marquee drag started

// ── Overlay element pool ───────────────────────────────────────
let overlayGroup = null;
let wirePath     = null; // blue wireframe of the path being edited
let marqueeEl    = null; // rubber-band selection rect
const _linePool = [], _circPool = [], _rectPool = [];
let _lu = 0, _cu = 0, _ru = 0;

function beginFrame() { _lu = 0; _cu = 0; _ru = 0; }

function poolLine(x1, y1, x2, y2, sw) {
  let el;
  if (_lu < _linePool.length) { el = _linePool[_lu]; el.style.display = ''; }
  else { el = document.createElementNS(NS, 'line'); el.setAttribute('stroke', '#0066ff'); _linePool.push(el); overlayGroup.appendChild(el); }
  _lu++;
  el.setAttribute('x1', x1); el.setAttribute('y1', y1);
  el.setAttribute('x2', x2); el.setAttribute('y2', y2);
  el.setAttribute('stroke-width', sw);
}

function poolCirc(cx, cy, radius, sw) {
  let el;
  if (_cu < _circPool.length) { el = _circPool[_cu]; el.style.display = ''; }
  else { el = document.createElementNS(NS, 'circle'); el.setAttribute('fill', 'white'); el.setAttribute('stroke', '#0066ff'); _circPool.push(el); overlayGroup.appendChild(el); }
  _cu++;
  el.setAttribute('cx', cx); el.setAttribute('cy', cy); el.setAttribute('r', radius);
  el.setAttribute('stroke-width', sw);
}

function poolRect(x, y, w, h, fill, sw) {
  let el;
  if (_ru < _rectPool.length) { el = _rectPool[_ru]; el.style.display = ''; }
  else { el = document.createElementNS(NS, 'rect'); el.setAttribute('stroke', '#0066ff'); _rectPool.push(el); overlayGroup.appendChild(el); }
  _ru++;
  el.setAttribute('x', x); el.setAttribute('y', y);
  el.setAttribute('width', w); el.setAttribute('height', h);
  el.setAttribute('fill', fill);
  el.setAttribute('stroke-width', sw);
}

function endFrame() {
  for (let i = _lu; i < _linePool.length; i++) _linePool[i].style.display = 'none';
  for (let i = _cu; i < _circPool.length; i++) _circPool[i].style.display = 'none';
  for (let i = _ru; i < _rectPool.length; i++) _rectPool[i].style.display = 'none';
}

// ── Overlay ────────────────────────────────────────────────────

function ensureOverlayEls() {
  if (!overlayGroup) {
    overlayGroup = document.createElementNS(NS, 'g');
    overlayGroup.style.pointerEvents = 'none';
    wirePath = document.createElementNS(NS, 'path');
    wirePath.setAttribute('fill', 'none');
    wirePath.setAttribute('stroke', '#0066ff');
    overlayGroup.appendChild(wirePath); // first child → behind anchors/handles
    marqueeEl = document.createElementNS(NS, 'rect');
    marqueeEl.setAttribute('fill', 'rgba(0,100,255,0.06)');
    marqueeEl.setAttribute('stroke', '#0066ff');
    marqueeEl.setAttribute('stroke-dasharray', '4 3');
    marqueeEl.style.display = 'none';
    overlayGroup.appendChild(marqueeEl); // after wirePath, pool elements appended on top
  }
  document.getElementById('overlay').appendChild(overlayGroup);
}

function _updateMarqueeEl(x1, y1, x2, y2) {
  if (!marqueeEl) return;
  const x = Math.min(x1, x2), y = Math.min(y1, y2);
  marqueeEl.setAttribute('x', x);
  marqueeEl.setAttribute('y', y);
  marqueeEl.setAttribute('width',  Math.abs(x2 - x1));
  marqueeEl.setAttribute('height', Math.abs(y2 - y1));
  marqueeEl.setAttribute('stroke-width', 1 / state.viewport.zoom);
  marqueeEl.style.display = '';
}

export function drawOverlay() {
  ensureOverlayEls();
  if (marqueeEl && mode !== 'marquee') marqueeEl.style.display = 'none';

  const z  = state.viewport.zoom;

  // Blue wireframe of the editing path
  if (wirePath) {
    const found = editingShapeId ? findShape(editingShapeId) : null;
    wirePath.setAttribute('d', found?.shape.attrs.d || '');
    wirePath.setAttribute('stroke-width', 1 / z);
  }

  if (!editingShapeId || anchors.length === 0) { beginFrame(); endFrame(); return; }
  const sw = 1 / z;
  const hs = 4 / z; // anchor square half-size
  const hr = 3 / z; // handle circle radius

  beginFrame();
  for (let i = 0; i < anchors.length; i++) {
    const a          = anchors[i];
    const isSelected = selectedAnchorIndices.has(i);

    if (isSelected) {
      if (a.hIn)  { poolLine(a.x, a.y, a.hIn.x,  a.hIn.y,  sw); poolCirc(a.hIn.x,  a.hIn.y,  hr, sw); }
      if (a.hOut) { poolLine(a.x, a.y, a.hOut.x, a.hOut.y, sw); poolCirc(a.hOut.x, a.hOut.y, hr, sw); }
    }

    poolRect(a.x - hs, a.y - hs, hs * 2, hs * 2, isSelected ? '#0066ff' : 'white', sw);
  }
  endFrame();
}

function clearOverlay() {
  if (marqueeEl) marqueeEl.style.display = 'none';
  beginFrame(); endFrame();
}

// ── Path parsing ───────────────────────────────────────────────
// Handles M, L, C, Z only — the exact set that buildPathD emits.

function parsePathD(d) {
  const result = [];
  let cp = false;

  const tokens = d.trim().split(/(?=[MLCZmlcz])/);
  for (const token of tokens) {
    if (!token.trim()) continue;
    const cmd  = token[0].toUpperCase();
    const nums = token.slice(1).trim().split(/[\s,]+/).filter(Boolean).map(Number);

    if (cmd === 'M') {
      result.push({ x: nums[0], y: nums[1], hIn: null, hOut: null });
    } else if (cmd === 'L') {
      result.push({ x: nums[0], y: nums[1], hIn: null, hOut: null });
    } else if (cmd === 'C') {
      const prev = result[result.length - 1];
      if (prev) prev.hOut = { x: nums[0], y: nums[1] };
      const endX = nums[4], endY = nums[5];
      const a0   = result[0];
      // Closing C: endpoint lands on first anchor — set hIn on a0 instead of pushing
      if (result.length > 1 && a0 && Math.abs(endX - a0.x) < 0.02 && Math.abs(endY - a0.y) < 0.02) {
        a0.hIn = { x: nums[2], y: nums[3] };
      } else {
        result.push({ x: endX, y: endY, hIn: { x: nums[2], y: nums[3] }, hOut: null });
      }
    } else if (cmd === 'Z') {
      cp = true;
    }
  }

  return { anchors: result, closePath: cp };
}

// ── Editing helpers ────────────────────────────────────────────

function getSelectedPathId() {
  for (const id of state.selection) {
    const found = findShape(id);
    if (found && found.shape.type === 'path') return id;
  }
  return null;
}

export function getEditingShapeId() { return editingShapeId; }
export function selectAnchor(idx) { selectedAnchorIndices.add(idx); }

export function beginEditing(id) {
  const found = findShape(id);
  if (!found) return;
  const sameShape = editingShapeId === id;
  editingShapeId = id;
  state.nodeEditingId = id;
  setOverlayHook(drawOverlay);
  const p = parsePathD(found.shape.attrs.d || '');
  anchors   = p.anchors;
  closePath = p.closePath;
  if (!sameShape) selectedAnchorIndices.clear();
}

function commitAnchorsToShape() {
  const found = findShape(editingShapeId);
  if (!found) return;
  const newD = buildPathD(anchors, closePath);
  found.shape.attrs.d = newD;
  const el = getElement(editingShapeId);
  if (el) el.setAttribute('d', newD);
}

// ── Hit testing (screen-space geometry) ───────────────────────

function docToScreen(docX, docY) {
  const rect = document.getElementById('canvas').getBoundingClientRect();
  const z    = state.viewport.zoom;
  return { sx: (docX - state.viewport.x) * z + rect.left, sy: (docY - state.viewport.y) * z + rect.top };
}

export function hitTestHandles(screenX, screenY) {
  for (const i of selectedAnchorIndices) {
    const a = anchors[i];
    for (const [handle, side] of [[a.hIn, 'in'], [a.hOut, 'out']]) {
      if (!handle) continue;
      const { sx, sy } = docToScreen(handle.x, handle.y);
      if (Math.hypot(screenX - sx, screenY - sy) < HIT_R) return { anchorIdx: i, side };
    }
  }
  return null;
}

export function hitTestAnchors(screenX, screenY) {
  for (let i = 0; i < anchors.length; i++) {
    const { sx, sy } = docToScreen(anchors[i].x, anchors[i].y);
    if (Math.hypot(screenX - sx, screenY - sy) < HIT_R) return i;
  }
  return -1;
}

function getShapeIdAt(target) {
  let el = target;
  while (el && el !== document.getElementById('canvas')) {
    if (el.dataset?.shapeId) return el.dataset.shapeId;
    el = el.parentElement;
  }
  return null;
}

// Detect whether an anchor's handles were collinear (smooth) at a given moment.
function isSmooth(anchor) {
  if (!anchor.hIn || !anchor.hOut) return false;
  const ex = anchor.x - (anchor.hOut.x - anchor.x);
  const ey = anchor.y - (anchor.hOut.y - anchor.y);
  return Math.hypot(anchor.hIn.x - ex, anchor.hIn.y - ey) < 0.5;
}

// ── Delete selected anchors ────────────────────────────────────

function deleteSelectedAnchors() {
  if (!editingShapeId || selectedAnchorIndices.size === 0) return;
  const found = findShape(editingShapeId);
  if (!found) return;

  const oldD    = found.shape.attrs.d;
  const shapeId = editingShapeId;

  if (selectedAnchorIndices.size === anchors.length) {
    // All anchors selected — delete the whole shape
    const { shape, layer } = found;
    const idx = layer.shapes.indexOf(shape);
    execute({
      do() {
        const f = findShape(shapeId);
        if (f) f.layer.shapes.splice(f.layer.shapes.indexOf(f.shape), 1);
        state.selection.delete(shapeId);
        if (editingShapeId === shapeId) {
          editingShapeId = null;
          anchors        = [];
          selectedAnchorIndices.clear();
        }
        clearOverlay();
        render();
      },
      undo() {
        layer.shapes.splice(idx, 0, shape);
        render();
      },
    });
    return;
  }

  // Partial delete — remove selected anchors and rebuild path
  const newAnchors = anchors.filter((_, i) => !selectedAnchorIndices.has(i));
  if (newAnchors.length < 2) closePath = false;
  const newD = buildPathD(newAnchors, closePath);
  found.shape.attrs.d = newD;
  anchors = newAnchors;
  selectedAnchorIndices.clear();

  execute({
    do() {
      const f = findShape(shapeId);
      if (f) { f.shape.attrs.d = newD; }
      render();
      if (state.activeTool === 'node' && editingShapeId === shapeId) drawOverlay();
    },
    undo() {
      const f = findShape(shapeId);
      if (f) {
        f.shape.attrs.d = oldD;
        if (state.activeTool === 'node' && editingShapeId === shapeId) {
          const p = parsePathD(oldD);
          anchors   = p.anchors;
          closePath = p.closePath;
        }
      }
      render();
      if (state.activeTool === 'node' && editingShapeId === shapeId) drawOverlay();
    },
  });

  drawOverlay();
}

// ── Public API ─────────────────────────────────────────────────

export function activate() {
  document.getElementById('canvas').style.cursor = HOLLOW_ARROW_CURSOR;
  mode           = 'idle';
  dragged        = false;
  dragStartDoc   = null;
  dragAnchorIdx  = -1;
  dragHandleSide = null;
  dragSmooth     = false;
  preDragD       = null;

  const pathId = getSelectedPathId();
  if (pathId) {
    beginEditing(pathId);
  } else {
    editingShapeId = null;
    anchors        = [];
    closePath      = false;
    selectedAnchorIndices.clear();
  }
  drawOverlay();
}

export function deactivate() {
  state.nodeEditingId = null;
  setOverlayHook(null);
  overlayGroup?.remove();
  editingShapeId = null;
  anchors        = [];
  closePath      = false;
  selectedAnchorIndices.clear();
  mode           = 'idle';
  dragged        = false;
}

export function onMouseDown(e) {
  if (isPanning() || e.button !== 0) return;

  dragStartDoc = screenToDoc(e.clientX, e.clientY);
  dragged      = false;

  // 1. Handles first — only visible when their anchor is selected
  const handleHit = hitTestHandles(e.clientX, e.clientY);
  if (handleHit) {
    dragAnchorIdx  = handleHit.anchorIdx;
    dragHandleSide = handleHit.side;
    dragSmooth     = isSmooth(anchors[dragAnchorIdx]);
    preDragD       = findShape(editingShapeId)?.shape.attrs.d ?? null;
    mode           = 'drag-handle';
    return;
  }

  // 2. Anchor squares
  const anchorIdx = hitTestAnchors(e.clientX, e.clientY);
  if (anchorIdx !== -1) {
    if (e.shiftKey) {
      if (selectedAnchorIndices.has(anchorIdx)) selectedAnchorIndices.delete(anchorIdx);
      else selectedAnchorIndices.add(anchorIdx);
    } else if (!selectedAnchorIndices.has(anchorIdx)) {
      selectedAnchorIndices.clear();
      selectedAnchorIndices.add(anchorIdx);
    }
    dragAnchorIdx = anchorIdx;
    preDragD      = findShape(editingShapeId)?.shape.attrs.d ?? null;
    mode          = 'drag-anchor';
    drawOverlay();
    return;
  }

  // 3. Shape body
  const shapeId = getShapeIdAt(e.target);
  if (shapeId) {
    const found = findShape(shapeId);
    if (found?.shape.type === 'path' && shapeId !== editingShapeId) {
      // Different path — begin editing it
      state.selection.clear();
      state.selection.add(shapeId);
      beginEditing(shapeId);
      drawOverlay();
      render();
      return;
    }
    if (found?.shape.type !== 'path' && editingShapeId) {
      // Non-path clicked while editing — exit node editing
      state.nodeEditingId = null;
      setOverlayHook(null);
      editingShapeId = null;
      anchors        = [];
      closePath      = false;
      selectedAnchorIndices.clear();
      state.selection.clear();
      state.selection.add(shapeId);
      clearOverlay();
      render();
      return;
    }
    // Same path body — fall through to marquee
    // Non-path when not editing — fall through to step 4
  }

  // 4. Empty area (or same shape body hit) — marquee if editing, else full deselect
  if (editingShapeId) {
    if (!e.shiftKey) selectedAnchorIndices.clear();
    marqueeStart = dragStartDoc;
    mode         = 'marquee';
    drawOverlay();
  } else {
    state.selection.clear();
    selectedAnchorIndices.clear();
    anchors   = [];
    closePath = false;
    clearOverlay();
    render();
  }
}

export function onMouseMove(e) {
  if (mode === 'marquee') {
    if (e.buttons === 0) { onMouseUp(e); return; }
    const cur = screenToDoc(e.clientX, e.clientY);
    const dx = cur.x - dragStartDoc.x;
    const dy = cur.y - dragStartDoc.y;
    if (!dragged && Math.hypot(dx, dy) < 1 / state.viewport.zoom) return;
    dragged = true;
    ensureOverlayEls();
    _updateMarqueeEl(dragStartDoc.x, dragStartDoc.y, cur.x, cur.y);
    return;
  }
  if (mode === 'idle') return;
  if (e.buttons === 0) { onMouseUp(e); return; }

  const pos = screenToDoc(e.clientX, e.clientY);
  const dx  = pos.x - dragStartDoc.x;
  const dy  = pos.y - dragStartDoc.y;

  if (!dragged && Math.hypot(dx, dy) < 1 / state.viewport.zoom) return;
  dragged = true;

  if (mode === 'drag-anchor') {
    for (const i of selectedAnchorIndices) {
      const a = anchors[i];
      if (a.hIn)  { a.hIn.x  += dx; a.hIn.y  += dy; }
      if (a.hOut) { a.hOut.x += dx; a.hOut.y += dy; }
      a.x += dx;
      a.y += dy;
    }
    dragStartDoc = pos; // incremental: next frame delta is relative to current pos
  }

  if (mode === 'drag-handle') {
    const a = anchors[dragAnchorIdx];
    if (dragHandleSide === 'out') {
      a.hOut = { x: pos.x, y: pos.y };
      if (dragSmooth && a.hIn) a.hIn = { x: 2 * a.x - pos.x, y: 2 * a.y - pos.y };
    } else {
      a.hIn = { x: pos.x, y: pos.y };
      if (dragSmooth && a.hOut) a.hOut = { x: 2 * a.x - pos.x, y: 2 * a.y - pos.y };
    }
  }

  commitAnchorsToShape();
  drawOverlay();
}

export function onMouseUp(e) {
  try {
    if (mode === 'marquee') {
      if (marqueeEl) marqueeEl.style.display = 'none';
      if (dragged && marqueeStart) {
        const cur  = screenToDoc(e.clientX, e.clientY);
        const minX = Math.min(marqueeStart.x, cur.x);
        const maxX = Math.max(marqueeStart.x, cur.x);
        const minY = Math.min(marqueeStart.y, cur.y);
        const maxY = Math.max(marqueeStart.y, cur.y);
        for (let i = 0; i < anchors.length; i++) {
          const a = anchors[i];
          if (a.x >= minX && a.x <= maxX && a.y >= minY && a.y <= maxY) {
            selectedAnchorIndices.add(i);
          }
        }
      }
      marqueeStart = null;
    } else if ((mode === 'drag-anchor' || mode === 'drag-handle') && dragged) {
      const found = findShape(editingShapeId);
      if (found && preDragD !== null) {
        const oldD    = preDragD;
        const newD    = found.shape.attrs.d;
        const shapeId = editingShapeId;
        if (oldD !== newD) {
          execute({
            do() {
              const f = findShape(shapeId);
              if (f) { f.shape.attrs.d = newD; }
              render();
              if (state.activeTool === 'node' && editingShapeId === shapeId) drawOverlay();
            },
            undo() {
              const f = findShape(shapeId);
              if (f) {
                f.shape.attrs.d = oldD;
                if (state.activeTool === 'node' && editingShapeId === shapeId) {
                  const p = parsePathD(oldD);
                  anchors   = p.anchors;
                  closePath = p.closePath;
                }
              }
              render();
              if (state.activeTool === 'node' && editingShapeId === shapeId) drawOverlay();
            },
          });
          return; // finally still runs before return
        }
      }
    }
  } finally {
    mode           = 'idle';
    dragged        = false;
    dragAnchorIdx  = -1;
    dragHandleSide = null;
    dragSmooth     = false;
    preDragD       = null;
    marqueeStart   = null;
  }
  drawOverlay();
}

export function onKeyDown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    document.querySelector('.tool-btn[data-tool="select"]')?.click();
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && editingShapeId) {
    e.preventDefault();
    deleteSelectedAnchors();
  }
}
