import { state, findShape } from '../state.js';
import { render, getElement, offsetTextGuidesForDrag, scaleTextGuidesForDrag } from '../render.js';
import { execute } from '../history.js';
import { screenToDoc, isPanning } from '../viewport.js';
import { translateShape, scaleShape, bakeRotation, syncElement, getBBox } from '../shapes/index.js';
import { initTextEditor, startEditing, isEditing, commit } from './_textedit.js';

const NS = 'http://www.w3.org/2000/svg';

let mode     = 'idle'; // 'idle' | 'move' | 'band' | 'scale' | 'rotate'
let dragStart = null;
let moved     = false;

// Manual double-click detection (more reliable than browser dblclick event)
let lastClickId   = null;
let lastClickTime = 0;

let snapshots  = new Map(); // move mode: shapeId → attrs clone
let dragBBoxes = new Map(); // shapeId → initial bbox {x,y,width,height}
let dragSelEl  = null;      // persistent selection rect during drag
let bandEl        = null;

// Scale mode state
let scaleHandle    = null;           // 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'
let scaleBBox      = null;           // {minX,minY,maxX,maxY} of selection at drag start
let scaleSnapshots = new Map();      // shapeId → {attrs, _boxWidth, _boxHeight} for scale; {attrs, _rotation, _rotCx, _rotCy} for rotate

// Rotate mode state
let rotateCenter     = null;         // {x, y} doc coords — selection bbox centre
let rotateStartAngle = null;         // initial mouse→centre angle (degrees) at drag start

// ── Activate / deactivate ──────────────────────────────────────────────────────

export function activate() {
  document.getElementById('canvas').style.cursor = 'default';
  mode = 'idle';
  moved = false;
  dragStart = null;
  lastClickId = null;
  lastClickTime = 0;
  snapshots.clear();
  scaleSnapshots.clear();
  scaleHandle = null;
  scaleBBox   = null;
  rotateCenter     = null;
  rotateStartAngle = null;
  cleanupDrag();
  cancelBand();
  render();
}

export function deactivate() {
  cleanupDrag();
  cancelBand();
  mode  = 'idle';
  moved = false;
  snapshots.clear();
  scaleSnapshots.clear();
  scaleHandle = null;
  scaleBBox   = null;
  rotateCenter     = null;
  rotateStartAngle = null;
}

// ── Mouse handlers ─────────────────────────────────────────────────────────────

