/**
 * Pen tool — bezier path drawing.
 *
 * Each anchor: { x, y, hIn: {x,y}|null, hOut: {x,y}|null }
 *   hIn  = incoming control point (curve arriving at this anchor)
 *   hOut = outgoing control point (curve leaving this anchor)
 *   null → treated as the anchor point itself (straight segment)
 *
 * Smooth anchor: hIn and hOut are mirrors through the anchor point.
 *
 * Mouse interaction:
 *   click              → corner anchor
 *   mousedown + drag   → smooth anchor; drag direction = outgoing handle
 *   mousedown on first anchor (≥2 pts):
 *     just click       → close path with straight final segment
 *     click + drag     → close path; drag sets hIn of first anchor (curves the
 *                        closing segment) and mirrors hOut for continuity
 *   Enter / dblclick   → finish open path
 *   Escape             → cancel
 */
import { state, getActiveLayer } from '../state.js';
import { screenToDoc, isPanning } from '../viewport.js';
import { createShape } from '../shapes/index.js';
import { execute } from '../history.js';
import { render } from '../render.js';

const NS = 'http://www.w3.org/2000/svg';
const CLOSE_RADIUS = 8; // px screen distance to snap-close

// ── Tool state ─────────────────────────────────────────────────
let active    = false;
let anchors   = [];
let mouseDown = false;
let closing   = false; // true: mousedown landed on first anchor, awaiting mouseup

let cursorPos = null;

let previewPath = null;
let handleGroup = null;

// Reusable SVG element pools — avoids innerHTML = '' + recreation each frame
const _linePool = [], _circPool = [], _rectPool = [];
let _lu = 0, _cu = 0, _ru = 0;

function beginFrame() { _lu = 0; _cu = 0; _ru = 0; }

function poolLine(x1, y1, x2, y2, sw) {
  let el;
  if (_lu < _linePool.length) { el = _linePool[_lu]; el.style.display = ''; }
  else { el = document.createElementNS(NS, 'line'); el.setAttribute('stroke', '#0066ff'); _linePool.push(el); handleGroup.appendChild(el); }
  _lu++;
  el.setAttribute('x1', x1); el.setAttribute('y1', y1);
  el.setAttribute('x2', x2); el.setAttribute('y2', y2);
  el.setAttribute('stroke-width', sw);
}

function poolCirc(cx, cy, radius, sw) {
  let el;
  if (_cu < _circPool.length) { el = _circPool[_cu]; el.style.display = ''; }
  else { el = document.createElementNS(NS, 'circle'); el.setAttribute('fill', 'white'); el.setAttribute('stroke', '#0066ff'); _circPool.push(el); handleGroup.appendChild(el); }
  _cu++;
  el.setAttribute('cx', cx); el.setAttribute('cy', cy); el.setAttribute('r', radius);
  el.setAttribute('stroke-width', sw);
}

function poolRect(x, y, w, h, fill, sw) {
  let el;
  if (_ru < _rectPool.length) { el = _rectPool[_ru]; el.style.display = ''; }
  else { el = document.createElementNS(NS, 'rect'); el.setAttribute('stroke', '#0066ff'); _rectPool.push(el); handleGroup.appendChild(el); }
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

export function activate() {
  document.getElementById('canvas').style.cursor = 'crosshair';
  active  = false;
  anchors = [];
  closing = false;
  ensureOverlayEls();
}

export function deactivate() { cancel(); }

export function onMouseDown(e) {
  if (isPanning() || e.button !== 0) return;
  mouseDown = true;

  const pos = screenToDoc(e.clientX, e.clientY);

  if (!active) {
    active  = true;
    anchors = [{ x: pos.x, y: pos.y, hIn: null, hOut: null }];
  } else if (anchors.length >= 2 && nearFirst(e.clientX, e.clientY)) {
    // Begin closing drag — snap to first anchor's exact position
    closing = true;
  } else {
    anchors.push({ x: pos.x, y: pos.y, hIn: null, hOut: null });
  }

  updateOverlay(cursorPos);
}

export function onMouseMove(e) {
  cursorPos = screenToDoc(e.clientX, e.clientY);

  if (mouseDown) {
    if (closing) {
      // Drag on the first anchor sets its incoming/outgoing handles.
      // hIn controls the closing segment arriving at a0.
      // hOut is mirrored for smooth continuity with the first outgoing segment.
      const a0 = anchors[0];
      const dx = cursorPos.x - a0.x;
      const dy = cursorPos.y - a0.y;
      if (Math.hypot(dx, dy) > 2 / state.viewport.zoom) {
        a0.hOut = { x: a0.x + dx, y: a0.y + dy };
        a0.hIn  = { x: a0.x - dx, y: a0.y - dy };
      }
    } else if (anchors.length > 0) {
      // Normal smooth-anchor drag on the most recently placed anchor
      const last = anchors[anchors.length - 1];
      const dx = cursorPos.x - last.x;
      const dy = cursorPos.y - last.y;
      if (Math.hypot(dx, dy) > 2 / state.viewport.zoom) {
        last.hOut = { x: last.x + dx, y: last.y + dy };
        last.hIn  = { x: last.x - dx, y: last.y - dy };
      }
    }
  }

  if (closing) {
    document.getElementById('canvas').style.cursor = 'crosshair';
  } else {
    const snapping = active && anchors.length >= 2 && nearFirst(e.clientX, e.clientY);
    document.getElementById('canvas').style.cursor = snapping ? 'pointer' : 'crosshair';
  }

  updateOverlay(cursorPos);
}

export function onMouseUp(e) {
  if (closing) {
    closing   = false;
    mouseDown = false;
    finalizePath(true);
    return;
  }
  mouseDown = false;
}

export function onKeyDown(e) {
  if (!active) return;
  if (e.key === 'Enter')  { e.preventDefault(); finalizePath(false); }
  if (e.key === 'Escape') cancel();
}

export function onDblClick(e) {
  if (!active) return;
  // The second click of a dblclick already added an extra anchor — remove it
  if (anchors.length > 1) anchors.pop();
  finalizePath(false);
}

// ── Internals ──────────────────────────────────────────────────

function ensureOverlayEls() {
  const ov = document.getElementById('overlay');
  if (!previewPath) {
    previewPath = document.createElementNS(NS, 'path');
    previewPath.setAttribute('fill', 'none');
    previewPath.setAttribute('stroke', '#0066ff');
  }
  if (!handleGroup) {
    handleGroup = document.createElementNS(NS, 'g');
  }
  // Always re-append: restores elements if renderSelection() cleared the overlay,
  // and keeps pen overlays on top of any selection indicators.
  ov.appendChild(previewPath);
  ov.appendChild(handleGroup);
}

function updateOverlay(cursor) {
  ensureOverlayEls();
  if (!previewPath || !handleGroup) return;
  const z  = state.viewport.zoom;
  const sw = 1 / z;

  previewPath.setAttribute('stroke-width', sw);

  // Build the path d string, adding either the closing preview or the
  // rubber-band segment from the last anchor to the cursor
  let d = buildPathD(anchors, false);
  if (active && anchors.length > 0) {
    if (closing) {
      d += closingPreviewSegment();
    } else if (cursor) {
      d += rubberBandSegment(anchors[anchors.length - 1], cursor);
    }
  }
  previewPath.setAttribute('d', d || 'M0 0');

  // Anchor squares + handle lines — pool-based, no innerHTML churn
  beginFrame();
  const hs = 4 / z;

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];

    for (const h of [a.hIn, a.hOut]) {
      if (!h) continue;
      poolLine(a.x, a.y, h.x, h.y, sw);
      poolCirc(h.x, h.y, 3 / z, sw);
    }

    const fill = i === 0 && closing ? '#99ccff' : 'white';
    poolRect(a.x - hs, a.y - hs, hs * 2, hs * 2, fill, sw);
  }

  endFrame();
}

