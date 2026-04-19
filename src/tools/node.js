import { state, findShape } from '../state.js';
import { render, getElement, setOverlayHook } from '../render.js';
import { execute } from '../history.js';
import { screenToDoc, isPanning } from '../viewport.js';
import { buildPathD } from './pen.js';
import { parsePathD } from '../path-utils.js';

const NS = 'http://www.w3.org/2000/svg';
const HIT_R = 6; // screen-px hit radius for anchors and handles

// Hollow white arrow cursor used for node / direct-selection editing.
const _arrowSvg = "<svg xmlns='http://www.w3.org/2000/svg' width='12' height='16'>"
  + "<path d='M1 1L1 13L4 10L6 15L8 14L6 9L10 9Z' fill='white' stroke='%23333' stroke-width='1.2' stroke-linejoin='round'/>"
  + "</svg>";
export const HOLLOW_ARROW_CURSOR = `url("data:image/svg+xml,${_arrowSvg}") 1 1, default`;

// ── Tool mode ──────────────────────────────────────────────────
let mode = 'idle'; // 'idle' | 'drag-anchor' | 'drag-handle' | 'marquee'

// ── Per-shape editing state (Maps keyed by shapeId) ────────────
let editingShapeIds = new Set();  // Set<shapeId>
let anchorsMap      = new Map();  // shapeId → anchors[]
let closePathMap    = new Map();  // shapeId → boolean
let selectedMap     = new Map();  // shapeId → Set<anchorIdx>

// ── Drag state ─────────────────────────────────────────────────
let dragStartDoc   = null;
let dragAnchor     = null;   // null | {shapeId, anchorIdx}
let dragHandleSide = null;   // 'in' | 'out'
let dragSmooth     = false;
let preDragDs      = new Map(); // shapeId → string (d snapshot)
let dragged        = false;
let marqueeStart   = null;

// ── Overlay element pool ───────────────────────────────────────
let overlayGroup = null;
let wireGroup    = null;    // <g> sub-group: one <path> per edited shape
let marqueeEl    = null;
let wirePathMap  = new Map(); // shapeId → SVGPathElement

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

    marqueeEl = document.createElementNS(NS, 'rect');
    marqueeEl.setAttribute('fill', 'rgba(0,100,255,0.06)');
    marqueeEl.setAttribute('stroke', '#0066ff');
    marqueeEl.setAttribute('stroke-dasharray', '4 3');
    marqueeEl.style.display = 'none';
    overlayGroup.appendChild(marqueeEl);

    wireGroup = document.createElementNS(NS, 'g');
    overlayGroup.appendChild(wireGroup);
    // pool elements appended to overlayGroup directly, on top of wireGroup
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

  const z = state.viewport.zoom;
  const sw = 1 / z;
  const hs = 4 / z;
  const hr = 3 / z;

  for (const [id, wp] of wirePathMap) {
    const found = findShape(id);
    wp.setAttribute('d', found?.shape.attrs.d || '');
    wp.setAttribute('stroke-width', sw);
  }

  if (editingShapeIds.size === 0) { beginFrame(); endFrame(); return; }

  beginFrame();
  for (const [id, shapeAnchors] of anchorsMap) {
    const sel = selectedMap.get(id) || new Set();
    for (let i = 0; i < shapeAnchors.length; i++) {
      const a = shapeAnchors[i];
      const isSel = sel.has(i);
      if (isSel) {
        if (a.hIn)  { poolLine(a.x, a.y, a.hIn.x,  a.hIn.y,  sw); poolCirc(a.hIn.x,  a.hIn.y,  hr, sw); }
        if (a.hOut) { poolLine(a.x, a.y, a.hOut.x, a.hOut.y, sw); poolCirc(a.hOut.x, a.hOut.y, hr, sw); }
      }
      poolRect(a.x - hs, a.y - hs, hs * 2, hs * 2, isSel ? '#0066ff' : 'white', sw);
    }
  }
  endFrame();
}

