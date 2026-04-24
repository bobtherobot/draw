/**
 * Select tool — click-select, rubber-band, move, scale handles, rotate handle.
 * Text shapes: double-click to edit.
 *
 * Transform operations (scale, rotate, move-origin) are delegated to
 * TransformController in transops.js.
 */
import { Tool } from './base.js';
import { startEditing, isEditing } from '../textedit.js';
import { unionBBoxes } from '../geometry/bbox.js';
import { effectiveVisible, effectiveLocked, allDisplayItems, findItem, sanitizeItems } from '../core/state.js';
import { hitTest } from '../core/hit-test.js';
import { handleAtPoint } from '../render/selection.js';
import { applyTransform } from '../viewport.js';
import { getCK } from '../render/renderer.js';
import { TransformController } from './transops.js';
import { cloneShape, restoreShape } from './snapshots.js';

const DBL_CLICK_MS  = 400;

// Scale handle axis angles (degrees, screen-space where y-down) before rotation.
const _BASE_AXIS = { nw: 45, n: 90, ne: 135, e: 0, se: 45, s: 90, sw: 135, w: 0 };
// Bidirectional resize cursors indexed by axis angle / 45.
const _RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
function _handleCursor(part, rotAngle, active) {
  if (part.startsWith('rotate-')) {
    if (active) return 'grabbing';
    return 'var(--cursor-rotate, crosshair)';
  }
  if (part === 'origin') return 'move';
  const base = _BASE_AXIS[part] ?? 0;
  const eff  = ((base + rotAngle) % 180 + 180) % 180;
  return _RESIZE_CURSORS[Math.round(eff / 45) % 4];
}

export class SelectTool extends Tool {
  get id()       { return 'select'; }
  get label()    { return 'Select'; }
  get shortcut() { return 'v'; }
  get icon()     { return 'select'; }

  init(ctx) { super.init(ctx); this._transops = new TransformController(ctx); }

  activate() {
    this._mode       = 'idle'; // 'idle'|'move'|'band'|'transop'
    this._dragStart  = null;
    this._moved      = false;
    this._snapshots  = new Map(); // shapeId → attrs clone
    this._selRotSnap    = null;  // selectionRotation snapshot at move-drag start
    this._selOriginSnap = null;  // selectionOrigin snapshot at move-drag start
    this._lastClickId= null;
    this._lastClickT = 0;
    this._bandLayer  = null;
    this._bandStart  = null;
    this._bandEnd    = null;
    this._canvasWrap = document.querySelector('.canvas-wrap');
    if (this._ctx) this._ctx.render();
  }

  deactivate() {
    if (isEditing()) return; // let textarea commit naturally
    if (this._ctx) this._ctx.state.selectionRotation = null;
    this._clearHandleCursor();
    this._cleanup();
  }

