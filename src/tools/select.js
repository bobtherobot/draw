import { state, findShape } from '../state.js';
import { render, getElement, offsetTextGuidesForDrag } from '../render.js';
import { execute } from '../history.js';
import { screenToDoc, isPanning } from '../viewport.js';
import { translateShape, syncElement, getBBox } from '../shapes/index.js';

const NS = 'http://www.w3.org/2000/svg';

let mode     = 'idle'; // 'idle' | 'move' | 'band'
let dragStart = null;
let moved     = false;

let snapshots = new Map(); // shapeId → attrs at drag start (for undo)
let dragBBoxes = new Map(); // shapeId → initial bbox {x,y,width,height} (for selection rect)
let dragSelEl  = null;     // persistent selection rect element during drag
let bandEl     = null;

// ── Activate / deactivate ──────────────────────────────────────────────────────

export function activate() {
  document.getElementById('canvas').style.cursor = 'default';
  mode = 'idle';
  moved = false;
  dragStart = null;
  snapshots.clear();
  cleanupDrag();
  cancelBand();
}

export function deactivate() {
  cleanupDrag();
  cancelBand();
  mode  = 'idle';
  moved = false;
  snapshots.clear();
}

// ── Mouse handlers ─────────────────────────────────────────────────────────────

export function onMouseDown(e) {
  if (isPanning()) return;
  dragStart = screenToDoc(e.clientX, e.clientY);
  moved = false;

  const shapeId = getShapeIdAt(e.target);

  if (shapeId) {
    if (e.shiftKey) {
      if (state.selection.has(shapeId)) state.selection.delete(shapeId);
      else state.selection.add(shapeId);
      render();
      mode = 'idle';
    } else {
      if (!state.selection.has(shapeId)) {
        state.selection.clear();
        state.selection.add(shapeId);
      }
      snapshots.clear();
      for (const id of state.selection) {
        const found = findShape(id);
        if (found) snapshots.set(id, JSON.parse(JSON.stringify(found.shape.attrs)));
      }
      mode = 'move';
      initDrag(); // cache bboxes, create persistent selection rect
    }
  } else {
    if (!e.shiftKey) { state.selection.clear(); render(); }
    mode  = 'band';
    bandEl = makeBandEl();
    document.getElementById('overlay').appendChild(bandEl);
  }
}

export function onMouseMove(e) {
  if (mode === 'idle') return;
  if (mode === 'move' && e.buttons === 0) { onMouseUp(e); return; }

  const pos = screenToDoc(e.clientX, e.clientY);
  const dx  = pos.x - dragStart.x;
  const dy  = pos.y - dragStart.y;

  if (mode === 'move') {
    moved = true;
    // Apply a native SVG transform to each selected element — no attr mutation,
    // no text re-layout, no path string parsing. The browser handles the offset.
    for (const id of state.selection) {
      const el = getElement(id);
      if (el) el.setAttribute('transform', `translate(${dx},${dy})`);
    }
    // Update the cached selection rect and text guide positions cheaply.
    updateDragSelEl(dx, dy);
    offsetTextGuidesForDrag(state.selection, dx, dy);
  }

  if (mode === 'band') {
    updateBand(dragStart, pos);
  }
}

export function onMouseUp(e) {
  try {
    if (mode === 'move' && moved) {
      const endPos = screenToDoc(e.clientX, e.clientY);
      const dx = endPos.x - dragStart.x;
      const dy = endPos.y - dragStart.y;

      // Clear SVG transforms and remove drag selection rect before committing.
      cleanupDrag();

      if (Math.hypot(dx, dy) > 1 / state.viewport.zoom) {
        // Meaningful drag — apply translations to shape.attrs and commit to undo.
        const oldAttrs = new Map(snapshots);
        const newAttrs = new Map();
        for (const id of state.selection) {
          const found = findShape(id);
          if (!found) continue;
          const snap = snapshots.get(id);
          if (snap) Object.assign(found.shape.attrs, JSON.parse(JSON.stringify(snap)));
          translateShape(found.shape, dx, dy);
          newAttrs.set(id, JSON.parse(JSON.stringify(found.shape.attrs)));
        }
        execute({
          do() {
            for (const [id, attrs] of newAttrs) {
              const f = findShape(id); if (f) Object.assign(f.shape.attrs, attrs);
            }
            render();
          },
          undo() {
            for (const [id, attrs] of oldAttrs) {
              const f = findShape(id); if (f) Object.assign(f.shape.attrs, attrs);
            }
            render();
          },
        });
      } else {
        // Plain click (no real movement) — restore from snapshot and full render
        // so the layers panel and object info reflect the new selection.
        for (const [id, attrs] of snapshots) {
          const f = findShape(id);
          if (f) Object.assign(f.shape.attrs, JSON.parse(JSON.stringify(attrs)));
        }
        render();
      }
    }
    if (mode === 'band') finishBand(e);
  } finally {
    mode  = 'idle';
    moved = false;
    snapshots.clear();
  }
}