function clearOverlay() {
  if (marqueeEl) marqueeEl.style.display = 'none';
  beginFrame(); endFrame();
}

// ── Path parsing ───────────────────────────────────────────────

// ── Editing helpers ────────────────────────────────────────────

function applyD(shapeId, d) {
  const f = findShape(shapeId);
  if (f) f.shape.attrs.d = d;
  const el = getElement(shapeId);
  if (el) el.setAttribute('d', d);
}

function commitAllAnchorsToShapes() {
  for (const id of editingShapeIds) {
    const shapeAnchors = anchorsMap.get(id);
    const cp = closePathMap.get(id);
    const newD = buildPathD(shapeAnchors, cp);
    applyD(id, newD);
  }
}

function getSelectedPathId() {
  for (const id of state.selection) {
    const found = findShape(id);
    if (found && found.shape.type === 'path') return id;
  }
  return null;
}

// compat shim for pen.js — returns first editing shape or null
export function getEditingShapeId() {
  return editingShapeIds.size > 0 ? [...editingShapeIds][0] : null;
}

export function selectAnchor(shapeId, idx) {
  selectedMap.get(shapeId)?.add(idx);
}

export function beginEditing(id) {
  if (editingShapeIds.has(id)) return;
  const found = findShape(id);
  if (!found || found.shape.type !== 'path') return;

  ensureOverlayEls();

  editingShapeIds.add(id);
  state.nodeEditingActive = true;
  setOverlayHook(drawOverlay);

  const p = parsePathD(found.shape.attrs.d || '');
  anchorsMap.set(id, p.anchors);
  closePathMap.set(id, p.closePath);
  selectedMap.set(id, new Set());

  const wp = document.createElementNS(NS, 'path');
  wp.setAttribute('fill', 'none');
  wp.setAttribute('stroke', '#0066ff');
  wireGroup.appendChild(wp);
  wirePathMap.set(id, wp);
}

function _stopEditing(id) {
  const wp = wirePathMap.get(id);
  if (wp) wp.remove();
  wirePathMap.delete(id);
  editingShapeIds.delete(id);
  anchorsMap.delete(id);
  closePathMap.delete(id);
  selectedMap.delete(id);
}

// ── Hit testing (screen-space geometry) ───────────────────────

function docToScreen(docX, docY) {
  const rect = document.getElementById('canvas').getBoundingClientRect();
  const z    = state.viewport.zoom;
  return { sx: (docX - state.viewport.x) * z + rect.left, sy: (docY - state.viewport.y) * z + rect.top };
}

// Returns null | {shapeId, anchorIdx, side}
export function hitTestHandles(screenX, screenY) {
  for (const [id, selIndices] of selectedMap) {
    const shapeAnchors = anchorsMap.get(id);
    if (!shapeAnchors) continue;
    for (const i of selIndices) {
      const a = shapeAnchors[i];
      for (const [handle, side] of [[a.hIn, 'in'], [a.hOut, 'out']]) {
        if (!handle) continue;
        const { sx, sy } = docToScreen(handle.x, handle.y);
        if (Math.hypot(screenX - sx, screenY - sy) < HIT_R) return { shapeId: id, anchorIdx: i, side };
      }
    }
  }
  return null;
}

// Returns null | {shapeId, anchorIdx}
export function hitTestAnchors(screenX, screenY) {
  for (const [id, shapeAnchors] of anchorsMap) {
    for (let i = 0; i < shapeAnchors.length; i++) {
      const { sx, sy } = docToScreen(shapeAnchors[i].x, shapeAnchors[i].y);
      if (Math.hypot(screenX - sx, screenY - sy) < HIT_R) return { shapeId: id, anchorIdx: i };
    }
  }
  return null;
}