export function onMouseDown(e) {
  if (isPanning()) return;

  // Manual double-click detection — must happen before drag setup
  const now     = Date.now();
  const handle  = e.target.dataset?.handle;
  if (!handle) {
    const hitId = getShapeIdAt(e.target);
    if (hitId && hitId === lastClickId && now - lastClickTime < 400) {
      const f = findShape(hitId);
      if (f?.shape.type === 'text') {
        lastClickId = null; lastClickTime = 0;
        if (isEditing()) commit();
        openTextEditor(f.shape, hitId);
        return;
      }
    }
    lastClickId   = hitId || null;
    lastClickTime = now;
  } else {
    lastClickId = null; lastClickTime = 0;
  }

  if (isEditing()) commit();

  dragStart = screenToDoc(e.clientX, e.clientY);
  moved = false;

  // Transform handles take priority
  if (handle && state.selection.size > 0) {
    if (handle === 'rotate') enterRotateMode();
    else                     enterScaleMode(handle);
    return;
  }

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
  if ((mode === 'move' || mode === 'scale' || mode === 'rotate') && e.buttons === 0) { onMouseUp(e); return; }

  const pos = screenToDoc(e.clientX, e.clientY);
  const dx  = pos.x - dragStart.x;
  const dy  = pos.y - dragStart.y;

  if (mode === 'move') {
    moved = true;
    for (const id of state.selection) {
      const el = getElement(id);
      if (!el) continue;
      const found = findShape(id);
      if (found?.shape.type === 'text') {
        // Model-update: preserves _scaleX/_scaleY/_rotation transform composition.
        const snap = snapshots.get(id);
        if (snap) {
          found.shape.attrs.x = (snap.x || 0) + dx;
          found.shape.attrs.y = (snap.y || 0) + dy;
          syncElement(el, found.shape);
        }
      } else {
        el.setAttribute('transform', `translate(${dx},${dy})`);
      }
    }
    updateDragSelEl(dx, dy);
    offsetTextGuidesForDrag(state.selection, dx, dy);
  }

  if (mode === 'scale') {
    moved = true;
    const { sx, sy, ox, oy } = computeScaleParams(dx, dy, e.shiftKey);
    const matrix = `matrix(${sx},0,0,${sy},${ox * (1 - sx)},${oy * (1 - sy)})`;
    for (const id of state.selection) {
      const el = getElement(id);
      if (!el) continue;
      const found = findShape(id);
      if (found?.shape.type === 'text') {
        // Text has a persistent _scaleX transform; compose via model update so syncTextElement
        // can combine _rotation + _scaleX correctly.
        const snap = scaleSnapshots.get(id);
        if (snap) {
          const s = found.shape;
          Object.assign(s.attrs, JSON.parse(JSON.stringify(snap.attrs)));
          s._fontSize  = snap._fontSize;
          s._scaleX    = snap._scaleX;
          s._scaleY    = snap._scaleY;
          s._boxWidth  = snap._boxWidth;
          s._boxHeight = snap._boxHeight;
          s._rotation  = snap._rotation;
          s._rotCx     = snap._rotCx;
          s._rotCy     = snap._rotCy;
          scaleShape(s, sx, sy, ox, oy);
          syncElement(el, s);
        }
      } else {
        el.setAttribute('transform', matrix);
      }
    }
    updateScaleSelEl(sx, sy, ox, oy);
    scaleTextGuidesForDrag(state.selection, sx, sy, ox, oy);
  }

  if (mode === 'rotate') {
    moved = true;
    const currentAngle = Math.atan2(pos.y - rotateCenter.y, pos.x - rotateCenter.x) * 180 / Math.PI;
    let delta = currentAngle - rotateStartAngle;
    if (e.shiftKey) delta = Math.round(delta / 15) * 15;
    for (const id of state.selection) {
      const el = getElement(id);
      if (!el) continue;
      const snap = scaleSnapshots.get(id);
      if (!snap) continue;
      const found = findShape(id);
      if (found?.shape.type === 'text') {
        // Text rotation must compose with _scaleX; update model so syncTextElement handles it.
        found.shape._rotation = snap._rotation + delta;
        found.shape._rotCx    = snap._rotCx;
        found.shape._rotCy    = snap._rotCy;
        syncElement(el, found.shape);
      } else {
        el.setAttribute('transform', `rotate(${snap._rotation + delta}, ${snap._rotCx}, ${snap._rotCy})`);
      }
    }
  }

  if (mode === 'band') {
    updateBand(dragStart, pos);
  }
}