  onMouseDown(e) {
    if (e.button !== 0) return;
    if (isEditing()) return;

    const ctx      = this._ctx;
    const pos      = ctx.screenToDoc(e.clientX, e.clientY);
    const handle   = handleAtPoint(e.clientX, e.clientY);
    const now      = Date.now();

    this._dragStart = pos;
    this._moved     = false;

    // Scale / rotate / origin handles — delegate to TransformController
    if (handle && ctx.state.selection.size > 0) {
      this._lastClickId = null;
      if (this._transops.enter(handle.part, pos)) {
        this._mode = 'transop';
        this._setHandleCursor(handle.part, true);
        return;
      }
    }

    // Hit-test shapes
    const hitId = this._shapeIdAt(e.clientX, e.clientY);

    // Handle double-click on text shapes
    if (hitId && hitId === this._lastClickId && now - this._lastClickT < DBL_CLICK_MS) {
      const shape = findItem(hitId);
      if (shape && (shape.type === 'free-text' || shape.type === 'text-block')) {
        this._lastClickId = null;
        this._openTextEditor(shape, hitId);
        return;
      }
    }
    this._lastClickId = hitId ?? null;
    this._lastClickT  = now;
    if (hitId) {
      if (!e.shiftKey && !ctx.state.selection.has(hitId)) {
        // Switching to a different shape — new selection, discard session state.
        ctx.state.selectionOrigin   = null;
        ctx.state.selectionRotation = null;
        ctx.state.selection = new Set([hitId]);
      } else if (e.shiftKey) {
        // Modifying selection — discard session state.
        ctx.state.selectionOrigin   = null;
        ctx.state.selectionRotation = null;
        const sel = new Set(ctx.state.selection);
        if (sel.has(hitId)) sel.delete(hitId); else sel.add(hitId);
        ctx.state.selection = sel;
      }
      // else: clicking an already-selected shape to move — keep session state.
      this._mode = 'move';
      ctx.state.operation = 'move';
      this._snapshotMove();
      ctx.render();
    } else {
      // Clicking empty space — discard session state.
      ctx.state.selectionOrigin   = null;
      ctx.state.selectionRotation = null;
      if (!e.shiftKey) ctx.state.selection = new Set();
      this._mode      = 'band';
      ctx.state.operation = 'band';
      this._bandLayer = ctx.overlay.acquireLayer('select-band');
      this._bandStart = pos;
      this._bandEnd   = pos;
      this._bandLayer.addCall(canvasCtx => this._drawBand(canvasCtx));
      ctx.render();
    }
  }

  onMouseMove(e) {
    if (this._mode === 'idle') {
      const handle = handleAtPoint(e.clientX, e.clientY);
      this._setHandleCursor(handle?.part ?? null);
      return;
    }
    const ctx = this._ctx;
    const pos = ctx.screenToDoc(e.clientX, e.clientY);
    const dx  = pos.x - this._dragStart.x;
    const dy  = pos.y - this._dragStart.y;
    if (Math.hypot(dx, dy) > 0.5) this._moved = true;

    if (this._mode === 'move') {
      for (const id of ctx.state.selection) {
        const shape = findItem(id);
        if (!shape) continue;
        const snap = this._snapshots.get(id);
        if (!snap) continue;
        const ot = ctx.getObjectType(shape.type);
        if (!ot) continue;
        restoreShape(shape, snap);
        ot.translate(shape, dx, dy);
        if (snap._origin) shape._origin = { x: snap._origin.x + dx, y: snap._origin.y + dy };
      }
      if (this._selRotSnap) {
        const s = this._selRotSnap;
        ctx.state.selectionRotation = {
          bbox:   { x: s.bbox.x + dx, y: s.bbox.y + dy, width: s.bbox.width, height: s.bbox.height },
          center: { x: s.center.x + dx, y: s.center.y + dy },
          angle:  s.angle,
        };
      }
      if (this._selOriginSnap) {
        ctx.state.selectionOrigin = { x: this._selOriginSnap.x + dx, y: this._selOriginSnap.y + dy };
      }
      ctx.render();
    } else if (this._mode === 'band') {
      this._bandEnd = pos;
      ctx.render();
    } else if (this._mode === 'transop') {
      this._transops.update(pos, e.shiftKey);
      ctx.render();
    }
  }

  onMouseUp(e) {
    if (this._mode === 'idle') return;
    const ctx  = this._ctx;
    const pos  = ctx.screenToDoc(e.clientX, e.clientY);

    if (this._mode === 'move' && this._moved) {
      const snapshots = new Map(this._snapshots);
      const postSnaps = new Map();
      for (const id of ctx.state.selection) {
        const shape = findItem(id);
        if (shape) postSnaps.set(id, cloneShape(shape));
      }
      ctx.execute({
        do() {
          for (const [id, snap] of postSnaps) {
            const shape = findItem(id);
            if (shape) restoreShape(shape, snap);
          }
          ctx.render();
        },
        undo() {
          for (const [id, snap] of snapshots) {
            const shape = findItem(id);
            if (shape) restoreShape(shape, snap);
          }
          ctx.render();
        },
      });
    } else if (this._mode === 'move' && !this._moved) {
      // Simple click — no move, selection already set on mousedown
    } else if (this._mode === 'band') {
      this._commitBand(pos, e.shiftKey);
    } else if (this._mode === 'transop') {
      this._transops.commit(this._moved);
    }

    this._cleanup();
    this._mode = 'idle';
    ctx.render();
  }