function getShapeIdAt(target) {
  let el = target;
  while (el && el !== document.getElementById('canvas')) {
    if (el.dataset?.shapeId) return el.dataset.shapeId;
    el = el.parentElement;
  }
  return null;
}

function isSmooth(anchor) {
  if (!anchor.hIn || !anchor.hOut) return false;
  const ex = anchor.x - (anchor.hOut.x - anchor.x);
  const ey = anchor.y - (anchor.hOut.y - anchor.y);
  return Math.hypot(anchor.hIn.x - ex, anchor.hIn.y - ey) < 0.5;
}

// ── Delete selected anchors ────────────────────────────────────

function deleteSelectedAnchors() {
  if (editingShapeIds.size === 0) return;

  // Collect per-shape changes
  const toDeleteShape   = []; // [{shape, layer, idx}] — shapes to remove entirely
  const toRebuildShape  = []; // [{id, oldD, newD}]    — shapes to partially rebuild
  let anySelected = false;

  for (const [id, selIndices] of selectedMap) {
    if (selIndices.size === 0) continue;
    anySelected = true;
    const shapeAnchors = anchorsMap.get(id);
    const cp           = closePathMap.get(id);
    const found        = findShape(id);
    if (!found) continue;

    if (selIndices.size === shapeAnchors.length) {
      const { shape, layer } = found;
      toDeleteShape.push({ id, shape, layer, idx: layer.shapes.indexOf(shape) });
    } else {
      const newAnchors = shapeAnchors.filter((_, i) => !selIndices.has(i));
      const newCp = newAnchors.length >= 2 ? cp : false;
      toRebuildShape.push({ id, oldD: found.shape.attrs.d, newD: buildPathD(newAnchors, newCp), newAnchors, newCp });
    }
  }

  if (!anySelected) return;

  // Apply immediately so state is consistent before execute snaps it
  for (const { id, newD, newAnchors, newCp } of toRebuildShape) {
    applyD(id, newD);
    anchorsMap.set(id, newAnchors);
    closePathMap.set(id, newCp);
    selectedMap.get(id)?.clear();
  }
  for (const { id, shape, layer } of toDeleteShape) {
    layer.shapes.splice(layer.shapes.indexOf(shape), 1);
    state.selection.delete(id);
    _stopEditing(id);
  }

  if (editingShapeIds.size === 0) {
    state.nodeEditingActive = false;
    setOverlayHook(null);
    clearOverlay();
  }

  execute({
    do() {
      for (const { id, newD } of toRebuildShape) {
        applyD(id, newD);
        if (editingShapeIds.has(id)) {
          const p = parsePathD(newD);
          anchorsMap.set(id, p.anchors);
          closePathMap.set(id, p.closePath);
          selectedMap.get(id)?.clear();
        }
      }
      for (const { id, shape, layer } of toDeleteShape) {
        if (layer.shapes.includes(shape)) layer.shapes.splice(layer.shapes.indexOf(shape), 1);
        state.selection.delete(id);
      }
      render();
      if (state.activeTool === 'node') drawOverlay();
    },
    undo() {
      for (const { id, oldD } of toRebuildShape) {
        applyD(id, oldD);
        if (editingShapeIds.has(id)) {
          const p = parsePathD(oldD);
          anchorsMap.set(id, p.anchors);
          closePathMap.set(id, p.closePath);
          selectedMap.get(id)?.clear();
        }
      }
      for (const { id, shape, layer, idx } of toDeleteShape) {
        layer.shapes.splice(idx, 0, shape);
        state.selection.add(id);
        if (!editingShapeIds.has(id)) beginEditing(id);
      }
      render();
      if (state.activeTool === 'node') drawOverlay();
    },
  });

  render();
  if (state.activeTool === 'node') drawOverlay();
}

// ── Public API ─────────────────────────────────────────────────