export function onMouseUp(e) {
  try {
    if (mode === 'move' && !moved) {
      // Pure click with no drag — just clean up and render so handles appear.
      cleanupDrag();
      render();
    }

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

    if (mode === 'scale' && moved) {
      const endPos = screenToDoc(e.clientX, e.clientY);
      const dx = endPos.x - dragStart.x;
      const dy = endPos.y - dragStart.y;
      const { sx, sy, ox, oy } = computeScaleParams(dx, dy, e.shiftKey);

      // Remove transforms before committing attrs
      for (const id of state.selection) {
        const el = getElement(id);
        if (el) el.removeAttribute('transform');
      }
      if (dragSelEl) { dragSelEl.remove(); dragSelEl = null; }
      document.getElementById('canvas').style.cursor = 'default';

      const oldSnaps = new Map(scaleSnapshots);
      const newData  = new Map();

      for (const id of state.selection) {
        const found = findShape(id);
        if (!found) continue;
        // Restore from snapshot before applying scale
        const snap = oldSnaps.get(id);
        if (snap) {
          Object.assign(found.shape.attrs, JSON.parse(JSON.stringify(snap.attrs)));
          if (snap._boxWidth  != null) found.shape._boxWidth  = snap._boxWidth;
          if (snap._boxHeight != null) found.shape._boxHeight = snap._boxHeight;
          if (snap._fontSize  != null) found.shape._fontSize  = snap._fontSize;
          if (snap._scaleX    != null) found.shape._scaleX    = snap._scaleX;
          else                         found.shape._scaleX    = undefined;
          if (snap._scaleY    != null) found.shape._scaleY    = snap._scaleY;
          else                         found.shape._scaleY    = undefined;
          if (snap._rotation  != null) found.shape._rotation  = snap._rotation;
          else                         found.shape._rotation  = undefined;
          if (snap._rotCx     != null) found.shape._rotCx     = snap._rotCx;
          if (snap._rotCy     != null) found.shape._rotCy     = snap._rotCy;
        }
        scaleShape(found.shape, sx, sy, ox, oy);
        newData.set(id, {
          attrs:      JSON.parse(JSON.stringify(found.shape.attrs)),
          _boxWidth:  found.shape._boxWidth,
          _boxHeight: found.shape._boxHeight,
          _fontSize:  found.shape._fontSize,
          _scaleX:    found.shape._scaleX,
          _scaleY:    found.shape._scaleY,
          _rotation:  found.shape._rotation,
          _rotCx:     found.shape._rotCx,
          _rotCy:     found.shape._rotCy,
        });
      }

      execute({
        do() {
          for (const [id, d] of newData) {
            const f = findShape(id); if (!f) continue;
            Object.assign(f.shape.attrs, d.attrs);
            if (d._boxWidth  != null) f.shape._boxWidth  = d._boxWidth;
            if (d._boxHeight != null) f.shape._boxHeight = d._boxHeight;
            if (d._fontSize  != null) f.shape._fontSize  = d._fontSize;
            if (d._scaleX    != null) f.shape._scaleX    = d._scaleX;    else f.shape._scaleX    = undefined;
            if (d._scaleY    != null) f.shape._scaleY    = d._scaleY;    else f.shape._scaleY    = undefined;
            if (d._rotation  != null) f.shape._rotation  = d._rotation;  else f.shape._rotation  = undefined;
            if (d._rotCx     != null) f.shape._rotCx     = d._rotCx;
            if (d._rotCy     != null) f.shape._rotCy     = d._rotCy;
          }
          render();
        },
        undo() {
          for (const [id, snap] of oldSnaps) {
            const f = findShape(id); if (!f) continue;
            Object.assign(f.shape.attrs, JSON.parse(JSON.stringify(snap.attrs)));
            if (snap._boxWidth  != null) f.shape._boxWidth  = snap._boxWidth;
            if (snap._boxHeight != null) f.shape._boxHeight = snap._boxHeight;
            if (snap._fontSize  != null) f.shape._fontSize  = snap._fontSize;
            if (snap._scaleX    != null) f.shape._scaleX    = snap._scaleX;   else f.shape._scaleX    = undefined;
            if (snap._scaleY    != null) f.shape._scaleY    = snap._scaleY;   else f.shape._scaleY    = undefined;
            if (snap._rotation  != null) f.shape._rotation  = snap._rotation; else f.shape._rotation  = undefined;
            if (snap._rotCx     != null) f.shape._rotCx     = snap._rotCx;
            if (snap._rotCy     != null) f.shape._rotCy     = snap._rotCy;
          }
          render();
        },
      });
    } else if (mode === 'scale' && !moved) {
      document.getElementById('canvas').style.cursor = 'default';
      render();
    }

    if (mode === 'rotate' && moved) {
      const endPos = screenToDoc(e.clientX, e.clientY);
      const currentAngle = Math.atan2(endPos.y - rotateCenter.y, endPos.x - rotateCenter.x) * 180 / Math.PI;
      let delta = currentAngle - rotateStartAngle;
      if (e.shiftKey) delta = Math.round(delta / 15) * 15;

      // Only remove raw transform from non-text shapes; text shapes manage their own via syncElement.
      for (const id of state.selection) {
        const el = getElement(id);
        if (!el) continue;
        const found = findShape(id);
        if (found?.shape.type !== 'text') el.removeAttribute('transform');
      }
      document.getElementById('canvas').style.cursor = 'default';

      const oldSnaps  = new Map(scaleSnapshots);
      const newAttrs  = new Map(); // path shapes: baked attrs
      const newRotations = new Map(); // text shapes: { _rotation, _rotCx, _rotCy }

      for (const id of state.selection) {
        const found = findShape(id);
        if (!found) continue;
        const snap = oldSnaps.get(id);
        if (found.shape.type === 'text') {
          // _rotation already updated during drag; just capture for undo.
          newRotations.set(id, {
            _rotation: found.shape._rotation,
            _rotCx:    found.shape._rotCx,
            _rotCy:    found.shape._rotCy,
          });
        } else {
          // Restore pre-rotation attrs then bake the rotation into coordinates.
          Object.assign(found.shape.attrs, JSON.parse(JSON.stringify(snap.attrs)));
          bakeRotation(found.shape, delta, snap._rotCx, snap._rotCy);
          newAttrs.set(id, JSON.parse(JSON.stringify(found.shape.attrs)));
        }
      }

      execute({
        do() {
          for (const [id, attrs] of newAttrs) {
            const f = findShape(id); if (f) Object.assign(f.shape.attrs, attrs);
          }
          for (const [id, rot] of newRotations) {
            const f = findShape(id);
            if (f) { f.shape._rotation = rot._rotation; f.shape._rotCx = rot._rotCx; f.shape._rotCy = rot._rotCy; }
          }
          render();
        },
        undo() {
          for (const [id, snap] of oldSnaps) {
            const f = findShape(id); if (!f) continue;
            Object.assign(f.shape.attrs, JSON.parse(JSON.stringify(snap.attrs)));
            if (f.shape.type === 'text') {
              f.shape._rotation = snap._rotation || 0;
              f.shape._rotCx    = snap._rotCx;
              f.shape._rotCy    = snap._rotCy;
            }
          }
          render();
        },
      });
    } else if (mode === 'rotate' && !moved) {
      document.getElementById('canvas').style.cursor = 'default';
      render();
    }

    if (mode === 'band') finishBand(e);
  } finally {
    mode  = 'idle';
    moved = false;
    snapshots.clear();
    scaleSnapshots.clear();
    scaleHandle      = null;
    scaleBBox        = null;
    rotateCenter     = null;
    rotateStartAngle = null;
  }
}