// Preview segment from the last placed anchor to the cursor (rubber band)
function rubberBandSegment(prev, cursor) {
  const h1 = prev.hOut || prev;
  return ` C ${h1.x} ${h1.y} ${cursor.x} ${cursor.y} ${cursor.x} ${cursor.y}`;
}

// Preview the closing segment from last anchor back to a0
function closingPreviewSegment() {
  if (anchors.length < 2) return '';
  const last = anchors[anchors.length - 1];
  const a0   = anchors[0];
  const h1 = last.hOut;
  const h2 = a0.hIn;
  if (!h1 && !h2) return ` L ${r(a0.x)} ${r(a0.y)}`;
  return ` C ${r((h1 || last).x)} ${r((h1 || last).y)} ${r((h2 || a0).x)} ${r((h2 || a0).y)} ${r(a0.x)} ${r(a0.y)}`;
}

function finalizePath(closePath) {
  if (anchors.length < 2) { cancel(); return; }
  clearOverlay();

  const d = buildPathD(anchors, closePath);
  const shape = createShape('path', { d }, { ...state.currentStyle });
  const layer = getActiveLayer();

  execute({
    do()   { layer.shapes.push(shape); state.selection = new Set([shape.id]); render(); },
    undo() { layer.shapes = layer.shapes.filter(s => s.id !== shape.id); state.selection.clear(); render(); },
  });

  active  = false;
  anchors = [];
  closing = false;
}

function cancel() {
  active    = false;
  anchors   = [];
  closing   = false;
  mouseDown = false;
  clearOverlay();
}

function clearOverlay() {
  previewPath?.setAttribute('d', '');
  if (handleGroup) { beginFrame(); endFrame(); }
}

function nearFirst(screenX, screenY) {
  if (anchors.length === 0) return false;
  const a0  = anchors[0];
  const svg = document.getElementById('canvas');
  const rect = svg.getBoundingClientRect();
  const z   = state.viewport.zoom;
  const sx  = (a0.x - state.viewport.x) * z + rect.left;
  const sy  = (a0.y - state.viewport.y) * z + rect.top;
  return Math.hypot(screenX - sx, screenY - sy) < CLOSE_RADIUS;
}

// ── Path builder ───────────────────────────────────────────────

export function buildPathD(anchors, closePath) {
  if (anchors.length === 0) return '';
  const a0 = anchors[0];
  let d = `M ${r(a0.x)} ${r(a0.y)}`;

  for (let i = 1; i < anchors.length; i++) {
    const prev = anchors[i - 1];
    const curr = anchors[i];
    const h1 = prev.hOut;
    const h2 = curr.hIn;
    if (!h1 && !h2) {
      d += ` L ${r(curr.x)} ${r(curr.y)}`;
    } else {
      d += ` C ${r((h1||prev).x)} ${r((h1||prev).y)} ${r((h2||curr).x)} ${r((h2||curr).y)} ${r(curr.x)} ${r(curr.y)}`;
    }
  }

  if (closePath && anchors.length > 1) {
    const last = anchors[anchors.length - 1];
    const h1 = last.hOut;
    const h2 = a0.hIn;
    if (!h1 && !h2) {
      d += ' Z';
    } else {
      d += ` C ${r((h1||last).x)} ${r((h1||last).y)} ${r((h2||a0).x)} ${r((h2||a0).y)} ${r(a0.x)} ${r(a0.y)} Z`;
    }
  }

  return d;
}

const r = (n) => Math.round(n * 100) / 100;