export function activate() {
  document.getElementById('canvas').style.cursor = HOLLOW_ARROW_CURSOR;
  mode = 'idle'; dragged = false; dragStartDoc = null;
  dragAnchor = null; dragHandleSide = null; dragSmooth = false;
  preDragDs.clear(); marqueeStart = null;

  editingShapeIds.clear();
  anchorsMap.clear(); closePathMap.clear(); selectedMap.clear();
  if (wireGroup) wireGroup.replaceChildren();
  wirePathMap.clear();

  for (const id of state.selection) {
    const found = findShape(id);
    if (found?.shape.type === 'path') beginEditing(id);
  }

  state.nodeEditingActive = editingShapeIds.size > 0;
  drawOverlay();
}

export function deactivate() {
  state.nodeEditingActive = false;
  setOverlayHook(null);
  if (wireGroup) wireGroup.replaceChildren();
  wirePathMap.clear();
  overlayGroup?.remove(); // removes from DOM but preserves reference + pool elements
  editingShapeIds.clear();
  anchorsMap.clear(); closePathMap.clear(); selectedMap.clear();
  mode = 'idle'; dragged = false; dragAnchor = null;
  dragHandleSide = null; dragSmooth = false; preDragDs.clear();
}

export function onMouseDown(e) {
  if (isPanning() || e.button !== 0) return;

  dragStartDoc = screenToDoc(e.clientX, e.clientY);
  dragged      = false;

  // 1. Handles first — only visible when their anchor is selected
  const handleHit = hitTestHandles(e.clientX, e.clientY);
  if (handleHit) {
    const shapeAnchors = anchorsMap.get(handleHit.shapeId);
    dragAnchor     = { shapeId: handleHit.shapeId, anchorIdx: handleHit.anchorIdx };
    dragHandleSide = handleHit.side;
    dragSmooth     = isSmooth(shapeAnchors[handleHit.anchorIdx]);
    preDragDs.clear();
    for (const id of editingShapeIds) preDragDs.set(id, findShape(id)?.shape.attrs.d ?? null);
    mode = 'drag-handle';
    return;
  }

  // 2. Anchor squares
  const anchorHit = hitTestAnchors(e.clientX, e.clientY);
  if (anchorHit) {
    const { shapeId, anchorIdx } = anchorHit;
    const sel = selectedMap.get(shapeId);
    if (e.shiftKey) {
      if (sel.has(anchorIdx)) sel.delete(anchorIdx);
      else sel.add(anchorIdx);
    } else if (!sel.has(anchorIdx)) {
      for (const s of selectedMap.values()) s.clear();
      sel.add(anchorIdx);
    }
    dragAnchor = anchorHit;
    preDragDs.clear();
    for (const id of editingShapeIds) preDragDs.set(id, findShape(id)?.shape.attrs.d ?? null);
    mode = 'drag-anchor';
    drawOverlay();
    return;
  }

  // 3. Shape body
  const shapeId = getShapeIdAt(e.target);
  if (shapeId) {
    const found = findShape(shapeId);
    if (found?.shape.type === 'path') {
      if (!editingShapeIds.has(shapeId)) {
        if (e.shiftKey) {
          // Shift-click a new path: add it to the editing set
          beginEditing(shapeId);
          state.selection.add(shapeId);
          drawOverlay();
          render();
        } else {
          // No shift: switch to editing just this path
          if (wireGroup) wireGroup.replaceChildren();
          wirePathMap.clear();
          editingShapeIds.clear();
          anchorsMap.clear(); closePathMap.clear(); selectedMap.clear();
          state.selection.clear();
          state.selection.add(shapeId);
          beginEditing(shapeId);
          drawOverlay();
          render();
        }
        return;
      }
      // Same path already being edited — fall through to marquee
    } else if (editingShapeIds.size > 0) {
      // Non-path clicked while editing — exit node editing
      state.nodeEditingActive = false;
      setOverlayHook(null);
      if (wireGroup) wireGroup.replaceChildren();
      wirePathMap.clear();
      editingShapeIds.clear();
      anchorsMap.clear(); closePathMap.clear(); selectedMap.clear();
      state.selection.clear();
      state.selection.add(shapeId);
      clearOverlay();
      render();
      return;
    }
  }

  // 4. Empty area or same-shape body — marquee if editing, else full deselect
  if (editingShapeIds.size > 0) {
    if (!e.shiftKey) for (const s of selectedMap.values()) s.clear();
    marqueeStart = dragStartDoc;
    mode         = 'marquee';
    drawOverlay();
  } else {
    state.selection.clear();
    for (const s of selectedMap.values()) s.clear();
    anchorsMap.clear(); closePathMap.clear();
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
    for (const [id, sel] of selectedMap) {
      const shapeAnchors = anchorsMap.get(id);
      for (const i of sel) {
        const a = shapeAnchors[i];
        if (a.hIn)  { a.hIn.x  += dx; a.hIn.y  += dy; }
        if (a.hOut) { a.hOut.x += dx; a.hOut.y += dy; }
        a.x += dx;
        a.y += dy;
      }
    }
    dragStartDoc = pos;
  }

  if (mode === 'drag-handle') {
    const { shapeId, anchorIdx } = dragAnchor;
    const a = anchorsMap.get(shapeId)[anchorIdx];
    if (dragHandleSide === 'out') {
      a.hOut = { x: pos.x, y: pos.y };
      if (dragSmooth && a.hIn) a.hIn = { x: 2 * a.x - pos.x, y: 2 * a.y - pos.y };
    } else {
      a.hIn = { x: pos.x, y: pos.y };
      if (dragSmooth && a.hOut) a.hOut = { x: 2 * a.x - pos.x, y: 2 * a.y - pos.y };
    }
  }

  commitAllAnchorsToShapes();
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
        for (const [id, shapeAnchors] of anchorsMap) {
          const sel = selectedMap.get(id);
          for (let i = 0; i < shapeAnchors.length; i++) {
            const a = shapeAnchors[i];
            if (a.x >= minX && a.x <= maxX && a.y >= minY && a.y <= maxY) sel.add(i);
          }
        }
      }
      marqueeStart = null;
    } else if ((mode === 'drag-anchor' || mode === 'drag-handle') && dragged) {
      // Collect per-shape changes into a single undo entry
      const snapshots = new Map();
      for (const [id, oldD] of preDragDs) {
        const f = findShape(id);
        if (!f) continue;
        const newD = f.shape.attrs.d;
        if (newD !== oldD) snapshots.set(id, { oldD, newD });
      }
      if (snapshots.size > 0) {
        execute({
          do() {
            for (const [id, { newD }] of snapshots) applyD(id, newD);
            render();
            if (state.activeTool === 'node') {
              for (const [id, { newD }] of snapshots) {
                if (editingShapeIds.has(id)) {
                  const p = parsePathD(newD);
                  anchorsMap.set(id, p.anchors);
                  closePathMap.set(id, p.closePath);
                }
              }
              drawOverlay();
            }
          },
          undo() {
            for (const [id, { oldD }] of snapshots) applyD(id, oldD);
            render();
            if (state.activeTool === 'node') {
              for (const [id, { oldD }] of snapshots) {
                if (editingShapeIds.has(id)) {
                  const p = parsePathD(oldD);
                  anchorsMap.set(id, p.anchors);
                  closePathMap.set(id, p.closePath);
                }
              }
              drawOverlay();
            }
          },
        });
        return; // finally still runs
      }
    }
  } finally {
    mode           = 'idle';
    dragged        = false;
    dragAnchor     = null;
    dragHandleSide = null;
    dragSmooth     = false;
    preDragDs.clear();
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
  if ((e.key === 'Delete' || e.key === 'Backspace') && editingShapeIds.size > 0) {
    e.preventDefault();
    deleteSelectedAnchors();
  }
}