function openTextEditor(shape, shapeId) {
  initTextEditor();
  const oldText = shape._text;
  const svgEl = getElement(shapeId);
  if (svgEl) svgEl.style.display = 'none';
  startEditing({
    docX:        shape.attrs.x,
    docY:        shape.attrs.y,
    fontSize:    shape._fontSize || 16,
    fill:        shape.style.fill,
    boxWidth:    shape._isArea ? shape._boxWidth  : undefined,
    boxHeight:   shape._isArea ? shape._boxHeight : undefined,
    initialText: shape._text || '',
    onCommit({ text }) {
      if (svgEl) svgEl.style.display = '';
      if (text === oldText) { render(); return; }
      execute({
        do()   { const f = findShape(shapeId); if (f) { f.shape._text = text;    render(); } },
        undo() { const f = findShape(shapeId); if (f) { f.shape._text = oldText; render(); } },
      });
    },
  });
  render();
}

export function onKeyDown(e) {
  if (e.key === 'Escape' && isEditing()) commit();
}

// ── Scale helpers ──────────────────────────────────────────────────────────────

function enterScaleMode(handle) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of state.selection) {
    const found = findShape(id);
    if (!found) continue;
    const bb = getBBox(found.shape);
    if (!bb || (bb.width === 0 && bb.height === 0)) continue;
    minX = Math.min(minX, bb.x);
    minY = Math.min(minY, bb.y);
    maxX = Math.max(maxX, bb.x + bb.width);
    maxY = Math.max(maxY, bb.y + bb.height);
  }
  if (!isFinite(minX)) return;

  scaleBBox   = { minX, minY, maxX, maxY };
  scaleHandle = handle;

  scaleSnapshots.clear();
  for (const id of state.selection) {
    const found = findShape(id);
    if (!found) continue;
    scaleSnapshots.set(id, {
      attrs:      JSON.parse(JSON.stringify(found.shape.attrs)),
      _boxWidth:  found.shape._boxWidth,
      _boxHeight: found.shape._boxHeight,
      _fontSize:  found.shape._fontSize,
      _scaleX:    found.shape._scaleX,
      _scaleY:    found.shape._scaleY,
      _rotation:  found.shape._rotation,
      _rotCx:     found.shape._rotCx,
      _rotCy:     found.shape._rotCy,
    });
  }

  // Overlay: clear both overlay and overlay-hit (removes handles during drag)
  const ov = document.getElementById('overlay');
  ov.innerHTML = '';
  document.getElementById('overlay-hit').innerHTML = '';
  dragSelEl = document.createElementNS(NS, 'rect');
  dragSelEl.setAttribute('fill', 'none');
  dragSelEl.setAttribute('stroke', '#0066ff');
  dragSelEl.style.pointerEvents = 'none';
  ov.appendChild(dragSelEl);
  updateScaleSelEl(1, 1, minX, minY);

  const CURSORS = { nw:'nwse-resize', ne:'nesw-resize', se:'nwse-resize', sw:'nesw-resize', n:'ns-resize', s:'ns-resize', e:'ew-resize', w:'ew-resize' };
  document.getElementById('canvas').style.cursor = CURSORS[handle] || 'default';

  mode = 'scale';
}