export function onKeyDown(e) {}

// ── Drag helpers ───────────────────────────────────────────────────────────────

function initDrag() {
  // Cache bounding boxes so we can compute the selection rect during drag
  // without calling getBBox() (which can force layout) on every frame.
  dragBBoxes.clear();
  for (const id of state.selection) {
    const found = findShape(id);
    if (!found) continue;
    const s = found.shape;
    if (s.type === 'text' && s._isArea) {
      dragBBoxes.set(id, { x: +(s.attrs.x ?? 0), y: +(s.attrs.y ?? 0), width: s._boxWidth ?? 0, height: s._boxHeight ?? 0 });
    } else {
      const el = getElement(id);
      if (el) {
        try {
          const bb = el.getBBox();
          if (bb && (bb.width > 0 || bb.height > 0))
            dragBBoxes.set(id, { x: bb.x, y: bb.y, width: bb.width, height: bb.height });
        } catch {}
      }
    }
  }

  // Replace overlay contents with a persistent selection rect for the drag session.
  const ov = document.getElementById('overlay');
  ov.innerHTML = '';
  dragSelEl = document.createElementNS(NS, 'rect');
  dragSelEl.setAttribute('fill', 'none');
  dragSelEl.setAttribute('stroke', '#0066ff');
  dragSelEl.style.pointerEvents = 'none';
  ov.appendChild(dragSelEl);
  updateDragSelEl(0, 0);
}

function updateDragSelEl(dx, dy) {
  if (!dragSelEl || dragBBoxes.size === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const bb of dragBBoxes.values()) {
    minX = Math.min(minX, bb.x);
    minY = Math.min(minY, bb.y);
    maxX = Math.max(maxX, bb.x + bb.width);
    maxY = Math.max(maxY, bb.y + bb.height);
  }
  if (!isFinite(minX)) return;
  const z  = state.viewport.zoom;
  const sw = 1 / z;
  dragSelEl.setAttribute('x',            minX + dx - sw);
  dragSelEl.setAttribute('y',            minY + dy - sw);
  dragSelEl.setAttribute('width',        maxX - minX + sw * 2);
  dragSelEl.setAttribute('height',       maxY - minY + sw * 2);
  dragSelEl.setAttribute('stroke-width', sw);
  dragSelEl.setAttribute('stroke-dasharray', `${4 / z},${3 / z}`);
}

function cleanupDrag() {
  // Remove SVG transforms applied during drag.
  for (const id of dragBBoxes.keys()) {
    const el = getElement(id);
    if (el) el.removeAttribute('transform');
  }
  if (dragSelEl) { dragSelEl.remove(); dragSelEl = null; }
  dragBBoxes.clear();
}

// ── Rubber-band helpers ────────────────────────────────────────────────────────

function makeBandEl() {
  const r = document.createElementNS(NS, 'rect');
  r.setAttribute('fill', 'rgba(0,100,255,0.1)');
  r.setAttribute('stroke', '#0066ff');
  r.setAttribute('stroke-width', 1 / state.viewport.zoom);
  r.style.pointerEvents = 'none';
  return r;
}

function updateBand(a, b) {
  if (!bandEl) return;
  bandEl.setAttribute('x',      Math.min(a.x, b.x));
  bandEl.setAttribute('y',      Math.min(a.y, b.y));
  bandEl.setAttribute('width',  Math.abs(b.x - a.x));
  bandEl.setAttribute('height', Math.abs(b.y - a.y));
}

function finishBand(e) {
  if (!bandEl) return;
  const pos = screenToDoc(e.clientX, e.clientY);
  const x1  = Math.min(dragStart.x, pos.x);
  const y1  = Math.min(dragStart.y, pos.y);
  const x2  = Math.max(dragStart.x, pos.x);
  const y2  = Math.max(dragStart.y, pos.y);
  cancelBand();

  if (x2 - x1 < 2 && y2 - y1 < 2) return;

  if (!e.shiftKey) state.selection.clear();
  for (const layer of state.layers) {
    if (!layer.visible || layer.locked) continue;
    for (const shape of layer.shapes) {
      const bb = getBBox(shape);
      if (!bb) continue;
      if (bb.x >= x1 && bb.y >= y1 && bb.x + bb.width <= x2 && bb.y + bb.height <= y2)
        state.selection.add(shape.id);
    }
  }
  render();
}

function cancelBand() {
  if (bandEl) { bandEl.remove(); bandEl = null; }
}

function getShapeIdAt(target) {
  let el = target;
  while (el && el !== document.getElementById('canvas')) {
    if (el.dataset?.shapeId) return el.dataset.shapeId;
    el = el.parentElement;
  }
  return null;
}
