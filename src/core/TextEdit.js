/**
 * Shared textarea overlay for editing text shapes.
 * A singleton <textarea> is repositioned per edit session.
 *
 * Point text: auto-expands width and height via a mirror <span>.
 * Area text:  fixed size, scrollTop pinned to 0 so overflow exits at the bottom.
 */
import { docToScreen, getCanvasRect } from './Viewport.js';
import { state } from './state.js';

const TA_ID     = 'text-edit-ta';
const MIRROR_ID = 'text-edit-mirror';

let _ta     = null;
let _mirror = null;
let _active = false;
let _editingShapeId  = null; // id of the shape being re-edited, or null for new text
let _pendingGuide    = null; // guide data for in-progress new-text creation

// Parameters captured at session start — used by charIndexAtPoint().
let _editOriginX    = 0;   // client X of the textarea's rotation-origin point
let _editOriginY    = 0;   // client Y
let _editRotRad     = 0;   // rotation in radians
let _editXRatio     = 1;   // CSS scaleX ratio applied to the textarea
let _editFontPx     = 14;  // CSS font-size in screen pixels
let _editFontFamily = 'sans-serif';
let _editTextAlign  = 'left';

let _measureCtx = null;
function _getMeasureCtx() {
  if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
  return _measureCtx;
}

function _ensureEls() {
  if (_ta) return;

  _ta = document.createElement('textarea');
  _ta.id = TA_ID;
  _ta.style.cssText = [
    'position:absolute', 'z-index:1000', 'border:none', 'outline:none',
    'resize:none', 'overflow:hidden', 'background:transparent',
    'padding:0', 'margin:0', 'line-height:1.3', 'white-space:pre',
  ].join(';');

  _mirror = document.createElement('span');
  _mirror.id = MIRROR_ID;
  _mirror.style.cssText = [
    'position:absolute', 'visibility:hidden', 'white-space:pre',
    'pointer-events:none', 'top:-9999px', 'left:-9999px',
  ].join(';');

  const wrap = document.querySelector('.canvas-wrap') ?? document.body;
  wrap.appendChild(_ta);
  wrap.appendChild(_mirror);
}

/**
 * Returns the id of the shape currently being edited, or null.
 * Used by the renderer to hide the live SVG element during editing.
 */
export function getEditingShapeId() { return _editingShapeId; }

/**
 * Returns live guide data while a brand-new text shape is being typed,
 * or null when editing an existing shape (which has its own item in state).
 * @returns {{ x, y, fontSize, fontFamily, textAlign, text }|null}
 */
export function getPendingGuide() { return _pendingGuide; }

/**
 * @typedef {Object} EditOptions
 * @property {number}   docX
 * @property {number}   docY
 * @property {number}   fontSize       - base font size (unscaled)
 * @property {string}   fill
 * @property {string}   [fontFamily]
 * @property {number}   [scaleX]       - horizontal scale factor (default 1)
 * @property {number}   [scaleY]       - vertical scale factor (default 1)
 * @property {number}   [rotation]     - rotation in degrees (default 0)
 * @property {number}   [zoom]
 * @property {number}   [boxWidth]
 * @property {number}   [boxHeight]
 * @property {string}   [shapeId]      - id of existing shape being re-edited
 * @property {string}   [initialText]
 * @property {number}   [clickX]       - screen clientX of the originating mousedown (enables immediate caret placement)
 * @property {number}   [clickY]       - screen clientY of the originating mousedown
 * @property {Function} [onInput]      - (text: string) => void  — called on every keystroke
 * @property {Function} onCommit       - (text: string) => void
 * @property {Function} [onCancel]     - () => void
 */

/**
 * Start a text editing session.
 * @param {EditOptions} opts
 */
export function startEditing(opts) {
  _ensureEls();
  const {
    docX, docY, fontSize, fill,
    fontFamily = 'sans-serif',
    textAlign  = 'left',
    scaleX = 1,
    scaleY = 1,
    rotation = 0,
    zoom = 1,
    boxWidth, boxHeight,
    shapeId = null,
    initialText = '',
    clickX, clickY,
    onInput, onCommit, onCancel,
  } = opts;

  _editingShapeId   = shapeId;
  _pendingGuide     = shapeId === null
    ? { x: docX, y: docY, fontSize, fontFamily, textAlign, text: initialText }
    : null;
  state.operation   = 'text-edit';

  const isArea  = boxWidth != null && boxHeight != null;
  // Apply scale: scaleY enlarges the rendered font; scaleX stretches horizontally
  const px      = fontSize * scaleY * zoom;
  const xRatio  = scaleX / scaleY; // CSS scaleX applied on top of the scaleY-adjusted font
  const transforms = [];
  if (rotation !== 0) transforms.push(`rotate(${rotation}deg)`);
  if (xRatio !== 1)   transforms.push(`scaleX(${xRatio})`);

  const screen     = docToScreen(docX, docY);
  const canvasRect = getCanvasRect();
  const screenX    = screen.x - canvasRect.left;
  const screenY    = screen.y - canvasRect.top;

  // Store params for charIndexAtPoint().  screen.x/y are absolute client coords of
  // the textarea's transform-origin (top-left corner for left-aligned text).
  _editOriginX    = screen.x;
  _editOriginY    = screen.y;
  _editRotRad     = rotation * Math.PI / 180;
  _editXRatio     = xRatio;
  _editFontPx     = px;
  _editFontFamily = fontFamily;
  _editTextAlign  = textAlign;

  const origin = textAlign === 'center' ? 'center top'
               : textAlign === 'right'  ? 'right top'
               :                          'left top';

  Object.assign(_ta.style, {
    left:            `${screenX}px`,
    top:             `${screenY}px`,
    fontSize:        `${px}px`,
    fontFamily:      fontFamily,
    textAlign:       textAlign,
    color:           fill,
    width:           isArea ? `${boxWidth  * zoom}px` : '4px',
    height:          isArea ? `${boxHeight * zoom}px` : `${px * 1.3}px`,
    overflow:        'hidden',
    transform:       transforms.join(' '),
    transformOrigin: origin,
  });

  Object.assign(_mirror.style, {
    fontSize:   `${px}px`,
    fontFamily: fontFamily,
  });

  _ta.value = initialText;

  _ta.oninput = () => {
    if (isArea) {
      _ta.scrollTop = 0;
    } else {
      _autoResize(px);
    }
    if (_pendingGuide) _pendingGuide.text = _ta.value;
    if (onInput) onInput(_ta.value);
  };

  _ta.style.display = 'block';
  _active = true;

  // Trigger initial sizing for existing text
  if (initialText && !isArea) _autoResize(px);

  if (clickX !== undefined && clickY !== undefined) {
    // Focus synchronously now that the textarea is visible and correctly sized,
    // then position the caret via setSelectionRange (reliable across all browsers
    // unlike synthetic mousedown which browsers may ignore for trust reasons).
    _ta.focus();
    const idx = charIndexAtPoint(clickX, clickY);
    _ta.setSelectionRange(idx, idx);
  } else {
    setTimeout(() => _ta.focus(), 0);
  }

  _ta.onblur    = () => _commit(onCommit);
  _ta.onkeydown = e => {
    if (e.key === 'Escape') { _cancel(onCancel); e.preventDefault(); }
  };
}