function computeScaleParams(dx, dy, shiftKey) {
  const { minX, minY, maxX, maxY } = scaleBBox;
  const origW = maxX - minX;
  const origH = maxY - minY;
  let sx = 1, sy = 1, ox = minX, oy = minY;

  switch (scaleHandle) {
    case 'se': sx = origW ? (origW + dx) / origW : 1; sy = origH ? (origH + dy) / origH : 1; ox = minX; oy = minY; break;
    case 'sw': sx = origW ? (origW - dx) / origW : 1; sy = origH ? (origH + dy) / origH : 1; ox = maxX; oy = minY; break;
    case 'ne': sx = origW ? (origW + dx) / origW : 1; sy = origH ? (origH - dy) / origH : 1; ox = minX; oy = maxY; break;
    case 'nw': sx = origW ? (origW - dx) / origW : 1; sy = origH ? (origH - dy) / origH : 1; ox = maxX; oy = maxY; break;
    case 'e':  sx = origW ? (origW + dx) / origW : 1; sy = 1; ox = minX; oy = minY; break;
    case 'w':  sx = origW ? (origW - dx) / origW : 1; sy = 1; ox = maxX; oy = minY; break;
    case 's':  sx = 1; sy = origH ? (origH + dy) / origH : 1; ox = minX; oy = minY; break;
    case 'n':  sx = 1; sy = origH ? (origH - dy) / origH : 1; ox = minX; oy = maxY; break;
  }

  if (shiftKey && (scaleHandle === 'nw' || scaleHandle === 'ne' || scaleHandle === 'se' || scaleHandle === 'sw')) {
    const s = Math.abs(dx) > Math.abs(dy) ? sx : sy;
    sx = sy = s;
  }

  if (Math.abs(sx) < 0.001) sx = sx <= 0 ? -0.001 : 0.001;
  if (Math.abs(sy) < 0.001) sy = sy <= 0 ? -0.001 : 0.001;

  return { sx, sy, ox, oy };
}

