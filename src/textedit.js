/**
 * Shared textarea overlay for editing text shapes.
 * A singleton <textarea> is repositioned per edit session.
 *
 * Point text: auto-expands width and height via a mirror <span>.
 * Area text:  fixed size, scrollTop pinned to 0 so overflow exits at the bottom.
 */
import { docToScreen, getCanvasRect } from './viewport.js';
import { state } from './core/state.js';

const TA_ID     = 'text-edit-ta';
const MIRROR_ID = 'text-edit-mirror';

let _ta     = null;
let _mirror = null;
let _active = false;
let _editingShapeId  = null; // id of the shape being re-edited, or null for new text
let _pendingGuide    = null; // guide data for in-progress new-text creation

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
 * @property {number}   [zoom]
 * @property {number}   [boxWidth]
 * @property {number}   [boxHeight]
 * @property {string}   [shapeId]      - id of existing shape being re-edited
 * @property {string}   [initialText]
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
    zoom = 1,
    boxWidth, boxHeight,
    shapeId = null,
    initialText = '',
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

  const screen     = docToScreen(docX, docY);
  const canvasRect = getCanvasRect();
  const screenX    = screen.x - canvasRect.left;
  const screenY    = screen.y - canvasRect.top;

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
    transform:       xRatio !== 1 ? `scaleX(${xRatio})` : '',
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

  setTimeout(() => _ta.focus(), 0);

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