  onDblClick(e) {
    // Double-click handled via manual detection in onMouseDown
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      this._ctx.state.selection        = new Set();
      this._ctx.state.selectionOrigin  = null;
      this._ctx.state.selectionRotation = null;
      this._cleanup();
      this._ctx.render();
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditing()) {
      this._deleteSelected();
    }
  }

  // ── Move ────────────────────────────────────────────────────────────────────

  _snapshotMove() {
    this._snapshots.clear();
    for (const id of this._ctx.state.selection) {
      const shape = findItem(id);
      if (shape) this._snapshots.set(id, cloneShape(shape));
    }
    const sr = this._ctx.state.selectionRotation;
    this._selRotSnap = sr
      ? { bbox: { ...sr.bbox }, center: { ...sr.center }, angle: sr.angle }
      : null;
    const so = this._ctx.state.selectionOrigin;
    this._selOriginSnap = so ? { x: so.x, y: so.y } : null;
  }

  // ── Rubber band ─────────────────────────────────────────────────────────────

  _commitBand(end, additive) {
    const s  = this._dragStart;
    const x0 = Math.min(s.x, end.x), y0 = Math.min(s.y, end.y);
    const x1 = Math.max(s.x, end.x), y1 = Math.max(s.y, end.y);
    if (Math.abs(x1-x0) < 2 && Math.abs(y1-y0) < 2) return;

    const ctx = this._ctx;
    const sel = additive ? new Set(ctx.state.selection) : new Set();
    for (const shape of allDisplayItems()) {
      if (!effectiveVisible(shape)) continue;
      if (effectiveLocked(shape)) continue;
      const ot = ctx.getObjectType(shape.type);
      const bb = ot?.getBBox(shape);
      if (!bb) continue;
      if (bb.x >= x0 && bb.x + bb.width  <= x1 &&
          bb.y >= y0 && bb.y + bb.height <= y1) {
        sel.add(shape.id);
      }
    }
    ctx.state.selection        = sel;
    ctx.state.selectionRotation = null;
  }

  // ── Text editing ─────────────────────────────────────────────────────────────

  _openTextEditor(shape, shapeId) {
    const ctx  = this._ctx;
    const snap = cloneShape(shape);
    startEditing({
      docX:        shape.attrs.x,
      docY:        shape.attrs.y,
      fontSize:    shape._fontSize   ?? 14,
      fontFamily:  shape._fontFamily ?? 'sans-serif',
      textAlign:   shape._textAlign  ?? 'left',
      fill:        shape.style.fill  ?? '#000000',
      scaleX:      shape._scaleX     ?? 1,
      scaleY:      shape._scaleY     ?? 1,
      zoom:        ctx.state.viewport.zoom,
      shapeId,
      boxWidth:    shape.type === 'text-block' ? shape._boxWidth  : undefined,
      boxHeight:   shape.type === 'text-block' ? shape._boxHeight : undefined,
      initialText: shape._text ?? '',
      onInput: (text) => {
        // Live-update the shape so text guides reflect current content while typing.
        // The SVG element is hidden by the renderer while shapeId === getEditingShapeId().
        const s = findItem(shapeId);
        if (s) { s._text = text; ctx.render(); }
      },
      onCommit: (text) => {
        // Restore snap text first so execute's do() starts from a clean state
        const s = findItem(shapeId);
        if (s) s._text = snap._text;
        ctx.execute({
          do()   { const s = findItem(shapeId); if (s) { s._text = text; ctx.getObjectType(s.type)?.syncRotDisplay?.(s); ctx.render(); } },
          undo() { const s = findItem(shapeId); if (s) { restoreShape(s, snap); ctx.render(); } },
        });
      },
      onCancel: () => {
        const s = findItem(shapeId);
        if (s) { restoreShape(s, snap); ctx.render(); }
      },
    });
    ctx.render(); // hide SVG shape immediately, show textarea
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  deleteSelected() { this._deleteSelected(); }

  _deleteSelected() {
    const ctx = this._ctx;
    const ids = [...ctx.state.selection];
    if (ids.length === 0) return;

    const oldItems = [...ctx.state.items];
    const oldSel   = new Set(ctx.state.selection);

    ctx.execute({
      do() {
        ctx.state.items             = ctx.state.items.filter(i => !ids.includes(i.id));
        sanitizeItems(ctx.state.items);
        ctx.state.selection          = new Set();
        ctx.state.selectionRotation  = null;
        ctx.render();
      },
      undo() {
        ctx.state.items     = oldItems;
        ctx.state.selection = oldSel;
        ctx.render();
      },
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  _shapeIdAt(screenX, screenY) {
    const ctx  = this._ctx;
    const hit  = hitTest(screenX, screenY, ctx.getObjectType);
    if (!hit || hit.isHandle || !hit.shape) return null;
    if (effectiveLocked(hit.shape)) return null;
    return hit.shape.id;
  }

  _drawBand(ckCanvas) {
    if (!this._bandStart || !this._bandEnd) return;
    const CK     = getCK();
    const s      = this._bandStart;
    const e      = this._bandEnd;
    const x      = Math.min(s.x, e.x);
    const y      = Math.min(s.y, e.y);
    const w      = Math.abs(e.x - s.x);
    const h      = Math.abs(e.y - s.y);
    const z      = this._ctx.state.viewport.zoom;
    const accent = _css('--theme-accent')    || '#4a9eff';
    const sel    = _css('--theme-selection') || 'rgba(74,158,255,0.22)';
    ckCanvas.save();
    applyTransform(ckCanvas);
    const rect = CK.XYWHRect(x, y, w, h);

    const fillPaint = new CK.Paint();
    fillPaint.setStyle(CK.PaintStyle.Fill);
    fillPaint.setColor(CK.parseColorString(sel));
    ckCanvas.drawRect(rect, fillPaint);
    fillPaint.delete();

    const dashPaint = new CK.Paint();
    dashPaint.setStyle(CK.PaintStyle.Stroke);
    dashPaint.setColor(CK.parseColorString(accent));
    dashPaint.setStrokeWidth(1 / z);
    const dashEffect = CK.PathEffect.MakeDash([4 / z, 3 / z]);
    dashPaint.setPathEffect(dashEffect);
    ckCanvas.drawRect(rect, dashPaint);
    dashEffect.delete();
    dashPaint.delete();

    ckCanvas.restore();
  }

  _cleanup() {
    if (this._bandLayer) {
      this._ctx?.overlay.releaseLayer('select-band');
      this._bandLayer = null;
      this._bandStart = null;
      this._bandEnd   = null;
    }
    this._snapshots.clear();
    this._selRotSnap    = null;
    this._selOriginSnap = null;
    this._transops.reset();
    this._clearHandleCursor();
  }

  _setHandleCursor(part, active = false) {
    if (!this._canvasWrap) return;
    this._canvasWrap.style.cursor = part
      ? _handleCursor(part, this._getSelectionAngle(), active)
      : '';
  }

  _clearHandleCursor() {
    if (this._canvasWrap) this._canvasWrap.style.cursor = '';
  }

  _getSelectionAngle() {
    const { state } = this._ctx;
    if (state.activeRotation)    return state.activeRotation.angle;
    if (state.selectionRotation) return state.selectionRotation.angle;
    if (state.selection.size === 1) {
      const shape = findItem([...state.selection][0]);
      return shape?._rotDisplay?.angle ?? 0;
    }
    return 0;
  }
}

// ── Module-level helpers ─────────────────────────────────────────────────────

function _css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
