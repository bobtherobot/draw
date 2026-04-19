/**
 * Shared textarea overlay for editing text shapes.
 * A singleton <textarea> is repositioned per edit session.
 *
 * Point text: auto-expands width via a mirror <span>.
 * Area text:  fixed size, scrollTop pinned to 0 so overflow exits at the bottom.
 */
import { screenToDoc } from './viewport.js';

const TA_ID     = 'text-edit-ta';
const MIRROR_ID = 'text-edit-mirror';

let _ta     = null;
let _mirror = null;
let _active = false;

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

  const wrap = document.getElementById('canvas-wrap') ?? document.body;
  wrap.appendChild(_ta);
  wrap.appendChild(_mirror);
}

/**
 * @typedef {Object} EditOptions
 * @property {number}   docX
 * @property {number}   docY
 * @property {number}   fontSize
 * @property {string}   fill
 * @property {number}   zoom
 * @property {number}   [boxWidth]
 * @property {number}   [boxHeight]
 * @property {string}   [initialText]
 * @property {Function} onCommit     - (text: string) => void
 */

/**
 * Start a text editing session.
 * @param {EditOptions} opts
 */
export function startEditing(opts) {
  _ensureEls();
  const { docX, docY, fontSize, fill, zoom, boxWidth, boxHeight, initialText = '', onCommit } = opts;

  const isArea = boxWidth != null && boxHeight != null;

  // Position
  const canvasRect = document.getElementById('canvas').getBoundingClientRect();
  const screenX    = (docX - (window._vpState?.x ?? 0)) * zoom + canvasRect.left;
  const screenY    = (docY - (window._vpState?.y ?? 0)) * zoom + canvasRect.top;

  const px = fontSize * zoom;

  Object.assign(_ta.style, {
    left:       `${screenX}px`,
    top:        `${screenY}px`,
    fontSize:   `${px}px`,
    color:      fill,
    fontFamily: 'sans-serif',
    width:      isArea ? `${boxWidth * zoom}px`  : '4px',
    height:     isArea ? `${boxHeight * zoom}px` : `${px * 1.3}px`,
    overflow:   isArea ? 'hidden' : 'hidden',
  });

  if (!isArea) {
    Object.assign(_mirror.style, { fontSize: `${px}px`, fontFamily: 'sans-serif' });
  }

  _ta.value = initialText;
  _ta.oninput = () => {
    if (isArea) {
      _ta.scrollTop = 0;
    } else {
      _mirror.textContent = _ta.value || ' ';
      _ta.style.width = `${Math.max(4, _mirror.scrollWidth)}px`;
    }
  };

  _ta.style.display = 'block';
  _active = true;

  setTimeout(() => _ta.focus(), 0);

  _ta._commitHandler = () => commit(onCommit);

  _ta.onblur = () => commit(onCommit);
  _ta.onkeydown = e => {
    if (e.key === 'Escape') { cancel(); e.preventDefault(); }
    if (!isArea && e.key === 'Enter') { commit(onCommit); e.preventDefault(); }
  };

  // Trigger initial size for point text
  if (!isArea) _ta.oninput();
}

function commit(onCommit) {
  if (!_active) return;
  _active = false;
  const text = _ta.value;
  _ta.style.display = 'none';
  _ta.onblur = null;
  _ta.onkeydown = null;
  _ta.oninput = null;
  if (onCommit) onCommit(text);
}

function cancel() {
  if (!_active) return;
  _active = false;
  _ta.style.display = 'none';
  _ta.onblur = null;
  _ta.onkeydown = null;
  _ta.oninput = null;
}

export const isEditing = () => _active;