function updateScaleSelEl(sx, sy, ox, oy) {
  if (!dragSelEl || !scaleBBox) return;
  const { minX, minY, maxX, maxY } = scaleBBox;
  const z  = state.viewport.zoom;
  const sw = 1 / z;
  const x1 = ox + (minX - ox) * sx;
  const y1 = oy + (minY - oy) * sy;
  const x2 = ox + (maxX - ox) * sx;
  const y2 = oy + (maxY - oy) * sy;
  dragSelEl.setAttribute('x',      Math.min(x1, x2) - sw);
  dragSelEl.setAttribute('y',      Math.min(y1, y2) - sw);
  dragSelEl.setAttribute('width',  Math.abs(x2 - x1) + sw * 2);
  dragSelEl.setAttribute('height', Math.abs(y2 - y1) + sw * 2);
  dragSelEl.setAttribute('stroke-width',    sw);
  dragSelEl.setAttribute('stroke-dasharray', `${4 / z},${3 / z}`);
}

// ── Rotate helpers ─────────────────────────────────────────────────────────────

function enterRotateMode() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of state.selection) {
    const found = findShape(id);
    if (!found) continue;
    const bb = getBBox(found.shape);
    if (!bb || (bb.width === 0 && bb.height === 0)) continue;
    minX = Math.min(minX, bb.x); minY = Math.min(minY, bb.y);
    maxX = Math.max(maxX, bb.x + bb.width); maxY = Math.max(maxY, bb.y + bb.height);
  }
  if (!isFinite(minX)) return;

  rotateCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  rotateStartAngle = Math.atan2(dragStart.y - rotateCenter.y, dragStart.x - rotateCenter.x) * 180 / Math.PI;

  scaleSnapshots.clear();
  for (const id of state.selection) {
    const found = findShape(id);
    if (!found) continue;
    scaleSnapshots.set(id, {
      attrs:      JSON.parse(JSON.stringify(found.shape.attrs)),
      _rotation:  found.shape._rotation || 0,
      _rotCx:     rotateCenter.x,
      _rotCy:     rotateCenter.y,
      _scaleX:    found.shape._scaleX,
      _scaleY:    found.shape._scaleY,
      _fontSize:  found.shape._fontSize,
      _boxWidth:  found.shape._boxWidth,
      _boxHeight: found.shape._boxHeight,
    });
  }

  document.getElementById('overlay').innerHTML = '';
  document.getElementById('overlay-hit').innerHTML = '';
  document.getElementById('canvas').style.cursor = 'crosshair';
  mode = 'rotate';
}

// ── Drag helpers ───────────────────────────────────────────────────────────────

function initDrag() {
  dragBBoxes.clear();
  for (const id of state.selection) {
    const found = findShape(id);
    if (!found) continue;
    const bb = getBBox(found.shape);
    if (bb && (bb.width > 0 || bb.height > 0))
      dragBBoxes.set(id, { x: bb.x, y: bb.y, width: bb.width, height: bb.height });
  }

  // Replace overlay contents with a persistent selection rect for the drag session.
  const ov = document.getElementById('overlay');
  ov.innerHTML = '';
  document.getElementById('overlay-hit').innerHTML = '';
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
  for (const id of dragBBoxes.keys()) {
    const el = getElement(id);
    if (!el) continue;
    const found = findShape(id);
    if (found?.shape.type === 'text') {
      // Restore attrs from snap so the scale transform re-renders at the pre-drag position.
      // The mouseup handler will then apply the final translation.
      const snap = snapshots.get(id);
      if (snap) Object.assign(found.shape.attrs, JSON.parse(JSON.stringify(snap)));
      syncElement(el, found.shape);
    } else {
      el.removeAttribute('transform');
    }
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