function _commit(onCommit) {
  if (!_active) return;
  _active = false;
  _editingShapeId  = null;
  _pendingGuide    = null;
  state.operation  = null;
  const text = _ta.value;
  _ta.style.display   = 'none';
  _ta.style.transform = '';
  _ta.onblur    = null;
  _ta.onkeydown = null;
  _ta.oninput   = null;
  if (onCommit) onCommit(text);
}

function _cancel(onCancel) {
  if (!_active) return;
  _active = false;
  _editingShapeId  = null;
  _pendingGuide    = null;
  state.operation  = null;
  _ta.style.display   = 'none';
  _ta.style.transform = '';
  _ta.onblur    = null;
  _ta.onkeydown = null;
  _ta.oninput   = null;
  if (onCancel) onCancel();
}

function _autoResize(px) {
  // Measure each line separately to find the widest, then auto-height.
  let maxW = 4;
  for (const line of (_ta.value || ' ').split('\n')) {
    _mirror.textContent = line || ' ';
    maxW = Math.max(maxW, _mirror.scrollWidth);
  }
  _ta.style.width  = `${maxW + 2}px`;
  _ta.style.height = 'auto';
  _ta.style.height = `${_ta.scrollHeight}px`;
}

export const isEditing = () => _active;

/** Synchronously commit the active editing session (no-op if not editing). */
export function commitEditing() {
  if (_active) _ta.blur();
}

/**
 * Compute the character index in the textarea's current text that corresponds
 * to a screen-space point (clientX, clientY).  Uses the font metrics and
 * transform parameters captured by the most-recent startEditing() call.
 * @returns {number}
 */
export function charIndexAtPoint(clientX, clientY) {
  if (!_ta || !_active) return 0;

  // Reverse the CSS transform (rotate then scaleX) to get local textarea coords.
  const dx  = clientX - _editOriginX;
  const dy  = clientY - _editOriginY;
  const cos = Math.cos(-_editRotRad);
  const sin = Math.sin(-_editRotRad);
  const lx  = (dx * cos - dy * sin) / _editXRatio;
  const ly  =  dx * sin + dy * cos;

  const text    = _ta.value;
  const lines   = text.split('\n');
  const lineH   = _editFontPx * 1.3;
  const lineIdx = Math.max(0, Math.min(lines.length - 1, Math.floor(ly / lineH)));
  const line    = lines[lineIdx];

  const mctx = _getMeasureCtx();
  mctx.font  = `${_editFontPx}px ${_editFontFamily}`;

  // Account for text-alignment offset within the textarea's width.
  const taW    = parseFloat(_ta.style.width) || 0;
  const lineW  = mctx.measureText(line).width;
  const startX = _editTextAlign === 'center' ? (taW - lineW) / 2
               : _editTextAlign === 'right'  ? (taW - lineW)
               : 0;

  const relX = lx - startX;

  // Find the character boundary nearest to relX (snap to mid-glyph).
  let charInLine = line.length;
  let prev = 0;
  for (let i = 0; i < line.length; i++) {
    const next = mctx.measureText(line.slice(0, i + 1)).width;
    if (relX < (prev + next) / 2) { charInLine = i; break; }
    prev = next;
  }

  // Convert line-local offset to absolute string offset.
  let abs = charInLine;
  for (let i = 0; i < lineIdx; i++) abs += lines[i].length + 1; // +1 for '\n'
  return Math.min(abs, text.length);
}

/**
 * Update the textarea's selection so that it spans from `anchor` to `active`.
 * Direction is preserved so the cursor follows the active end.
 */
export function setTextareaSelection(anchor, active) {
  if (!_ta || !_active) return;
  if (anchor <= active) {
    _ta.setSelectionRange(anchor, active, 'forward');
  } else {
    _ta.setSelectionRange(active, anchor, 'backward');
  }
}
